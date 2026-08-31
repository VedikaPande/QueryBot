"""
Tests for the workflow state schema and the sandboxed code wrapper.
"""
import ast
import os

os.environ.setdefault('CHART_DOCKER_ENABLED', 'false')
os.environ.setdefault('GROQ_API_KEY', 'test-key')

from langgraph.graph import END, START, StateGraph  # noqa: E402

from querybot_agent.docker_code_executor import DockerCodeExecutor  # noqa: E402
from querybot_agent.question_classifier import (  # noqa: E402
    route_question,
    should_generate_chart,
    should_generate_insights,
    should_generate_table,
)
from querybot_agent.utils.state import InputState, OutputState, OverallState  # noqa: E402


class TestStateSchema:
    def test_classification_keys_survive_a_node_boundary(self):
        """
        LangGraph silently discards keys that are not declared on the schema.
        `is_relevant` was one of them, so relevance routing always saw its
        default and never took the irrelevant branch on its own merits.
        """
        observed = {}

        def produce(_state):
            return {
                'is_relevant': False,
                'question_type': 'irrelevant',
                'classification_confidence': 0.93,
                'classification_reasoning': 'not about the data',
                'seaborn_function': 'sns.barplot',
                'matplotlib_styling': 'whitegrid',
                'sql_query': 'SELECT 1',
                'result_columns': ['a', 'b'],
            }

        def observe(state):
            observed.update(state)
            return {'answer': 'done'}

        graph = StateGraph(
            state_schema=OverallState, input_schema=InputState, output_schema=OutputState
        )
        graph.add_node('produce', produce)
        graph.add_node('observe', observe)
        graph.add_edge(START, 'produce')
        graph.add_edge('produce', 'observe')
        graph.add_edge('observe', END)
        graph.compile().invoke({'question': 'hello', 'uuid': 'abc'})

        for key in (
            'is_relevant',
            'classification_confidence',
            'classification_reasoning',
            'seaborn_function',
            'matplotlib_styling',
            'result_columns',
        ):
            assert key in observed, f'{key} was dropped by the state schema'

        assert observed['is_relevant'] is False


class TestRouting:
    def test_irrelevant_questions_bypass_the_sql_pipeline(self):
        assert route_question({'is_relevant': False}) == 'handle_irrelevant'
        assert route_question({'question_type': 'irrelevant'}) == 'handle_irrelevant'
        assert route_question({'is_relevant': True, 'question_type': 'chart'}) == 'process_question'

    def test_a_restyle_skips_the_sql_pipeline(self):
        state = {
            'is_relevant': True,
            'question_type': 'chart',
            'intent': 'restyle',
            'chart_spec': {'chart_type': 'pie', 'changed': ['chart_type']},
        }
        assert route_question(state) == 'apply_refinement'

        # A restyle intent with nothing to change must not take the shortcut:
        # re-running the query to render an identical chart would be a no-op.
        assert route_question({**state, 'chart_spec': {}}) == 'process_question'
        # Relevance still wins, so "thanks!" after a chart is not a restyle.
        assert route_question({**state, 'is_relevant': False}) == 'handle_irrelevant'

    def test_charts_follow_the_visualization_selector(self):
        base = {'results': [[1, 2]], 'visualization': 'bar'}
        assert should_generate_chart(base) == 'generate_chart'

        # No rows to plot.
        assert should_generate_chart({**base, 'results': []}) == 'skip_chart'
        # The selector decided a chart would not help.
        assert should_generate_chart({**base, 'visualization': 'none'}) == 'skip_chart'
        assert should_generate_chart({**base, 'visualization': None}) == 'skip_chart'

    def test_a_chosen_chart_is_not_suppressed_by_the_classifier(self):
        """
        Regression: the classifier labelling a question 'general' used to veto a
        chart the selector had already chosen and justified, so the UI announced
        an ideal chart type and then showed nothing.
        """
        state = {
            'results': [['Yangon', 1912.95], ['Mandalay', 1116.67]],
            'visualization': 'bar',
            'question_type': 'general',
            'requires_visualization': False,
        }
        assert should_generate_chart(state) == 'generate_chart'

    def test_a_table_is_produced_when_there_is_no_chart(self):
        """Without a chart the table is the only view of the underlying rows."""
        assert should_generate_table({'results': [[1]], 'chart_image_base64': None}) == 'format_table'
        assert (
            should_generate_table({'results': [[1]], 'chart_image_base64': 'iVBOR'}) == 'skip_table'
        )
        assert should_generate_table({'results': []}) == 'skip_table'

    def test_insights_require_more_than_one_row(self):
        assert should_generate_insights({'results': [[1], [2]]}) == 'generate_insights'
        # A single value needs no trend analysis.
        assert should_generate_insights({'results': [[1]]}) == 'finalize'
        assert should_generate_insights({'results': []}) == 'finalize'

    def test_a_restyle_does_not_pay_for_insights_again(self):
        """The rows are unchanged, so the previous analysis is carried forward."""
        state = {'results': [[1], [2]], 'intent': 'restyle'}
        assert should_generate_insights(state) == 'finalize'


class TestCodeWrapper:
    def _executor(self) -> DockerCodeExecutor:
        # Bypass __init__ so no Docker probe runs.
        executor = DockerCodeExecutor.__new__(DockerCodeExecutor)
        executor.required_packages = ['pandas', 'numpy']
        return executor

    def test_indentation_uses_real_newlines(self):
        """
        This split on the literal two-character sequence backslash-n rather than
        a newline, so multi-line code came back as a single unindented line and
        the wrapper produced a syntax error every time it was used.
        """
        indented = self._executor()._indent_code('a = 1\nb = 2')
        assert indented == '    a = 1\n    b = 2'

    def test_wrapped_code_is_valid_python(self):
        wrapper = self._executor()._wrap_code('x = 1\ny = 2\nprint(x + y)')
        ast.parse(wrapper)

    def test_wrapper_handles_nested_blocks(self):
        code = 'for i in range(3):\n    if i > 1:\n        print(i)'
        ast.parse(self._executor()._wrap_code(code))
