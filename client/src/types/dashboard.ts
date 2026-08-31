import type { CellValue } from './api';
import type { VisualizationType } from './playground';

/** Which part of a pinned result the tile displays. */
export type TileView = 'chart' | 'table' | 'answer';

/** Tile width, as a share of the 12-column grid. */
export type TileSize = 'small' | 'medium' | 'large' | 'full';

export const TILE_SIZES: { value: TileSize; label: string; columns: number }[] = [
  { value: 'small', label: 'Small', columns: 3 },
  { value: 'medium', label: 'Medium', columns: 4 },
  { value: 'large', label: 'Large', columns: 6 },
  { value: 'full', label: 'Full width', columns: 12 },
];

export interface DashboardTile {
  id: string;
  title: string;
  view: TileView;
  size: TileSize;
  columns: number;
  position: number;

  answer?: string;
  chart_image_base64?: string;
  result_rows?: CellValue[][];
  result_columns?: string[];
  visualization?: VisualizationType;
  created_at?: string;

  /** Owner-only. Withheld from a publicly shared dashboard. */
  sql_query?: string;
  message_id?: string;
}

export interface Dashboard {
  id: string;
  title: string;
  description: string | null;
  tile_count: number;
  created_at: string | null;
  updated_at: string | null;

  /** Owner-only fields, absent on a public response. */
  is_shared?: boolean;
  share_token?: string | null;
  shared_at?: string | null;
}

export interface DashboardDetail extends Dashboard {
  tiles: DashboardTile[];
}
