import { config } from '@/config/env';
import { csrfHeaders } from './csrf';
import { WORKFLOW_STEPS } from '@/types/playground';
import type { AnalysisResult, StreamUpdate, WorkflowStep } from '@/types/playground';

const WORKFLOW_STEP_SET = new Set<string>(WORKFLOW_STEPS);

/** Keys that carry result data, as opposed to workflow bookkeeping. */
const RESULT_KEYS: (keyof AnalysisResult)[] = [
  'answer',
  'sql_query',
  'sql_valid',
  'sql_issues',
  'visualization',
  'visualization_reason',
  'chart_image_base64',
  'chart_generation_error',
  'insights',
  'insights_error',
  'formatted_table',
  'data_narrative',
  'results',
  'result_columns',
  'question_type',
  'requires_visualization',
  'requires_table',
  'is_relevant',
  'parsed_question',
  'unique_nouns',
  'error',
  'suggested_questions',
  'data_quality_notes',
  'sql_attempts',
  'sql_repaired',
  'intent',
  'chart_spec',
];

/**
 * Fold one streamed update into the accumulated result.
 *
 * The agent streams `{ nodeName: { ...fields } }`. The node wrapper is unwrapped
 * generically rather than per node, so adding a node to the graph needs no change
 * here; only recognised result keys are copied across.
 */
export const mergeUpdate = (
  current: AnalysisResult,
  update: StreamUpdate
): { result: AnalysisResult; step?: WorkflowStep } => {
  const result: AnalysisResult = { ...current };
  let step: WorkflowStep | undefined;

  for (const [key, value] of Object.entries(update)) {
    // Record the step even when the payload is null. The agent's output schema
    // filters intermediate keys out of the stream, so nodes that write only
    // intermediate state arrive as `{"parse_question": null}` — skipping those
    // left the progress indicator stuck on the first step for the whole run.
    if (WORKFLOW_STEP_SET.has(key)) {
      step = key as WorkflowStep;
    }

    if (value == null) continue;

    if ((RESULT_KEYS as string[]).includes(key)) {
      Object.assign(result, pickResultFields({ [key]: value }));
      continue;
    }

    // Any other object is a node payload. Merging it without requiring the node
    // to be listed above is what makes routes that bypass the normal pipeline
    // work: `handle_irrelevant` is not a progress step, and its answer was being
    // dropped entirely, so asking something off-topic produced a blank reply.
    if (typeof value === 'object') {
      Object.assign(result, pickResultFields(value as Record<string, unknown>));
    }
  }

  return { result, step };
};

/** Copy only recognised result fields, ignoring nulls. */
const pickResultFields = (source: Record<string, unknown>): Partial<AnalysisResult> => {
  const picked: Record<string, unknown> = {};
  for (const key of RESULT_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      picked[key] = value;
    }
  }
  return picked as Partial<AnalysisResult>;
};

export interface RunAnalysisOptions {
  question: string;
  datasetUuid: string;
  conversationId?: string | null;
  onUpdate: (result: AnalysisResult, step?: WorkflowStep) => void;
  signal?: AbortSignal;
}

export interface RunAnalysisOutcome {
  result: AnalysisResult;
  conversationId: string | null;
  /** Id of the persisted assistant turn, used to pin the result to a dashboard. */
  messageId: string | null;
}

/**
 * Stream an analysis from the agent.
 *
 * Uses `fetch` rather than axios because axios cannot expose a readable stream
 * in the browser. Credentials are included so the JWT cookie authenticates the
 * request.
 */
export const runAnalysis = async ({
  question,
  datasetUuid,
  conversationId,
  onUpdate,
  signal,
}: RunAnalysisOptions): Promise<RunAnalysisOutcome> => {
  const response = await fetch(`${config.API_BASE_URL}/langgraph/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // This call uses fetch rather than the axios instance, so it does not go
      // through the request interceptor and must add the CSRF token itself.
      ...csrfHeaders('post', '/langgraph/run'),
    },
    credentials: 'include',
    body: JSON.stringify({
      question,
      databaseUuid: datasetUuid,
      conversationId: conversationId ?? undefined,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || `The request failed (${response.status})`);
  }

  if (!response.body) {
    throw new Error('This browser does not support streaming responses.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let accumulated: AnalysisResult = {};
  let resolvedConversationId = conversationId ?? response.headers.get('X-Conversation-Id');
  let resolvedMessageId: string | null = null;
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; the trailing fragment may be a
      // partial event and is carried into the next read.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        const payload = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');

        if (!payload || payload === '[DONE]') continue;

        let parsed: StreamUpdate;
        try {
          parsed = JSON.parse(payload) as StreamUpdate;
        } catch {
          // A malformed frame should not abort an otherwise healthy run.
          console.warn('Skipping unparsable stream event:', payload.slice(0, 200));
          continue;
        }

        if (parsed.conversationId) {
          resolvedConversationId = parsed.conversationId;
        }
        if (parsed.messageId) {
          resolvedMessageId = parsed.messageId;
        }
        if (parsed.done) continue;

        const { result, step } = mergeUpdate(accumulated, parsed);
        accumulated = result;
        onUpdate(accumulated, step);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    result: accumulated,
    conversationId: resolvedConversationId,
    messageId: resolvedMessageId,
  };
};
