"""
Chart generation tests.

The plotting script is built by string assembly, so these check it stays valid
Python for the inputs most likely to break it.
"""
import ast
import os

import pytest

# Keeps the constructor from probing for a Docker daemon during tests.
os.environ.setdefault('CHART_DOCKER_ENABLED', 'false')
os.environ.setdefault('GROQ_API_KEY', 'test-key')

from querybot_agent.chart_generator import ChartGenerator  # noqa: E402
from querybot_agent.chart_templates import build_chart_code  # noqa: E402

VISUALIZATIONS = [
    'bar',
    'horizontal_bar',
    'line',
    'pie',
    'scatter',
    'histogram',
    'box',
    'heatmap',
    'anything_unrecognised',
]

ROWS = [['Health and beauty', 49193.74], ['Sports and travel', 55122.83]]


@pytest.fixture(scope='module')
def generator() -> ChartGenerator:
    return ChartGenerator()


class TestGeneratedCode:
    @pytest.mark.parametrize('visualization', VISUALIZATIONS)
    def test_every_chart_type_produces_valid_python(self, visualization):
        code = build_chart_code(visualization, ROWS, 'Revenue by line', '/tmp/chart.png')
        ast.parse(code)

    @pytest.mark.parametrize(
        'question',
        [
            "What's the split by {category}?",
            'Compare "revenue" vs \'cost\'',
            "O'Reilly's share of the 100% total",
            'Multi\nline\nquestion',
            'Backslash \\ and tab \t question',
            '{{double braces}} and {single}',
        ],
    )
    def test_awkward_questions_do_not_break_codegen(self, question):
        """
        The question used to be interpolated into an f-string inside the
        generated code, so a brace produced invalid Python and an apostrophe
        could terminate the literal early.
        """
        code = build_chart_code('bar', ROWS, question, '/tmp/chart.png')
        ast.parse(code)

    def test_awkward_data_does_not_break_codegen(self):
        rows = [
            ["quote' and \"double\"", 1.5],
            ['brace {x} and backslash \\', 2.5],
            [None, 3.5],
            ['newline\nin\ncell', 4.5],
        ]
        code = build_chart_code('bar', rows, 'Test', '/tmp/chart.png')
        ast.parse(code)

    def test_the_output_path_is_used_verbatim(self):
        """The same template serves the container mount and a local directory."""
        assert '"/app/output/my-chart.png"' in build_chart_code(
            'bar', ROWS, 'Test', '/app/output/my-chart.png'
        )
        assert '"generated_charts/local.png"' in build_chart_code(
            'bar', ROWS, 'Test', 'generated_charts/local.png'
        )

    def test_no_untrusted_value_becomes_code(self):
        """
        The safety property that permits in-process rendering: data and title
        arrive as JSON literals, never as executable syntax.
        """
        code = build_chart_code(
            'bar', [['__import__("os").system("id")', 1]], 'title', '/tmp/c.png'
        )
        ast.parse(code)
        # The payload appears only inside the JSON string handed to json.loads.
        assert 'DATA = json.loads(' in code
        assert '__import__("os").system' not in code.split('DATA = json.loads(')[0]

    def test_empty_data_is_handled_without_a_chart(self, generator):
        result = generator.generate_chart({'visualization': 'bar', 'results': [], 'question': 'x'})
        assert result['chart_image_base64'] is None
        assert result['chart_generation_error'] is None


class TestInProcessRendering:
    """
    With the sandbox disabled, templates still render. Charts therefore work
    without a Docker daemon, and the socket mount that would grant the agent root
    on the host is not required.
    """

    def test_the_sandbox_is_reported_unavailable(self, generator):
        assert generator.sandbox_available is False
        assert generator.unavailable_reason

    @pytest.mark.parametrize('visualization', ['bar', 'horizontal_bar', 'line', 'pie'])
    def test_a_real_png_is_produced(self, generator, visualization):
        result = generator.generate_chart(
            {'visualization': visualization, 'results': ROWS, 'question': 'Revenue by line'}
        )

        assert result['chart_generation_error'] is None, result['chart_generation_error']
        encoded = result['chart_image_base64']
        assert encoded

        import base64

        decoded = base64.b64decode(encoded)
        # PNG magic number, so this is a real image and not an error string.
        assert decoded[:8] == b'\x89PNG\r\n\x1a\n'
        assert len(decoded) > 5_000

    def test_the_temporary_file_is_removed(self, generator):
        import pathlib

        before = set(pathlib.Path(generator.charts_dir).glob('*.png'))
        generator.generate_chart(
            {'visualization': 'bar', 'results': ROWS, 'question': 'Revenue'}
        )
        after = set(pathlib.Path(generator.charts_dir).glob('*.png'))

        # The image is returned as base64; leaving it on disk would accumulate.
        assert before == after

    def test_data_that_cleans_to_nothing_does_not_raise(self, generator):
        result = generator.generate_chart(
            {'visualization': 'bar', 'results': [[None, None]], 'question': 'x'}
        )
        assert result['chart_image_base64'] is None
