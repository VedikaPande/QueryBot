"""
Workflow assembly.

Wires the nodes into a LangGraph state machine with conditional routing for
relevance, charts, tables and insights.
"""
import logging
from typing import Optional

from langgraph.graph import END, START, StateGraph

from querybot_agent.chart_generator import chart_generation_node
from querybot_agent.insights_generator import format_table_node, generate_insights_node
from querybot_agent.question_classifier import (
    classify_question_node,
    route_question,
    should_generate_chart,
    should_generate_insights,
    should_generate_table,
    should_repair_sql,
)
from querybot_agent.refinement import apply_refinement_node
from querybot_agent.response_finalizer import (
    finalize_response_node,
    handle_irrelevant_node,
    skip_chart_node,
    skip_table_node,
)
from querybot_agent.sql_agent import SQLAgent
from querybot_agent.utils.state import InputState, OutputState, OverallState
from querybot_agent.visualization import choose_visualization_node

logger = logging.getLogger(__name__)


class WorkflowManager:
    """Builds and runs the QueryBot workflow."""

    def __init__(self) -> None:
        self.sql_agent = SQLAgent()
        self._compiled = None

    def create_workflow(self) -> StateGraph:
        """Define the graph."""
        workflow = StateGraph(
            state_schema=OverallState,
            input_schema=InputState,
            output_schema=OutputState,
        )

        workflow.add_node('classify_question', classify_question_node)
        workflow.add_node('handle_irrelevant', handle_irrelevant_node)
        workflow.add_node('apply_refinement', apply_refinement_node)
        workflow.add_node('parse_question', self.sql_agent.parse_question)
        workflow.add_node('get_unique_nouns', self.sql_agent.get_unique_nouns)
        workflow.add_node('generate_sql', self.sql_agent.generate_sql)
        workflow.add_node('validate_and_fix_sql', self.sql_agent.validate_and_fix_sql)
        workflow.add_node('execute_sql', self.sql_agent.execute_sql)
        workflow.add_node('repair_sql', self.sql_agent.repair_sql)
        workflow.add_node('format_results', self.sql_agent.format_results)
        workflow.add_node('choose_visualization', choose_visualization_node)
        workflow.add_node('generate_chart', chart_generation_node)
        workflow.add_node('skip_chart', skip_chart_node)
        workflow.add_node('format_table', format_table_node)
        workflow.add_node('skip_table', skip_table_node)
        workflow.add_node('generate_insights', generate_insights_node)
        workflow.add_node('finalize_response', finalize_response_node)

        workflow.add_edge(START, 'classify_question')
        workflow.add_conditional_edges(
            'classify_question',
            route_question,
            {
                'process_question': 'parse_question',
                'handle_irrelevant': 'handle_irrelevant',
                # A follow-up that only changes presentation rejoins the graph at
                # the chart step, skipping SQL generation altogether.
                'apply_refinement': 'apply_refinement',
            },
        )
        workflow.add_edge('handle_irrelevant', END)

        workflow.add_edge('parse_question', 'get_unique_nouns')
        workflow.add_edge('get_unique_nouns', 'generate_sql')
        workflow.add_edge('generate_sql', 'validate_and_fix_sql')
        workflow.add_edge('validate_and_fix_sql', 'execute_sql')

        # Execution-guided self-correction: a failing query goes back through
        # repair_sql with the database's error as feedback, then re-executes.
        # `should_repair_sql` bounds the cycle so it cannot spin.
        workflow.add_conditional_edges(
            'execute_sql',
            should_repair_sql,
            {'repair_sql': 'repair_sql', 'continue': 'format_results'},
        )
        workflow.add_edge('repair_sql', 'execute_sql')

        workflow.add_edge('format_results', 'choose_visualization')

        chart_routes = {'generate_chart': 'generate_chart', 'skip_chart': 'skip_chart'}
        workflow.add_conditional_edges('choose_visualization', should_generate_chart, chart_routes)
        # The refiner has already set the chart type, so it joins the same gate:
        # a restyle to 'none' still has to skip rendering.
        workflow.add_conditional_edges('apply_refinement', should_generate_chart, chart_routes)

        table_routes = {'format_table': 'format_table', 'skip_table': 'skip_table'}
        workflow.add_conditional_edges('generate_chart', should_generate_table, table_routes)
        workflow.add_conditional_edges('skip_chart', should_generate_table, table_routes)

        insight_routes = {'generate_insights': 'generate_insights', 'finalize': 'finalize_response'}
        workflow.add_conditional_edges('format_table', should_generate_insights, insight_routes)
        workflow.add_conditional_edges('skip_table', should_generate_insights, insight_routes)

        workflow.add_edge('generate_insights', 'finalize_response')
        workflow.add_edge('finalize_response', END)

        return workflow

    def compile_graph(self):
        """Compile once and reuse; compilation is pure overhead per run."""
        if self._compiled is None:
            self._compiled = self.create_workflow().compile()
        return self._compiled

    def run_sql_agent(
        self,
        question: str,
        uuid: str,
        history: Optional[list[dict]] = None,
        previous: Optional[dict] = None,
    ) -> dict:
        """Run the workflow to completion and return the final state."""
        graph = self.compile_graph()
        payload = {'question': question, 'uuid': uuid}
        if history:
            payload['history'] = history
        if previous:
            payload['previous'] = previous

        result = graph.invoke(payload)

        return {
            'answer': result.get('answer', 'No answer was produced.'),
            'sql_query': result.get('sql_query'),
            'visualization': result.get('visualization', 'none'),
            'visualization_reason': result.get('visualization_reason', ''),
            'chart_image_base64': result.get('chart_image_base64'),
            'chart_generation_error': result.get('chart_generation_error'),
            'insights': result.get('insights'),
            'formatted_table': result.get('formatted_table'),
            'data_narrative': result.get('data_narrative'),
            'insights_error': result.get('insights_error'),
            'results': result.get('results'),
            'result_columns': result.get('result_columns'),
            'error': result.get('error'),
            'suggested_questions': result.get('suggested_questions') or [],
            'data_quality_notes': result.get('data_quality_notes') or [],
            'intent': result.get('intent') or 'new',
            'chart_spec': result.get('chart_spec') or {},
        }
