"""
LangGraph agent client.

Translates the agent's streamed node updates into a flat sequence of
Server-Sent Events, and accumulates the final answer so it can be persisted as a
conversation message.
"""
import json
from typing import Any, Iterator, Optional

from flask import current_app
from langgraph_sdk import get_sync_client

from app.utils.logging import get_logger

logger = get_logger(__name__)

# Node payload keys that carry the final answer. Collected while streaming so the
# completed response can be written to the conversation history.
RESULT_KEYS = (
    'answer',
    'sql_query',
    'visualization',
    'visualization_reason',
    'chart_image_base64',
    'chart_generation_error',
    'insights',
    'insights_error',
    'formatted_table',
    'data_narrative',
    'results',
    # Persisted alongside the rows. Its absence here meant every stored result had
    # unnamed columns when reopened from history or pinned to a dashboard.
    'result_columns',
    # The styling the user asked for, so the next turn can build on it.
    'chart_spec',
    'error',
)


class LangGraphError(Exception):
    """Raised when the agent cannot be reached or fails mid-run."""


def _client():
    api_url = current_app.config.get('LANGGRAPH_API_URL')
    if not api_url:
        raise LangGraphError('LANGGRAPH_API_URL is not configured.')
    return get_sync_client(api_key=current_app.config.get('LANGSMITH_API_KEY'), url=api_url)


def _to_dict(chunk: Any) -> Optional[dict]:
    """Normalise an SDK chunk into a plain dict, or None when it carries no data."""
    data = getattr(chunk, 'data', None)
    if data is None:
        data = chunk

    if hasattr(data, '__dict__') and not isinstance(data, dict):
        data = vars(data)

    return data if isinstance(data, dict) and data else None


def _sse(payload: dict) -> str:
    """Encode a payload as a single Server-Sent Event."""
    return f'data: {json.dumps(payload, default=str)}\n\n'


def stream_run(
    question: str,
    dataset_uuid: str,
    history: Optional[list[dict]] = None,
    previous: Optional[dict] = None,
) -> Iterator[tuple[str, dict]]:
    """
    Run the agent and yield ``(sse_text, accumulated_result)`` per update.

    The accumulated dict is mutated in place and is complete once the generator
    is exhausted, letting the caller persist the final answer.
    """
    accumulated: dict[str, Any] = {}
    assistant_id = current_app.config.get('LANGGRAPH_ASSISTANT_ID', 'agent')

    payload: dict[str, Any] = {'question': question, 'uuid': dataset_uuid}
    if history:
        # Prior turns let the agent resolve follow-ups such as "and by region?".
        payload['history'] = history
    if previous:
        # The last answered turn, so "make it a pie chart" restyles that result
        # instead of putting the question through the whole workflow again.
        payload['previous'] = previous

    try:
        client = _client()
        thread = client.threads.create()
        thread_id = thread['thread_id']

        logger.info('Starting agent run on thread %s', thread_id)

        stream = client.runs.stream(
            thread_id=thread_id,
            assistant_id=assistant_id,
            input=payload,
            stream_mode='updates',
        )

        for chunk in stream:
            node_update = _to_dict(chunk)
            if not node_update:
                continue

            # 'updates' mode nests the payload under the node name.
            for value in node_update.values():
                if isinstance(value, dict):
                    for key in RESULT_KEYS:
                        if value.get(key) is not None:
                            accumulated[key] = value[key]

            yield _sse(node_update), accumulated

    except Exception as exc:  # noqa: BLE001 - surfaced to the client as a stream event
        logger.exception('Agent run failed')
        accumulated['error'] = str(exc)
        yield _sse({'error': f'The analysis failed: {exc}'}), accumulated
