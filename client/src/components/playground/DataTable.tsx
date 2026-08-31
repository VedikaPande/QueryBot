import { useDeferredValue, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CellValue } from '@/types/api';

interface DataTableProps {
  columns: string[];
  rows: CellValue[][];
  className?: string;
  pageSize?: number;
}

type SortDirection = 'asc' | 'desc';

interface SortState {
  index: number;
  direction: SortDirection;
}

/** Render one cell, marking nulls and formatting numbers readably. */
const renderCell = (value: CellValue) => {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground/50 italic">null</span>;
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'number') {
    return (
      <span className="tabular-nums">
        {Number.isInteger(value)
          ? value.toLocaleString()
          : value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
      </span>
    );
  }
  return String(value);
};

/** True when most sampled values in a column parse as numbers. */
const detectNumericColumns = (rows: CellValue[][], columnCount: number): boolean[] =>
  Array.from({ length: columnCount }, (_, index) => {
    const sample = rows
      .slice(0, 25)
      .map((row) => row[index])
      .filter((value) => value !== null && value !== undefined && value !== '');

    if (sample.length === 0) return false;

    const numeric = sample.filter(
      (value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)))
    );
    return numeric.length / sample.length > 0.7;
  });

/**
 * Sortable, filterable, paginated result grid.
 *
 * Implemented directly rather than via a table library: sorting, filtering and
 * pagination over an in-memory array is a small amount of code, and it avoids
 * taking a dependency whose API has changed shape between majors.
 */
const DataTable = ({ columns, rows, className, pageSize = 25 }: DataTableProps) => {
  const [sort, setSort] = useState<SortState | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);

  // Keeps typing responsive when filtering a large result set.
  const deferredFilter = useDeferredValue(filter);

  const numericColumns = useMemo(
    () => detectNumericColumns(rows, columns.length),
    [rows, columns.length]
  );

  const filteredRows = useMemo(() => {
    const needle = deferredFilter.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) =>
      row.some((cell) => cell !== null && String(cell).toLowerCase().includes(needle))
    );
  }, [rows, deferredFilter]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;

    const { index, direction } = sort;
    const isNumeric = numericColumns[index];
    const factor = direction === 'asc' ? 1 : -1;

    // Copy before sorting: the source array is owned by the caller.
    return [...filteredRows].sort((left, right) => {
      const a = left[index];
      const b = right[index];

      // Nulls always sort last, regardless of direction.
      if (a === null || a === undefined || a === '') return 1;
      if (b === null || b === undefined || b === '') return -1;

      if (isNumeric) {
        return (Number(a) - Number(b)) * factor;
      }
      return String(a).localeCompare(String(b), undefined, { numeric: true }) * factor;
    });
  }, [filteredRows, sort, numericColumns]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  // Clamp rather than store: filtering can shrink the result below the current page.
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const toggleSort = (index: number) => {
    setPage(0);
    setSort((previous) => {
      if (previous?.index !== index) return { index, direction: 'asc' };
      if (previous.direction === 'asc') return { index, direction: 'desc' };
      // Third click clears the sort and restores the original order.
      return null;
    });
  };

  if (rows.length === 0) {
    return (
      <p className={cn('text-muted-foreground py-8 text-center text-sm', className)}>
        This query returned no rows.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
            placeholder="Filter rows..."
            aria-label="Filter rows"
            className="h-9 pl-9"
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {sortedRows.length === rows.length
            ? `${rows.length.toLocaleString()} rows`
            : `${sortedRows.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`}
        </p>
      </div>

      {/* The table scrolls inside this container so the page never scrolls sideways. */}
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr>
              {columns.map((column, index) => {
                const isSorted = sort?.index === index;
                return (
                  <th
                    key={`${column}-${index}`}
                    scope="col"
                    aria-sort={isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn(
                      'border-border border-b px-3 py-2 font-medium whitespace-nowrap',
                      numericColumns[index] ? 'text-right' : 'text-left'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(index)}
                      className={cn(
                        'hover:text-primary inline-flex items-center gap-1.5 transition-colors',
                        numericColumns[index] && 'flex-row-reverse'
                      )}
                      aria-label={`Sort by ${column}`}
                    >
                      <span>{column}</span>
                      {isSorted ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={currentPage * pageSize + rowIndex}
                className="border-border/60 hover:bg-muted/40 border-b transition-colors last:border-0"
              >
                {columns.map((_, columnIndex) => (
                  <td
                    key={columnIndex}
                    className={cn(
                      'max-w-xs truncate px-3 py-2',
                      numericColumns[columnIndex] ? 'text-right' : 'text-left'
                    )}
                    title={row[columnIndex] === null ? '' : String(row[columnIndex] ?? '')}
                  >
                    {renderCell(row[columnIndex] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Page {currentPage + 1} of {pageCount.toLocaleString()}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 0}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pageCount - 1}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataTable;
