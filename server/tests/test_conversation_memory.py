"""
Tests for the conversational context handed to the agent.

A follow-up like "make it a pie chart" is only cheap if the route tells the agent
what the previous turn was. These cover that plumbing, plus the terminal stream
frame the client needs to pin a result to a dashboard.
"""
import json

from app.models.conversation_model import Conversation, Message


def _run(client, dataset, question, conversation_id=None):
    """Post a question and return the parsed SSE frames."""
    payload = {'question': question, 'databaseUuid': str(dataset.external_uuid)}
    if conversation_id:
        payload['conversationId'] = conversation_id

    response = client.post('/api/langgraph/run', json=payload)
    assert response.status_code == 200

    frames = []
    for block in response.get_data(as_text=True).split('\n\n'):
        body = '\n'.join(
            line[5:].strip() for line in block.splitlines() if line.startswith('data:')
        )
        if body:
            frames.append(json.loads(body))
    return response, frames


def _seed_answer(db, conversation_id, **overrides):
    """Write an assistant turn as though the agent had produced it."""
    fields = {
        'content': 'Yangon leads with 1,912.95.',
        'sql_query': 'SELECT city, SUM(total) FROM sales GROUP BY city',
        'visualization': 'bar',
        'insights': '- Yangon leads',
        **overrides,
    }
    message = Message(conversation_id=conversation_id, role='assistant', **fields)
    db.session.add(message)
    db.session.commit()
    return message


def _conversation(db, dataset, title='Revenue'):
    conversation = Conversation(user_id=dataset.user_id, dataset_id=dataset.id, title=title)
    db.session.add(conversation)
    db.session.flush()
    return conversation


class TestStreamHeaders:
    def test_the_stream_does_not_set_a_connection_header(
        self, client, sign_in, user, dataset, stub_agent
    ):
        """
        `Connection` is hop-by-hop and belongs to the server in front. Setting
        keep-alive here contradicted what the server did with a chunked stream: a
        client that reused the connection for its next question hung until it
        timed out, so asking two things in a row over one connection failed.
        """
        sign_in(user.email)
        response = client.post(
            '/api/langgraph/run',
            json={'question': 'How many rows?', 'databaseUuid': str(dataset.external_uuid)},
        )

        assert response.status_code == 200
        assert 'Connection' not in response.headers
        # The ones that do belong to the app are still there.
        assert response.headers['Cache-Control'] == 'no-cache, no-transform'
        assert response.headers['X-Accel-Buffering'] == 'no'
        assert response.headers['X-Conversation-Id']


class TestTerminalFrame:
    def test_the_done_frame_reports_the_persisted_message_id(
        self, client, sign_in, user, dataset, db, stub_agent
    ):
        """
        The client needs this id to pin a result to a dashboard. A missing import
        in the route meant emitting the frame raised NameError inside the
        generator, so the id never arrived and pinning silently could not work.
        """
        sign_in(user.email)
        _, frames = _run(client, dataset, 'What is the total revenue by city?')

        done = next((frame for frame in frames if frame.get('done')), None)
        assert done is not None, 'the stream ended without a done frame'
        assert done['conversationId']
        assert done['messageId'], 'the assistant turn was not reported to the client'

        stored = db.session.get(Message, __import__('uuid').UUID(done['messageId']))
        assert stored is not None and stored.role == 'assistant'


class TestPreviousTurn:
    def test_the_first_question_has_no_previous_turn(
        self, client, sign_in, user, dataset, stub_agent
    ):
        sign_in(user.email)
        _run(client, dataset, 'What is the total revenue by city?')

        assert stub_agent.calls[-1]['previous'] is None

    def test_a_follow_up_receives_the_previous_query_and_answer(
        self, client, sign_in, user, dataset, db, stub_agent
    ):
        sign_in(user.email)
        conversation = _conversation(db, dataset)
        db.session.add(
            Message(
                conversation_id=conversation.id,
                role='user',
                content='What is the total revenue by city?',
            )
        )
        _seed_answer(db, conversation.id)

        _run(client, dataset, 'make it a pie chart', str(conversation.id))

        previous = stub_agent.calls[-1]['previous']
        assert previous is not None
        assert previous['question'] == 'What is the total revenue by city?'
        assert previous['answer'] == 'Yangon leads with 1,912.95.'
        assert previous['sql_query'] == 'SELECT city, SUM(total) FROM sales GROUP BY city'

    def test_a_turn_with_no_query_cannot_be_refined(
        self, client, sign_in, user, dataset, db, stub_agent
    ):
        """
        Without the SQL there is nothing to re-run, so the follow-up has to go
        through the full workflow rather than being offered a restyle it cannot do.
        """
        sign_in(user.email)
        conversation = _conversation(db, dataset)
        _seed_answer(db, conversation.id, sql_query=None)

        _run(client, dataset, 'make it a pie chart', str(conversation.id))

        assert stub_agent.calls[-1]['previous'] is None

    def test_the_previous_turn_carries_its_styling_forward(
        self, client, sign_in, user, dataset, db, stub_agent
    ):
        """
        This is what lets "make it a pie chart" then "now in green" keep the pie
        rather than resetting to a bar.
        """
        sign_in(user.email)
        conversation = _conversation(db, dataset)
        db.session.add(
            Message(conversation_id=conversation.id, role='user', content='Revenue by city?')
        )
        _seed_answer(db, conversation.id, chart_spec={'chart_type': 'pie', 'palette': 'Greens'})

        _run(client, dataset, 'now sort it descending', str(conversation.id))

        previous = stub_agent.calls[-1]['previous']
        assert previous['sql_query'] == 'SELECT city, SUM(total) FROM sales GROUP BY city'
        assert previous['visualization'] == 'bar'
        assert previous['chart_spec'] == {'chart_type': 'pie', 'palette': 'Greens'}
        assert previous['insights'] == '- Yangon leads'
        assert previous['question'] == 'Revenue by city?'

    def test_the_rows_are_never_sent_back_to_the_agent(
        self, client, sign_in, user, dataset, db, stub_agent
    ):
        """
        The agent re-runs the stored query instead. Shipping thousands of rows
        through the request would be slow and could exceed the payload limit.
        """
        sign_in(user.email)
        conversation = _conversation(db, dataset)
        _seed_answer(
            db,
            conversation.id,
            result_rows=[[f'city-{index}', index] for index in range(2000)],
            result_columns=['city', 'total'],
        )

        _run(client, dataset, 'top 5 only', str(conversation.id))

        previous = stub_agent.calls[-1]['previous']
        assert 'result_rows' not in previous
        assert 'results' not in previous

    def test_an_error_turn_is_not_offered_as_something_to_refine(
        self, client, sign_in, user, dataset, db, stub_agent
    ):
        """A failed turn has no chart to restyle, so it must be skipped."""
        sign_in(user.email)
        conversation = _conversation(db, dataset)
        db.session.add(
            Message(
                conversation_id=conversation.id,
                role='error',
                content='no such column: revenue',
                error='no such column: revenue',
            )
        )
        db.session.commit()

        _run(client, dataset, 'make it a pie chart', str(conversation.id))

        assert stub_agent.calls[-1]['previous'] is None

    def test_the_most_recent_answer_wins(
        self, client, sign_in, user, dataset, db, stub_agent
    ):
        sign_in(user.email)
        conversation = _conversation(db, dataset)
        _seed_answer(db, conversation.id, visualization='bar')
        _seed_answer(
            db,
            conversation.id,
            visualization='line',
            sql_query='SELECT month, SUM(total) FROM sales GROUP BY month',
        )

        _run(client, dataset, 'make it a pie chart', str(conversation.id))

        previous = stub_agent.calls[-1]['previous']
        assert previous['visualization'] == 'line'
        assert 'month' in previous['sql_query']
