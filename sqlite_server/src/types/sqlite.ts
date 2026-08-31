export interface QueryRequest {
  uuid?: unknown;
  query?: unknown;
  /** Optional caller-supplied cap, clamped to the server maximum. */
  maxRows?: unknown;
}

export interface SqliteMasterRow {
  name: string;
  sql: string | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

export interface SchemaResponse {
  /** Human-readable schema consumed by the LangGraph agent's prompts. */
  schema: string;
  /** Structured schema consumed by the frontend schema browser. */
  tables: TableInfo[];
}

export interface QueryResult {
  /** Column names in selection order. */
  columns: string[];
  /** Row values as arrays, matching `columns` order. */
  results: unknown[][];
  /** Rows as objects, convenient for table rendering and exports. */
  rows: Record<string, unknown>[];
  rowCount: number;
  /** True when the result was cut short by the row cap. */
  truncated: boolean;
  durationMs: number;
}

export interface UploadResult {
  uuid: string;
  fileName: string;
  sizeBytes: number;
  tables: TableInfo[];
  expiresAt: string;
}

/** Statistics for one column, computed by scanning the data. */
export interface ColumnProfile {
  name: string;
  type: string;
  /** 'numeric' | 'text' | 'temporal' | 'boolean' — inferred from the values. */
  kind: string;
  nullCount: number;
  nullPercent: number;
  distinctCount: number;
  /** True when nearly every value is distinct. */
  isUnique: boolean;
  /**
   * True when the column appears to identify rows rather than measure anything:
   * a declared primary key, or a unique integer with an identifier-like name.
   * Such columns are excluded from correlation, where they only ever produce
   * artefacts of insertion order.
   */
  isIdentifier: boolean;

  // Numeric columns only.
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stdev?: number;
  /** Values more than three interquartile ranges outside the middle 50%. */
  outlierCount?: number;

  /** Most frequent values, for low-cardinality columns. */
  topValues?: { value: string; count: number }[];
  /** Bucketed counts for numeric columns, for a sparkline histogram. */
  histogram?: { start: number; end: number; count: number }[];
}

export interface TableProfile {
  table: string;
  rowCount: number;
  columns: ColumnProfile[];
  /** Rows that are exact duplicates of another row. */
  duplicateRows: number;
}

export interface DatasetProfile {
  tables: TableProfile[];
  /** Pearson correlations between numeric column pairs, strongest first. */
  correlations: { table: string; a: string; b: string; coefficient: number }[];
  /** Plain-language observations worth surfacing immediately. */
  highlights: string[];
  computedMs: number;
}
