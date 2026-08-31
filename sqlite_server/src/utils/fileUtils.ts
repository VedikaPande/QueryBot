import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import csv from 'csv-parser';
import Database from 'better-sqlite3';
import { config } from '../config';
import { logger, errorMessage } from './logger';
import { isValidUuid, sanitizeColumnName, uniquifyColumnNames } from './validation';

/** Table name used for databases converted from a flat file. */
export const CSV_TABLE_NAME = 'csv_data';

export const ensureUploadsDir = (): void => {
  if (!fs.existsSync(config.uploadDir)) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    logger.info('Created uploads directory', { path: config.uploadDir });
  }
};

/**
 * Resolve the on-disk path for a dataset.
 *
 * The identifier is validated as a UUID and the resolved path is checked to be
 * inside the uploads directory. Without both checks a caller could supply
 * `../../etc/passwd` and read files outside the intended directory.
 */
export const getDatabasePath = (uuid: string): string => {
  if (!isValidUuid(uuid)) {
    throw new Error('Invalid database identifier');
  }

  const resolved = path.resolve(config.uploadDir, `${uuid}.sqlite`);
  const root = path.resolve(config.uploadDir);

  if (resolved !== path.join(root, `${uuid}.sqlite`) || !resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid database identifier');
  }

  return resolved;
};

export const databaseExists = (uuid: string): boolean => {
  try {
    return fs.existsSync(getDatabasePath(uuid));
  } catch {
    // An invalid identifier is reported as "not found" rather than leaking that
    // it failed validation.
    return false;
  }
};

export const deleteDatabase = async (uuid: string): Promise<boolean> => {
  try {
    await fsp.unlink(getDatabasePath(uuid));
    return true;
  } catch {
    return false;
  }
};

/** Remove uploads older than the configured retention window. */
export const deleteOldFiles = async (): Promise<void> => {
  try {
    await fsp.mkdir(config.uploadDir, { recursive: true });
    const files = await fsp.readdir(config.uploadDir);
    const now = Date.now();
    let removed = 0;

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(config.uploadDir, file);
        try {
          const stats = await fsp.stat(filePath);
          if (!stats.isFile()) return;

          if (now - stats.mtime.getTime() > config.fileRetentionMs) {
            await fsp.unlink(filePath);
            removed += 1;
          }
        } catch (error) {
          logger.warn('Could not process file during cleanup', { file, error: errorMessage(error) });
        }
      })
    );

    if (removed > 0) {
      logger.info('Cleaned up expired uploads', { removed });
    }
  } catch (error) {
    logger.error('Upload cleanup failed', { error: errorMessage(error) });
  }
};

type ColumnType = 'INTEGER' | 'REAL' | 'TEXT';

/**
 * Infer a column type from sampled values.
 *
 * Storing numbers as TEXT would make SQLite compare them lexicographically, so
 * "9" would sort above "10" and every numeric aggregate would be wrong.
 */
const inferColumnType = (values: string[]): ColumnType => {
  const present = values.filter((value) => value !== '' && value != null);
  if (present.length === 0) return 'TEXT';

  let allIntegers = true;

  for (const value of present) {
    const trimmed = value.trim();
    // Number() accepts '', whitespace and hex; require an explicit decimal shape.
    if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
      return 'TEXT';
    }
    if (!/^-?\d+$/.test(trimmed)) {
      allIntegers = false;
    }
  }

  return allIntegers ? 'INTEGER' : 'REAL';
};

/** Coerce a raw CSV cell to the storage type chosen for its column. */
const coerceValue = (value: string | undefined, type: ColumnType): string | number | null => {
  if (value == null || value === '') return null;
  if (type === 'INTEGER') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (type === 'REAL') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return value;
};

const readCsvRows = (csvFilePath: string): Promise<Record<string, string>[]> =>
  new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row: Record<string, string>) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });

/** Names SQLite reserves or that would collide with its internals. */
const RESERVED_TABLE_NAMES = new Set(['sqlite_master', 'sqlite_sequence', 'sqlite_stat1']);

/**
 * Derive a table name from an uploaded file's name.
 *
 * Naming the table after the file is what makes multiple uploads legible —
 * `orders` and `customers` rather than two tables both called `csv_data`. The
 * result is sanitised for use as an identifier and made unique against the tables
 * already present.
 */
export const deriveTableName = (fileName: string, existing: string[] = []): string => {
  const stem = path.basename(fileName, path.extname(fileName));

  let base = stem
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  // A name starting with a digit, or nothing usable at all, is not a valid
  // bare identifier.
  if (!base || /^\d/.test(base)) {
    base = base ? `t_${base}` : CSV_TABLE_NAME;
  }
  if (RESERVED_TABLE_NAMES.has(base) || base.startsWith('sqlite_')) {
    base = `t_${base}`;
  }

  base = base.slice(0, 60);

  const taken = new Set(existing.map((name) => name.toLowerCase()));
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
};

/** List the user tables in an open database. */
export const listTableNames = (db: Database.Database): string[] =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((row) => row.name);

/**
 * Import a CSV file into an open database as a new table, with inferred column
 * types and sanitised column names.
 */
const importCsvIntoDatabase = async (
  db: Database.Database,
  csvFilePath: string,
  tableName: string
): Promise<number> => {
  const rows = await readCsvRows(csvFilePath);

  if (rows.length === 0) {
    throw new Error('The CSV file contains no data rows.');
  }

  const originalHeaders = Object.keys(rows[0] ?? {});
  if (originalHeaders.length === 0) {
    throw new Error('The CSV file has no columns.');
  }

  const columnNames = uniquifyColumnNames(
    originalHeaders.map((header, index) => sanitizeColumnName(header, index))
  );

  // Sample up to 1000 rows per column; scanning every row of a large file to
  // pick a type is not worth the cost.
  const sample = rows.slice(0, 1000);
  const columnTypes = originalHeaders.map((header) =>
    inferColumnType(sample.map((row) => row[header] ?? ''))
  );

  const quoted = tableName.replace(/"/g, '""');
  const columnDefs = columnNames
    .map((name, index) => `"${name}" ${columnTypes[index] ?? 'TEXT'}`)
    .join(', ');
  db.exec(`CREATE TABLE "${quoted}" (${columnDefs})`);

  const placeholders = columnNames.map(() => '?').join(', ');
  const insert = db.prepare(
    `INSERT INTO "${quoted}" (${columnNames.map((n) => `"${n}"`).join(', ')}) VALUES (${placeholders})`
  );

  const insertAll = db.transaction((batch: Record<string, string>[]) => {
    for (const row of batch) {
      insert.run(
        originalHeaders.map((header, index) =>
          coerceValue(row[header], columnTypes[index] ?? 'TEXT')
        )
      );
    }
  });

  insertAll(rows);

  logger.info('Imported CSV', { table: tableName, rows: rows.length, columns: columnNames.length });
  return rows.length;
};

/**
 * Convert a CSV file into a new single-table SQLite database.
 */
export const convertCsvToSqlite = async (
  csvFilePath: string,
  sqliteFilePath: string,
  tableName: string = CSV_TABLE_NAME
): Promise<void> => {
  // Deliberately left on the default rollback journal: these files are opened
  // read-only afterwards, and a stale -wal sidecar makes that open fail.
  const db = new Database(sqliteFilePath);
  try {
    await importCsvIntoDatabase(db, csvFilePath, tableName);
  } finally {
    db.close();
  }
};

/**
 * Add another file's data to an existing dataset as new table(s).
 *
 * Multiple files in one SQLite file is what makes cross-file questions work: the
 * agent can JOIN them directly, with no ATTACH and no changes to the read-only
 * query guard.
 */
export const appendFileToDatabase = async (
  uuid: string,
  uploadedPath: string,
  originalName: string
): Promise<string[]> => {
  const targetPath = getDatabasePath(uuid);
  const extension = path.extname(originalName).toLowerCase();

  const db = new Database(targetPath);
  try {
    const existing = listTableNames(db);
    const added: string[] = [];

    if (extension === '.csv') {
      const tableName = deriveTableName(originalName, existing);
      await importCsvIntoDatabase(db, uploadedPath, tableName);
      added.push(tableName);
    } else if (extension === '.sqlite' || extension === '.db') {
      assertValidSqliteFile(uploadedPath);

      const source = new Database(uploadedPath, { readonly: true });
      let sourceTables: string[];
      try {
        sourceTables = listTableNames(source);
      } finally {
        source.close();
      }

      if (sourceTables.length === 0) {
        throw new Error('That database contains no tables.');
      }

      // ATTACH is used here deliberately, and is safe: the path is ours, not
      // caller-supplied. It stays blocked in the query guard, where the SQL comes
      // from a model and the target could be any file on disk.
      db.exec(`ATTACH DATABASE '${uploadedPath.replace(/'/g, "''")}' AS incoming`);
      try {
        for (const sourceTable of sourceTables) {
          const tableName = deriveTableName(sourceTable, [...existing, ...added]);
          const quoted = tableName.replace(/"/g, '""');
          const sourceQuoted = sourceTable.replace(/"/g, '""');
          // CREATE ... AS SELECT copies both structure and rows in one statement.
          db.exec(`CREATE TABLE "${quoted}" AS SELECT * FROM incoming."${sourceQuoted}"`);
          added.push(tableName);
        }
      } finally {
        db.exec('DETACH DATABASE incoming');
      }
    } else {
      throw new Error('Invalid file type. Accepted formats: .csv, .sqlite, .db');
    }

    logger.info('Appended file to dataset', { uuid, tables: added });
    return added;
  } finally {
    db.close();
  }
};

/**
 * Confirm an uploaded file is a real SQLite database before accepting it.
 * The extension alone is attacker-controlled, so the header is checked and the
 * file is opened once to prove it parses.
 */
export const assertValidSqliteFile = (filePath: string): void => {
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw new Error('The uploaded file is not a valid SQLite database.');
  }

  const db = new Database(filePath, { readonly: true });
  try {
    db.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table'").get();
  } finally {
    db.close();
  }
};
