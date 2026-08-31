"""
Chart generation.

Two execution paths, chosen by how much the code can be trusted:

**Deterministic template — rendered in-process.** The plotting body is selected
from a fixed set of our own templates, and the data and title are injected as
JSON literals, so nothing the user or the model supplies ever becomes code. There
is no untrusted input to isolate, and rendering directly means charts work
without a Docker daemon.

**Model-written code — rendered in a container.** Used only when the template
fails to produce an image. This code is genuinely untrusted, so it runs with no
network, capped memory and CPU, a timeout and a non-root user. When Docker is
unavailable this path is simply skipped.
"""
import base64
import json
import logging
import os
import threading
import uuid
from datetime import datetime
from typing import Annotated, Any, Dict, Optional

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from querybot_agent.chart_templates import build_chart_code, cmap_of, palette_of
from querybot_agent.config import settings
from querybot_agent.docker_code_executor import DockerPythonREPL
from querybot_agent.llm_manager import LLMManager

logger = logging.getLogger(__name__)


class ChartGenerator:
    """Renders query results into a chart image."""

    def __init__(self) -> None:
        self.llm_manager = LLMManager()
        self.charts_dir = settings.charts_dir
        os.makedirs(self.charts_dir, exist_ok=True)

        self.repl: Optional[DockerPythonREPL] = None
        self.unavailable_reason: Optional[str] = None

        if not settings.chart_docker_enabled:
            # Not an error: templates still render in-process. Only the
            # model-written fallback is unavailable.
            self.unavailable_reason = 'The chart sandbox is disabled (CHART_DOCKER_ENABLED=false).'
            return

        # A missing Docker daemon must not take the whole run down: without a
        # sandbox the answer still stands, only the model-written fallback is lost.
        try:
            self.repl = DockerPythonREPL(
                image_name=settings.chart_image_name,
                timeout=settings.chart_timeout,
            )
            if not self.repl.validate_installation():
                logger.info('Building the chart executor image; this runs once.')
                if not self.repl.build_image():
                    self.repl = None
                    self.unavailable_reason = 'Could not build the chart executor Docker image.'
        except Exception as exc:  # noqa: BLE001 - degrade instead of failing the run
            logger.warning('Docker unavailable, charts disabled: %s', exc)
            self.repl = None
            self.unavailable_reason = f'Docker is not available: {exc}'

    @property
    def sandbox_available(self) -> bool:
        """Whether model-written code can be executed. Not needed for templates."""
        return self.repl is not None

    def generate_chart(self, state: dict) -> dict:
        """Produce a chart for the current results, or explain why it could not."""
        visualization = state.get('visualization', 'none')
        results = state.get('results') or []
        question = state.get('question', '')
        # Colours the user asked for on this or an earlier turn. Validated
        # against an allow-list, so an unknown name falls back to the default
        # rather than making seaborn raise mid-render.
        chart_spec = state.get('chart_spec')
        palette = palette_of(chart_spec)
        cmap = cmap_of(chart_spec)

        if visualization in ('none', None, '') or not results:
            return {'chart_image_base64': None, 'chart_generation_error': None}

        chart_filename = (
            f'chart_{datetime.now().strftime("%Y%m%d_%H%M%S")}_{uuid.uuid4().hex[:8]}.png'
        )
        chart_path = os.path.join(self.charts_dir, chart_filename)

        try:
            if self.sandbox_available:
                # Prefer the sandbox when it exists: it also bounds runaway
                # memory on a pathological result set.
                code = build_chart_code(
                    visualization,
                    results,
                    question,
                    f'/app/output/{chart_filename}',
                    palette,
                    cmap,
                )
                output = self.repl.run(code, output_dir=self.charts_dir)  # type: ignore[union-attr]
                encoded = self._read_and_cleanup(chart_path)
                if encoded:
                    return {'chart_image_base64': encoded, 'chart_generation_error': None}

                logger.info('Template produced no file in the sandbox, asking the model: %s', output)
                return self._generate_with_agent(
                    visualization, results, question, chart_filename, chart_path
                )

            # No sandbox: render the template here. Safe because the template
            # carries no untrusted code, only JSON-encoded data.
            code = build_chart_code(visualization, results, question, chart_path, palette, cmap)
            self._render_in_process(code)

            encoded = self._read_and_cleanup(chart_path)
            if encoded:
                return {'chart_image_base64': encoded, 'chart_generation_error': None}

            # The model fallback writes its own code, which must not run
            # in-process, so there is nothing further to try.
            return {
                'chart_image_base64': None,
                'chart_generation_error': 'The chart could not be rendered from this data.',
            }

        except Exception as exc:  # noqa: BLE001 - reported to the user, not raised
            logger.exception('Chart generation failed')
            return {'chart_image_base64': None, 'chart_generation_error': f'Chart generation failed: {exc}'}

    def _render_in_process(self, code: str) -> None:
        """
        Execute a template-generated script in this process.

        Only ever called with output from `build_chart_code`, whose plotting body
        comes from a fixed set of templates and whose data and title are JSON
        literals — no caller-supplied text becomes code. Model-written code is
        never passed here.

        pyplot keeps global figure state and is not thread-safe, so concurrent
        runs are serialised.
        """
        with _render_lock:
            namespace: dict[str, Any] = {'__name__': '__querybot_chart__'}
            try:
                exec(compile(code, '<chart-template>', 'exec'), namespace)  # noqa: S102
            except SystemExit:
                # The template raises SystemExit when the data cleans to nothing.
                logger.info('Chart template exited early: no plottable rows')
            finally:
                # A template that raised part-way through would otherwise leak an
                # open figure into the next render.
                try:
                    import matplotlib.pyplot as plt

                    plt.close('all')
                except Exception:  # noqa: BLE001
                    pass

    def _read_and_cleanup(self, chart_path: str) -> Optional[str]:
        """Base64-encode the rendered chart and remove the file from disk."""
        if not os.path.exists(chart_path):
            return None

        try:
            with open(chart_path, 'rb') as handle:
                encoded = base64.b64encode(handle.read()).decode('utf-8')
        finally:
            try:
                os.remove(chart_path)
            except OSError:
                logger.debug('Could not remove temporary chart file %s', chart_path)

        return encoded

    def _generate_with_agent(
        self,
        visualization: str,
        results: list,
        question: str,
        chart_filename: str,
        chart_path: str,
    ) -> dict:
        """Ask the model to write the plotting code when the template did not work."""
        try:
            agent = self._create_chart_agent()
            agent.invoke(
                {
                    'messages': [
                        HumanMessage(
                            content=(
                                f'Create a {visualization} chart answering: {question}\n\n'
                                f'Data (list of rows): {json.dumps(results[:200], default=str)}\n\n'
                                f'Save it to exactly "/app/output/{chart_filename}".'
                            )
                        )
                    ]
                }
            )

            encoded = self._read_and_cleanup(chart_path)
            if encoded:
                return {'chart_image_base64': encoded, 'chart_generation_error': None}

            return {
                'chart_image_base64': None,
                'chart_generation_error': 'The chart could not be rendered from this data.',
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception('Agent chart generation failed')
            return {'chart_image_base64': None, 'chart_generation_error': f'Chart generation failed: {exc}'}

    def _create_chart_agent(self):
        """Build a ReAct agent whose only tool is the sandboxed Python executor."""
        repl = self.repl
        charts_dir = self.charts_dir

        @tool
        def docker_python_executor(
            code: Annotated[str, 'Python code that renders and saves the chart.']
        ) -> str:
            """Run Python in an isolated Docker container with no network access."""
            try:
                return str(repl.run(code, output_dir=charts_dir))  # type: ignore[union-attr]
            except Exception as exc:  # noqa: BLE001
                return f'Execution failed: {exc!r}'

        system_prompt = (
            'You are a data visualization expert. Write Python that renders a clear, '
            'professional chart using pandas, numpy, matplotlib and seaborn, then run it '
            'with the docker_python_executor tool.\n'
            '- The container has no network access and 512MB of memory.\n'
            "- The matplotlib backend is already set to 'Agg'; never call plt.show().\n"
            '- Save the figure to the exact path given in the request, under /app/output.\n'
            '- Use plt.figure(figsize=(12, 8)), label the axes, add a title, and call '
            'plt.tight_layout() before saving with dpi=150 and bbox_inches="tight".\n'
            '- Call plt.close() after saving.\n'
            'Reply with FINAL ANSWER once the file has been written.'
        )

        return create_react_agent(self.llm_manager.llm, [docker_python_executor], prompt=system_prompt)

# Constructing a ChartGenerator probes Docker and may build an image, which is
# far too expensive to repeat for every chart. The instance is created once and
# shared; the lock keeps concurrent runs from racing on the image build.
_generator: Optional[ChartGenerator] = None
_generator_lock = threading.Lock()

# pyplot's figure registry is process-global, so in-process rendering has to be
# serialised across concurrent runs.
_render_lock = threading.Lock()


def get_chart_generator() -> ChartGenerator:
    """Return the process-wide chart generator, creating it on first use."""
    global _generator
    if _generator is None:
        with _generator_lock:
            if _generator is None:
                _generator = ChartGenerator()
    return _generator


def chart_generation_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """LangGraph node that renders a chart for the current results."""
    return get_chart_generator().generate_chart(state)
