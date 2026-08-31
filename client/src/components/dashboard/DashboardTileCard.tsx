import { useState } from 'react';
import {
  BarChart3,
  FileText,
  GripVertical,
  Maximize2,
  Table2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import DataTable from '@/components/playground/DataTable';
import { cn } from '@/lib/utils';
import { TILE_SIZES, type DashboardTile, type TileSize, type TileView } from '@/types/dashboard';

interface DashboardTileCardProps {
  tile: DashboardTile;
  /** Read-only on a publicly shared dashboard. */
  editable?: boolean;
  isDragging?: boolean;
  onChangeView?: (view: TileView) => void;
  onChangeSize?: (size: TileSize) => void;
  onRemove?: () => void;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
}

/** Views a tile can offer, given what the pinned result actually contains. */
const availableViews = (tile: DashboardTile): { value: TileView; label: string; icon: typeof BarChart3 }[] => {
  const views: { value: TileView; label: string; icon: typeof BarChart3 }[] = [];
  if (tile.chart_image_base64) views.push({ value: 'chart', label: 'Chart', icon: BarChart3 });
  if (tile.result_rows?.length) views.push({ value: 'table', label: 'Table', icon: Table2 });
  if (tile.answer) views.push({ value: 'answer', label: 'Answer', icon: FileText });
  return views;
};

/** One pinned result. */
const DashboardTileCard = ({
  tile,
  editable = false,
  isDragging = false,
  onChangeView,
  onChangeSize,
  onRemove,
  onDragStart,
  onDragEnter,
  onDragEnd,
}: DashboardTileCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const columns = tile.result_columns?.length
    ? tile.result_columns
    : (tile.result_rows?.[0]?.map((_, index) => `Column ${index + 1}`) ?? []);

  const views = availableViews(tile);

  return (
    <article
      // Spans of a 12-column grid, so tile sizes compose predictably.
      style={{ gridColumn: `span ${Math.min(tile.columns, 12)}` }}
      className={cn(
        'bg-card border-border flex min-h-56 flex-col overflow-hidden rounded-xl border transition-shadow',
        isDragging && 'opacity-40',
        isExpanded && 'row-span-2'
      )}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
    >
      <header className="border-border flex items-center gap-1.5 border-b px-3 py-2">
        {editable && (
          <span
            // Only the handle is draggable, so text inside the tile stays
            // selectable and the grid does not fight the cursor.
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
            aria-label="Reorder tile"
            role="button"
            tabIndex={-1}
          >
            <GripVertical className="h-4 w-4" />
          </span>
        )}

        <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={tile.title}>
          {tile.title}
        </h3>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setIsExpanded((open) => !open)}
          title={isExpanded ? 'Collapse' : 'Expand'}
          aria-label={isExpanded ? 'Collapse tile' : 'Expand tile'}
          className="shrink-0"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>

        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Tile options" className="shrink-0">
                <span aria-hidden>⋯</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {views.length > 1 && (
                <>
                  <DropdownMenuLabel>Show</DropdownMenuLabel>
                  {views.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuItem key={value} onSelect={() => onChangeView?.(value)}>
                      <Icon className="h-4 w-4" />
                      {label}
                      {tile.view === value && <span className="ml-auto text-xs">✓</span>}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}

              <DropdownMenuLabel>Width</DropdownMenuLabel>
              {TILE_SIZES.map(({ value, label }) => (
                <DropdownMenuItem key={value} onSelect={() => onChangeSize?.(value)}>
                  {label}
                  {tile.size === value && <span className="ml-auto text-xs">✓</span>}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onRemove?.()}>
                <Trash2 className="h-4 w-4" />
                Unpin
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className={cn('min-h-0 flex-1 overflow-auto p-3', isExpanded && 'max-h-[32rem]')}>
        {tile.view === 'chart' && tile.chart_image_base64 && (
          <div className="flex h-full items-center justify-center rounded-lg bg-white p-2">
            <img
              src={`data:image/png;base64,${tile.chart_image_base64}`}
              alt={tile.title}
              className="max-h-full max-w-full rounded"
            />
          </div>
        )}

        {tile.view === 'table' && tile.result_rows && (
          <DataTable columns={columns} rows={tile.result_rows} pageSize={isExpanded ? 15 : 5} />
        )}

        {tile.view === 'answer' && tile.answer && (
          <MarkdownRenderer content={tile.answer} className="text-sm" />
        )}
      </div>
    </article>
  );
};

export default DashboardTileCard;
