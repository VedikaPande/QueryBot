import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mergeUpdate, runAnalysis } from '../analysisAPI';
import type { AnalysisResult, StreamUpdate } from '@/types/playground';

describe('mergeUpdate', () => {
  it('unwraps a node-keyed payload and reports the step', () => {
    const { result, step } = mergeUpdate({}, {
      generate_sql: { sql_query: 'SELECT 1' },
    } as StreamUpdate);

    expect(result.sql_query).toBe('SELECT 1');
    expect(step).toBe('generate_sql');
  });

  it('accumulates across successive updates', () => {
    let state: AnalysisResult = {};

    state = mergeUpdate(state, { classify_question: { question_type: 'chart' } } as StreamUpdate).result;
    state = mergeUpdate(state, { generate_sql: { sql_query: 'SELECT 1' } } as StreamUpdate).result;
    state = mergeUpdate(state, { format_results: { answer: 'Forty-two.' } } as StreamUpdate).result;

    expect(state).toMatchObject({
      question_type: 'chart',
      sql_query: 'SELECT 1',
      answer: 'Forty-two.',
    });
  });

  it('keeps earlier values when a later update omits them', () => {
    const first = mergeUpdate({}, { generate_sql: { sql_query: 'SELECT 1' } } as StreamUpdate).result;
    const second = mergeUpdate(first, { generate_chart: { chart_image_base64: 'iVBOR' } } as StreamUpdate).result;

    expect(second.sql_query).toBe('SELECT 1');
    expect(second.chart_image_base64).toBe('iVBOR');
  });

  it('ignores nulls so a later node cannot erase an earlier value', () => {
    const first = mergeUpdate({}, { generate_chart: { chart_image_base64: 'iVBOR' } } as StreamUpdate).result;
    const second = mergeUpdate(first, {
      finalize_response: { chart_image_base64: undefined, answer: 'Done' },
    } as StreamUpdate).result;

    expect(second.chart_image_base64).toBe('iVBOR');
    expect(second.answer).toBe('Done');
  });

  it('accepts fields sent at the top level rather than under a node', () => {
    const { result } = mergeUpdate({}, { answer: 'Direct' } as StreamUpdate);
    expect(result.answer).toBe('Direct');
  });

  it('still advances the step when a node payload is null', () => {
    // The agent's output schema filters intermediate keys out of the stream, so
    // most nodes genuinely arrive as `{"parse_question": null}`. Ignoring those
    // left the progress indicator frozen on the first step for a whole run.
    const { result, step } = mergeUpdate({ answer: 'kept' }, {
      parse_question: null,
    } as unknown as StreamUpdate);

    expect(step).toBe('parse_question');
    expect(result.answer).toBe('kept');
  });

  it('tracks the latest step across a stream of null payloads', () => {
    let state: AnalysisResult = {};
    const steps: (string | undefined)[] = [];

    for (const node of ['classify_question', 'parse_question', 'generate_sql'] as const) {
      const merged = mergeUpdate(state, { [node]: null } as unknown as StreamUpdate);
      state = merged.result;
      steps.push(merged.step);
    }

    expect(steps).toEqual(['classify_question', 'parse_question', 'generate_sql']);
  });

  it('drops keys that are not part of the result shape', () => {
    const { result } = mergeUpdate({}, {
      generate_sql: { sql_query: 'SELECT 1', internal_scratch: 'noise' },
    } as unknown as StreamUpdate);

    expect(result.sql_query).toBe('SELECT 1');
    expect(result).not.toHaveProperty('internal_scratch');
  });

  it('does not mutate the input', () => {
    const original: AnalysisResult = { answer: 'first' };
    mergeUpdate(original, { format_results: { answer: 'second' } } as StreamUpdate);
    expect(original.answer).toBe('first');
  });

  it('merges a payload from a node that is not a progress step', () => {
    // `handle_irrelevant` answers off-topic questions but is not one of the
    // labelled steps, so its answer was being dropped and the reply came back
    // blank. Any node-shaped payload is now merged, listed or not.
    const { result, step } = mergeUpdate({}, {
      handle_irrelevant: { answer: "I answer questions about your dataset." },
    } as unknown as StreamUpdate);

    expect(result.answer).toBe("I answer questions about your dataset.");
    expect(step).toBeUndefined();
  });

  it('carries a refinement through as its own step', () => {
    const { result, step } = mergeUpdate(
      { visualization: 'bar' },
      {
        apply_refinement: {
          visualization: 'pie',
          chart_spec: { chart_type: 'pie', palette: 'Greens', changed: ['chart_type'] },
          intent: 'restyle',
        },
      } as StreamUpdate
    );

    expect(step).toBe('apply_refinement');
    expect(result.visualization).toBe('pie');
    expect(result.chart_spec?.palette).toBe('Greens');
    expect(result.intent).toBe('restyle');
  });
});

/** Build a fetch Response whose body streams the given SSE text chunks. */
const streamingResponse = (chunks: string[], headers: Record<string, string> = {}) => {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    headers: { get: (name: string) => headers[name] ?? null },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined },
        releaseLock: () => {},
      }),
    },
  } as unknown as Response;
};

describe('runAnalysis', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = (chunks: string[], headers?: Record<string, string>) => {
    vi.mocked(fetch).mockResolvedValue(streamingResponse(chunks, headers));
    const updates: AnalysisResult[] = [];
    return runAnalysis({
      question: 'How many rows?',
      datasetUuid: 'd1',
      onUpdate: (result) => updates.push({ ...result }),
    }).then((outcome) => ({ outcome, updates }));
  };

  it('parses events and reports the final result', async () => {
    const { outcome, updates } = await run([
      'data: {"generate_sql": {"sql_query": "SELECT 1"}}\n\n',
      'data: {"format_results": {"answer": "One row."}}\n\n',
    ]);

    expect(updates).toHaveLength(2);
    expect(outcome.result.sql_query).toBe('SELECT 1');
    expect(outcome.result.answer).toBe('One row.');
  });

  it('reassembles events split across chunk boundaries', async () => {
    // The network may split a frame anywhere; a naive parser loses it.
    const { outcome } = await run([
      'data: {"format_res',
      'ults": {"answer": "Reassembled."}}\n\n',
    ]);

    expect(outcome.result.answer).toBe('Reassembled.');
  });

  it('handles several events arriving in one chunk', async () => {
    const { updates } = await run([
      'data: {"generate_sql": {"sql_query": "SELECT 1"}}\n\ndata: {"format_results": {"answer": "Done"}}\n\n',
    ]);

    expect(updates).toHaveLength(2);
  });

  it('skips a malformed frame instead of failing the run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { outcome } = await run([
      'data: {not valid json}\n\n',
      'data: {"format_results": {"answer": "Survived."}}\n\n',
    ]);

    expect(outcome.result.answer).toBe('Survived.');
    expect(warn).toHaveBeenCalled();
  });

  it('ignores the [DONE] sentinel', async () => {
    const { outcome } = await run([
      'data: {"format_results": {"answer": "Fine"}}\n\n',
      'data: [DONE]\n\n',
    ]);

    expect(outcome.result.answer).toBe('Fine');
  });

  it('captures the conversation id from the terminal event', async () => {
    const { outcome } = await run([
      'data: {"format_results": {"answer": "Hi"}}\n\n',
      'data: {"done": true, "conversationId": "conv-42"}\n\n',
    ]);

    expect(outcome.conversationId).toBe('conv-42');
  });

  it('falls back to the conversation id header', async () => {
    const { outcome } = await run(['data: {"format_results": {"answer": "Hi"}}\n\n'], {
      'X-Conversation-Id': 'conv-header',
    });

    expect(outcome.conversationId).toBe('conv-header');
  });

  it('surfaces the server message on a failed request', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'You are sending requests too quickly.' }),
      headers: { get: () => null },
    } as unknown as Response);

    await expect(
      runAnalysis({ question: 'q', datasetUuid: 'd', onUpdate: () => {} })
    ).rejects.toThrow('too quickly');
  });
});
