"""
Authorization tests.

These cover the two holes that previously existed: the query endpoint had no
authentication decorator at all, and no endpoint checked that the caller owned
the dataset it was asked to read.
"""

# Endpoints that must reject an unauthenticated caller.
PROTECTED_ENDPOINTS = [
    ('POST', '/api/langgraph/run'),
    ('POST', '/api/langgraph/query'),
    ('GET', '/api/datasets'),
    ('POST', '/api/datasets'),
    ('GET', '/api/conversations'),
]


class TestAuthenticationRequired:
    def test_protected_endpoints_reject_anonymous_callers(self, client):
        for method, path in PROTECTED_ENDPOINTS:
            response = client.open(path, method=method, json={})
            assert response.status_code == 401, f'{method} {path} allowed an anonymous caller'

    def test_run_endpoint_requires_authentication(self, client):
        """The query engine was previously reachable without any credentials."""
        response = client.post(
            '/api/langgraph/run',
            json={'question': 'How many rows?', 'databaseUuid': 'any'},
        )
        assert response.status_code == 401

    def test_health_endpoints_stay_public(self, client):
        assert client.get('/health').status_code == 200
        assert client.get('/api/langgraph/health').status_code == 200


class TestDatasetOwnership:
    def test_owner_can_see_their_dataset(self, client, sign_in, user, dataset):
        sign_in(user.email)

        response = client.get('/api/datasets')
        assert response.status_code == 200

        uuids = [entry['uuid'] for entry in response.get_json()['data']['datasets']]
        assert str(dataset.external_uuid) in uuids

    def test_other_users_datasets_are_not_listed(self, client, sign_in, other_user, dataset):
        sign_in(other_user.email)

        response = client.get('/api/datasets')
        assert response.status_code == 200
        assert response.get_json()['data']['datasets'] == []

    def test_querying_someone_elses_dataset_is_rejected(self, client, sign_in, other_user, dataset):
        """Knowing the identifier must not be enough to read the data."""
        sign_in(other_user.email)

        response = client.post(
            '/api/langgraph/run',
            json={'question': 'Show me everything', 'databaseUuid': str(dataset.external_uuid)},
        )
        assert response.status_code == 404

    def test_running_sql_against_someone_elses_dataset_is_rejected(
        self, client, sign_in, other_user, dataset
    ):
        sign_in(other_user.email)

        response = client.post(
            '/api/langgraph/query',
            json={'query': 'SELECT * FROM csv_data', 'databaseUuid': str(dataset.external_uuid)},
        )
        assert response.status_code == 404

    def test_reading_someone_elses_schema_is_rejected(self, client, sign_in, other_user, dataset):
        sign_in(other_user.email)

        response = client.get(f'/api/datasets/{dataset.external_uuid}/schema')
        assert response.status_code == 404

    def test_deleting_someone_elses_dataset_is_rejected(self, client, sign_in, other_user, dataset):
        sign_in(other_user.email)

        response = client.delete(f'/api/datasets/{dataset.external_uuid}')
        assert response.status_code == 404

    def test_malformed_identifier_is_not_a_server_error(self, client, sign_in, user):
        """A bad identifier should be a clean 404, never a 500 from the driver."""
        sign_in(user.email)

        for bad in ['../../etc/passwd', 'not-a-uuid', '']:
            response = client.post(
                '/api/langgraph/query',
                json={'query': 'SELECT 1', 'databaseUuid': bad},
            )
            assert response.status_code in (400, 404), f'{bad!r} produced {response.status_code}'


class TestRequestValidation:
    def test_question_is_required(self, client, sign_in, user, dataset):
        sign_in(user.email)

        response = client.post(
            '/api/langgraph/run',
            json={'databaseUuid': str(dataset.external_uuid)},
        )
        assert response.status_code == 400

    def test_dataset_is_required(self, client, sign_in, user):
        sign_in(user.email)

        response = client.post('/api/langgraph/run', json={'question': 'How many rows?'})
        assert response.status_code == 400

    def test_absurdly_long_questions_are_rejected(self, client, sign_in, user, dataset):
        sign_in(user.email)

        response = client.post(
            '/api/langgraph/run',
            json={'question': 'a' * 2500, 'databaseUuid': str(dataset.external_uuid)},
        )
        assert response.status_code == 400

    def test_there_is_no_default_dataset_fallback(self, client, sign_in, user):
        """
        A missing identifier must fail rather than silently querying a
        hard-coded dataset, which is what the previous implementation did.
        """
        sign_in(user.email)

        response = client.post(
            '/api/langgraph/run',
            json={'question': 'Show me the data', 'databaseUuid': None},
        )
        assert response.status_code == 400
