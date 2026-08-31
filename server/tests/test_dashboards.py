"""
Dashboard tests, with the emphasis on the sharing boundary.

A share link is a capability handed to people outside the account, so what it
does and does not expose is the security-critical part of this feature.
"""
import pytest

from app.extensions import db
from app.models.conversation_model import Conversation, Message
from app.models.dashboard_model import Dashboard
from app.models.utils import to_uuid


@pytest.fixture()
def analysis(app, user, dataset):
    """A completed assistant turn the user can pin."""
    conversation = Conversation(
        user_id=user.id,
        dataset_id=dataset.id,
        title='What is the total revenue by city?',
    )
    db.session.add(conversation)
    db.session.flush()

    message = Message(
        conversation_id=conversation.id,
        role='assistant',
        content='Yangon leads with 1,912.95.',
        sql_query='SELECT city, SUM(total) FROM csv_data GROUP BY city',
        visualization='bar',
        chart_image_base64='iVBORw0KGgo=',
        result_rows=[['Yangon', 1912.95], ['Mandalay', 1116.67]],
        result_columns=['city', 'revenue'],
    )
    db.session.add(message)
    db.session.commit()
    return message


@pytest.fixture()
def other_analysis(app, other_user, dataset):
    """An assistant turn belonging to a different user."""
    conversation = Conversation(
        user_id=other_user.id, dataset_id=dataset.id, title="Someone else's question"
    )
    db.session.add(conversation)
    db.session.flush()

    message = Message(
        conversation_id=conversation.id,
        role='assistant',
        content='Confidential result.',
        sql_query='SELECT secret FROM t',
    )
    db.session.add(message)
    db.session.commit()
    return message


def create_dashboard(client, title='My dashboard') -> str:
    response = client.post('/api/dashboards', json={'title': title})
    assert response.status_code == 201, response.get_json()
    return response.get_json()['data']['dashboard']['id']


class TestAuthentication:
    def test_every_owner_endpoint_requires_a_session(self, client):
        assert client.get('/api/dashboards').status_code == 401
        assert client.post('/api/dashboards', json={}).status_code == 401


class TestOwnership:
    def test_dashboards_are_scoped_to_their_owner(self, client, sign_in, user, other_user):
        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        client.post('/api/auth/logout')
        sign_in(other_user.email)

        assert client.get('/api/dashboards').get_json()['data']['dashboards'] == []
        assert client.get(f'/api/dashboards/{dashboard_id}').status_code == 404
        assert client.delete(f'/api/dashboards/{dashboard_id}').status_code == 404
        assert client.patch(f'/api/dashboards/{dashboard_id}', json={'title': 'Mine now'}).status_code == 404

    def test_another_users_result_cannot_be_pinned(self, client, sign_in, user, other_analysis):
        """
        The important one: without this check a user could pin someone else's
        result and then publish it through a share link.
        """
        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        response = client.post(
            f'/api/dashboards/{dashboard_id}/tiles',
            json={'messageId': str(other_analysis.id)},
        )
        assert response.status_code == 404

    def test_a_malformed_message_id_is_rejected_cleanly(self, client, sign_in, user):
        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        for bad in ['not-a-uuid', '', '../../etc/passwd']:
            response = client.post(
                f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': bad}
            )
            assert response.status_code == 400


class TestPinning:
    def test_a_result_can_be_pinned_and_read_back(self, client, sign_in, user, analysis):
        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        response = client.post(
            f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)}
        )
        assert response.status_code == 201

        tile = response.get_json()['data']['tile']
        # The title defaults to the question that produced the result.
        assert 'total revenue by city' in tile['title']
        assert tile['chart_image_base64'] == 'iVBORw0KGgo='

        dashboard = client.get(f'/api/dashboards/{dashboard_id}').get_json()['data']['dashboard']
        assert dashboard['tile_count'] == 1
        assert dashboard['tiles'][0]['result_rows'] == [['Yangon', 1912.95], ['Mandalay', 1116.67]]

    def test_pinning_a_chart_view_falls_back_when_there_is_no_chart(
        self, client, sign_in, user, dataset
    ):
        """Requesting a chart tile for a chartless result would render an empty box."""
        conversation = Conversation(user_id=user.id, dataset_id=dataset.id, title='Count')
        db.session.add(conversation)
        db.session.flush()
        message = Message(
            conversation_id=conversation.id,
            role='assistant',
            content='42 rows.',
            result_rows=[[42]],
        )
        db.session.add(message)
        db.session.commit()

        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        response = client.post(
            f'/api/dashboards/{dashboard_id}/tiles',
            json={'messageId': str(message.id), 'view': 'chart'},
        )
        assert response.get_json()['data']['tile']['view'] == 'table'

    def test_tiles_can_be_reordered(self, client, sign_in, user, analysis):
        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        ids = []
        for _ in range(3):
            response = client.post(
                f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)}
            )
            ids.append(response.get_json()['data']['tile']['id'])

        reversed_ids = list(reversed(ids))
        response = client.patch(
            f'/api/dashboards/{dashboard_id}/tiles/order', json={'tileIds': reversed_ids}
        )
        assert response.status_code == 200

        tiles = response.get_json()['data']['dashboard']['tiles']
        assert [t['id'] for t in tiles] == reversed_ids

    def test_removing_a_tile_keeps_positions_contiguous(self, client, sign_in, user, analysis):
        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        ids = [
            client.post(
                f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)}
            ).get_json()['data']['tile']['id']
            for _ in range(3)
        ]

        client.delete(f'/api/dashboards/{dashboard_id}/tiles/{ids[0]}')

        tiles = client.get(f'/api/dashboards/{dashboard_id}').get_json()['data']['dashboard']['tiles']
        # A gap would make later inserts collide on position.
        assert [t['position'] for t in tiles] == [0, 1]

    def test_the_tile_count_is_capped(self, client, sign_in, user, analysis, monkeypatch):
        from app.routes import dashboard_routes

        monkeypatch.setattr(dashboard_routes, 'MAX_TILES', 2)

        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        for _ in range(2):
            assert (
                client.post(
                    f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)}
                ).status_code
                == 201
            )

        response = client.post(
            f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)}
        )
        assert response.status_code == 400


class TestSharing:
    def _shared_dashboard(self, client, analysis) -> tuple[str, str]:
        dashboard_id = create_dashboard(client)
        client.post(f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)})

        response = client.patch(f'/api/dashboards/{dashboard_id}', json={'shared': True})
        token = response.get_json()['data']['dashboard']['share_token']
        return dashboard_id, token

    def test_sharing_is_off_until_enabled(self, client, sign_in, user, analysis):
        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        dashboard = client.get(f'/api/dashboards/{dashboard_id}').get_json()['data']['dashboard']
        assert dashboard['is_shared'] is False
        assert dashboard['share_token'] is None

    def test_the_share_token_is_not_the_dashboard_id(self, client, sign_in, user, analysis):
        """
        The id appears in the owner's own URLs and logs. Reusing it as the
        capability would make every dashboard guessable from anywhere it had been
        mentioned.
        """
        sign_in(user.email)
        dashboard_id, token = self._shared_dashboard(client, analysis)

        assert token != dashboard_id
        assert dashboard_id not in token
        # High entropy, so the token space cannot be walked.
        assert len(token) >= 32

    def test_a_shared_dashboard_is_readable_without_a_session(self, client, sign_in, user, analysis):
        sign_in(user.email)
        _, token = self._shared_dashboard(client, analysis)
        client.post('/api/auth/logout')

        response = client.get(f'/api/public/dashboards/{token}')
        assert response.status_code == 200

        dashboard = response.get_json()['data']['dashboard']
        assert dashboard['tiles'][0]['chart_image_base64'] == 'iVBORw0KGgo='

    def test_the_public_payload_withholds_sql_and_account_details(
        self, client, sign_in, user, analysis
    ):
        """
        A shared link should convey findings, not the data model or who owns it.
        The SQL discloses the schema, so it is stripped.
        """
        sign_in(user.email)
        _, token = self._shared_dashboard(client, analysis)
        client.post('/api/auth/logout')

        body = client.get(f'/api/public/dashboards/{token}').get_data(as_text=True)

        assert 'SELECT city' not in body
        assert 'sql_query' not in body
        assert 'share_token' not in body
        assert 'is_shared' not in body
        assert user.email not in body
        # The finding itself is still there.
        assert 'Yangon' in body

    def test_revoking_sharing_invalidates_the_link_immediately(
        self, client, sign_in, user, analysis
    ):
        sign_in(user.email)
        dashboard_id, token = self._shared_dashboard(client, analysis)

        assert client.get(f'/api/public/dashboards/{token}').status_code == 200

        client.patch(f'/api/dashboards/{dashboard_id}', json={'shared': False})
        assert client.get(f'/api/public/dashboards/{token}').status_code == 404

    def test_re_enabling_sharing_mints_a_new_token(self, client, sign_in, user, analysis):
        """The revoked link must not come back to life."""
        sign_in(user.email)
        dashboard_id, first = self._shared_dashboard(client, analysis)

        client.patch(f'/api/dashboards/{dashboard_id}', json={'shared': False})
        response = client.patch(f'/api/dashboards/{dashboard_id}', json={'shared': True})
        second = response.get_json()['data']['dashboard']['share_token']

        assert second != first
        assert client.get(f'/api/public/dashboards/{first}').status_code == 404
        assert client.get(f'/api/public/dashboards/{second}').status_code == 200

    def test_enabling_sharing_twice_keeps_the_same_link(self, client, sign_in, user, analysis):
        """A link already circulated must not be invalidated by a no-op toggle."""
        sign_in(user.email)
        dashboard_id, first = self._shared_dashboard(client, analysis)

        response = client.patch(f'/api/dashboards/{dashboard_id}', json={'shared': True})
        assert response.get_json()['data']['dashboard']['share_token'] == first

    @pytest.mark.parametrize('token', ['nope', '', 'x' * 100])
    def test_an_unknown_token_is_a_plain_404(self, client, token):
        response = client.get(f'/api/public/dashboards/{token}')
        assert response.status_code in (404, 405)

    def test_a_private_dashboard_is_not_reachable_publicly(self, client, sign_in, user, analysis):
        sign_in(user.email)
        dashboard_id = create_dashboard(client)

        # The id is not a capability, so it must not work against the public route.
        assert client.get(f'/api/public/dashboards/{dashboard_id}').status_code == 404


class TestCascades:
    def test_deleting_a_dashboard_leaves_the_analysis_intact(
        self, client, sign_in, user, analysis
    ):
        sign_in(user.email)
        dashboard_id = create_dashboard(client)
        client.post(f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)})

        client.delete(f'/api/dashboards/{dashboard_id}')

        # Unpinning is not deleting: the conversation must survive.
        assert db.session.get(Message, analysis.id) is not None

    def test_foreign_keys_are_enforced_on_sqlite(self, app):
        """
        SQLite ships with foreign-key enforcement OFF, which made every
        `ondelete='CASCADE'` inert locally while working in production. The
        connect hook that turns it on is what keeps the two environments honest,
        so it is asserted directly rather than only through its effects.
        """
        from sqlalchemy import text

        with app.app_context():
            enabled = db.session.execute(text('PRAGMA foreign_keys')).scalar()
            assert enabled == 1

    def test_deleting_a_user_leaves_no_orphans(self, client, sign_in, user, analysis):
        """Removing an account must take its datasets, conversations and tiles."""
        sign_in(user.email)
        dashboard_id = create_dashboard(client)
        client.post(f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)})

        from app.models.dashboard_model import DashboardTile
        from app.models.dataset_model import Dataset

        db.session.delete(db.session.get(type(user), user.id))
        db.session.commit()

        assert db.session.query(Dataset).count() == 0
        assert db.session.query(Conversation).count() == 0
        assert db.session.query(Message).count() == 0
        assert db.session.query(Dashboard).count() == 0
        assert db.session.query(DashboardTile).count() == 0

    def test_deleting_the_conversation_removes_its_tiles(self, client, sign_in, user, analysis):
        """A tile whose source is gone has nothing to render."""
        sign_in(user.email)
        dashboard_id = create_dashboard(client)
        client.post(f'/api/dashboards/{dashboard_id}/tiles', json={'messageId': str(analysis.id)})

        conversation = db.session.get(Conversation, analysis.conversation_id)
        db.session.delete(conversation)
        db.session.commit()

        # to_uuid: the route returns the id as a string, and sa.Uuid columns need
        # a real UUID rather than coercing on the driver's behalf.
        dashboard = db.session.get(Dashboard, to_uuid(dashboard_id))
        db.session.refresh(dashboard)
        assert dashboard.tiles == []
