import { useState } from 'react';
import { ChevronDown, Database, Eye, KeyRound, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import DataTable from './DataTable';
import { DatasetAPI } from '@/services/datasetAPI';
import { getErrorMessage } from '@/services/apiClient';
import { cn } from '@/lib/utils';
import type { DatasetTable, TablePreview } from '@/types/dataset';

interface SchemaBrowserProps {
  datasetUuid: string;
  tables: DatasetTable[];
  isLoading?: boolean;
}

/** Shorten SQLite's verbose declared types for display. */
const shortType = (type: string): string => {
  const normalized = type.toUpperCase();
  if (normalized.includes('INT')) return 'int';
  if (normalized.includes('CHAR') || normalized.includes('TEXT') || normalized.includes('CLOB')) return 'text';
  if (normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB')) return 'num';
  if (normalized.includes('BLOB')) return 'blob';
  if (normalized.includes('BOOL')) return 'bool';
  if (normalized.includes('DATE') || normalized.includes('TIME')) return 'date';
  return normalized.toLowerCase() || 'any';
};

/** Lists the tables and columns in a dataset, with a row preview. */
const SchemaBrowser = ({ datasetUuid, tables, isLoading }: SchemaBrowserProps) => {
  const [expanded, setExpanded] = useState<string | null>(tables[0]?.name ?? null);
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const openPreview = async (tableName: string) => {
    setIsPreviewLoading(true);
    setPreview(null);

    try {
      setPreview(await DatasetAPI.previewTable(datasetUuid, tableName));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not load the preview'));
    } finally {
      setIsPreviewLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-center text-sm">No tables found in this dataset.</p>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1 p-2">
        {tables.map((table) => {
          const isOpen = expanded === table.name;

          return (
            <div key={table.name} className="border-border/60 overflow-hidden rounded-lg border">
              <div className="bg-muted/40 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : table.name)}
                  aria-expanded={isOpen}
                  className="hover:bg-muted/60 flex flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors"
                >
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !isOpen && '-rotate-90')}
                  />
                  <Table2 className="text-primary h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-medium">{table.name}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                    {table.rowCount.toLocaleString()}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mr-1 shrink-0"
                  onClick={() => openPreview(table.name)}
                  title={`Preview ${table.name}`}
                  aria-label={`Preview ${table.name}`}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </div>

              {isOpen && (
                <ul className="divide-border/50 divide-y">
                  {table.columns.map((column) => (
                    <li
                      key={column.name}
                      className="flex items-center gap-2 px-3 py-1.5 pl-8 text-xs"
                    >
                      {column.primaryKey && (
                        <KeyRound className="text-warning h-3 w-3 shrink-0" aria-label="Primary key" />
                      )}
                      <span className="truncate font-mono">{column.name}</span>
                      <span className="text-muted-foreground ml-auto shrink-0 font-mono">
                        {shortType(column.type)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <Dialog
        open={isPreviewLoading || preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
            setIsPreviewLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              {preview?.table ?? 'Loading preview'}
            </DialogTitle>
            <DialogDescription>
              {preview
                ? `Showing ${preview.previewCount} of ${preview.rowCount.toLocaleString()} rows`
                : 'Fetching rows...'}
            </DialogDescription>
          </DialogHeader>

          {isPreviewLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : preview ? (
            <DataTable
              columns={preview.columns}
              rows={preview.rows.map((row) => preview.columns.map((column) => row[column] ?? null))}
              pageSize={10}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SchemaBrowser;
