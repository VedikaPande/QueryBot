"""
Tests for conversational refinement and provider selection.
"""
import os

os.environ.setdefault('CHART_DOCKER_ENABLED', 'false')
os.environ.setdefault('GROQ_API_KEY', 'test-key')

import pytest  # noqa: E402

from querybot_agent import chart_templates, refinement  # noqa: E402
from querybot_agent.chart_templates import build_chart_code  # noqa: E402
from querybot_agent.config import PROVIDER_DEFAULT_MODELS, Settings  # noqa: E402
from querybot_agent.database_manager import DatabaseError  # noqa: E402
from querybot_agent.llm_manager import (  # noqa: E402
    PROVIDERS,
    LLMConfigurationError,
    LLMManager,
    _build_client,
    _rejects_temperature,
    _text_of,
)

PREVIOUS = {
    'question': 'What is the total revenue by city?',
    'answer': 'Yangon leads with 1,912.95, ahead of Mandalay at 1,116.67.',
    'sql_query': 'SELECT city, SUM(total) FROM sales GROUP BY city',
    'visualization': 'bar',
    'chart_spec': {},
}


class TestIntentParsing:
    def test_a_chart_type_change_is_a_restyle(self):
        intent, spec = refinement.parse_intent(
            {'intent': 'restyle', 'chart_type': 'pie'}, PREVIOUS
        )
        assert intent == refinement.RESTYLE
        assert spec['chart_type'] == 'pie'
        assert spec['changed'] == ['chart_type']

    def test_the_first_question_can_never_be_a_restyle(self):
        """
        There is no previous query to re-run, so a restyle would have nothing to
        restyle. The model claiming otherwise must not derail the run.
        """
        intent, spec = refinement.parse_intent({'intent': 'restyle', 'chart_type': 'pie'}, None)
        assert (intent, spec) == (refinement.NEW, {})

        intent, _ = refinement.parse_intent(
            {'intent': 'restyle', 'chart_type': 'pie'}, {'visualization': 'bar'}
        )
        assert intent == refinement.NEW

    def test_a_restyle_to_the_same_chart_falls_back_to_a_new_question(self):
        """
        Nothing changed, so re-rendering would look like the request was ignored.
        Answering it as a fresh question at least does something.
        """
        intent, spec = refinement.parse_intent(
            {'intent': 'restyle', 'chart_type': 'bar'}, PREVIOUS
        )
        assert (intent, spec) == (refinement.NEW, {})

    def test_an_unknown_chart_type_is_rejected_rather_than_guessed(self):
        """
        A type with no template would silently render as a bar chart, which looks
        like the request was misunderstood.
        """
        intent, _ = refinement.parse_intent(
            {'intent': 'restyle', 'chart_type': 'sankey'}, PREVIOUS
        )
        assert intent == refinement.NEW

    def test_an_unknown_palette_is_dropped(self):
        intent, spec = refinement.parse_intent(
            {'intent': 'restyle', 'chart_type': 'pie', 'palette': 'neon-vaporwave'}, PREVIOUS
        )
        assert intent == refinement.RESTYLE
        assert 'palette' not in spec

    def test_a_palette_keeps_the_casing_matplotlib_expects(self):
        """`blues` is not a colormap; `Blues` is."""
        _, spec = refinement.parse_intent(
            {'intent': 'restyle', 'palette': 'blues'}, PREVIOUS
        )
        assert spec['palette'] == 'Blues'

    def test_styling_accumulates_across_turns(self):
        """
        "Make it a pie chart" then "now in green" has to keep the pie, so the
        palette already in force is inherited when the user does not mention it.
        """
        previous = {**PREVIOUS, 'visualization': 'pie', 'chart_spec': {'palette': 'Greens'}}
        _, spec = refinement.parse_intent(
            {'intent': 'restyle', 'sort': 'desc'}, previous
        )
        assert spec['palette'] == 'Greens'
        assert spec['sort'] == 'desc'
        # Only what this turn changed is announced to the user.
        assert spec['changed'] == ['sort']

    def test_a_limit_is_capped(self):
        _, spec = refinement.parse_intent({'intent': 'restyle', 'limit': 99_999}, PREVIOUS)
        assert spec['limit'] == refinement.MAX_REFINE_LIMIT

    def test_a_nonsense_limit_is_ignored(self):
        for value in (0, -3, 'lots', None):
            _, spec = refinement.parse_intent(
                {'intent': 'restyle', 'chart_type': 'pie', 'limit': value}, PREVIOUS
            )
            assert 'limit' not in spec

    def test_requery_is_left_to_the_normal_pipeline(self):
        intent, spec = refinement.parse_intent(
            {'intent': 'requery', 'chart_type': 'pie'}, PREVIOUS
        )
        assert (intent, spec) == (refinement.REQUERY, {})

    def test_an_unrecognised_intent_degrades_to_a_new_question(self):
        intent, _ = refinement.parse_intent({'intent': 'restyle-ish'}, PREVIOUS)
        assert intent == refinement.NEW

    def test_refinement_can_be_switched_off(self, monkeypatch):
        monkeypatch.setenv('REFINE_FOLLOWUPS', 'false')
        monkeypatch.setattr(refinement, 'settings', Settings())
        intent, _ = refinement.parse_intent(
            {'intent': 'restyle', 'chart_type': 'pie'}, PREVIOUS
        )
        assert intent == refinement.NEW


class TestReshape:
    ROWS = [['Yangon', 1912.95], ['Mandalay', 1116.67], ['Naypyitaw', 2100.5]]

    def test_sorting_uses_the_value_column(self):
        descending = refinement._reshape(self.ROWS, {'sort': 'desc'})
        assert [row[0] for row in descending] == ['Naypyitaw', 'Yangon', 'Mandalay']

        ascending = refinement._reshape(self.ROWS, {'sort': 'asc'})
        assert [row[0] for row in ascending] == ['Mandalay', 'Yangon', 'Naypyitaw']

    def test_a_limit_trims_after_sorting(self):
        top = refinement._reshape(self.ROWS, {'sort': 'desc', 'limit': 2})
        assert [row[0] for row in top] == ['Naypyitaw', 'Yangon']

    def test_mixed_and_missing_values_do_not_raise(self):
        """
        SQLite returns text where a column was stored as text, and NULL as None.
        Comparing those against floats directly is a TypeError.
        """
        rows = [['a', 5], ['b', 'n/a'], ['c', None], ['d', '12']]
        ordered = refinement._reshape(rows, {'sort': 'desc'})
        # The rankable rows lead in both directions, so a following "top 2" shows
        # the two largest values rather than two blanks.
        assert [row[0] for row in ordered] == ['d', 'a', 'b', 'c']
        assert refinement._reshape(rows, {'sort': 'desc', 'limit': 2})[0][0] == 'd'

        ascending = refinement._reshape(rows, {'sort': 'asc'})
        assert [row[0] for row in ascending[:2]] == ['a', 'd']

    def test_an_empty_result_is_returned_unchanged(self):
        assert refinement._reshape([], {'sort': 'desc', 'limit': 5}) == []


class _StubDatabase:
    """Stands in for the dataset service."""

    def __init__(self, payload=None, error=None):
        self.payload = payload or {}
        self.error = error
        self.queries = []

    def execute_query_detailed(self, _uuid, query):
        self.queries.append(query)
        if self.error:
            raise DatabaseError(self.error)
        return self.payload


class TestRefiner:
    def _refiner(self, database):
        refiner = refinement.Refiner()
        refiner.db_manager = database
        return refiner

    def test_the_previous_query_is_re_run_verbatim(self):
        """
        Re-running the known-good SQL rather than writing it again is what keeps
        the restyled chart showing the same numbers as the first one.
        """
        database = _StubDatabase(
            {'results': [['Yangon', 1912.95], ['Mandalay', 1116.67]], 'columns': ['city', 'total']}
        )
        update = self._refiner(database).apply(
            {
                'uuid': 'd1',
                'previous': PREVIOUS,
                'chart_spec': {'chart_type': 'pie', 'changed': ['chart_type']},
            }
        )

        assert database.queries == [PREVIOUS['sql_query']]
        assert update['sql_query'] == PREVIOUS['sql_query']
        assert update['visualization'] == 'pie'
        assert update['result_columns'] == ['city', 'total']
        assert 'pie chart' in update['answer']

    def test_a_pure_restyle_carries_the_previous_finding_forward(self):
        database = _StubDatabase({'results': [['Yangon', 1]], 'columns': ['city', 'total']})
        update = self._refiner(database).apply(
            {
                'uuid': 'd1',
                'previous': {**PREVIOUS, 'insights': '- Yangon leads'},
                'chart_spec': {'palette': 'crest', 'changed': ['palette']},
            }
        )

        assert update['insights'] == '- Yangon leads'
        # The rows are unchanged, so the earlier prose still describes them.
        assert PREVIOUS['answer'] in update['answer']

    def test_changing_the_rows_drops_the_stale_prose(self):
        """
        "Top 5 only" changes what is on screen, so a sentence about the full set
        would now be wrong.
        """
        database = _StubDatabase({'results': [[f'c{i}', i] for i in range(9)], 'columns': ['c', 'v']})
        update = self._refiner(database).apply(
            {
                'uuid': 'd1',
                'previous': {**PREVIOUS, 'insights': '- Nine cities'},
                'chart_spec': {'limit': 5, 'sort': 'desc', 'changed': ['limit', 'sort']},
            }
        )

        assert len(update['results']) == 5
        assert 'insights' not in update
        assert PREVIOUS['answer'] not in update['answer']

    def test_acknowledgements_do_not_stack_over_successive_restyles(self):
        """
        Each restyle opens with a line saying what changed. Carrying the whole
        previous answer forward would stack them, leaving the user to read three
        confirmations before the number they asked about.
        """
        database = _StubDatabase({'results': [['Yangon', 1]], 'columns': ['city', 'total']})
        refiner = self._refiner(database)
        finding = 'Yangon leads with 1,912.95, ahead of Mandalay at 1,116.67.'

        first = refiner.apply(
            {
                'uuid': 'd1',
                'previous': PREVIOUS,
                'chart_spec': {'chart_type': 'pie', 'changed': ['chart_type']},
            }
        )
        assert first['answer'] == f'Switched to a pie chart.\n\n{finding}'

        # The next turn sees the composed answer, and must still find the finding.
        second = refiner.apply(
            {
                'uuid': 'd1',
                'previous': {
                    **PREVIOUS,
                    'answer': first['answer'],
                    'visualization': 'pie',
                    'chart_spec': first['chart_spec'],
                },
                'chart_spec': {'palette': 'flare', 'changed': ['palette']},
            }
        )
        assert second['answer'] == f'Recoloured with the flare palette.\n\n{finding}'
        assert second['answer'].count('Switched to') == 0

    def test_an_answer_that_reads_like_an_acknowledgement_survives_intact(self):
        """
        The finding is carried explicitly rather than parsed back out of the
        answer, so prose that happens to open the same way keeps its first
        sentence.
        """
        database = _StubDatabase({'results': [['Yangon', 1]], 'columns': ['city', 'total']})
        answer = 'Switched to card payments in 62% of orders.\n\nCash accounts for the rest.'

        update = self._refiner(database).apply(
            {
                'uuid': 'd1',
                'previous': {**PREVIOUS, 'answer': answer},
                'chart_spec': {'palette': 'flare', 'changed': ['palette']},
            }
        )

        assert '62% of orders' in update['answer']

    def test_a_trimmed_result_stops_carrying_the_old_prose_forward(self):
        """
        Once a sort or limit changes the rows, the finding no longer describes
        them — and must not resurface on a later turn either.
        """
        database = _StubDatabase(
            {'results': [[f'c{index}', index] for index in range(9)], 'columns': ['c', 'v']}
        )
        update = self._refiner(database).apply(
            {
                'uuid': 'd1',
                'previous': PREVIOUS,
                'chart_spec': {'limit': 3, 'changed': ['limit']},
            }
        )

        assert update['answer'] == 'Trimmed to 3 rows.'
        assert 'finding' not in update['chart_spec']

    def test_a_query_that_no_longer_runs_is_reported_not_raised(self):
        """
        The dataset can be replaced between turns, so the stored SQL is not
        guaranteed to still work. The user gets an explanation and a way forward.
        """
        database = _StubDatabase(error='no such table: sales')
        update = self._refiner(database).apply(
            {'uuid': 'd1', 'previous': PREVIOUS, 'chart_spec': {'chart_type': 'pie'}}
        )

        assert update['visualization'] == 'none'
        assert 'no such table' in update['answer']
        assert update['results'] == []


class TestPaletteSelection:
    def test_the_default_palette_is_used_when_nothing_was_asked_for(self):
        assert chart_templates.palette_of({}) == chart_templates.DEFAULT_PALETTE
        assert chart_templates.cmap_of({}) == chart_templates.DEFAULT_CMAP

    def test_a_requested_palette_reaches_the_chart(self):
        spec = {'palette': 'flare'}
        assert chart_templates.palette_of(spec) == 'flare'
        # flare is also a colormap, so a heatmap can honour it.
        assert chart_templates.cmap_of(spec) == 'flare'

    def test_a_discrete_palette_does_not_become_a_colormap(self):
        """`husl` is a qualitative palette; passing it as a cmap raises."""
        assert chart_templates.cmap_of({'palette': 'deep'}) == chart_templates.DEFAULT_CMAP

    def test_an_invalid_palette_never_reaches_seaborn(self):
        spec = {'palette': '__import__("os")'}
        assert chart_templates.palette_of(spec) == chart_templates.DEFAULT_PALETTE


class TestChartTemplateHonoursTheSpec:
    def _code(self, visualization, palette, cmap):
        return build_chart_code(
            visualization,
            [['Yangon', 1912.95], ['Mandalay', 1116.67]],
            'total revenue by city',
            '/tmp/chart.png',
            palette,
            cmap,
        )

    def test_the_palette_is_injected_as_a_literal(self):
        code = self._code('pie', 'Greens', 'Greens')
        assert 'PALETTE = "Greens"' in code
        assert 'sns.set_theme(style="whitegrid", palette=PALETTE)' in code
        # The pie chart builds its own colour list and must use it too.
        assert 'sns.color_palette(PALETTE, len(totals))' in code

    def test_a_heatmap_uses_the_colormap(self):
        code = self._code('heatmap', 'viridis', 'viridis')
        assert 'CMAP = "viridis"' in code
        assert 'cmap=CMAP' in code

    def test_every_offered_chart_type_produces_compilable_code(self):
        """
        A type the refiner accepts but the generator cannot build would render as
        a bar chart with the wrong title.
        """
        for chart_type in chart_templates.CHART_TYPES:
            if chart_type == 'none':
                continue
            compile(self._code(chart_type, 'husl', 'YlGnBu'), '<chart>', 'exec')


class TestProviderSelection:
    def test_every_provider_has_a_default_model(self):
        assert set(PROVIDER_DEFAULT_MODELS) == set(PROVIDERS)

    def test_the_default_provider_is_groq(self):
        assert Settings().llm_provider == 'groq'

    def test_an_explicit_model_wins_over_the_provider_default(self, monkeypatch):
        monkeypatch.setenv('LLM_PROVIDER', 'anthropic')
        monkeypatch.setenv('LLM_MODEL', 'claude-haiku-4-5')
        assert Settings().model == 'claude-haiku-4-5'

    def test_each_provider_falls_back_to_its_own_default(self, monkeypatch):
        monkeypatch.delenv('LLM_MODEL', raising=False)
        monkeypatch.delenv('GROQ_MODEL', raising=False)
        for provider, expected in PROVIDER_DEFAULT_MODELS.items():
            monkeypatch.setenv('LLM_PROVIDER', provider)
            assert Settings().model == expected

    def test_groq_model_still_selects_the_model_for_groq(self, monkeypatch):
        """It predates multi-provider support and is set in existing deployments."""
        monkeypatch.delenv('LLM_MODEL', raising=False)
        monkeypatch.setenv('LLM_PROVIDER', 'groq')
        monkeypatch.setenv('GROQ_MODEL', 'llama-3.3-70b-versatile')
        assert Settings().model == 'llama-3.3-70b-versatile'

    def test_groq_model_does_not_leak_into_another_provider(self, monkeypatch):
        monkeypatch.delenv('LLM_MODEL', raising=False)
        monkeypatch.setenv('LLM_PROVIDER', 'openai')
        monkeypatch.setenv('GROQ_MODEL', 'llama-3.3-70b-versatile')
        assert Settings().model == PROVIDER_DEFAULT_MODELS['openai']

    def test_an_unknown_provider_fails_with_the_supported_list(self, monkeypatch):
        monkeypatch.setattr('querybot_agent.llm_manager.settings', Settings())
        monkeypatch.setenv('LLM_PROVIDER', 'cohere')
        monkeypatch.setattr('querybot_agent.llm_manager.settings', Settings())

        with pytest.raises(LLMConfigurationError, match='anthropic'):
            _build_client()

    def test_a_missing_api_key_is_reported_by_name(self, monkeypatch):
        monkeypatch.setenv('LLM_PROVIDER', 'anthropic')
        monkeypatch.delenv('ANTHROPIC_API_KEY', raising=False)
        monkeypatch.setattr('querybot_agent.llm_manager.settings', Settings())

        with pytest.raises(LLMConfigurationError, match='ANTHROPIC_API_KEY'):
            _build_client()

    def test_the_client_is_built_once_and_shared(self, monkeypatch):
        """A client per node would open one connection pool per graph step."""
        LLMManager.reset()
        calls = []

        def build():
            calls.append(1)
            return object()

        monkeypatch.setattr('querybot_agent.llm_manager._build_client', build)
        first, second = LLMManager(), LLMManager()

        assert first.llm is second.llm
        assert len(calls) == 1
        LLMManager.reset()


class TestEveryProviderConstructs:
    """
    Builds a real client per provider with a throwaway key.

    Construction makes no network call, but it is where a wrong keyword argument
    surfaces — Google names the output cap `max_output_tokens` where the others use
    `max_tokens`, and passing the wrong one is a TypeError at the constructor.
    """

    def _client(self, monkeypatch, provider, model=None):
        from querybot_agent import llm_manager

        monkeypatch.setenv('LLM_PROVIDER', provider)
        monkeypatch.setenv(PROVIDERS[provider].api_key_env, 'test-key-not-real')
        if model:
            monkeypatch.setenv('LLM_MODEL', model)
        else:
            monkeypatch.delenv('LLM_MODEL', raising=False)
            monkeypatch.delenv('GROQ_MODEL', raising=False)
        monkeypatch.setattr(llm_manager, 'settings', Settings())

        return llm_manager._build_client()

    @pytest.mark.parametrize('provider', sorted(PROVIDERS))
    def test_the_client_builds_with_the_configured_model_and_cap(self, monkeypatch, provider):
        client = self._client(monkeypatch, provider)

        model = getattr(client, 'model', None) or getattr(client, 'model_name', None)
        assert model == PROVIDER_DEFAULT_MODELS[provider]

        cap = getattr(client, 'max_tokens', None) or getattr(client, 'max_output_tokens', None)
        assert cap == Settings().max_output_tokens

    def test_current_claude_models_are_built_without_temperature(self, monkeypatch):
        client = self._client(monkeypatch, 'anthropic')
        assert client.temperature is None

    def test_older_claude_models_still_receive_it(self, monkeypatch):
        client = self._client(monkeypatch, 'anthropic', 'claude-haiku-4-5')
        assert client.temperature == Settings().temperature


class TestSamplingParameters:
    def test_current_claude_models_reject_temperature(self):
        """
        Sending `temperature` to these returns a 400 rather than being ignored, so
        it has to be omitted rather than defaulted.
        """
        for model in ('claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5'):
            assert _rejects_temperature('anthropic', model) is True

    def test_older_claude_models_still_accept_it(self):
        assert _rejects_temperature('anthropic', 'claude-haiku-4-5') is False
        assert _rejects_temperature('anthropic', 'claude-sonnet-4-6') is False

    def test_other_providers_are_unaffected(self):
        assert _rejects_temperature('openai', 'gpt-5') is False
        assert _rejects_temperature('groq', 'openai/gpt-oss-120b') is False


class TestRestyleThroughTheGraph:
    """
    Drives the compiled graph so the wiring is covered, not just the pieces.

    The chart is rendered for real: a palette that reaches seaborn as an invalid
    name raises mid-render, and that failure only shows up here.
    """

    def _run(self, monkeypatch, classification, previous):
        from querybot_agent.database_manager import DatabaseManager
        from querybot_agent.question_classifier import QuestionClassifier
        from querybot_agent.workflow_manager import WorkflowManager

        monkeypatch.setattr(
            QuestionClassifier, 'classify_question', lambda _self, _state: classification
        )
        monkeypatch.setattr(
            DatabaseManager,
            'execute_query_detailed',
            lambda _self, _uuid, _query: {
                'results': [['Yangon', 1912.95], ['Mandalay', 1116.67], ['Naypyitaw', 2100.5]],
                'columns': ['city', 'total'],
            },
        )

        return WorkflowManager().run_sql_agent(
            'make it a pie chart', 'dataset-1', previous=previous
        )

    def test_a_restyle_renders_the_requested_chart(self, monkeypatch):
        result = self._run(
            monkeypatch,
            {
                'is_relevant': True,
                'question_type': 'chart',
                'requires_visualization': True,
                'requires_table': False,
                'intent': refinement.RESTYLE,
                'chart_spec': {
                    'chart_type': 'pie',
                    'palette': 'Greens',
                    'changed': ['chart_type', 'palette'],
                },
            },
            PREVIOUS,
        )

        assert result['visualization'] == 'pie'
        assert result['sql_query'] == PREVIOUS['sql_query']
        # A real PNG, so the palette was accepted by seaborn.
        assert result['chart_image_base64'], result.get('chart_generation_error')
        assert result['chart_image_base64'].startswith('iVBORw0KGgo')
        assert result['intent'] == refinement.RESTYLE
        assert result['chart_spec']['palette'] == 'Greens'

    def test_every_palette_renders_without_raising(self, monkeypatch):
        """
        Each name in the allow-list has to be valid for both the theme and the pie
        chart's own colour list, which take different palette forms.
        """
        for palette in chart_templates.PALETTES:
            result = self._run(
                monkeypatch,
                {
                    'is_relevant': True,
                    'question_type': 'chart',
                    'intent': refinement.RESTYLE,
                    'chart_spec': {'palette': palette, 'changed': ['palette']},
                },
                {**PREVIOUS, 'visualization': 'pie'},
            )
            assert result['chart_image_base64'], f'{palette}: {result.get("chart_generation_error")}'

    def test_a_restyle_reports_what_changed(self, monkeypatch):
        result = self._run(
            monkeypatch,
            {
                'is_relevant': True,
                'question_type': 'chart',
                'intent': refinement.RESTYLE,
                'chart_spec': {'limit': 2, 'sort': 'desc', 'changed': ['limit', 'sort']},
            },
            PREVIOUS,
        )

        assert len(result['results']) == 2
        assert result['results'][0][0] == 'Naypyitaw'
        assert 'trimmed to 2 rows' in result['answer']
        # The table has to reflect the trimmed rows, not the original ones.
        assert 'Mandalay' not in (result['formatted_table'] or '')


class TestResponseFlattening:
    def test_a_plain_string_passes_through(self):
        assert _text_of('{"a": 1}') == '{"a": 1}'

    def test_block_lists_are_joined(self):
        assert _text_of([{'type': 'text', 'text': 'a'}, {'type': 'text', 'text': 'b'}]) == 'ab'

    def test_thinking_blocks_are_dropped(self):
        """
        Reasoning models return thinking blocks with no `text`. Stringifying them
        put their repr in the middle of the JSON the caller then has to parse.
        """
        content = [
            {'type': 'thinking', 'thinking': 'let me work through this', 'signature': 'x'},
            {'type': 'text', 'text': '{"visualization": "pie"}'},
        ]
        assert _text_of(content) == '{"visualization": "pie"}'
