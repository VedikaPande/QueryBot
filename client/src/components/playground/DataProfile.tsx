import { useMemo, useState } from 'react';
import { AlertTriangle, Fingerprint, Hash, Lightbulb, Link2, Type } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ColumnProfile, DatasetProfile } from '@/types/dataset';

interface DataProfileProps {
  profile: DatasetProfile | null;
  isLoading: boolean;
  /** Clicking a highlight or correlation asks about it. */
  onAsk: (question: string) => void;
}

const compact = (value: number): string =>
  Math.abs(value) >= 1000
    ? value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const KIND_ICON: Record<string, typeof Hash> = {
  numeric: Hash,
  text: Type,
  temporal: Hash,
  boolean: Type,
};

/**
 * A distribution sparkline.
 *
 * Rendered as inline SVG rather than through a charting library: it is a dozen
 * bars, and pulling in a chart runtime for it would cost more than the whole
 * panel is worth.
 */
const Histogram = ({ buckets }: { buckets: NonNullable<ColumnProfile['histogram']> }) => {
  const peak = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <svg
      viewBox={`0 0 ${buckets.length * 4} 20`}
      className="h-5 w-20"
      preserveAspectRatio="none"
      role="img"
      aria-label="Value distribution"
    >
      {buckets.map((bucket, index) => {
        // Non-empty buckets keep a visible floor so gaps read as genuinely empty.
        const height = bucket.count === 0 ? 0 : Math.max(1.5, (bucket.count / peak) * 20);
        return (
          <rect
            key={index}
            x={index * 4}
            y={20 - height}
            width={3}
            height={height}
            className="fill-primary/70"
          />
        );
      })}
    </svg>
  );
};

/** One column's statistics. */
const ColumnRow = ({ column }: { column: ColumnProfile }) => {
  const Icon = KIND_ICON[column.kind] ?? Type;

  const detail = useMemo(() => {
    if (column.kind === 'numeric' && column.min !== undefined) {
      const parts = [`${compact(column.min)} – ${compact(column.max ?? column.min)}`];
      if (column.mean !== undefined) parts.push(`avg ${compact(column.mean)}`);
      return parts.join(' · ');
    }
    return `${column.distinctCount.toLocaleString()} distinct`;
  }, [column]);

  return (
    <div className="border-border/50 flex items-center gap-2 border-b py-2 last:border-0">
      <Icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-xs" title={column.name}>
            {column.name}
          </span>
          {column.isIdentifier && (
            <Fingerprint className="text-muted-foreground h-3 w-3 shrink-0" aria-label="Identifier" />
          )}
        </div>
        <p className="text-muted-foreground truncate text-[11px]">{detail}</p>
      </div>

      {column.histogram && <Histogram buckets={column.histogram} />}

      {column.topValues && column.topValues.length > 0 && !column.histogram && (
        <span
          className="text-muted-foreground max-w-24 truncate text-[11px]"
          title={column.topValues.map((v) => `${v.value} (${v.count})`).join(', ')}
        >
          {column.topValues[0]?.value}
        </span>
      )}

      {/* Only flagged when high enough to change how the column should be read. */}
      {column.nullPercent >= 10 && (
        <span
          className="text-warning shrink-0 text-[11px] tabular-nums"
          title={`${column.nullCount} missing values`}
        >
          {column.nullPercent.toFixed(0)}% empty
        </span>
      )}
    </div>
  );
};

/**
 * Automatic dataset profile.
 *
 * Shown as soon as a file is uploaded, so the user starts from an understanding
 * of their data rather than discovering the schema through failed questions.
 * Everything here is computed in SQL — no model call, so it is instant and exact.
 */
const DataProfile = ({ profile, isLoading, onAsk }: DataProfileProps) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!profile || profile.tables.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {profile.highlights.length > 0 && (
        <section>
          <h3 className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs font-medium">
            <Lightbulb className="h-3.5 w-3.5" />
            What stands out
          </h3>
          <ul className="flex flex-col gap-1">
            {profile.highlights.map((highlight) => (
              <li
                key={highlight}
                className="border-warning/30 bg-warning/5 flex gap-1.5 rounded-md border p-2 text-[11px] leading-snug"
              >
                <AlertTriangle className="text-warning mt-0.5 h-3 w-3 shrink-0" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.correlations.length > 0 && (
        <section>
          <h3 className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs font-medium">
            <Link2 className="h-3.5 w-3.5" />
            Related columns
          </h3>
          <ul className="flex flex-col gap-1">
            {profile.correlations.map(({ a, b, coefficient }) => (
              <li key={`${a}-${b}`}>
                {/* Clicking turns an observation into the next question. */}
                <button
                  type="button"
                  onClick={() => onAsk(`What is the relationship between ${a} and ${b}?`)}
                  className="border-border hover:border-primary hover:bg-primary/5 flex w-full items-center gap-2 rounded-md border p-2 text-left text-[11px] transition-colors"
                >
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {a} ↔ {b}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 tabular-nums',
                      coefficient > 0 ? 'text-success' : 'text-destructive'
                    )}
                  >
                    r={coefficient}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.tables.map((table) => {
        const isOpen = expanded === table.table || profile.tables.length === 1;

        return (
          <section key={table.table}>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : table.table)}
              className="text-muted-foreground hover:text-foreground mb-1 flex w-full items-center justify-between text-xs font-medium transition-colors"
            >
              <span className="font-mono">{table.table}</span>
              <span className="tabular-nums">
                {table.rowCount.toLocaleString()} rows
                {table.duplicateRows > 0 && (
                  <span className="text-warning"> · {table.duplicateRows} dup</span>
                )}
              </span>
            </button>

            {isOpen && (
              <div className="border-border rounded-md border px-2">
                {table.columns.map((column) => (
                  <ColumnRow key={column.name} column={column} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <p className="text-muted-foreground text-center text-[10px]">
        Profiled in {profile.computedMs}ms
      </p>
    </div>
  );
};

export default DataProfile;
