import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Clock, FilePlus2, FileSpreadsheet, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import DataProfile from './DataProfile';
import SchemaBrowser from './SchemaBrowser';
import { config } from '@/config/env';
import { cn } from '@/lib/utils';
import type { Dataset, DatasetProfile, DatasetTable } from '@/types/dataset';

interface DatasetPanelProps {
  dataset: Dataset | null;
  tables: DatasetTable[];
  profile: DatasetProfile | null;
  isUploading: boolean;
  uploadProgress: number;
  isSchemaLoading: boolean;
  isProfileLoading: boolean;
  onUpload: (file: File) => void;
  onAddFile: (file: File) => void;
  onRemove: () => void;
  onAsk: (question: string) => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Describe how long until the dataset is removed by the retention sweep. */
const formatExpiry = (expiresAt: string | null): string | null => {
  if (!expiresAt) return null;

  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(remainingMs)) return null;
  if (remainingMs <= 0) return 'Expired';

  // Round to whole minutes first, then split. Rounding the remainder separately
  // let 3h 59.6m render as "3h 60m".
  const totalMinutes = Math.round(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `Expires in ${hours}h ${minutes}m` : `Expires in ${minutes}m`;
};

/** Upload target plus the schema browser for the active dataset. */
const DatasetPanel = ({
  dataset,
  tables,
  profile,
  isUploading,
  uploadProgress,
  isSchemaLoading,
  isProfileLoading,
  onUpload,
  onAddFile,
  onRemove,
  onAsk,
}: DatasetPanelProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [view, setView] = useState<'profile' | 'schema'>('profile');

  const handleFile = (file: File | undefined) => {
    if (file) onUpload(file);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0]);
    // Reset so selecting the same file again still fires a change event.
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
  };

  const expiry = dataset ? formatExpiry(dataset.expires_at) : null;

  return (
    <div className="flex min-h-0 flex-col">
      {!dataset ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'm-3 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
            isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'
          )}
        >
          {isUploading ? (
            <>
              <Loader2 className="text-primary h-8 w-8 animate-spin" />
              <div className="w-full">
                <p className="text-sm font-medium">Uploading...</p>
                <div className="bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full transition-[width] duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-primary/10 rounded-xl p-3">
                <Upload className="text-primary h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium">Drop a file here</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  CSV, SQLite or DB · up to {Math.round(config.MAX_UPLOAD_BYTES / (1024 * 1024))}MB
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                Choose a file
              </Button>
            </>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={config.ACCEPTED_FILE_TYPES.join(',')}
            onChange={handleInputChange}
            className="hidden"
            aria-label="Upload a dataset"
          />
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3 p-3">
            <div className="bg-primary/10 shrink-0 rounded-lg p-2">
              <FileSpreadsheet className="text-primary h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={dataset.file_name}>
                {dataset.file_name}
              </p>
              <p className="text-muted-foreground text-xs">
                {dataset.table_count} table{dataset.table_count === 1 ? '' : 's'} ·{' '}
                {dataset.row_count.toLocaleString()} rows · {formatBytes(dataset.size_bytes)}
              </p>
              {expiry && (
                <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  {expiry}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              title="Remove this dataset"
              aria-label="Remove this dataset"
              className="hover:text-destructive shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <Separator />

          {/* The profile leads: it answers "what is in here" before the user has
              to formulate a question. The schema is a click away for reference. */}
          <div className="flex shrink-0 gap-1 px-3 pt-2">
            {(['profile', 'schema'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
                  view === option
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option === 'profile' ? 'Overview' : 'Schema'}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {view === 'profile' ? (
              <DataProfile profile={profile} isLoading={isProfileLoading} onAsk={onAsk} />
            ) : (
              <SchemaBrowser
                datasetUuid={dataset.uuid}
                tables={tables}
                isLoading={isSchemaLoading}
              />
            )}
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5 p-3">
            {/* Adding is the primary action: several files in one dataset become
                tables the agent can JOIN, which is how cross-file questions work. */}
            <Button
              size="sm"
              className="w-full"
              onClick={() => addInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FilePlus2 className="h-4 w-4" />
              )}
              Add another file
            </Button>
            <input
              ref={addInputRef}
              type="file"
              accept={config.ACCEPTED_FILE_TYPES.join(',')}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAddFile(file);
                event.target.value = '';
              }}
              className="hidden"
              aria-label="Add another file to this dataset"
            />

            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => inputRef.current?.click()}
              disabled={isUploading}
            >
              <Upload className="h-4 w-4" />
              Replace dataset
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={config.ACCEPTED_FILE_TYPES.join(',')}
              onChange={handleInputChange}
              className="hidden"
              aria-label="Replace the dataset"
            />
          </div>
        </>
      )}
    </div>
  );
};

export default DatasetPanel;
