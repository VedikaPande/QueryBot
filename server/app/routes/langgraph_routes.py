"""
Query routes.

Every endpoint here requires an authenticated user and verifies that the caller
owns the dataset being queried. Previously these routes had no authentication at
all and fell back to a hard-coded dataset identifier when none was supplied.
"""
import json
import time
from datetime import datetime, timezone

from flask import Blueprint, Response, current_app, request, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models.conversation_model import Conversation, Message
from app.models.utils import to_uuid
from app.services import dataset_service, langgraph_service
from app.utils.logging import get_logger
from app.utils.rate_limit import limiter
from app.utils.responses import error_response, success_response

logger = get_logger(__name__)

langgraph_bp = Blueprint('langgraph', __name__, url_prefix='/api/langgraph')

# Prior turns handed to the agent as context for follow-up questions. Kept small
# so the prompt stays within budget.
HISTORY_TURN_LIMIT = 6

# The previous answer is quoted back to the model, so it is trimmed rather than
# sent whole; the rows themselves are never sent, because the agent re-runs the
# stored query instead.
PREVIOUS_ANSWER_CHARS = 1200


def _history_for(conversation: Conversation) -> list[dict]:
    """Summarise recent turns for the agent, omitting bulky fields."""
    turns = []
    for message in conversation.messages[-HISTORY_TURN_LIMIT:]:
        entry = {'role': message.role, 'content': message.content}
        if message.sql_query:
            entry['sql_query'] = message.sql_query
        turns.append(entry)
    return turns


def _previous_result(conversation: Conversation) -> dict | None:
    """
    Describe the last answered turn so a follow-up can build on it.

    Only the query and the prose are sent, never the rows: the agent re-executes
    the stored SQL, which keeps this payload small and guarantees the restyled
    chart shows the same numbers the first one did.
    """
    messages = list(conversation.messages)

    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if message.role != 'assistant' or not message.sql_query:
            continue

        # The question that produced it is the nearest preceding user turn.
        question = next(
            (
                earlier.content
                for earlier in reversed(messages[:index])
                if earlier.role == 'user'
            ),
            None,
        )

        return {
            'question': question,
            'answer': (message.content or '')[:PREVIOUS_ANSWER_CHARS],
            'sql_query': message.sql_query,
            'visualization': message.visualization,
            'chart_spec': message.chart_spec or {},
            'insights': message.insights,
            'data_narrative': message.data_narrative,
        }

    return None


@langgraph_bp.route('/run', methods=['POST'])
@jwt_required()
# The costly endpoint: each call makes several paid LLM requests, so it is
# limited far more tightly than the rest of the API.
@limiter.limit(lambda: current_app.config['RATELIMIT_ANALYSIS'])
def run_agent():
    """
    Stream an analysis of the user's question.

    Body: ``{"question": str, "databaseUuid": str, "conversationId": str | None}``
    Responds with Server-Sent Events; the final event reports the persisted
    conversation and message identifiers.
    """
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}

    question = (data.get('question') or '').strip()
    dataset_uuid = data.get('databaseUuid')
    conversation_id = data.get('conversationId')

    if not question:
        return error_response('A question is required', 400)
    if len(question) > 2000:
        return error_response('That question is too long (2000 character maximum)', 400)
    if not dataset_uuid:
        return error_response('Upload a dataset before asking a question', 400)

    # Ownership check: without this, any authenticated user could read any
    # dataset by supplying its identifier.
    dataset = dataset_service.get_owned_dataset(user_id, dataset_uuid)
    if not dataset:
        logger.warning('User %s attempted to query dataset %s they do not own', user_id, dataset_uuid)
        return error_response('Dataset not found', 404)

    if conversation_id:
        conversation = Conversation.find_for_user(conversation_id, user_id)
        if not conversation:
            return error_response('Conversation not found', 404)
        if str(conversation.dataset_id) != str(dataset.id):
            return error_response('That conversation belongs to a different dataset', 400)
    else:
        conversation = Conversation(
            user_id=dataset.user_id,
            dataset_id=dataset.id,
            title=Conversation.build_title(question),
        )
        db.session.add(conversation)
        db.session.flush()

    # Both are read before the new user turn is added, so they describe the state
    # the question was asked against.
    history = _history_for(conversation)
    previous = _previous_result(conversation)

    db.session.add(Message(conversation_id=conversation.id, role='user', content=question))
    dataset.touch()
    db.session.commit()

    conversation_uuid = str(conversation.id)
    dataset_ref = str(dataset.external_uuid)
    started = time.monotonic()

    # Captured before entering the generator: the app context is torn down by the
    # time the stream is consumed.
    app = current_app._get_current_object()

    def generate():
        accumulated: dict = {}
        message_id: str | None = None

        try:
            for event, result in langgraph_service.stream_run(
                question, dataset_ref, history, previous
            ):
                accumulated = result
                yield event
        finally:
            # Persist whatever completed, even if the client disconnected midway.
            with app.app_context():
                try:
                    message_id = _persist_assistant_message(
                        conversation_uuid,
                        accumulated,
                        int((time.monotonic() - started) * 1000),
                    )
                except Exception:  # noqa: BLE001 - never break the stream on a write failure
                    logger.exception('Could not persist assistant message')

        # The message id is what lets the client pin this result to a dashboard,
        # so it is reported once the turn has actually been written.
        yield 'data: ' + json.dumps(
            {'done': True, 'conversationId': conversation_uuid, 'messageId': message_id}
        ) + '\n\n'

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache, no-transform',
            # `Connection` is hop-by-hop and belongs to the server in front, not
            # to a WSGI app. Advertising keep-alive here contradicted what the
            # server actually did with a chunked stream, and a client that reused
            # the connection for its next question hung until it timed out.
            'X-Accel-Buffering': 'no',
            'X-Conversation-Id': conversation_uuid,
        },
    )


def _persist_assistant_message(conversation_id: str, result: dict, duration_ms: int) -> str | None:
    """
    Write the accumulated agent output as the assistant's turn.

    Returns the new message's id so the caller can report it to the client, which
    needs it to pin the result to a dashboard.
    """
    if not result:
        return None

    conversation = db.session.get(Conversation, to_uuid(conversation_id))
    if not conversation:
        return None

    rows = result.get('results')
    message = Message(
        conversation_id=conversation.id,
        role='error' if result.get('error') and not result.get('answer') else 'assistant',
        content=result.get('answer') or result.get('error') or '',
        sql_query=result.get('sql_query'),
        visualization=result.get('visualization'),
        chart_spec=result.get('chart_spec') or None,
        insights=result.get('insights'),
        data_narrative=result.get('data_narrative'),
        formatted_table=result.get('formatted_table'),
        chart_image_base64=result.get('chart_image_base64'),
        result_rows=rows if isinstance(rows, list) else None,
        result_columns=result.get('result_columns'),
        error=result.get('error'),
        duration_ms=duration_ms,
    )
    conversation.updated_at = datetime.now(timezone.utc)
    db.session.add(message)
    db.session.commit()

    return str(message.id)


@langgraph_bp.route('/query', methods=['POST'])
@jwt_required()
@limiter.limit(lambda: current_app.config['RATELIMIT_QUERY'])
def run_raw_query():
    """
    Execute a user-supplied SQL query against their own dataset.

    Backs the "show and edit the SQL" workflow: the agent's generated SQL can be
    corrected and re-run without another round trip through the model. The
    dataset service enforces that the statement is read-only.
    """
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}

    query = (data.get('query') or '').strip()
    dataset_uuid = data.get('databaseUuid')

    if not query:
        return error_response('A SQL query is required', 400)
    if not dataset_uuid:
        return error_response('A dataset is required', 400)

    dataset = dataset_service.get_owned_dataset(user_id, dataset_uuid)
    if not dataset:
        return error_response('Dataset not found', 404)

    from app.services import sqlite_service
    from app.services.sqlite_service import SqliteServiceError

    try:
        result = sqlite_service.execute_query(str(dataset.external_uuid), query)
    except SqliteServiceError as exc:
        return error_response(exc.message, exc.status_code)

    dataset_service.touch(dataset)
    return success_response('Query executed successfully', result)


@langgraph_bp.route('/health', methods=['GET'])
@limiter.exempt
def health_check():
    """Report whether the agent integration is configured."""
    return success_response(
        'LangGraph integration status',
        {
            'api_url_set': bool(current_app.config.get('LANGGRAPH_API_URL')),
            'api_key_set': bool(current_app.config.get('LANGSMITH_API_KEY')),
            'assistant_id': current_app.config.get('LANGGRAPH_ASSISTANT_ID'),
        },
    )
