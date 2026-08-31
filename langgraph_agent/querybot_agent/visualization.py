"""
Chart-type selection.

Decides which chart communicates a result most clearly, from the shape of the
rows rather than the wording of the question. The shape is measured here — row
count, column kinds, label cardinality — and the model only picks from that
summary, so the choice does not depend on it re-reading the data.
"""
import logging
import re
from typing import Any, Dict

from langchain_core.prompts import ChatPromptTemplate

from querybot_agent.llm_manager import LLMManager

logger = logging.getLogger(__name__)

# Rows sampled when measuring column kinds and label cardinality. Enough to
# characterise the result without walking a 5,000-row set.
TYPE_SAMPLE_ROWS = 50
LABEL_SAMPLE_ROWS = 500

TEMPORAL_WORDS = re.compile(
    r'\b(date|time|month|year|day|week|quarter|trend|over time)\b', re.IGNORECASE
)

PROMPT = ChatPromptTemplate.from_messages([
    ('system', '''You choose the chart type that communicates a result most clearly.

Options:
- "bar": compare values across categories (best under 12 categories)
- "horizontal_bar": many categories, or long category labels
- "pie": parts of a whole, 2-7 categories only
- "line": a trend over time or another ordered sequence
- "scatter": the relationship between two numeric variables
- "histogram": the distribution of one numeric variable
- "box": compare distributions across categories
- "heatmap": a matrix of two categories against a value
- "none": a single value, or data a chart would not clarify

Respond with JSON only:
{{"visualization": string, "reason": string, "seaborn_function": string}}'''),
    ('human', '''Question: {question}
Rows: {row_count}
Columns: {column_count}
Column kinds: {column_kinds}
Looks time-based: {temporal}
Distinct labels: {distinct_labels}
Sample: {sample}

Choose the chart type:'''),
])


class VisualizationSelector:
    """Chooses a chart type for a result set."""

    def __init__(self) -> None:
        self.llm_manager = LLMManager()

    def choose(self, state: dict) -> Dict[str, Any]:
        """Pick the chart type that best fits the shape of the result."""
        results = state.get('results') or []

        if not results:
            return {'visualization': 'none', 'visualization_reason': 'There is no data to plot.'}

        try:
            result = self.llm_manager.invoke_json(
                PROMPT, **describe_shape(results, state['question'])
            )
            return {
                'visualization': result.get('visualization', 'bar'),
                'visualization_reason': result.get('reason', 'Chosen from the shape of the data.'),
                'seaborn_function': result.get('seaborn_function', 'sns.barplot'),
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning('Visualization selection failed, using the rule-based fallback: %s', exc)
            return fallback_for(results)


def describe_shape(results: list, question: str) -> Dict[str, Any]:
    """Summarise the result's shape to inform the chart choice."""
    first_row = results[0] if results else []
    column_count = len(first_row) if isinstance(first_row, (list, tuple)) else 1

    column_kinds = [
        'numeric' if _mostly_numeric(_column(results, index, TYPE_SAMPLE_ROWS)) else 'categorical'
        for index in range(column_count)
    ]

    labels = {str(value) for value in _column(results, 0, LABEL_SAMPLE_ROWS)}

    return {
        'question': question,
        'row_count': len(results),
        'column_count': column_count,
        'column_kinds': ', '.join(column_kinds) or 'unknown',
        'temporal': bool(TEMPORAL_WORDS.search(question)),
        'distinct_labels': len(labels),
        'sample': results[:10],
    }


def fallback_for(results: list) -> Dict[str, Any]:
    """Rule-based chart choice, used when the model call fails."""
    first_row = results[0] if results else []
    column_count = len(first_row) if isinstance(first_row, (list, tuple)) else 1
    row_count = len(results)

    if column_count < 2 or row_count < 2:
        return {
            'visualization': 'none',
            'visualization_reason': 'A single value is clearer as text than as a chart.',
            'seaborn_function': '',
        }

    if row_count > 25:
        return {
            'visualization': 'horizontal_bar',
            'visualization_reason': 'Many categories read more clearly on a horizontal axis.',
            'seaborn_function': 'sns.barplot',
        }

    return {
        'visualization': 'bar',
        'visualization_reason': 'A bar chart compares values across a small number of categories.',
        'seaborn_function': 'sns.barplot',
    }


def _column(results: list, index: int, limit: int) -> list:
    """Non-null values from one column of the first `limit` rows."""
    return [
        row[index]
        for row in results[:limit]
        if isinstance(row, (list, tuple)) and index < len(row) and row[index] is not None
    ]


def _mostly_numeric(values: list) -> bool:
    """True when more than 70% of the sampled values parse as numbers."""
    if not values:
        return False

    numeric = 0
    for value in values:
        try:
            float(value)
            numeric += 1
        except (TypeError, ValueError):
            pass

    return numeric / len(values) > 0.7


def choose_visualization_node(state: dict) -> Dict[str, Any]:
    """LangGraph node that selects the chart type."""
    return VisualizationSelector().choose(state)
