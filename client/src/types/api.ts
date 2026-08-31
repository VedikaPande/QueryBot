/** Envelope returned by every Flask endpoint. */
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

/** Error body returned by the Flask API. */
export interface ApiError {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
}

/** A single value in a query result cell. */
export type CellValue = string | number | boolean | null;

/** One row of a query result, in column order. */
export type ResultRow = CellValue[];
