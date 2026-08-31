"""
Insight generation and table formatting.

Derives statistics from the result set, has the model interpret them, and
renders the rows as a Markdown table.
"""
import logging
import statistics
from typing import Any, Dict, List, Optional

from langchain_core.prompts import ChatPromptTemplate

from querybot_agent.config import settings
from querybot_agent.database_manager import DatabaseManager
from querybot_agent.llm_manager import LLMManager

logger = logging.getLogger(__name__)

# Rows rendered into the table. Beyond this the output stops being readable and
# starts costing meaningful bandwidth.
MAX_TABLE_ROWS = 100


class InsightsGenerator:
    """Produces insights, a narrative and a formatted table."""

    def __init__(self) -> None:
        self.llm_manager = LLMManager()
        self.db_manager = DatabaseManager()

    def generate_insights_and_narrative(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Analyse the results and describe what they show."""
        results = state.get('results') or []
        question = state['question']

        if not results:
            return {'insights': None, 'data_narrative': None, 'insights_error': None}

        columns = state.get('result_columns') or []
        stats = self._describe(results, columns)
        sample = results[: settings.llm_sample_rows]

        prompt = ChatPromptTemplate.from_messages([
            ('system', '''You are a data analyst reporting findings to a colleague.

Return exactly two sections:

**Key findings**
- Three to five bullets, each naming a specific number or comparison
- Point out the largest and smallest values, notable gaps, and anything that looks anomalous
- Quantify claims: "twice as high", "62% of the total", not "significantly higher"

**What this means**
Two or three sentences on why the pattern might exist and what to look at next.

Never invent data that is not shown. If the data is too thin to support a claim,
say so rather than speculating.'''),
            ('human', '''Question: {question}
Columns: {columns}
Rows: {row_count}
Statistics: {stats}
Data (first {sample_size} rows): {results}

Write the analysis:'''),
        ])

        try:
            response = self.llm_manager.invoke(
                prompt,
                question=question,
                columns=', '.join(columns) if columns else 'unnamed',
                row_count=len(results),
                stats=stats,
                sample_size=len(sample),
                results=sample,
            ).strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning('Insight generation failed: %s', exc)
            return {
                'insights': None,
                'data_narrative': None,
                'insights_error': f'Insights could not be generated: {exc}',
            }

        # The two sections are produced in one call and split here; asking twice
        # doubled both the latency and the cost of every query.
        insights, _, narrative = response.partition('**What this means**')

        return {
            'insights': insights.strip() or response,
            'data_narrative': narrative.strip() or None,
            'insights_error': None,
            'suggested_questions': self.suggest_followups(state),
            'data_quality_notes': self.assess_data_quality(state),
        }

    def suggest_followups(self, state: Dict[str, Any]) -> list[str]:
        """
        Propose the questions a analyst would naturally ask next.

        Answering one question usually raises the next one, and a user staring at
        an empty input box rarely knows what this dataset can support. Offering
        three concrete, clickable next steps is what turns a single lookup into an
        actual investigation.
        """
        if not settings.suggest_followups:
            return []

        results = state.get('results') or []
        if not results:
            return []

        prompt = ChatPromptTemplate.from_messages([
            ('system', '''You propose the next questions to ask about a dataset.

Given a question, its result and the schema, return exactly three follow-ups that
a curious analyst would ask next. Each must:
- be answerable from this schema alone
- go somewhere new: drill into a segment, compare over time, or test a cause
- be phrased as the user would type it, under 12 words
- not restate the question already answered

Respond with JSON only: {{"questions": ["...", "...", "..."]}}'''),
            ('human', '''Schema:
{schema}

Question just answered: {question}
Result: {results}

Suggest three follow-up questions:'''),
        ])

        try:
            schema = self.db_manager.get_schema(state['uuid'])
            result = self.llm_manager.invoke_json(
                prompt,
                schema=schema,
                question=state['question'],
                results=str(results[:10]),
            )
            questions = [str(q).strip() for q in (result.get('questions') or []) if str(q).strip()]
            return questions[:3]
        except Exception as exc:  # noqa: BLE001 - a nicety, never a failure
            logger.info('Could not suggest follow-ups: %s', exc)
            return []

    def assess_data_quality(self, state: Dict[str, Any]) -> list[str]:
        """
        Flag characteristics of the result that change how it should be read.

        Computed, not inferred by the model, so the warnings are always true. A
        total that silently excludes a third of the rows is worse than no total,
        and the user has no way to know unless told.
        """
        results = state.get('results') or []
        notes: list[str] = []

        if not results:
            return notes

        if not isinstance(results[0], (list, tuple)):
            return notes

        row_count = len(results)
        width = len(results[0])
        columns = state.get('result_columns') or []

        for index in range(width):
            values = [row[index] for row in results if isinstance(row, (list, tuple)) and index < len(row)]
            name = columns[index] if index < len(columns) else f'column {index + 1}'

            missing = sum(1 for v in values if v is None or v == '')
            if missing:
                share = missing / len(values)
                if share >= 0.1:
                    notes.append(
                        f'{share:.0%} of "{name}" values are missing, so aggregates over it are '
                        f'based on {len(values) - missing} of {len(values)} rows.'
                    )

            numeric = self._as_numbers([v for v in values if v is not None])
            if numeric and len(numeric) > 4:
                # Flag a value far outside the bulk of the distribution: a single
                # outlier can dominate a mean or a chart's scale.
                ordered = sorted(numeric)
                q1 = ordered[len(ordered) // 4]
                q3 = ordered[(3 * len(ordered)) // 4]
                spread = q3 - q1
                if spread > 0:
                    extremes = [v for v in numeric if v > q3 + 3 * spread or v < q1 - 3 * spread]
                    if extremes:
                        notes.append(
                            f'"{name}" contains {len(extremes)} extreme value(s) '
                            f'(up to {max(extremes, key=abs):,.2f}) that will skew averages and chart scales.'
                        )

        if row_count >= settings.max_result_rows:
            notes.append(
                f'The result hit the {settings.max_result_rows:,}-row limit, so it may be incomplete. '
                'Narrow the question or add a filter for a complete answer.'
            )

        # Two notes is a useful heads-up; ten is noise the user will skip.
        return notes[:3]

    def format_data_table(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Render the rows as a Markdown table."""
        results = state.get('results') or []

        if not results:
            return {'formatted_table': None}

        columns = state.get('result_columns') or []
        if not columns:
            width = len(results[0]) if isinstance(results[0], (list, tuple)) else 1
            columns = [f'Column {index + 1}' for index in range(width)]

        try:
            rows = results[:MAX_TABLE_ROWS]

            lines = [
                f'| {" | ".join(columns)} |',
                f'| {" | ".join("---" for _ in columns)} |',
            ]
            for row in rows:
                cells = row if isinstance(row, (list, tuple)) else [row]
                lines.append(f'| {" | ".join(self._format_cell(cell) for cell in cells)} |')

            if len(results) > MAX_TABLE_ROWS:
                lines.append('')
                lines.append(f'_Showing {MAX_TABLE_ROWS} of {len(results):,} rows._')

            return {'formatted_table': '\n'.join(lines)}
        except Exception as exc:  # noqa: BLE001
            logger.warning('Table formatting failed: %s', exc)
            return {'formatted_table': None}

    @staticmethod
    def _format_cell(value: Any) -> str:
        """Render one cell, keeping numbers readable and the table intact."""
        if value is None:
            return ''
        if isinstance(value, float):
            text = f'{value:,.2f}'
        elif isinstance(value, int):
            text = f'{value:,}'
        else:
            text = str(value)
        # A literal pipe would split the cell and corrupt the Markdown table.
        return text.replace('|', '\\|')

    def _describe(self, results: List[Any], columns: List[str]) -> str:
        """Summarise the result set numerically to ground the model's claims."""
        parts = [f'{len(results)} rows']

        if not isinstance(results[0], (list, tuple)):
            return ' | '.join(parts)

        width = len(results[0])
        for index in range(width):
            values = [
                row[index]
                for row in results
                if isinstance(row, (list, tuple)) and index < len(row) and row[index] is not None
            ]
            if not values:
                continue

            name = columns[index] if index < len(columns) else f'column {index + 1}'
            numeric = self._as_numbers(values)

            if numeric and len(numeric) / len(values) > 0.7:
                summary = (
                    f'{name}: min {min(numeric):,.2f}, max {max(numeric):,.2f}, '
                    f'mean {statistics.mean(numeric):,.2f}, total {sum(numeric):,.2f}'
                )
                if len(numeric) > 1:
                    summary += f', stdev {statistics.stdev(numeric):,.2f}'
                parts.append(summary)
            else:
                parts.append(f'{name}: {len(set(map(str, values)))} distinct values')

        return ' | '.join(parts)

    @staticmethod
    def _as_numbers(values: List[Any]) -> Optional[List[float]]:
        """Parse the values that are numeric, ignoring the rest."""
        numbers = []
        for value in values:
            try:
                numbers.append(float(value))
            except (TypeError, ValueError):
                continue
        return numbers or None


def generate_insights_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node wrapper for insight generation."""
    return InsightsGenerator().generate_insights_and_narrative(state)


def format_table_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node wrapper for table formatting."""
    return InsightsGenerator().format_data_table(state)
