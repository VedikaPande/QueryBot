import type Database from 'better-sqlite3';
import { logger } from './logger';
import type {
  ColumnProfile,
  DatasetProfile,
  TableInfo,
  TableProfile,
} from '../types/sqlite';

/**
 * Dataset profiling: the shape of each column, what is missing, what is skewed,
 * and which columns move together.
 *
 * Computed in SQL against the uploaded database, so it is exact and involves no
 * model call.
 */

/** Buckets in a numeric column's histogram. Enough shape for a sparkline. */
const HISTOGRAM_BUCKETS = 12;

/** Above this many distinct values, a "top values" list stops being useful. */
const TOP_VALUES_CARDINALITY_LIMIT = 25;

/** Escape an identifier for interpolation; SQL cannot parameterise these. */
const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

/** Column names that conventionally identify a row rather than measure it. */
const IDENTIFIER_NAME = /(^|_)(id|ids|key|uuid|guid|index|idx|no|num|number|row|pk|code)$/i;

/**
 * Whether a column identifies rows rather than measuring anything.
 *
 * Distinctness alone is not the test: a revenue or temperature column in a small
 * dataset is usually entirely distinct, and treating that as an identifier would
 * exclude exactly the columns worth correlating. A declared primary key, or a
 * unique integer with an identifier-like name, is the reliable signal.
 */
const looksLikeIdentifier = (
  name: string,
  declaredType: string,
  isUnique: boolean,
  isPrimaryKey: boolean
): boolean => {
  if (isPrimaryKey) return true;
  if (!isUnique) return false;

  const isIntegerTyped = /INT/i.test(declaredType);
  return isIntegerTyped && IDENTIFIER_NAME.test(name);
};

/**
 * Classify a column from its declared type and a sample of its values.
 *
 * The declared type is unreliable: SQLite applies loose affinity, and a CSV
 * column of dates arrives as TEXT.
 */
const classifyColumn = (
  db: Database.Database,
  table: string,
  column: string,
  declaredType: string
): string => {
  const normalized = declaredType.toUpperCase();
  if (/INT|REAL|FLOA|DOUB|NUM|DEC/.test(normalized)) return 'numeric';
  if (/BOOL/.test(normalized)) return 'boolean';

  const sample = db
    .prepare(
      `SELECT ${quote(column)} AS v FROM ${quote(table)}
       WHERE ${quote(column)} IS NOT NULL AND ${quote(column)} != '' LIMIT 50`
    )
    .all() as { v: unknown }[];

  if (sample.length === 0) return 'text';

  const values = sample.map((row) => String(row.v));

  const numericCount = values.filter((v) => v.trim() !== '' && !Number.isNaN(Number(v))).length;
  if (numericCount / values.length > 0.9) return 'numeric';

  // ISO-ish dates and common regional formats.
  const temporalCount = values.filter((v) =>
    /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)
  ).length;
  if (temporalCount / values.length > 0.8) return 'temporal';

  const booleanCount = values.filter((v) => /^(true|false|yes|no|y|n|0|1)$/i.test(v)).length;
  if (booleanCount === values.length && new Set(values.map((v) => v.toLowerCase())).size <= 2) {
    return 'boolean';
  }

  return 'text';
};

/** Numeric summary for one column, including a histogram and an outlier count. */
const profileNumericColumn = (
  db: Database.Database,
  table: string,
  column: string
): Partial<ColumnProfile> => {
  const col = quote(column);
  const tbl = quote(table);

  // CAST so a numeric column stored as TEXT still aggregates correctly.
  const stats = db
    .prepare(
      `SELECT
         MIN(CAST(${col} AS REAL))  AS min,
         MAX(CAST(${col} AS REAL))  AS max,
         AVG(CAST(${col} AS REAL))  AS mean,
         COUNT(*)                   AS n
       FROM ${tbl}
       WHERE ${col} IS NOT NULL AND ${col} != ''`
    )
    .get() as { min: number | null; max: number | null; mean: number | null; n: number };

  if (!stats || stats.n === 0 || stats.min === null) return {};

  /** Value at a fractional position, used for the median and quartiles. */
  const percentile = (fraction: number): number => {
    const offset = Math.max(0, Math.min(stats.n - 1, Math.floor(stats.n * fraction)));
    const row = db
      .prepare(
        `SELECT CAST(${col} AS REAL) AS v FROM ${tbl}
         WHERE ${col} IS NOT NULL AND ${col} != ''
         ORDER BY v LIMIT 1 OFFSET ?`
      )
      .get(offset) as { v: number } | undefined;
    return row?.v ?? 0;
  };

  const median = percentile(0.5);
  const q1 = percentile(0.25);
  const q3 = percentile(0.75);
  const iqr = q3 - q1;

  // SQLite has no stdev aggregate, so it is derived from E[x²] - E[x]².
  const variance = db
    .prepare(
      `SELECT AVG(CAST(${col} AS REAL) * CAST(${col} AS REAL)) - AVG(CAST(${col} AS REAL)) * AVG(CAST(${col} AS REAL)) AS v
       FROM ${tbl} WHERE ${col} IS NOT NULL AND ${col} != ''`
    )
    .get() as { v: number | null };

  let outlierCount = 0;
  if (iqr > 0) {
    const bounds = db
      .prepare(
        `SELECT COUNT(*) AS c FROM ${tbl}
         WHERE ${col} IS NOT NULL AND ${col} != ''
           AND (CAST(${col} AS REAL) > ? OR CAST(${col} AS REAL) < ?)`
      )
      .get(q3 + 3 * iqr, q1 - 3 * iqr) as { c: number };
    outlierCount = bounds.c;
  }

  // Histogram, skipped when every value is identical.
  const histogram: { start: number; end: number; count: number }[] = [];
  const span = (stats.max ?? 0) - stats.min;
  if (span > 0) {
    const width = span / HISTOGRAM_BUCKETS;
    const buckets = db
      .prepare(
        `SELECT
           CAST(MIN(CAST((CAST(${col} AS REAL) - ?) / ? AS INTEGER), ?) AS INTEGER) AS bucket,
           COUNT(*) AS count
         FROM ${tbl}
         WHERE ${col} IS NOT NULL AND ${col} != ''
         GROUP BY bucket ORDER BY bucket`
      )
      .all(stats.min, width, HISTOGRAM_BUCKETS - 1) as { bucket: number; count: number }[];

    const counts = new Map(buckets.map((b) => [b.bucket, b.count]));
    for (let i = 0; i < HISTOGRAM_BUCKETS; i += 1) {
      histogram.push({
        start: stats.min + i * width,
        end: stats.min + (i + 1) * width,
        count: counts.get(i) ?? 0,
      });
    }
  }

  // Keys are omitted rather than set to undefined: exactOptionalPropertyTypes
  // distinguishes "absent" from "present but undefined".
  return {
    min: stats.min,
    ...(stats.max !== null ? { max: stats.max } : {}),
    ...(stats.mean !== null ? { mean: stats.mean } : {}),
    median,
    stdev: variance.v !== null && variance.v > 0 ? Math.sqrt(variance.v) : 0,
    outlierCount,
    ...(histogram.length > 0 ? { histogram } : {}),
  };
};

/** Profile every column of one table. */
const profileTable = (db: Database.Database, table: TableInfo): TableProfile => {
  const tbl = quote(table.name);

  const columns: ColumnProfile[] = table.columns.map((column) => {
    const col = quote(column.name);

    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN ${col} IS NULL OR ${col} = '' THEN 1 ELSE 0 END) AS nulls,
           COUNT(DISTINCT ${col}) AS distinct_count
         FROM ${tbl}`
      )
      .get() as { nulls: number | null; distinct_count: number };

    const nullCount = counts.nulls ?? 0;
    const kind = classifyColumn(db, table.name, column.name, column.type);
    // Grouping by this would produce roughly one row each.
    const isUnique = table.rowCount > 0 && counts.distinct_count >= table.rowCount * 0.99;

    const profile: ColumnProfile = {
      name: column.name,
      type: column.type,
      kind,
      nullCount,
      nullPercent: table.rowCount > 0 ? (nullCount / table.rowCount) * 100 : 0,
      distinctCount: counts.distinct_count,
      isUnique,
      isIdentifier: looksLikeIdentifier(column.name, column.type, isUnique, column.primaryKey),
    };

    if (kind === 'numeric') {
      Object.assign(profile, profileNumericColumn(db, table.name, column.name));
    }

    // A "top values" list only helps when the cardinality is low enough to read.
    if (kind !== 'numeric' && counts.distinct_count <= TOP_VALUES_CARDINALITY_LIMIT) {
      profile.topValues = (
        db
          .prepare(
            `SELECT ${col} AS value, COUNT(*) AS count FROM ${tbl}
             WHERE ${col} IS NOT NULL AND ${col} != ''
             GROUP BY ${col} ORDER BY count DESC LIMIT 8`
          )
          .all() as { value: unknown; count: number }[]
      ).map((row) => ({ value: String(row.value), count: row.count }));
    }

    return profile;
  });

  // Exact duplicate rows, a common sign of a bad export or a double import.
  let duplicateRows = 0;
  try {
    const columnList = table.columns.map((c) => quote(c.name)).join(', ');
    if (columnList) {
      const result = db
        .prepare(
          `SELECT COUNT(*) - COUNT(DISTINCT 1) AS d FROM (
             SELECT ${columnList}, COUNT(*) AS n FROM ${tbl} GROUP BY ${columnList} HAVING n > 1
           )`
        )
        .get() as { d: number } | undefined;
      const groups = db
        .prepare(
          `SELECT COALESCE(SUM(n - 1), 0) AS extra FROM (
             SELECT COUNT(*) AS n FROM ${tbl} GROUP BY ${columnList} HAVING n > 1
           )`
        )
        .get() as { extra: number };
      duplicateRows = groups.extra ?? result?.d ?? 0;
    }
  } catch {
    // Wide tables can exceed SQLite's expression limits; a missing duplicate
    // count is not worth failing the whole profile for.
    duplicateRows = 0;
  }

  return { table: table.name, rowCount: table.rowCount, columns, duplicateRows };
};

/**
 * Pearson correlation between numeric column pairs.
 *
 * Surfaces relationships worth investigating that a user would not think to ask
 * about — the "these two move together" observation.
 */
const computeCorrelations = (
  db: Database.Database,
  profiles: TableProfile[]
): DatasetProfile['correlations'] => {
  const found: DatasetProfile['correlations'] = [];

  for (const table of profiles) {
    const numeric = table.columns.filter(
      // An identifier correlating with anything is an artefact of insertion
      // order, not a finding. A constant column has no relationship to report.
      (c) => c.kind === 'numeric' && !c.isIdentifier && (c.stdev ?? 0) > 0
    );

    // Quadratic in the column count, so bounded for very wide tables.
    for (let i = 0; i < numeric.length && i < 12; i += 1) {
      for (let j = i + 1; j < numeric.length && j < 12; j += 1) {
        const a = quote(numeric[i]!.name);
        const b = quote(numeric[j]!.name);

        try {
          const row = db
            .prepare(
              `SELECT
                 COUNT(*) AS n,
                 AVG(x) AS mx, AVG(y) AS my,
                 AVG(x * y) AS mxy,
                 AVG(x * x) AS mxx, AVG(y * y) AS myy
               FROM (
                 SELECT CAST(${a} AS REAL) AS x, CAST(${b} AS REAL) AS y
                 FROM ${quote(table.table)}
                 WHERE ${a} IS NOT NULL AND ${a} != '' AND ${b} IS NOT NULL AND ${b} != ''
               )`
            )
            .get() as {
            n: number; mx: number; my: number; mxy: number; mxx: number; myy: number;
          };

          if (!row || row.n < 5) continue;

          const covariance = row.mxy - row.mx * row.my;
          const sdX = Math.sqrt(Math.max(0, row.mxx - row.mx * row.mx));
          const sdY = Math.sqrt(Math.max(0, row.myy - row.my * row.my));
          if (sdX === 0 || sdY === 0) continue;

          const coefficient = covariance / (sdX * sdY);
          // Only report relationships strong enough to be worth a look.
          if (Math.abs(coefficient) >= 0.5) {
            found.push({
              table: table.table,
              a: numeric[i]!.name,
              b: numeric[j]!.name,
              coefficient: Number(coefficient.toFixed(3)),
            });
          }
        } catch {
          // A non-coercible column pair is simply skipped.
        }
      }
    }
  }

  return found.sort((x, y) => Math.abs(y.coefficient) - Math.abs(x.coefficient)).slice(0, 6);
};

/** Turn the numbers into observations a person can act on. */
const buildHighlights = (
  profiles: TableProfile[],
  correlations: DatasetProfile['correlations']
): string[] => {
  const highlights: string[] = [];

  for (const table of profiles) {
    const worstNulls = [...table.columns]
      .filter((c) => c.nullPercent >= 20)
      .sort((a, b) => b.nullPercent - a.nullPercent)[0];
    if (worstNulls) {
      highlights.push(
        `${worstNulls.nullPercent.toFixed(0)}% of "${worstNulls.name}" is empty — filter on it with care.`
      );
    }

    if (table.duplicateRows > 0) {
      highlights.push(
        `${table.duplicateRows.toLocaleString()} duplicate row${table.duplicateRows === 1 ? '' : 's'} in ${table.table} — totals may be overstated.`
      );
    }

    const skewed = table.columns.find(
      (c) => c.kind === 'numeric' && (c.outlierCount ?? 0) > 0 && c.mean !== undefined && c.median !== undefined
        && Math.abs(c.mean - c.median) > Math.abs(c.median) * 0.5
    );
    if (skewed) {
      highlights.push(
        `"${skewed.name}" is skewed (mean ${skewed.mean!.toLocaleString(undefined, { maximumFractionDigits: 2 })} vs median ${skewed.median!.toLocaleString(undefined, { maximumFractionDigits: 2 })}) — the median is the fairer summary.`
      );
    }

    const constant = table.columns.find((c) => c.distinctCount === 1 && c.nullCount < table.rowCount);
    if (constant) {
      highlights.push(`"${constant.name}" holds one value throughout — it cannot distinguish anything.`);
    }
  }

  for (const { a, b, coefficient } of correlations.slice(0, 2)) {
    highlights.push(
      `"${a}" and "${b}" move ${coefficient > 0 ? 'together' : 'inversely'} (r = ${coefficient}).`
    );
  }

  return highlights.slice(0, 6);
};

/** Profile an open database. */
export const profileDatabase = (
  db: Database.Database,
  tables: TableInfo[]
): DatasetProfile => {
  const startedAt = Date.now();

  const profiles = tables.map((table) => {
    try {
      return profileTable(db, table);
    } catch (error) {
      logger.warn('Could not profile table', { table: table.name, error: String(error) });
      return { table: table.name, rowCount: table.rowCount, columns: [], duplicateRows: 0 };
    }
  });

  const correlations = computeCorrelations(db, profiles);

  return {
    tables: profiles,
    correlations,
    highlights: buildHighlights(profiles, correlations),
    computedMs: Date.now() - startedAt,
  };
};
