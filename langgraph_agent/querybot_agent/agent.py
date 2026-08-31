"""
QueryBot agent.

Public entry point wrapping the LangGraph workflow: takes a natural-language
question about an uploaded dataset and returns an answer, a chart, a table and
supporting analysis.
"""
import logging
from typing import Any, Dict, Optional

from querybot_agent.workflow_manager import WorkflowManager

logger = logging.getLogger(__name__)


class QueryBotAgent:
    """Answers questions about a dataset."""

    def __init__(self) -> None:
        self.workflow_manager = WorkflowManager()

    def query(
        self,
        question: str,
        database_uuid: str,
        history: Optional[list[dict]] = None,
        previous: Optional[dict] = None,
    ) -> Dict[str, Any]:
        """
        Answer one question.

        Args:
            question: The natural-language question.
            database_uuid: Identifier of the dataset to query.
            history: Prior conversation turns, used to resolve follow-ups.
            previous: The last answered turn. Supplying it lets a follow-up such
                as "make it a pie chart" restyle that result instead of asking the
                data again.

        Returns:
            The answer plus the SQL, chart, table and insights that support it.
        """
        try:
            return self.workflow_manager.run_sql_agent(question, database_uuid, history, previous)
        except Exception as exc:  # noqa: BLE001 - returned to the caller, not raised
            logger.exception('Query failed')
            return {
                'answer': f'Something went wrong while answering that: {exc}',
                'sql_query': None,
                'visualization': 'none',
                'visualization_reason': '',
                'chart_image_base64': None,
                'chart_generation_error': None,
                'insights': None,
                'formatted_table': None,
                'data_narrative': None,
                'insights_error': None,
                'results': [],
                'result_columns': [],
                'error': str(exc),
                'suggested_questions': [],
                'data_quality_notes': [],
                'intent': 'new',
                'chart_spec': {},
            }

    def get_workflow_graph(self):
        """Return the compiled graph for deployment or inspection."""
        return self.workflow_manager.compile_graph()


def ask_question(
    question: str,
    database_uuid: str,
    history: Optional[list[dict]] = None,
    previous: Optional[dict] = None,
) -> Dict[str, Any]:
    """Answer a single question without managing an agent instance."""
    return QueryBotAgent().query(question, database_uuid, history, previous)
