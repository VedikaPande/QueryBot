"""
Conversational refinement.

A follow-up like "make it a pie chart", "use warmer colours" or "just the top
five" is about how the *previous* answer is presented, not a new question about
the data. Running the full workflow for those costs six model calls and routinely
loses the original intent, because the SQL is written again from scratch and the
second attempt rarely matches the first.

So those turns take a different path: the previous query — already known to be
valid — is re-executed, the presentation is adjusted, and the chart is
re-rendered. One classification call and one database query instead of six model
calls, and the numbers on screen cannot drift because the SQL did not change.

Detection rides along with the existing question classifier rather than adding a
node of its own, so a genuinely new question costs exactly what it did before.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

from querybot_agent.chart_templates import CHART_TYPES, PALETTES
from querybot_agent.config import settings
from querybot_agent.database_manager import DatabaseError, DatabaseManager

logger = logging.getLogger(__name__)

NEW = 'new'
RESTYLE = 'restyle'
REQUERY = 'requery'

# A restyle limit is a display choice, not a query: past a few hundred rows a
# chart is unreadable anyway and the user should filter in SQL instead.
MAX_REFINE_LIMIT = 500

# Appended to the classifier's system prompt only when there is a previous result
# to refine, so the first question in a conversation is unaffected.
INSTRUCTIONS = f'''
The user has already received an answer, so this turn may be a follow-up. Also
report which of these it is, as "intent":

- "restyle": it only changes how the *existing* result is shown, and the same
  query would still answer it. Changing the chart type, the colours, the sort
  order, or trimming to the top N all qualify.
  Examples: "make it a pie chart", "horizontal bars please", "use warmer
  colours", "top 5 only", "sort ascending", "that's too colourful".
- "requery": it asks for different data — a new filter, a different grouping, a
  column that is not in the current result, another time period.
  Examples: "now break that down by month", "only for 2024", "what about profit?".
- "new": it is unrelated to the previous answer.

When and only when the intent is "restyle", also fill in what changed. Use null
for anything the user did not ask to change:
- "chart_type": one of {", ".join(CHART_TYPES)}
- "palette": the closest match from {", ".join(PALETTES)} — for "warmer" prefer
  flare, YlOrRd or Oranges; for "cooler" crest, Blues or mako; for "muted" or
  "less colourful" prefer muted, pastel or colorblind
- "sort": "asc" or "desc", by the result's value column
- "limit": how many rows to keep

If the user asks for something the chart types above cannot express, treat the
turn as "requery" rather than inventing a type.
'''


def previous_summary(previous: Optional[Dict[str, Any]]) -> str:
    """Describe the previous turn for the classifier prompt."""
    if not previous:
        return 'None - this is the first question in the conversation.'

    lines = [f'Question: {previous.get("question") or "unknown"}']
    if previous.get('answer'):
        lines.append(f'Answer: {str(previous["answer"])[:400]}')
    if previous.get('sql_query'):
        lines.append(f'SQL used: {previous["sql_query"]}')
    lines.append(f'Chart shown: {previous.get("visualization") or "none"}')

    spec = previous.get('chart_spec') or {}
    if spec.get('palette'):
        lines.append(f'Palette in use: {spec["palette"]}')

    return '\n'.join(lines)


def parse_intent(
    result: Dict[str, Any],
    previous: Optional[Dict[str, Any]],
) -> Tuple[str, Dict[str, Any]]:
    """
    Read the intent and chart spec out of a classifier response.

    Returns ``(intent, chart_spec)``. The intent falls back to ``new`` whenever
    refinement is impossible — no previous query to re-run, the feature is off, or
    the model asked for something outside the allow-lists — so a bad answer here
    degrades to the normal workflow rather than to a broken chart.
    """
    if not settings.refine_followups:
        return NEW, {}

    previous = previous or {}
    if not previous.get('sql_query'):
        return NEW, {}

    intent = str(result.get('intent') or NEW).strip().lower()
    if intent not in (NEW, RESTYLE, REQUERY):
        intent = NEW

    if intent != RESTYLE:
        return intent, {}

    spec = _clean_spec(result, previous)
    if not spec:
        # Classified as a restyle but nothing recognisable changed. Re-running the
        # same query to render the same chart would be a no-op, so treat it as a
        # new question and let the full workflow answer it.
        logger.info('Restyle carried no usable change; treating the turn as a new question')
        return NEW, {}

    return RESTYLE, spec


def _clean_spec(result: Dict[str, Any], previous: Dict[str, Any]) -> Dict[str, Any]:
    """Validate the requested changes, dropping anything unrecognised."""
    spec: Dict[str, Any] = {}
    inherited = previous.get('chart_spec') or {}

    chart_type = _one_of(result.get('chart_type'), CHART_TYPES)
    if chart_type and chart_type != previous.get('visualization'):
        spec['chart_type'] = chart_type

    palette = _one_of(result.get('palette'), PALETTES, case_sensitive=True)
    if palette and palette != inherited.get('palette'):
        spec['palette'] = palette

    sort = str(result.get('sort') or '').strip().lower()
    if sort in ('asc', 'desc'):
        spec['sort'] = sort

    limit = _positive_int(result.get('limit'))
    if limit:
        spec['limit'] = min(limit, MAX_REFINE_LIMIT)

    if not spec:
        return {}

    # Styling accumulates across turns: "make it a pie chart" then "now green"
    # has to keep the pie. Anything the user did not mention is inherited.
    merged = {key: value for key, value in inherited.items() if key in ('palette',)}
    merged.update(spec)
    merged['changed'] = sorted(spec)
    return merged


def _one_of(value: Any, allowed: tuple, case_sensitive: bool = False) -> Optional[str]:
    """Return the value when it is in the allow-list, otherwise None."""
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    if case_sensitive:
        # Palette names are matched case-insensitively but returned with the
        # casing matplotlib expects: 'blues' is not a colormap, 'Blues' is.
        for option in allowed:
            if option.lower() == text.lower():
                return option
        return None

    text = text.lower().replace(' ', '_').replace('-', '_')
    return text if text in allowed else None


def _positive_int(value: Any) -> Optional[int]:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


class Refiner:
    """Rewrites the previous result according to a chart spec."""

    def __init__(self) -> None:
        self.db_manager = DatabaseManager()

    def apply(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Re-run the previous query and re-present its result."""
        previous = state.get('previous') or {}
        spec = state.get('chart_spec') or {}
        sql = previous.get('sql_query')

        if not sql:
            # Routing guarantees a query is present, so this only fires if state
            # was rebuilt between nodes. Answer honestly rather than crash.
            return self._cannot_refine('the previous query is no longer available')

        try:
            payload = self.db_manager.execute_query_detailed(state['uuid'], sql)
        except DatabaseError as exc:
            logger.info('Could not re-run the previous query for a refinement: %s', exc)
            return self._cannot_refine(str(exc))

        rows = payload.get('results') or []
        columns = payload.get('columns') or []
        reshaped = _reshape(rows, spec)

        visualization = spec.get('chart_type') or previous.get('visualization') or 'bar'
        changed = spec.get('changed') or []
        # A different sort or row count means the previous prose no longer
        # describes what is on screen, so it is not carried forward.
        data_changed = bool({'sort', 'limit'} & set(changed))
        finding = '' if data_changed else _finding_of(previous)

        # The finding travels with the spec rather than being re-read from the
        # answer, which now opens with an acknowledgement. Parsing it back out
        # would mean matching our own prose, and a real answer that happens to
        # start the same way ("Switched to card payments in 62% of orders") would
        # lose its first sentence.
        carried = {**spec, 'finding': finding} if finding else spec

        update: Dict[str, Any] = {
            'sql_query': sql,
            'results': reshaped,
            'result_columns': columns,
            'error': None,
            'visualization': visualization,
            'visualization_reason': _describe(spec, visualization),
            'chart_spec': carried,
            'answer': _answer(spec, visualization, finding),
        }

        if not data_changed:
            # Same rows, so the earlier analysis is still accurate and there is no
            # reason to pay for it again.
            update['insights'] = previous.get('insights')
            update['data_narrative'] = previous.get('data_narrative')

        return update

    @staticmethod
    def _cannot_refine(reason: str) -> Dict[str, Any]:
        return {
            'answer': (
                f'That chart could not be updated because {reason}. '
                'Ask the question again and I will rebuild it.'
            ),
            'results': [],
            'result_columns': [],
            'visualization': 'none',
            'visualization_reason': 'The previous result could not be reloaded.',
            'chart_spec': {},
        }


def _finding_of(previous: Dict[str, Any]) -> str:
    """
    The prose describing the numbers, without any earlier acknowledgement.

    On the first restyle that is simply the previous answer. Afterwards it comes
    from the spec, which carried it forward — so a run of restyles shows one
    confirmation and one finding, not a stack of confirmations.
    """
    carried = (previous.get('chart_spec') or {}).get('finding')
    return str(carried or previous.get('answer') or '').strip()


def _reshape(rows: List[Any], spec: Dict[str, Any]) -> List[Any]:
    """
    Apply the presentation-only sort and row limit.

    Done on the rows rather than in SQL: the query is known to work, and
    re-generating it to add an ORDER BY would put the numbers at risk for a change
    the user only asked to see differently.
    """
    if not rows:
        return rows

    reshaped = list(rows)
    sort = spec.get('sort')

    if sort in ('asc', 'desc') and isinstance(reshaped[0], (list, tuple)):
        reshaped = _sorted_by_value(reshaped, descending=sort == 'desc')

    limit = spec.get('limit')
    if limit:
        reshaped = reshaped[:limit]

    return reshaped


def _sorted_by_value(rows: List[Any], descending: bool) -> List[Any]:
    """
    Order by the value column, ranking the rows that have a number.

    A column can mix numbers, text and NULL — SQLite stores whatever was in the
    file — and comparing those against each other raises. So the numeric rows are
    ranked and the rest keep their original order behind them, in both directions:
    reversing a single ordering would push the unrankable rows to the front on a
    descending sort, and a following "top 5" would then show none of the values
    the user asked to rank.
    """
    index = len(rows[0]) - 1

    ranked: List[tuple] = []
    unrankable: List[Any] = []

    for row in rows:
        value = _numeric_at(row, index)
        if value is None:
            unrankable.append(row)
        else:
            ranked.append((value, row))

    ranked.sort(key=lambda pair: pair[0], reverse=descending)
    return [row for _, row in ranked] + unrankable


def _numeric_at(row: Any, index: int) -> Optional[float]:
    """Parse the value column as a number, or None when it is not one."""
    if not isinstance(row, (list, tuple)) or index >= len(row) or row[index] is None:
        return None

    try:
        return float(row[index])
    except (TypeError, ValueError):
        return None


def _describe(spec: Dict[str, Any], visualization: str) -> str:
    """Explain the chart choice in terms of what the user asked for."""
    readable = visualization.replace('_', ' ')
    if 'chart_type' in (spec.get('changed') or []):
        return f'You asked for a {readable} chart.'
    return f'Kept as a {readable} chart and restyled as requested.'


def _answer(spec: Dict[str, Any], visualization: str, finding: str) -> str:
    """
    Acknowledge the change, and repeat the finding when it still holds.

    Without the acknowledgement a restyle looks like nothing happened — the user
    sees the same answer text and has to check the chart to know it worked.
    """
    changed = set(spec.get('changed') or [])
    parts = []

    if 'chart_type' in changed:
        parts.append(f'switched to a {visualization.replace("_", " ")} chart')
    if 'palette' in changed:
        parts.append(f'recoloured with the {spec["palette"]} palette')
    if 'sort' in changed:
        parts.append('sorted ' + ('high to low' if spec['sort'] == 'desc' else 'low to high'))
    if 'limit' in changed:
        parts.append(f'trimmed to {spec["limit"]} rows')

    if not parts:
        summary = 'Updated the chart.'
    elif len(parts) == 1:
        summary = f'{parts[0].capitalize()}.'
    else:
        summary = f'{", ".join(parts[:-1]).capitalize()} and {parts[-1]}.'

    return f'{summary}\n\n{finding}' if finding else summary


def apply_refinement_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node that re-presents the previous result."""
    return Refiner().apply(state)
