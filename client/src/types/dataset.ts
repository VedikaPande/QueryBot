import type { CellValue } from './api';

export interface DatasetColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface DatasetTable {
  name: string;
  columns: DatasetColumn[];
  rowCount: number;
}

export interface Dataset {
  id: string;
  uuid: string;
  file_name: string;
  size_bytes: number;
  table_count: number;
  row_count: number;
  created_at: string | null;
  last_used_at: string | null;
  /** When the underlying file is removed by the retention sweep. */
  expires_at: string | null;
}

export interface DatasetSchema {
  tables: DatasetTable[];
  dataset: Dataset;
}

export interface TablePreview {
  table: string;
  columns: string[];
  rows: Record<string, CellValue>[];
  rowCount: number;
  previewCount: number;
}

/** Statistics for one column, computed by scanning the data. */
export interface ColumnProfile {
  name: string;
  type: string;
  kind: 'numeric' | 'text' | 'temporal' | 'boolean' | string;
  nullCount: number;
  nullPercent: number;
  distinctCount: number;
  isUnique: boolean;
  isIdentifier: boolean;

  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stdev?: number;
  outlierCount?: number;

  topValues?: { value: string; count: number }[];
  histogram?: { start: number; end: number; count: number }[];
}

export interface TableProfile {
  table: string;
  rowCount: number;
  columns: ColumnProfile[];
  duplicateRows: number;
}

export interface DatasetProfile {
  tables: TableProfile[];
  correlations: { table: string; a: string; b: string; coefficient: number }[];
  highlights: string[];
  computedMs: number;
}

/** Result of running a SQL query directly. */
export interface QueryResult {
  columns: string[];
  results: CellValue[][];
  rows: Record<string, CellValue>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}
