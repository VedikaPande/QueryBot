import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { config } from '../../config';
import {
  appendFileToDatabase,
  convertCsvToSqlite,
  deriveTableName,
  listTableNames,
} from '../fileUtils';

describe('deriveTableName', () => {
  it('names the table after the file', () => {
    expect(deriveTableName('orders.csv')).toBe('orders');
    expect(deriveTableName('Customer Data.csv')).toBe('customer_data');
    expect(deriveTableName('2026-sales-report.csv')).toBe('t_2026_sales_report');
  });

  it('strips characters that are not valid in an identifier', () => {
    for (const name of ['a"b.csv', "o'brien.csv", 'a;b.csv', 'x`y.csv']) {
      expect(deriveTableName(name)).not.toMatch(/["'`;]/);
    }
  });

  it('avoids colliding with existing tables', () => {
    expect(deriveTableName('orders.csv', ['orders'])).toBe('orders_2');
    expect(deriveTableName('orders.csv', ['orders', 'orders_2'])).toBe('orders_3');
    // Comparison is case-insensitive, as SQLite treats identifiers.
    expect(deriveTableName('Orders.csv', ['orders'])).toBe('orders_2');
  });

  it('avoids names SQLite reserves', () => {
    expect(deriveTableName('sqlite_master.csv')).toBe('t_sqlite_master');
    expect(deriveTableName('sqlite_sequence.csv')).toBe('t_sqlite_sequence');
  });

  it('falls back when nothing usable remains', () => {
    expect(deriveTableName('!!!.csv')).toBe('csv_data');
    expect(deriveTableName('')).toBe('csv_data');
  });

  it('treats a dotfile name as a stem, since it has no extension', () => {
    // path.extname('.csv') is '' by POSIX convention, so the whole name is the
    // stem and sanitises to a perfectly usable identifier.
    expect(deriveTableName('.csv')).toBe('csv');
  });

  it('bounds the length', () => {
    expect(deriveTableName(`${'a'.repeat(200)}.csv`).length).toBeLessThanOrEqual(60);
  });
});

describe('multi-file datasets', () => {
  let workDir: string;
  let uuid: string;
  let originalUploadDir: string;

  /** Write a CSV into the temporary working directory. */
  const writeCsv = (name: string, content: string): string => {
    const filePath = path.join(workDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'querybot-multifile-'));
    uuid = randomUUID();

    // getDatabasePath resolves against the configured uploads directory, so it is
    // pointed at the temporary directory for the duration of the test.
    originalUploadDir = config.uploadDir;
    (config as { uploadDir: string }).uploadDir = workDir;
  });

  afterEach(() => {
    (config as { uploadDir: string }).uploadDir = originalUploadDir;
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const seedDataset = async (): Promise<void> => {
    const orders = writeCsv(
      'orders.csv',
      'order_id,customer_id,total\n1,10,120.5\n2,11,80\n3,10,45.25\n'
    );
    await convertCsvToSqlite(orders, path.join(workDir, `${uuid}.sqlite`), 'orders');
  };

  it('starts with the table named after the first file', async () => {
    await seedDataset();

    const db = new Database(path.join(workDir, `${uuid}.sqlite`), { readonly: true });
    expect(listTableNames(db)).toEqual(['orders']);
    db.close();
  });

  it('appends a second CSV as its own table', async () => {
    await seedDataset();

    const customers = writeCsv(
      'customers.csv',
      'customer_id,name,country\n10,Ada,UK\n11,Grace,US\n'
    );
    const added = await appendFileToDatabase(uuid, customers, 'customers.csv');

    expect(added).toEqual(['customers']);

    const db = new Database(path.join(workDir, `${uuid}.sqlite`), { readonly: true });
    expect(listTableNames(db).sort()).toEqual(['customers', 'orders']);
    db.close();
  });

  it('supports a JOIN across the two files, which is the point of this feature', async () => {
    await seedDataset();
    await appendFileToDatabase(
      uuid,
      writeCsv('customers.csv', 'customer_id,name,country\n10,Ada,UK\n11,Grace,US\n'),
      'customers.csv'
    );

    const db = new Database(path.join(workDir, `${uuid}.sqlite`), { readonly: true });
    const rows = db
      .prepare(
        `SELECT c.country, SUM(o.total) AS revenue
         FROM orders o JOIN customers c ON o.customer_id = c.customer_id
         GROUP BY c.country ORDER BY revenue DESC`
      )
      .all() as { country: string; revenue: number }[];
    db.close();

    // Ada (UK): 120.5 + 45.25 = 165.75. Grace (US): 80.
    expect(rows).toEqual([
      { country: 'UK', revenue: 165.75 },
      { country: 'US', revenue: 80 },
    ]);
  });

  it('disambiguates a second file with the same name', async () => {
    await seedDataset();

    const added = await appendFileToDatabase(
      uuid,
      writeCsv('orders-again.csv', 'order_id,total\n9,1\n'),
      'orders.csv'
    );

    expect(added).toEqual(['orders_2']);
  });

  it('imports every table when appending a SQLite file', async () => {
    await seedDataset();

    const sourcePath = path.join(workDir, 'extra.sqlite');
    const source = new Database(sourcePath);
    source.exec('CREATE TABLE regions (id INTEGER, name TEXT)');
    source.exec('CREATE TABLE targets (region_id INTEGER, goal REAL)');
    source.prepare('INSERT INTO regions VALUES (?, ?)').run(1, 'EMEA');
    source.prepare('INSERT INTO targets VALUES (?, ?)').run(1, 500.0);
    source.close();

    const added = await appendFileToDatabase(uuid, sourcePath, 'extra.sqlite');
    expect(added.sort()).toEqual(['regions', 'targets']);

    const db = new Database(path.join(workDir, `${uuid}.sqlite`), { readonly: true });
    // Rows are copied, not just the structure.
    expect((db.prepare('SELECT name FROM regions').get() as { name: string }).name).toBe('EMEA');
    expect(listTableNames(db).sort()).toEqual(['orders', 'regions', 'targets']);
    db.close();
  });

  it('rejects an unsupported file type', async () => {
    await seedDataset();

    await expect(
      appendFileToDatabase(uuid, writeCsv('notes.txt', 'hello'), 'notes.txt')
    ).rejects.toThrow(/Invalid file type/);
  });

  it('rejects a file that is not really a SQLite database', async () => {
    await seedDataset();

    await expect(
      appendFileToDatabase(uuid, writeCsv('fake.sqlite', 'not a database'), 'fake.sqlite')
    ).rejects.toThrow(/not a valid SQLite database/);
  });

  it('rejects an empty CSV', async () => {
    await seedDataset();

    await expect(
      appendFileToDatabase(uuid, writeCsv('empty.csv', 'a,b\n'), 'empty.csv')
    ).rejects.toThrow(/no data rows/);
  });

  it('leaves the dataset usable after a failed append', async () => {
    await seedDataset();

    await expect(
      appendFileToDatabase(uuid, writeCsv('bad.csv', 'a,b\n'), 'bad.csv')
    ).rejects.toThrow();

    // A rejected file must not corrupt what was already there.
    const db = new Database(path.join(workDir, `${uuid}.sqlite`), { readonly: true });
    expect(listTableNames(db)).toEqual(['orders']);
    expect((db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(3);
    db.close();
  });
});
