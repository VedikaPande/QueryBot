import { useMemo } from 'react';
import {
  AlertCircle,
  BarChart3,
  Code2,
  FileText,
  Lightbulb,
  Sparkles,
  Table2,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import ProcessingLoader from '@/components/ui/ProcessingLoader';
import DataTable from './DataTable';
import SqlPanel from './SqlPanel';
import type { AnalysisResult, WorkflowStep } from '@/types/playground';

interface ResultsPanelProps {
  result: AnalysisResult | null;
  question: string;
  datasetUuid: string | null;
  isRunning: boolean;
  currentStep?: WorkflowStep;
  hasDataset: boolean;
  /** Asks a suggested follow-up. Omitted when the panel is read-only. */
  onAsk?: (question: string) => void;
}

/**
 * The main output area.
 *
 * Each kind of output gets its own tab rather than being concatenated into one
 * long scroll, and tabs appear only when there is something to show - the
 * previous version rendered the answer, insights and table both inline and
 * again inside the answer text.
 */
const ResultsPanel = ({
  result,
  question,
  datasetUuid,
  isRunning,
  currentStep,
  hasDataset,
  onAsk,
}: ResultsPanelProps) => {
  // Memoised so the fallback empty array is stable; otherwise a fresh `[]` on
  // every render invalidates everything downstream that depends on it.
  const rows = useMemo(() => result?.results ?? [], [result?.results]);

  // Falls back to positional names when the agent did not report column names.
  const columns = useMemo(
    () =>
      result?.result_columns?.length
        ? result.result_columns
        : (rows[0]?.map((_, index) => `Column ${index + 1}`) ?? []),
    [result, rows]
  );

  const tabs = useMemo(() => {
    if (!result) return [];

    const available: { id: string; label: string; icon: typeof FileText }[] = [];
    if (result.answer) available.push({ id: 'answer', label: 'Answer', icon: FileText });
    if (result.chart_image_base64) available.push({ id: 'chart', label: 'Chart', icon: BarChart3 });
    if (rows.length > 0) available.push({ id: 'data', label: 'Data', icon: Table2 });
    if (result.insights) available.push({ id: 'insights', label: 'Insights', icon: Lightbulb });
    if (result.sql_query) available.push({ id: 'sql', label: 'SQL', icon: Code2 });
    return available;
  }, [result, rows.length]);

  if (isRunning && !result?.answer) {
    return <ProcessingLoader currentStep={currentStep} />;
  }

  if (!result || tabs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="bg-muted rounded-2xl p-4">
          <BarChart3 className="text-muted-foreground h-8 w-8" />
        </div>
        <div>
          <p className="font-medium">No results yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {hasDataset
              ? 'Ask a question and the answer, chart and data will appear here.'
              : 'Upload a dataset to get started.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <Tabs defaultValue={tabs[0]?.id} className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="border-border border-b px-4 py-2">
        <TabsList className="h-9">
          {tabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="gap-1.5 px-3">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {result.answer && (
          <TabsContent value="answer" className="m-0 p-5">
            {/* Caveats come before the answer: a total that silently excludes a
                third of the rows should be read with that in mind, not after. */}
            {result.data_quality_notes && result.data_quality_notes.length > 0 && (
              <ul className="mb-4 flex flex-col gap-1.5">
                {result.data_quality_notes.map((note) => (
                  <li
                    key={note}
                    className="border-warning/40 bg-warning/10 flex gap-2 rounded-lg border p-2.5 text-xs leading-snug"
                  >
                    <TriangleAlert className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            )}

            <MarkdownRenderer content={result.answer} />

            {result.data_narrative && (
              <div className="border-border mt-5 border-t pt-5">
                <h3 className="mb-2 text-sm font-semibold">What this means</h3>
                <MarkdownRenderer content={result.data_narrative} className="text-sm" />
              </div>
            )}

            {/* Answering one question raises the next. Offering concrete next
                steps is what turns a lookup into an investigation. */}
            {onAsk && result.suggested_questions && result.suggested_questions.length > 0 && (
              <div className="border-border mt-5 border-t pt-5">
                <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
                  <Sparkles className="h-3.5 w-3.5" />
                  Ask next
                </h3>
                <div className="flex flex-wrap gap-2">
                  {result.suggested_questions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => onAsk(question)}
                      className="border-border hover:border-primary hover:bg-primary/5 rounded-full border px-3 py-1.5 text-xs transition-colors"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        )}

        {result.chart_image_base64 && (
          <TabsContent value="chart" className="m-0 p-5">
            <div className="border-border flex justify-center rounded-lg border bg-white p-4">
              <img
                src={`data:image/png;base64,${result.chart_image_base64}`}
                alt={`Chart answering: ${question}`}
                className="h-auto max-w-full rounded"
              />
            </div>

            {result.visualization_reason && (
              <p className="text-muted-foreground mt-3 text-sm">
                <span className="text-foreground font-medium capitalize">
                  {result.visualization?.replace(/_/g, ' ')}
                </span>{' '}
                — {result.visualization_reason}
              </p>
            )}
          </TabsContent>
        )}

        {rows.length > 0 && (
          <TabsContent value="data" className="m-0 p-5">
            <DataTable columns={columns} rows={rows} />
          </TabsContent>
        )}

        {result.insights && (
          <TabsContent value="insights" className="m-0 p-5">
            <MarkdownRenderer content={result.insights} />

            {result.insights_error && (
              <div className="border-destructive/40 bg-destructive/10 text-destructive mt-4 flex gap-2 rounded-lg border p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{result.insights_error}</p>
              </div>
            )}
          </TabsContent>
        )}

        {result.sql_query && (
          <TabsContent value="sql" className="m-0 p-5">
            {/* Worth showing: the first query failed and the agent recovered by
                feeding the database's error back to the model. */}
            {result.sql_repaired && (result.sql_attempts ?? 0) > 1 && (
              <div className="border-border bg-muted/50 mb-4 flex gap-2 rounded-lg border p-3 text-xs">
                <Wrench className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  The first query failed, so it was rewritten using the database&rsquo;s error
                  message — this is the {result.sql_attempts === 2 ? 'second' : 'third'} attempt.
                </span>
              </div>
            )}

            {/* Keyed on the SQL so a new query resets the editor and its result. */}
            <SqlPanel
              key={result.sql_query}
              sql={result.sql_query}
              datasetUuid={datasetUuid}
              sqlIssues={result.sql_issues}
            />
          </TabsContent>
        )}
      </div>

      {result.chart_generation_error && (
        <div className="border-warning/40 bg-warning/10 mx-4 mb-4 flex gap-2 rounded-lg border p-3 text-sm">
          <TriangleAlert className="text-warning mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">The chart could not be rendered</p>
            <p className="text-muted-foreground mt-0.5">{result.chart_generation_error}</p>
          </div>
        </div>
      )}
    </Tabs>
  );
};

export default ResultsPanel;
