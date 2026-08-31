"""
Workflow state schemas.

LangGraph discards any key a node returns that is not declared here, so every
field the routing logic reads has to appear on ``OverallState``.
"""
from typing import Any, Dict, List, Optional

from typing_extensions import TypedDict


class InputState(TypedDict, total=False):
    """What callers provide when starting a run."""

    question: str
    uuid: str
    # Prior turns, so follow-up questions can be resolved against earlier context.
    history: Optional[List[Dict[str, Any]]]
    # The last answered turn: its question, query, chart and prose. Lets a
    # follow-up restyle that result instead of asking the data again.
    previous: Optional[Dict[str, Any]]


class OutputState(TypedDict, total=False):
    """What callers receive when a run completes."""

    answer: str
    sql_query: Optional[str]
    visualization: str
    visualization_reason: str
    chart_image_base64: Optional[str]
    chart_generation_error: Optional[str]
    insights: Optional[str]
    formatted_table: Optional[str]
    data_narrative: Optional[str]
    insights_error: Optional[str]
    results: Optional[List[Any]]
    result_columns: Optional[List[str]]
    error: Optional[str]
    # Questions the user is likely to ask next, derived from this result.
    suggested_questions: Optional[List[str]]
    # Caveats about the data that affect how the answer should be read.
    data_quality_notes: Optional[List[str]]
    # How this turn was handled: 'new', 'requery' or 'restyle'.
    intent: Optional[str]
    # Presentation choices carried forward so styling accumulates across turns.
    chart_spec: Optional[Dict[str, Any]]


class OverallState(InputState, OutputState, total=False):
    """Every key the workflow reads or writes, including intermediates."""

    # Question analysis
    parsed_question: Optional[Dict[str, Any]]
    unique_nouns: Optional[List[str]]

    # SQL lifecycle
    sql_valid: Optional[bool]
    sql_issues: Optional[str]

    # Execution-guided self-correction: a failing query is retried with the
    # database's own error as feedback.
    sql_attempts: Optional[int]
    sql_error_history: Optional[List[str]]
    sql_repaired: Optional[bool]

    # Classification
    question_type: Optional[str]
    requires_visualization: Optional[bool]
    requires_table: Optional[bool]
    is_relevant: Optional[bool]
    classification_confidence: Optional[float]
    classification_reasoning: Optional[str]

    # Visualization hints, produced by choose_visualization for the chart generator.
    seaborn_function: Optional[str]
    matplotlib_styling: Optional[str]
