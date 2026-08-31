"""
Tests for execution-guided self-correction and the proactive-insight helpers.

The repair loop is the accuracy mechanism: a query that fails is rewritten using
the database's own error message as feedback. These tests pin down the routing so
it recovers real failures without ever spinning.
"""
import os

import pytest

os.environ.setdefault('CHART_DOCKER_ENABLED', 'false')
os.environ.setdefault('GROQ_API_KEY', 'test-key')

from querybot_agent.config import settings  # noqa: E402
from querybot_agent.insights_generator import InsightsGenerator  # noqa: E402
from querybot_agent.question_classifier import should_repair_sql  # noqa: E402


class TestRepairRouting:
    def test_a_successful_query_is_not_retried(self):
        state = {'results': [[1]], 'error': None, 'sql_query': 'SELECT 1', 'sql_attempts': 1}
        assert should_repair_sql(state) == 'continue'

    def test_a_failing_query_is_retried(self):
        state = {
            'results': [],
            'error': 'no such column: revenu',
            'sql_query': 'SELECT revenu FROM t',
            'sql_attempts': 1,
        }
        assert should_repair_sql(state) == 'repair_sql'

    def test_retries_stop_at_the_configured_limit(self):
        """Past a couple of attempts the model repeats itself; retrying only adds latency."""
        state = {
            'results': [],
            'error': 'no such column: revenu',
            'sql_query': 'SELECT revenu FROM t',
            'sql_attempts': settings.max_sql_repairs + 1,
        }
        assert should_repair_sql(state) == 'continue'

    def test_a_repair_that_produced_nothing_new_stops_the_loop(self):
        """An identical query fails identically, so there is nothing to gain."""
        state = {
            'results': [],
            'error': 'syntax error',
            'sql_query': 'SELECT',
            'sql_attempts': 1,
            'sql_repaired': False,
        }
        assert should_repair_sql(state) == 'continue'

    @pytest.mark.parametrize('sentinel', ['NOT_RELEVANT', 'NOT_ENOUGH_INFO'])
    def test_unanswerable_questions_are_not_retried(self, sentinel):
        state = {'results': [], 'error': 'cannot answer', 'sql_query': sentinel, 'sql_attempts': 1}
        assert should_repair_sql(state) == 'continue'

    def test_the_loop_terminates_for_a_persistently_failing_query(self):
        """
        Walks the cycle the graph would take, asserting it reaches 'continue'.
        A repair edge that never stops would hang every failing request.
        """
        state = {'results': [], 'error': 'no such column: x', 'sql_query': 'SELECT x', 'sql_attempts': 0}
        transitions = 0

        while should_repair_sql(state) == 'repair_sql':
            transitions += 1
            state['sql_attempts'] += 1
            assert transitions <= settings.max_sql_repairs + 2, 'the repair loop did not terminate'

        assert transitions <= settings.max_sql_repairs + 1


class TestDataQualityNotes:
    """Computed from the rows, so the warnings are always factually true."""

    def setup_method(self):
        self.generator = InsightsGenerator()

    def test_nothing_is_flagged_for_clean_data(self):
        state = {
            'results': [['a', 1.0], ['b', 2.0], ['c', 3.0]],
            'result_columns': ['label', 'value'],
        }
        assert self.generator.assess_data_quality(state) == []

    def test_substantial_missing_values_are_flagged(self):
        state = {
            'results': [['a', 1.0], ['b', None], ['c', None], ['d', 4.0]],
            'result_columns': ['label', 'revenue'],
        }
        notes = self.generator.assess_data_quality(state)

        assert any('revenue' in n and 'missing' in n for n in notes), notes
        # A total over this column covers 2 of 4 rows; the user must know.
        assert any('2 of 4 rows' in n for n in notes), notes

    def test_a_dominant_outlier_is_flagged(self):
        """One extreme value can dominate a mean and flatten a chart's scale."""
        rows = [[f'r{i}', float(i)] for i in range(20)]
        rows.append(['spike', 1_000_000.0])

        notes = self.generator.assess_data_quality(
            {'results': rows, 'result_columns': ['label', 'amount']}
        )
        assert any('extreme value' in n for n in notes), notes

    def test_hitting_the_row_cap_is_flagged_as_incomplete(self):
        rows = [[i, float(i)] for i in range(settings.max_result_rows)]
        notes = self.generator.assess_data_quality(
            {'results': rows, 'result_columns': ['a', 'b']}
        )
        assert any('row limit' in n or 'incomplete' in n for n in notes), notes

    def test_notes_are_capped_so_they_stay_readable(self):
        rows = [[None, None, None, None, None] for _ in range(10)]
        notes = self.generator.assess_data_quality(
            {'results': rows, 'result_columns': ['a', 'b', 'c', 'd', 'e']}
        )
        assert len(notes) <= 3

    def test_an_empty_result_produces_no_notes(self):
        assert self.generator.assess_data_quality({'results': []}) == []


class TestFollowupSuggestions:
    def test_suggestions_are_skipped_when_there_is_no_data(self):
        assert InsightsGenerator().suggest_followups({'results': [], 'question': 'x'}) == []

    def test_suggestions_can_be_turned_off(self, monkeypatch):
        # Settings is a frozen dataclass, so the module's reference is swapped for
        # a modified copy rather than the field being mutated in place.
        import dataclasses

        from querybot_agent import insights_generator

        monkeypatch.setattr(
            insights_generator,
            'settings',
            dataclasses.replace(settings, suggest_followups=False),
        )

        result = InsightsGenerator().suggest_followups(
            {'results': [[1]], 'question': 'x', 'uuid': 'u'}
        )
        assert result == []

    def test_a_model_failure_degrades_to_no_suggestions(self, monkeypatch):
        """A nicety must never fail the request that carries it."""
        generator = InsightsGenerator()
        monkeypatch.setattr(
            generator.db_manager, 'get_schema', lambda *a, **k: (_ for _ in ()).throw(RuntimeError('down'))
        )
        assert generator.suggest_followups({'results': [[1]], 'question': 'x', 'uuid': 'u'}) == []
