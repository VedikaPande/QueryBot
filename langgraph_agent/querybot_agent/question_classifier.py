"""
Question classification and routing.

Decides whether a question can be answered from the dataset and what kind of
output it calls for, then drives the workflow's conditional edges.
"""
import logging
from typing import Any, Dict, Literal

from langchain_core.prompts import ChatPromptTemplate

from querybot_agent import refinement
from querybot_agent.config import settings
from querybot_agent.database_manager import DatabaseManager, DatabaseError
from querybot_agent.llm_manager import LLMManager

logger = logging.getLogger(__name__)

CHART_HINTS = ('chart', 'graph', 'plot', 'visualize', 'visualise', 'trend', 'distribution', 'compare')
TABLE_HINTS = ('list', 'show me', 'display', 'records', 'entries', 'rows', 'table', 'breakdown')
SMALLTALK_HINTS = ('hello', 'hi ', 'hey', 'thank you', 'thanks', 'weather', 'who are you', 'your name')


class QuestionClassifier:
    """Classifies a question and decides how it should be processed."""

    def __init__(self) -> None:
        self.llm_manager = LLMManager()
        self.db_manager = DatabaseManager()

    def classify_question(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Return the classification fields the routing functions read.

        When a previous answer exists this call also decides whether the turn is a
        follow-up that only restyles it. Detecting that here rather than in a node
        of its own means a first question makes exactly as many model calls as
        before.
        """
        question = state['question']
        previous = state.get('previous') if settings.refine_followups else None

        try:
            schema = self.db_manager.get_schema(state['uuid'])
        except DatabaseError as exc:
            logger.warning('Schema unavailable during classification: %s', exc)
            schema = 'Schema unavailable'

        prompt = self._build_prompt(bool(previous))

        try:
            result = self.llm_manager.invoke_json(
                prompt,
                schema=schema,
                question=question,
                previous=refinement.previous_summary(previous),
            )
            question_type = str(result.get('question_type', 'general'))
            intent, chart_spec = refinement.parse_intent(result, previous)

            if intent == refinement.RESTYLE:
                logger.info('Treating "%s" as a restyle: %s', question[:60], chart_spec)

            return {
                'question_type': question_type,
                'requires_visualization': bool(result.get('requires_visualization', question_type == 'chart')),
                'requires_table': bool(result.get('requires_table', question_type == 'table')),
                'is_relevant': bool(result.get('is_relevant', True)),
                'classification_confidence': float(result.get('confidence', 0.8)),
                'classification_reasoning': str(result.get('reasoning', '')),
                'intent': intent,
                'chart_spec': chart_spec,
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning('Classification failed, falling back to keywords: %s', exc)
            return self._keyword_fallback(question, str(exc))

    @staticmethod
    def _build_prompt(has_previous: bool) -> ChatPromptTemplate:
        """
        Build the classifier prompt.

        The refinement half is appended only when there is something to refine, so
        the first turn of a conversation sends the same prompt it always did.
        """
        system = '''You classify questions asked about a database.

Categories:
- "chart": the user wants a visual - a graph, plot, trend or comparison
- "table": the user wants records, a list or a detailed breakdown
- "general": the user wants a number, summary or explanation
- "irrelevant": the question is not about this data at all

Treat a question as relevant whenever the schema could plausibly answer it, even
if the wording is loose. Only greetings, small talk and questions about
unrelated subjects are irrelevant.

Respond with JSON only:
{{
    "is_relevant": boolean,
    "question_type": "chart" | "table" | "general" | "irrelevant",
    "requires_visualization": boolean,
    "requires_table": boolean,
    "confidence": number,
    "reasoning": string'''

        if has_previous:
            system += ''',
    "intent": "new" | "restyle" | "requery",
    "chart_type": string or null,
    "palette": string or null,
    "sort": "asc" | "desc" | null,
    "limit": number or null'''

        system += '\n}}'

        if has_previous:
            system += '\n' + refinement.INSTRUCTIONS

        human = '''Database schema:
{schema}

===Previous turn:
{previous}

Question: {question}

Classify it:'''

        return ChatPromptTemplate.from_messages([('system', system), ('human', human)])

    @staticmethod
    def _keyword_fallback(question: str, reason: str) -> Dict[str, Any]:
        """Classify by keyword when the model call fails."""
        lowered = f' {question.lower().strip()} '

        if any(hint in lowered for hint in SMALLTALK_HINTS) and len(lowered.split()) <= 6:
            question_type = 'irrelevant'
        elif any(hint in lowered for hint in CHART_HINTS):
            question_type = 'chart'
        elif any(hint in lowered for hint in TABLE_HINTS):
            question_type = 'table'
        else:
            question_type = 'general'

        return {
            'question_type': question_type,
            'requires_visualization': question_type == 'chart',
            'requires_table': question_type == 'table',
            'is_relevant': question_type != 'irrelevant',
            'classification_confidence': 0.5,
            'classification_reasoning': f'Keyword fallback after classification error: {reason}',
            # Keywords cannot tell a restyle from a new question with any
            # confidence, and guessing wrong shows the user a chart of the wrong
            # data. Falling back to the full workflow is slower but correct.
            'intent': refinement.NEW,
            'chart_spec': {},
        }


def classify_question_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node wrapper for classification."""
    return QuestionClassifier().classify_question(state)


def route_question(
    state: Dict[str, Any],
) -> Literal['process_question', 'handle_irrelevant', 'apply_refinement']:
    """
    Send the turn down one of the three paths.

    A restyle skips the SQL pipeline entirely: the previous query is re-run as-is,
    so there is nothing to parse, generate or validate.
    """
    if not (state.get('is_relevant', True) and state.get('question_type') != 'irrelevant'):
        return 'handle_irrelevant'

    if state.get('intent') == refinement.RESTYLE and state.get('chart_spec'):
        return 'apply_refinement'

    return 'process_question'


def should_generate_chart(state: Dict[str, Any]) -> Literal['generate_chart', 'skip_chart']:
    """
    Render a chart whenever the visualization selector picked a real type.

    The decision rests on `choose_visualization`, which is told to answer 'none'
    for a single value or data a chart would not clarify. Also gating on the
    classifier's `requires_visualization` produced a contradiction: for "total
    revenue by city" the selector chose a bar chart and explained why, then the
    classifier's 'general' label suppressed it, so the UI reported an ideal chart
    type and displayed nothing.
    """
    has_data = bool(state.get('results'))
    chart_useful = state.get('visualization', 'none') not in ('none', None, '')

    if has_data and chart_useful:
        return 'generate_chart'
    return 'skip_chart'


def should_generate_table(state: Dict[str, Any]) -> Literal['format_table', 'skip_table']:
    """Format a table when one was asked for, or when a chart was not produced."""
    wants_table = state.get('requires_table') or state.get('question_type') == 'table'
    has_data = bool(state.get('results'))
    # Without a chart, the table is the only way to see the underlying rows.
    no_chart = not state.get('chart_image_base64')

    if has_data and (wants_table or no_chart):
        return 'format_table'
    return 'skip_table'


def should_repair_sql(state: Dict[str, Any]) -> Literal['repair_sql', 'continue']:
    """
    Retry a failing query with the database's error as feedback.

    Bounded by `max_sql_repairs`: past a couple of attempts the model tends to
    re-propose the same mistake, so further retries only add latency. A query
    that returned rows, or one rejected as irrelevant, is never retried.
    """
    if not state.get('error'):
        return 'continue'

    query = state.get('sql_query', '')
    if query in ('NOT_RELEVANT', 'NOT_ENOUGH_INFO'):
        return 'continue'

    # A repair that produced no new query sets this false; stop rather than loop.
    if state.get('sql_repaired') is False:
        return 'continue'

    if int(state.get('sql_attempts') or 0) > settings.max_sql_repairs:
        return 'continue'

    return 'repair_sql'


def should_generate_insights(state: Dict[str, Any]) -> Literal['generate_insights', 'finalize']:
    """Insights need enough rows to say something non-trivial."""
    results = state.get('results') or []

    # A restyle shows the same rows a different way. Re-deriving the analysis
    # would cost two model calls to reproduce text the user already has, so the
    # refiner carries the previous one forward instead.
    if state.get('intent') == refinement.RESTYLE:
        return 'finalize'

    if len(results) > 1 and state.get('is_relevant', True) and state.get('question_type') != 'irrelevant':
        return 'generate_insights'
    return 'finalize'
