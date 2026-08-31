import { Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { BaseController } from './BaseController';
import { config } from '../config';
import { logger, errorMessage } from '../utils/logger';
import { profileDatabase } from '../utils/profiler';
import { validateReadOnlySql } from '../utils/sqlGuard';
import { isValidUuid } from '../utils/validation';
import {
  appendFileToDatabase,
  assertValidSqliteFile,
  convertCsvToSqlite,
  databaseExists,
  deleteDatabase,
  deriveTableName,
  getDatabasePath,
} from '../utils/fileUtils';
import type {
  ColumnInfo,
  QueryRequest,
  QueryResult,
  SchemaResponse,
  SqliteMasterRow,
  TableInfo,
  UploadResult,
} from '../types/sqlite';

/** Run `work` against a read-only handle, always closing it. */
const withDatabase = <T>(uuid: string, work: (db: Database.Database) => T): T => {
  const db = new Database(getDatabasePath(uuid), { readonly: true });
  try {
    return work(db);
  } finally {
    db.close();
  }
};

/** Collect table names, column metadata and row counts. */
const readTables = (db: Database.Database): TableInfo[] => {
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as SqliteMasterRow[];

  return tables.map(({ name }) => {
    // Identifiers cannot be parameterised; PRAGMA's function form accepts a
    // bound value, which avoids interpolating the name into SQL.
    const columns = db.prepare('SELECT * FROM pragma_table_info(?)').all(name) as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;

    let rowCount = 0;
    try {
      const counted = db
        .prepare(`SELECT count(*) AS count FROM "${name.replace(/"/g, '""')}"`)
        .get() as { count: number } | undefined;
      rowCount = counted?.count ?? 0;
    } catch (error) {
      logger.warn('Could not count rows', { table: name, error: errorMessage(error) });
    }

    const columnInfo: ColumnInfo[] = columns.map((column) => ({
      name: column.name,
      type: column.type || 'TEXT',
      nullable: column.notnull === 0,
      primaryKey: column.pk > 0,
    }));

    return { name, columns: columnInfo, rowCount };
  });
};

/** Render the prompt-friendly schema text the LangGraph agent consumes. */
const renderSchemaText = (db: Database.Database, tables: TableInfo[]): string => {
  const lines: string[] = [];

  for (const table of tables) {
    lines.push(`Table: ${table.name} (${table.rowCount} rows)`);
    lines.push(
      `Columns: ${table.columns
        .map((column) => `${column.name} ${column.type}${column.primaryKey ? ' PRIMARY KEY' : ''}`)
        .join(', ')}`
    );

    try {
      const sample = db
        .prepare(`SELECT * FROM "${table.name.replace(/"/g, '""')}" LIMIT 3`)
        .all() as Record<string, unknown>[];
      if (sample.length > 0) {
        lines.push('Example rows:');
        for (const row of sample) {
          lines.push(JSON.stringify(row));
        }
      }
    } catch (error) {
      logger.warn('Could not read sample rows', { table: table.name, error: errorMessage(error) });
    }

    lines.push('');
  }

  return lines.join('\n');
};

export class SqliteController extends BaseController {
  /** Accept a SQLite or CSV upload and return its identifier plus schema. */
  uploadFile = this.asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      return this.error(res, 'No file uploaded', 400);
    }

    const uploadedPath = req.file.path;
    const extension = path.extname(req.file.originalname).toLowerCase();
    const uuid = randomUUID();
    const targetPath = getDatabasePath(uuid);

    /** Remove whichever temporary artefacts remain after a failure. */
    const cleanup = async (...paths: string[]): Promise<void> => {
      await Promise.all(paths.map((p) => fsp.unlink(p).catch(() => undefined)));
    };

    try {
      if (extension === '.sqlite' || extension === '.db') {
        assertValidSqliteFile(uploadedPath);
        await fsp.rename(uploadedPath, targetPath);
      } else if (extension === '.csv') {
        // Named after the file rather than a fixed `csv_data`, so a dataset with
        // several files reads as `orders` and `customers` instead of two tables
        // that cannot both be called the same thing.
        await convertCsvToSqlite(uploadedPath, targetPath, deriveTableName(req.file.originalname));
        await cleanup(uploadedPath);
      } else {
        await cleanup(uploadedPath);
        return this.error(res, 'Invalid file type. Only .csv, .sqlite and .db files are accepted.', 400);
      }
    } catch (error) {
      await cleanup(uploadedPath, targetPath);
      logger.warn('Upload rejected', { error: errorMessage(error) });
      return this.error(res, errorMessage(error) || 'Could not process the uploaded file', 400);
    }

    try {
      const tables = withDatabase(uuid, readTables);

      if (tables.length === 0) {
        await deleteDatabase(uuid);
        return this.error(res, 'The uploaded database contains no tables.', 400);
      }

      const stats = await fsp.stat(targetPath);
      const result: UploadResult = {
        uuid,
        fileName: req.file.originalname,
        sizeBytes: stats.size,
        tables,
        expiresAt: new Date(Date.now() + config.fileRetentionMs).toISOString(),
      };

      logger.info('Dataset uploaded', { uuid, tables: tables.length, sizeBytes: stats.size });
      return this.success(res, result, 'File uploaded successfully', 201);
    } catch (error) {
      await deleteDatabase(uuid);
      logger.error('Failed to inspect uploaded database', { error: errorMessage(error) });
      return this.error(res, 'Could not read the uploaded database.', 400);
    }
  });

  /** Execute a single read-only query against an uploaded dataset. */
  executeQuery = this.asyncHandler(async (req: Request, res: Response) => {
    const { uuid, query, maxRows } = (req.body ?? {}) as QueryRequest;

    if (!isValidUuid(uuid)) {
      return this.error(res, 'A valid database identifier is required', 400);
    }
    if (typeof query !== 'string') {
      return this.error(res, 'A query string is required', 400);
    }

    const validation = validateReadOnlySql(query);
    if (!validation.ok) {
      logger.warn('Rejected unsafe query', { uuid, reason: validation.reason });
      return this.error(res, validation.reason ?? 'Query rejected', 400);
    }

    if (!databaseExists(uuid)) {
      return this.error(res, 'Database not found. It may have expired - please upload it again.', 404);
    }

    const requestedRows = typeof maxRows === 'number' && maxRows > 0 ? maxRows : config.maxQueryRows;
    const rowLimit = Math.min(requestedRows, config.maxQueryRows);
    const startedAt = Date.now();

    try {
      const result = withDatabase(uuid, (db) => {
        // better-sqlite3 is synchronous and offers no interrupt, so the deadline
        // is enforced between rows. That bounds long result sets; it cannot
        // interrupt a single row that is slow to produce.
        const deadline = Date.now() + config.queryTimeoutMs;
        const statement = db.prepare(query);
        const rows: Record<string, unknown>[] = [];
        let truncated = false;

        for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
          if (rows.length >= rowLimit) {
            truncated = true;
            break;
          }
          if (Date.now() > deadline) {
            throw new Error('Query exceeded the time limit.');
          }
          rows.push(row);
        }

        const columns = statement.columns().map((column) => column.name);

        return { rows, columns, truncated };
      });

      const payload: QueryResult = {
        columns: result.columns,
        // Positional form kept for the LangGraph agent, which indexes by position.
        results: result.rows.map((row) => result.columns.map((column) => row[column] ?? null)),
        rows: result.rows,
        rowCount: result.rows.length,
        truncated: result.truncated,
        durationMs: Date.now() - startedAt,
      };

      logger.info('Query executed', {
        uuid,
        rowCount: payload.rowCount,
        durationMs: payload.durationMs,
        truncated: payload.truncated,
      });

      return this.success(res, payload, 'Query executed successfully');
    } catch (error) {
      // SQL errors are the user's to see and fix, so the message is returned.
      logger.warn('Query failed', { uuid, error: errorMessage(error) });
      return this.error(res, errorMessage(error) || 'Query execution failed', 400);
    }
  });

  /** Return both the prompt-facing schema text and structured table metadata. */
  getSchema = this.asyncHandler(async (req: Request, res: Response) => {
    const { uuid } = req.params;

    if (!isValidUuid(uuid)) {
      return this.error(res, 'A valid database identifier is required', 400);
    }
    if (!databaseExists(uuid)) {
      return this.error(res, 'Database not found. It may have expired - please upload it again.', 404);
    }

    try {
      const payload = withDatabase(uuid, (db) => {
        const tables = readTables(db);
        const response: SchemaResponse = { schema: renderSchemaText(db, tables), tables };
        return response;
      });

      return this.success(res, payload, 'Schema retrieved successfully');
    } catch (error) {
      logger.error('Schema retrieval failed', { uuid, error: errorMessage(error) });
      return this.error(res, 'Could not read the database schema', 500);
    }
  });

  /**
   * Add another file to an existing dataset as new table(s).
   *
   * Keeping several files in one SQLite database is what makes cross-file
   * questions work: the agent can JOIN the tables directly, with no ATTACH in
   * user-facing SQL and no change to the read-only query guard.
   */
  addFile = this.asyncHandler(async (req: Request, res: Response) => {
    const { uuid } = req.params;

    if (!req.file) {
      return this.error(res, 'No file uploaded', 400);
    }

    const uploadedPath = req.file.path;
    const cleanup = () => fsp.unlink(uploadedPath).catch(() => undefined);

    if (!isValidUuid(uuid)) {
      await cleanup();
      return this.error(res, 'A valid database identifier is required', 400);
    }
    if (!databaseExists(uuid)) {
      await cleanup();
      return this.error(res, 'Database not found. It may have expired - please upload it again.', 404);
    }

    try {
      const addedTables = await appendFileToDatabase(uuid, uploadedPath, req.file.originalname);
      await cleanup();

      const tables = withDatabase(uuid, readTables);
      const stats = await fsp.stat(getDatabasePath(uuid));

      return this.success(
        res,
        {
          uuid,
          fileName: req.file.originalname,
          addedTables,
          sizeBytes: stats.size,
          tables,
        },
        `Added ${addedTables.length} table${addedTables.length === 1 ? '' : 's'}`,
        201
      );
    } catch (error) {
      await cleanup();
      logger.warn('Could not add the file to the dataset', { uuid, error: errorMessage(error) });
      return this.error(res, errorMessage(error) || 'Could not add the file', 400);
    }
  });

  /**
   * Profile a dataset: per-column statistics, distributions, outliers,
   * duplicates and correlations.
   *
   * Computed entirely in SQL, so it is fast and exact. Gives the user an
   * immediate picture of what they uploaded instead of leaving them to discover
   * the schema by trial and error.
   */
  profileDataset = this.asyncHandler(async (req: Request, res: Response) => {
    const { uuid } = req.params;

    if (!isValidUuid(uuid)) {
      return this.error(res, 'A valid database identifier is required', 400);
    }
    if (!databaseExists(uuid)) {
      return this.error(res, 'Database not found. It may have expired - please upload it again.', 404);
    }

    try {
      const payload = withDatabase(uuid, (db) => profileDatabase(db, readTables(db)));

      logger.info('Dataset profiled', {
        uuid,
        tables: payload.tables.length,
        durationMs: payload.computedMs,
      });
      return this.success(res, payload, 'Profile computed successfully');
    } catch (error) {
      logger.error('Profiling failed', { uuid, error: errorMessage(error) });
      return this.error(res, 'Could not profile the dataset', 500);
    }
  });

  /** Return the first rows of a table so users can see their data before querying. */
  previewTable = this.asyncHandler(async (req: Request, res: Response) => {
    const { uuid, table } = req.params;

    if (!isValidUuid(uuid)) {
      return this.error(res, 'A valid database identifier is required', 400);
    }
    if (!databaseExists(uuid)) {
      return this.error(res, 'Database not found. It may have expired - please upload it again.', 404);
    }
    if (!table) {
      return this.error(res, 'A table name is required', 400);
    }

    try {
      const payload = withDatabase(uuid, (db) => {
        const tables = readTables(db);
        // Only names that already exist in the database are accepted, so the
        // identifier interpolated below can never be attacker-chosen.
        const match = tables.find((candidate) => candidate.name === table);
        if (!match) return null;

        const rows = db
          .prepare(`SELECT * FROM "${match.name.replace(/"/g, '""')}" LIMIT ?`)
          .all(config.previewRowLimit) as Record<string, unknown>[];

        return {
          table: match.name,
          columns: match.columns.map((column) => column.name),
          rows,
          rowCount: match.rowCount,
          previewCount: rows.length,
        };
      });

      if (!payload) {
        return this.error(res, `Table "${table}" does not exist in this database`, 404);
      }

      return this.success(res, payload, 'Preview retrieved successfully');
    } catch (error) {
      logger.error('Preview failed', { uuid, table, error: errorMessage(error) });
      return this.error(res, 'Could not preview the table', 500);
    }
  });

  /** Delete a dataset, letting users remove their data before it expires. */
  deleteDatabase = this.asyncHandler(async (req: Request, res: Response) => {
    const { uuid } = req.params;

    if (!isValidUuid(uuid)) {
      return this.error(res, 'A valid database identifier is required', 400);
    }

    const deleted = await deleteDatabase(uuid);
    if (!deleted) {
      return this.error(res, 'Database not found', 404);
    }

    logger.info('Dataset deleted', { uuid });
    return this.success(res, { uuid }, 'Database deleted successfully');
  });

  /** Report whether a dataset is still present, used to detect expiry. */
  headDatabase = this.asyncHandler(async (req: Request, res: Response) => {
    const { uuid } = req.params;

    if (!isValidUuid(uuid) || !databaseExists(uuid)) {
      return this.error(res, 'Database not found', 404);
    }

    const stats = fs.statSync(getDatabasePath(uuid));
    return this.success(
      res,
      {
        uuid,
        sizeBytes: stats.size,
        expiresAt: new Date(stats.mtime.getTime() + config.fileRetentionMs).toISOString(),
      },
      'Database is available'
    );
  });
}
