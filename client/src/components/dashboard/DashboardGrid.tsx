import { useRef, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import DashboardTileCard from './DashboardTileCard';
import type { DashboardTile, TileSize, TileView } from '@/types/dashboard';

interface DashboardGridProps {
  tiles: DashboardTile[];
  editable?: boolean;
  onReorder?: (tileIds: string[]) => void;
  onChangeView?: (tileId: string, view: TileView) => void;
  onChangeSize?: (tileId: string, size: TileSize) => void;
  onRemove?: (tileId: string) => void;
}

/**
 * The tile grid, with drag-to-reorder.
 *
 * Reordering is implemented with the native HTML drag events rather than a
 * drag-and-drop library: the interaction is a single-list reorder, and the
 * libraries that do this well are larger than the whole dashboard feature.
 */
const DashboardGrid = ({
  tiles,
  editable = false,
  onReorder,
  onChangeView,
  onChangeSize,
  onRemove,
}: DashboardGridProps) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Live order during a drag, so tiles move under the cursor before the drop.
  const [preview, setPreview] = useState<DashboardTile[] | null>(null);
  const hasMoved = useRef(false);

  const ordered = preview ?? tiles;

  const handleDragEnter = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;

    const current = preview ?? tiles;
    const from = current.findIndex((tile) => tile.id === draggingId);
    const to = current.findIndex((tile) => tile.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...current];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);

    hasMoved.current = true;
    setPreview(next);
  };

  const handleDragEnd = () => {
    // Only persist when the order actually changed; a click on the handle
    // should not fire a write.
    if (hasMoved.current && preview) {
      onReorder?.(preview.map((tile) => tile.id));
    }
    setDraggingId(null);
    setPreview(null);
    hasMoved.current = false;
  };

  if (tiles.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
        <div className="bg-muted rounded-2xl p-4">
          <LayoutDashboard className="text-muted-foreground h-8 w-8" />
        </div>
        <div>
          <p className="font-medium">Nothing pinned yet</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            Ask a question in the playground, then use <strong>Pin to dashboard</strong> on the
            result to keep it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-6 lg:grid-cols-12">
      {ordered.map((tile) => (
        <DashboardTileCard
          key={tile.id}
          tile={tile}
          editable={editable}
          isDragging={draggingId === tile.id}
          onChangeView={(view) => onChangeView?.(tile.id, view)}
          onChangeSize={(size) => onChangeSize?.(tile.id, size)}
          onRemove={() => onRemove?.(tile.id)}
          onDragStart={() => setDraggingId(tile.id)}
          onDragEnter={() => handleDragEnter(tile.id)}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  );
};

export default DashboardGrid;
