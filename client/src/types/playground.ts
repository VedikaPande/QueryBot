import type { CellValue } from './api';

/** Chart types the agent can select. */
export type VisualizationType =
  | 'bar'
  | 'horizontal_bar'
  | 'line'
  | 'pie'
  | 'scatter'
  | 'histogram'
  | 'box'
  | 'heatmap'
  | 'none';

/** Workflow nodes, in the order the agent runs them. */
export const WORKFLOW_STEPS = [
  'classify_question',
  // Taken instead of the SQL steps when a follow-up only restyles the previous
  // result, so the progress indicator jumps straight from here to the chart.
  'apply_refinement',
  'parse_question',
  'get_unique_nouns',
  'generate_sql',
  'validate_and_fix_sql',
  'execute_sql',
  'repair_sql',
  'format_results',
  'choose_visualization',
  'generate_chart',
  'format_table',
  'generate_insights',
  'finalize_response',
] as const;

export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

/** Everything the agent produces for one question. */
export interface AnalysisResult {
  answer?: string;
  sql_query?: string;
  sql_valid?: boolean;
  sql_issues?: string;
  visualization?: VisualizationType;
  visualization_reason?: string;
  chart_image_base64?: string;
  chart_generation_error?: string;
  insights?: string;
  insights_error?: string;
  formatted_table?: string;
  data_narrative?: string;
  results?: CellValue[][];
  result_columns?: string[];
  question_type?: string;
  requires_visualization?: boolean;
  requires_table?: boolean;
  is_relevant?: boolean;
  parsed_question?: Record<string, unknown>;
  unique_nouns?: string[];
  error?: string;
  /** Questions the user is likely to ask next, derived from this result. */
  suggested_questions?: string[];
  /** Computed caveats that change how the result should be read. */
  data_quality_notes?: string[];
  /** How many execution attempts the query needed, including repairs. */
  sql_attempts?: number;
  /** True when a failing query was rewritten from the database's error. */
  sql_repaired?: boolean;
  /** How the turn was handled: a new question, a re-query, or a restyle. */
  intent?: 'new' | 'requery' | 'restyle';
  /** Presentation choices in effect, carried forward across follow-ups. */
  chart_spec?: ChartSpec;
}

/** Presentation choices a follow-up can change without re-asking the question. */
export interface ChartSpec {
  chart_type?: VisualizationType;
  palette?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  /** Which of the above this turn actually changed. */
  changed?: string[];
  /**
   * The prose describing the numbers, carried forward so a run of follow-ups
   * shows one confirmation and one finding rather than a stack of confirmations.
   */
  finding?: string;
}

/**
 * A streaming update.
 *
 * The agent streams `{ nodeName: { ...partialResult } }`, plus a terminal
 * `{ done, conversationId }` frame.
 */
export type StreamUpdate = Partial<Record<WorkflowStep, AnalysisResult>> &
  AnalysisResult & {
    done?: boolean;
    conversationId?: string;
    /** Id of the persisted assistant turn, needed to pin the result. */
    messageId?: string | null;
  };

export type ChatRole = 'user' | 'assistant' | 'system' | 'error';

/** One turn in the conversation. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** Assistant turns carry the full analysis so results can be reopened. */
  result?: AnalysisResult;
  /** True while the agent is still producing this turn. */
  pending?: boolean;
  /**
   * True once the server has written the turn, meaning `id` is the real message
   * id and the result can be pinned to a dashboard.
   */
  persisted?: boolean;
  /** The workflow step currently running, shown in the progress indicator. */
  currentStep?: WorkflowStep;
  durationMs?: number;
}

export interface Conversation {
  id: string;
  title: string;
  dataset_id: string;
  dataset_uuid: string | null;
  dataset_name: string | null;
  message_count: number;
  created_at: string | null;
  updated_at: string | null;
}

/** A message as persisted by the server. */
export interface StoredMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string | null;
  sql_query?: string;
  visualization?: VisualizationType;
  chart_spec?: ChartSpec;
  insights?: string;
  data_narrative?: string;
  formatted_table?: string;
  chart_image_base64?: string;
  result_rows?: CellValue[][];
  result_columns?: string[];
  error?: string;
  duration_ms?: number;
}

export interface ConversationDetail extends Conversation {
  messages: StoredMessage[];
}

/** Starter prompts offered when a dataset has just been uploaded. */
export const SAMPLE_QUESTIONS = [
  'Give me an overview of this dataset',
  'What are the top 10 rows by the largest numeric column?',
  'Show me the distribution of the main category',
  'Which categories have the highest totals?',
  'Is there a relationship between the numeric columns?',
  'Summarise the key trends over time',
] as const;

/** Human-readable label for each workflow step. */
export const STEP_LABELS: Record<WorkflowStep, string> = {
  classify_question: 'Understanding your question',
  apply_refinement: 'Updating the previous result',
  parse_question: 'Finding the relevant tables',
  get_unique_nouns: 'Reading the actual values',
  generate_sql: 'Writing the SQL',
  validate_and_fix_sql: 'Checking the query',
  execute_sql: 'Running the query',
  repair_sql: 'Fixing the query from the database error',
  format_results: 'Writing the answer',
  choose_visualization: 'Choosing a chart',
  generate_chart: 'Rendering the chart',
  format_table: 'Formatting the table',
  generate_insights: 'Analysing the results',
  finalize_response: 'Finishing up',
};
