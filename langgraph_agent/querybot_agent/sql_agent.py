"""
SQL generation and execution.

Turns a natural-language question into a validated SQLite query, runs it through
the dataset service, repairs it from the database's own error when it fails, and
states the result in plain language.
"""
import logging
import re
from typing import Optional

from langchain_core.prompts import ChatPromptTemplate

from querybot_agent.config import settings
from querybot_agent.database_manager import DatabaseManager, DatabaseError
from querybot_agent.llm_manager import LLMManager

logger = logging.getLogger(__name__)

# Sentinels the model returns instead of SQL.
NOT_RELEVANT = 'NOT_RELEVANT'
NOT_ENOUGH_INFO = 'NOT_ENOUGH_INFO'

SQL_STYLE_RULES = '''
IMPORTANT SQLite STYLE RULES:
- Wrap table and column identifiers in backticks whenever they contain spaces or
  special characters, e.g. `product name`.
- Use single quotes for string literals. Never use double quotes for strings:
  SQLite reads a double-quoted token as an identifier.
- Escape a single quote inside a literal by doubling it: 'O''Reilly'.
- Use IS NULL / IS NOT NULL for null checks.
- Do not quote numeric literals.
- Exclude rows where a selected column is NULL, '' or 'N/A'.
- Return two or three columns: [label, value] or [label, series, value].
- Always add a LIMIT unless the question requires a full aggregate.
'''


def _format_history(history: Optional[list[dict]]) -> str:
    """Render prior turns as plain text for prompt context."""
    if not history:
        return 'None - this is the first question in the conversation.'

    lines = []
    for turn in history[-6:]:
        role = 'User' if turn.get('role') == 'user' else 'Assistant'
        content = str(turn.get('content', ''))[:400]
        lines.append(f'{role}: {content}')
        if turn.get('sql_query'):
            lines.append(f'  (SQL used: {turn["sql_query"]})')
    return '\n'.join(lines)


def _format_previous_query(state: dict) -> str:
    """
    Render the last query for the SQL prompt.

    A follow-up like "now break that down by month" is an edit to the previous
    query, not a fresh problem. Showing it explicitly keeps the filters and joins
    the user already accepted, which regenerating from the question alone loses.
    """
    previous = state.get('previous') or {}
    query = previous.get('sql_query')

    if not query:
        return 'None.'

    asked = previous.get('question')
    lead = f'It answered: {asked}\n' if asked else ''
    return f'{lead}{query}\n\nEdit this query if the new question refines it. Otherwise ignore it.'


def _strip_sql_fences(text: str) -> str:
    """Remove markdown fences the model sometimes wraps around SQL."""
    cleaned = text.strip()
    cleaned = re.sub(r'^```(?:sql)?\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*```$', '', cleaned)
    return cleaned.strip().rstrip(';').strip()


class SQLAgent:
    """Owns the SQL portion of the workflow."""

    def __init__(self) -> None:
        self.db_manager = DatabaseManager()
        self.llm_manager = LLMManager()

    def parse_question(self, state: dict) -> dict:
        """Identify the tables and columns relevant to the question."""
        question = state['question']
        schema = self.db_manager.get_schema(state['uuid'])

        prompt = ChatPromptTemplate.from_messages([
            ('system', '''You identify which parts of a database schema are needed to answer a question.

Set is_relevant to false when the question cannot be answered from this schema.

Respond with JSON only:
{{
    "is_relevant": boolean,
    "relevant_tables": [
        {{"table_name": string, "columns": [string], "noun_columns": [string]}}
    ]
}}

"noun_columns" lists only columns holding names or labels the question filters on
- "Artist Name" qualifies, "Artist ID" does not. Never include numeric columns.'''),
            ('human', '''===Database schema:
{schema}

===Conversation so far:
{history}

===User question:
{question}

Identify the relevant tables and columns:'''),
        ])

        try:
            parsed = self.llm_manager.invoke_json(
                prompt,
                schema=schema,
                question=question,
                history=_format_history(state.get('history')),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning('Question parsing failed, assuming relevance: %s', exc)
            # Assume relevance so the query attempt still happens; a genuinely
            # unanswerable question fails later with a clearer message.
            parsed = {'is_relevant': True, 'relevant_tables': []}

        return {'parsed_question': parsed}

    def get_unique_nouns(self, state: dict) -> dict:
        """
        Sample distinct values from label columns.

        Giving the model the real values prevents it from inventing filters such
        as WHERE city = 'New York' when the data actually says 'NEW YORK'.
        """
        parsed_question = state.get('parsed_question') or {}

        if not parsed_question.get('is_relevant', True):
            return {'unique_nouns': []}

        unique_nouns: set[str] = set()

        for table_info in parsed_question.get('relevant_tables', []):
            table_name = table_info.get('table_name')
            if not table_name:
                continue

            for noun_column in table_info.get('noun_columns', []) or []:
                query = (
                    f'SELECT DISTINCT `{noun_column}` FROM `{table_name}` '
                    f'WHERE `{noun_column}` IS NOT NULL '
                    f"AND `{noun_column}` != '' AND `{noun_column}` != 'N/A' LIMIT 50"
                )
                try:
                    for row in self.db_manager.execute_query(state['uuid'], query):
                        if row and row[0] is not None:
                            unique_nouns.add(str(row[0]))
                except DatabaseError:
                    # A column the model guessed at may not exist; skip it.
                    logger.debug('Could not sample %s.%s', table_name, noun_column)

                if len(unique_nouns) >= 200:
                    break

        return {'unique_nouns': sorted(unique_nouns)}

    def generate_sql(self, state: dict) -> dict:
        """Write a SQLite query for the question."""
        parsed_question = state.get('parsed_question') or {}

        if not parsed_question.get('is_relevant', True):
            return {'sql_query': NOT_RELEVANT}

        schema = self.db_manager.get_schema(state['uuid'])

        prompt = ChatPromptTemplate.from_messages([
            ('system', f'''You write SQLite queries that answer questions about a database.
{SQL_STYLE_RULES}
If the schema does not contain enough information, reply with exactly {NOT_ENOUGH_INFO}.

OUTPUT: the SQL query only. No markdown, no commentary.'''),
            ('human', '''===Database schema:
{schema}

===Conversation so far:
{history}

===Previous query:
{previous_query}

===User question:
{question}

===Relevant tables and columns:
{parsed_question}

===Actual values present in label columns:
{unique_nouns}

Write the SQL query:'''),
        ])

        response = self.llm_manager.invoke(
            prompt,
            schema=schema,
            question=state['question'],
            parsed_question=parsed_question,
            unique_nouns=state.get('unique_nouns', []),
            history=_format_history(state.get('history')),
            previous_query=_format_previous_query(state),
        )

        sql = _strip_sql_fences(response)
        if NOT_ENOUGH_INFO in sql.upper():
            return {'sql_query': NOT_ENOUGH_INFO}

        return {'sql_query': sql}

    def validate_and_fix_sql(self, state: dict) -> dict:
        """Check the query against the schema and correct it if needed."""
        sql_query = state.get('sql_query', '')

        if sql_query in (NOT_RELEVANT, NOT_ENOUGH_INFO):
            return {
                'sql_query': sql_query,
                'sql_valid': False,
                'sql_issues': 'The question cannot be answered from this dataset.',
            }

        schema = self.db_manager.get_schema(state['uuid'])

        prompt = ChatPromptTemplate.from_messages([
            ('system', f'''You validate SQLite queries against a schema.

Confirm every table and column exists and the syntax is valid.
{SQL_STYLE_RULES}

Respond with JSON only:
{{{{"valid": boolean, "issues": string or null, "corrected_query": string}}}}

When the query is already correct, set valid to true, issues to null, and
corrected_query to the original query.'''),
            ('human', '''===Database schema:
{schema}

===Query to validate:
{sql_query}

Respond with JSON only:'''),
        ])

        try:
            result = self.llm_manager.invoke_json(prompt, schema=schema, sql_query=sql_query)
        except Exception as exc:  # noqa: BLE001
            # Validation is an optimisation, not a gate: if it fails, run the
            # original query and let the database report any real problem.
            logger.warning('SQL validation failed, using the original query: %s', exc)
            return {'sql_query': sql_query, 'sql_valid': True, 'sql_issues': None}

        if result.get('valid') and not result.get('issues'):
            return {'sql_query': sql_query, 'sql_valid': True, 'sql_issues': None}

        corrected = _strip_sql_fences(str(result.get('corrected_query') or ''))
        # A validator that reports a problem but returns nothing usable would
        # otherwise replace the query with the string "None".
        if not corrected or corrected.lower() == 'none':
            return {'sql_query': sql_query, 'sql_valid': True, 'sql_issues': result.get('issues')}

        return {'sql_query': corrected, 'sql_valid': False, 'sql_issues': result.get('issues')}

    def execute_sql(self, state: dict) -> dict:
        """Run the query and return rows plus column names."""
        query = state.get('sql_query', '')
        attempts = int(state.get('sql_attempts') or 0)

        if query == NOT_RELEVANT:
            return {'results': [], 'result_columns': [], 'error': 'The question is not about this dataset.'}
        if query == NOT_ENOUGH_INFO:
            return {
                'results': [],
                'result_columns': [],
                'error': 'This dataset does not contain enough information to answer that.',
            }

        try:
            payload = self.db_manager.execute_query_detailed(state['uuid'], query)
            return {
                'results': payload.get('results', []),
                'result_columns': payload.get('columns', []),
                'error': None,
                'sql_attempts': attempts + 1,
            }
        except DatabaseError as exc:
            message = str(exc)
            logger.info('Query attempt %d failed: %s', attempts + 1, message)
            return {
                'results': [],
                'result_columns': [],
                'error': message,
                'sql_attempts': attempts + 1,
                # Accumulated so a repair can see what has already been tried and
                # avoid proposing the same broken query again.
                'sql_error_history': (state.get('sql_error_history') or []) + [f'{query} -> {message}'],
            }

    def repair_sql(self, state: dict) -> dict:
        """
        Rewrite a failing query using the database's error message as feedback.

        The database knows things the schema text does not — that a column is
        stored as text, that an alias is out of scope, that a function does not
        exist in SQLite. Feeding the real error back recovers most failures that
        would otherwise reach the user as a raw SQLite message.
        """
        schema = self.db_manager.get_schema(state['uuid'])
        history = state.get('sql_error_history') or []

        prompt = ChatPromptTemplate.from_messages([
            ('system', f'''You repair SQLite queries that failed to execute.

You are given the schema, the question, and every attempt so far with the exact
error the database returned. Diagnose the cause and return a corrected query.
{SQL_STYLE_RULES}

Common causes and their fixes:
- "no such column": the name is wrong or needs backticks; check the schema exactly.
- "no such function": SQLite lacks it. Use strftime for dates, || to concatenate,
  and CAST(x AS REAL) to coerce a value.
- "ambiguous column name": qualify it with its table.
- "misuse of aggregate": the aggregate belongs in HAVING, not WHERE.
- A comparison that returns nothing: the column may be text; CAST it before
  comparing numerically.

OUTPUT: the corrected SQL only. No markdown, no explanation.'''),
            ('human', '''===Database schema:
{schema}

===User question:
{question}

===Failed attempts, each with the database error:
{history}

Write a corrected SQL query:'''),
        ])

        try:
            response = self.llm_manager.invoke(
                prompt,
                schema=schema,
                question=state['question'],
                history='\n\n'.join(history[-3:]),
            )
            repaired = _strip_sql_fences(response)
        except Exception as exc:  # noqa: BLE001
            logger.warning('SQL repair failed: %s', exc)
            # Leave the query unchanged; routing will stop retrying.
            return {'sql_repaired': False}

        if not repaired or repaired == state.get('sql_query'):
            # An identical query would fail identically, so stop here.
            return {'sql_repaired': False}

        logger.info('Repaired SQL after attempt %s', state.get('sql_attempts'))
        return {'sql_query': repaired, 'sql_repaired': True, 'error': None}

    def format_results(self, state: dict) -> dict:
        """Turn rows into a sentence a person would write, not a Python repr."""
        results = state.get('results') or []
        question = state['question']

        if state.get('error'):
            return {'answer': state['error']}
        if not results:
            return {'answer': 'That query returned no rows, so there is nothing to report for this question.'}

        columns = state.get('result_columns') or []
        sample = results[: settings.llm_sample_rows]

        prompt = ChatPromptTemplate.from_messages([
            ('system', '''You state what query results show, in plain language.

- Answer the question directly in one or two sentences.
- Quote the specific numbers that matter, formatted readably (1,234 not 1234.0).
- Do not describe the query, the table or the process.
- Do not invent anything the data does not show.'''),
            ('human', '''Question: {question}
Columns: {columns}
Rows returned: {row_count}
Data (first {sample_size} rows): {results}

Answer the question:'''),
        ])

        try:
            answer = self.llm_manager.invoke(
                prompt,
                question=question,
                columns=', '.join(columns) if columns else 'unnamed',
                row_count=len(results),
                sample_size=len(sample),
                results=sample,
            ).strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning('Answer formatting failed: %s', exc)
            answer = f'The query returned {len(results)} row(s). See the table and chart below.'

        return {'answer': answer}
