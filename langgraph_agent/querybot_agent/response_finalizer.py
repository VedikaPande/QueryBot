"""
Response assembly.

Collects the outputs of the workflow into the final response shape.
"""
from typing import Any, Dict


class ResponseFinalizer:
    """Combines workflow outputs into the response returned to the client."""

    def finalize_response(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Return the completed response.

        The answer is deliberately left as prose. The previous version appended
        the insights, the narrative and the entire formatted table into this one
        string, which the UI then rendered again in its own tabs - the same
        content appeared two or three times on screen.
        """
        answer = (state.get('answer') or '').strip()

        if not answer:
            answer = (
                state.get('error')
                or 'That question could not be answered from this dataset.'
            )

        return {
            'answer': answer,
            'sql_query': state.get('sql_query'),
            'visualization': state.get('visualization', 'none'),
            'visualization_reason': state.get('visualization_reason', ''),
            'chart_image_base64': state.get('chart_image_base64'),
            'chart_generation_error': state.get('chart_generation_error'),
            'insights': state.get('insights'),
            'formatted_table': state.get('formatted_table'),
            'data_narrative': state.get('data_narrative'),
            'insights_error': state.get('insights_error'),
            'results': state.get('results'),
            'result_columns': state.get('result_columns'),
            'error': state.get('error'),
            'suggested_questions': state.get('suggested_questions') or [],
            # Recomputed when the insights step was skipped: these are derived
            # from the rows, cost nothing, and matter regardless of that route.
            'data_quality_notes': state.get('data_quality_notes') or self._quality_notes(state),
            'intent': state.get('intent') or 'new',
            # Returned so the next turn can build on this styling rather than
            # resetting it: "make it a pie chart" then "now green" keeps the pie.
            'chart_spec': state.get('chart_spec') or {},
        }

    @staticmethod
    def _quality_notes(state: Dict[str, Any]) -> list:
        """Derive data-quality caveats without the insights step having run."""
        if not state.get('results'):
            return []
        try:
            from querybot_agent.insights_generator import InsightsGenerator

            return InsightsGenerator().assess_data_quality(state)
        except Exception:  # noqa: BLE001 - advisory only
            return []

    def handle_irrelevant_question(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Respond to a question the dataset cannot answer."""
        return {
            'answer': (
                "I answer questions about the dataset you've uploaded. That one falls outside it.\n\n"
                'Try asking about:\n'
                '- Totals, averages or counts across your columns\n'
                '- How a value changes over time\n'
                '- Which categories rank highest or lowest\n'
                '- The relationship between two columns'
            ),
            'sql_query': None,
            'visualization': 'none',
            'visualization_reason': 'The question is not about the data.',
            'chart_image_base64': None,
            'chart_generation_error': None,
            'insights': None,
            'formatted_table': None,
            'data_narrative': None,
            'insights_error': None,
            'results': [],
            'result_columns': [],
            'error': None,
            'suggested_questions': [],
            'data_quality_notes': [],
            'intent': 'new',
            'chart_spec': {},
        }

    def create_skip_response(self, skip_type: str) -> Dict[str, Any]:
        """
        Return the state update for a skipped step.

        Skipped steps write nulls rather than placeholder prose so the UI can
        simply omit the section instead of showing "not required" filler.
        """
        if skip_type == 'chart':
            return {'chart_image_base64': None, 'chart_generation_error': None}
        if skip_type == 'table':
            return {'formatted_table': None}
        if skip_type == 'insights':
            return {'insights': None, 'data_narrative': None, 'insights_error': None}
        return {}


def finalize_response_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node wrapper for finalisation."""
    return ResponseFinalizer().finalize_response(state)


def handle_irrelevant_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node wrapper for irrelevant questions."""
    return ResponseFinalizer().handle_irrelevant_question(state)


def skip_chart_node(_state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node wrapper for skipping chart generation."""
    return ResponseFinalizer().create_skip_response('chart')


def skip_table_node(_state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node wrapper for skipping table formatting."""
    return ResponseFinalizer().create_skip_response('table')


def skip_insights_node(_state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node wrapper for skipping insight generation."""
    return ResponseFinalizer().create_skip_response('insights')
