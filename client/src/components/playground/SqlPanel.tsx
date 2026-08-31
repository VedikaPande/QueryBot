import { useState } from 'react';
import { Check, Copy, Loader2, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import DataTable from './DataTable';
import { DatasetAPI } from '@/services/datasetAPI';
import { getErrorMessage } from '@/services/apiClient';
import type { QueryResult } from '@/types/dataset';

interface SqlPanelProps {
  sql: string;
  datasetUuid: string | null;
  /** Issues the agent reported while validating the generated SQL. */
  sqlIssues?: string;
}

/**
 * Shows the generated SQL and lets the user correct and re-run it.
 *
 * Re-running goes straight to the database rather than back through the model,
 * so fixing a wrong column is instant and costs nothing.
 *
 * The caller keys this component on the SQL string, so new SQL remounts it and
 * clears the draft, the last result and any error in one step — no reset effect,
 * and no frame showing the old result against the new query.
 */
const SqlPanel = ({ sql, datasetUuid, sqlIssues }: SqlPanelProps) => {
  const [draft, setDraft] = useState(sql);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isEdited = draft.trim() !== sql.trim();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  const handleRun = async () => {
    if (!datasetUuid || !draft.trim()) return;

    setIsRunning(true);
    setError(null);

    try {
      const queryResult = await DatasetAPI.runQuery(datasetUuid, draft);
      setResult(queryResult);
      toast.success(
        `${queryResult.rowCount.toLocaleString()} row${queryResult.rowCount === 1 ? '' : 's'} in ${queryResult.durationMs}ms`
      );
    } catch (caught) {
      const message = getErrorMessage(caught, 'The query failed');
      setError(message);
      setResult(null);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {sqlIssues && (
        <div className="border-warning/40 bg-warning/10 flex gap-2 rounded-lg border p-3 text-sm">
          <TriangleAlert className="text-warning mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">The query was adjusted before running</p>
            <p className="text-muted-foreground mt-0.5">{sqlIssues}</p>
          </div>
        </div>
      )}

      <div className="border-border overflow-hidden rounded-lg border">
        <div className="bg-muted/60 border-border flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-muted-foreground text-xs font-medium">
            SQL{isEdited && <span className="text-primary"> · edited</span>}
          </span>
          <div className="flex gap-1">
            {isEdited && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(sql)} className="h-7">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl/Cmd+Enter runs, matching every SQL client.
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void handleRun();
            }
          }}
          spellCheck={false}
          aria-label="SQL query"
          className="bg-card text-foreground min-h-32 w-full resize-y p-3 font-mono text-[13px] leading-relaxed outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleRun} disabled={isRunning || !draft.trim() || !datasetUuid} size="sm">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {isRunning ? 'Running...' : 'Run query'}
        </Button>
        <span className="text-muted-foreground text-xs">
          Read-only queries only · Ctrl+Enter to run
        </span>
      </div>

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
          <p className="font-medium">Query failed</p>
          <p className="mt-1 font-mono text-xs break-words">{error}</p>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-2">
          {result.truncated && (
            <p className="text-muted-foreground text-xs">
              Showing the first {result.rowCount.toLocaleString()} rows; the result was truncated.
            </p>
          )}
          <DataTable columns={result.columns} rows={result.results} />
        </div>
      )}
    </div>
  );
};

export default SqlPanel;
