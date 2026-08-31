import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { profileDatabase } from '../profiler';
import type { DatasetProfile, TableInfo } from '../../types/sqlite';

/** Quote an identifier for use in test DDL. */
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/**
 * Profiling runs against a real in-memory database rather than mocks: the whole
 * point is that the numbers are exact, so the SQL has to actually execute.
 */
describe('profileDatabase', () => {
  let db: Database.Database;
  let profile: DatasetProfile;

  const tables: TableInfo[] = [
    {
      name: 'sales',
      rowCount: 24,
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'city', type: 'TEXT', nullable: true, primaryKey: false },
        { name: 'revenue', type: 'REAL', nullable: true, primaryKey: false },
        { name: 'units', type: 'INTEGER', nullable: true, primaryKey: false },
        { name: 'region', type: 'TEXT', nullable: true, primaryKey: false },
        { name: 'sold_on', type: 'TEXT', nullable: true, primaryKey: false },
      ],
    },
  ];

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE sales (
      id INTEGER, city TEXT, revenue REAL, units INTEGER, region TEXT, sold_on TEXT
    )`);

    const insert = db.prepare('INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?)');

    // 20 ordinary rows where revenue tracks units, so a correlation exists.
    for (let i = 1; i <= 20; i += 1) {
      insert.run(
        i,
        ['Yangon', 'Mandalay', 'Naypyitaw'][i % 3],
        i * 10,
        i * 2,
        'APAC',
        `2026-0${(i % 9) + 1}-15`
      );
    }

    // Three rows with a missing city, to exercise the null reporting.
    for (let i = 21; i <= 23; i += 1) {
      insert.run(i, null, i * 10, i * 2, 'APAC', '2026-01-01');
    }

    // One extreme revenue value, to exercise outlier and skew detection.
    insert.run(24, 'Yangon', 5_000_000, 4, 'APAC', '2026-01-02');

    profile = profileDatabase(db, tables);
  });

  afterAll(() => db.close());

  const column = (name: string) =>
    profile.tables[0]!.columns.find((c) => c.name === name)!;

  it('profiles every column of every table', () => {
    expect(profile.tables).toHaveLength(1);
    expect(profile.tables[0]!.columns).toHaveLength(6);
    expect(profile.computedMs).toBeGreaterThanOrEqual(0);
  });

  it('counts missing values and reports them as a percentage', () => {
    const city = column('city');
    expect(city.nullCount).toBe(3);
    expect(city.nullPercent).toBeCloseTo((3 / 24) * 100, 1);
  });

  it('identifies a column that behaves like an identifier', () => {
    // Grouping by this would produce one row each, so it is worth flagging.
    expect(column('id').isUnique).toBe(true);
    expect(column('city').isUnique).toBe(false);
  });

  it('classifies column kinds from the values, not just the declared type', () => {
    expect(column('revenue').kind).toBe('numeric');
    expect(column('city').kind).toBe('text');
    // Declared TEXT, but the values are dates.
    expect(column('sold_on').kind).toBe('temporal');
  });

  it('computes numeric statistics', () => {
    const revenue = column('revenue');
    expect(revenue.min).toBe(10);
    expect(revenue.max).toBe(5_000_000);
    expect(revenue.median).toBeGreaterThan(0);
    expect(revenue.stdev).toBeGreaterThan(0);
  });

  it('detects the extreme value', () => {
    expect(column('revenue').outlierCount).toBeGreaterThanOrEqual(1);
  });

  it('builds a histogram for numeric columns', () => {
    const histogram = column('units').histogram;
    expect(histogram).toBeDefined();
    expect(histogram!.length).toBeGreaterThan(0);
    // Every row is accounted for in exactly one bucket.
    expect(histogram!.reduce((sum, b) => sum + b.count, 0)).toBe(24);
  });

  it('lists top values only for low-cardinality columns', () => {
    const city = column('city');
    expect(city.topValues).toBeDefined();
    expect(city.topValues!.length).toBeGreaterThan(0);
    expect(city.topValues![0]!.count).toBeGreaterThanOrEqual(city.topValues!.at(-1)!.count);

    // Numeric columns get a histogram instead; a value list would be noise.
    expect(column('revenue').topValues).toBeUndefined();
  });

  it('excludes identifier columns from correlations', () => {
    // An id correlating with anything is an artefact of insertion order.
    expect(profile.correlations.some((c) => c.a === 'id' || c.b === 'id')).toBe(false);
  });

  describe('identifier detection', () => {
    /**
     * Distinctness alone is the wrong test. A revenue or temperature column in a
     * small dataset is usually entirely distinct, and classifying that as an
     * identifier silently excluded exactly the columns worth correlating.
     */
    const profileOne = (
      name: string,
      type: string,
      values: number[],
      primaryKey = false
    ) => {
      const oneDb = new Database(':memory:');
      oneDb.exec(`CREATE TABLE t (${quoteIdent(name)} ${type})`);
      const insert = oneDb.prepare(`INSERT INTO t VALUES (?)`);
      for (const v of values) insert.run(v);

      const result = profileDatabase(oneDb, [
        {
          name: 't',
          rowCount: values.length,
          columns: [{ name, type, nullable: true, primaryKey }],
        },
      ]);
      oneDb.close();
      return result.tables[0]!.columns[0]!;
    };

    const sequential = Array.from({ length: 20 }, (_, i) => i + 1);
    const distinctMeasures = Array.from({ length: 20 }, (_, i) => (i + 1) * 1.5);

    it('treats a declared primary key as an identifier', () => {
      expect(profileOne('anything', 'INTEGER', sequential, true).isIdentifier).toBe(true);
    });

    it('treats a unique integer named like an id as an identifier', () => {
      for (const name of ['id', 'user_id', 'order_no', 'row_number', 'product_code']) {
        expect(profileOne(name, 'INTEGER', sequential).isIdentifier).toBe(true);
      }
    });

    it('does not treat an all-distinct measure as an identifier', () => {
      // The bug this guards: revenue was excluded from correlation because every
      // value happened to be distinct.
      for (const name of ['revenue', 'price', 'temperature', 'total']) {
        const column = profileOne(name, 'REAL', distinctMeasures);
        expect(column.isUnique).toBe(true);
        expect(column.isIdentifier).toBe(false);
      }
    });

    it('does not treat a repeating integer as an identifier even when id-named', () => {
      // A foreign key with repeats is a grouping column, not a row identifier.
      const repeating = Array.from({ length: 20 }, (_, i) => i % 4);
      expect(profileOne('category_id', 'INTEGER', repeating).isIdentifier).toBe(false);
    });
  });

  describe('correlations', () => {
    /** Build a two-column table and profile it. */
    const profilePairs = (rows: [number, number][]): DatasetProfile => {
      const pairDb = new Database(':memory:');
      pairDb.exec('CREATE TABLE t (x REAL, y REAL)');
      const insert = pairDb.prepare('INSERT INTO t VALUES (?, ?)');
      for (const [x, y] of rows) insert.run(x, y);

      const result = profileDatabase(pairDb, [
        {
          name: 't',
          rowCount: rows.length,
          columns: [
            { name: 'x', type: 'REAL', nullable: true, primaryKey: false },
            { name: 'y', type: 'REAL', nullable: true, primaryKey: false },
          ],
        },
      ]);
      pairDb.close();
      return result;
    };

    it('finds a strong positive relationship', () => {
      const rows = Array.from({ length: 20 }, (_, i): [number, number] => [i, i * 5]);
      const result = profilePairs(rows);

      expect(result.correlations).toHaveLength(1);
      expect(result.correlations[0]!.coefficient).toBeCloseTo(1, 1);
      expect(result.highlights.some((h) => h.includes('move together'))).toBe(true);
    });

    it('finds a strong inverse relationship and describes it as such', () => {
      const rows = Array.from({ length: 20 }, (_, i): [number, number] => [i, 100 - i * 5]);
      const result = profilePairs(rows);

      expect(result.correlations[0]!.coefficient).toBeCloseTo(-1, 1);
      expect(result.highlights.some((h) => h.includes('inversely'))).toBe(true);
    });

    it('reports nothing for unrelated columns', () => {
      // Alternating y against a rising x leaves no linear relationship.
      const rows = Array.from({ length: 20 }, (_, i): [number, number] => [i, i % 2]);
      expect(profilePairs(rows).correlations).toEqual([]);
    });

    it('ignores a pair with too few rows to mean anything', () => {
      expect(profilePairs([[1, 1], [2, 2], [3, 3]]).correlations).toEqual([]);
    });

    it('is deliberately not robust to a dominant outlier', () => {
      /**
       * Pearson's r is defined on raw values, so one extreme point can mask an
       * otherwise perfect relationship. The consequence is a false negative — a
       * real relationship goes unreported — never a false claim, which is the
       * safe direction for something shown to users as a finding.
       *
       * Pinned so a future reader does not "fix" the missing correlation by
       * loosening the reporting threshold, which would produce spurious claims.
       */
      const rows: [number, number][] = Array.from({ length: 20 }, (_, i) => [i, i * 5]);
      rows.push([4, 5_000_000]);

      expect(profilePairs(rows).correlations).toEqual([]);
    });
  });

  it('surfaces a constant column as useless for grouping', () => {
    expect(profile.highlights.some((h) => h.includes('region') && h.includes('one value'))).toBe(true);
  });

  it('warns that a skewed column is better summarised by its median', () => {
    expect(profile.highlights.some((h) => h.includes('skewed'))).toBe(true);
  });

  it('produces readable highlights, capped in number', () => {
    expect(profile.highlights.length).toBeGreaterThan(0);
    expect(profile.highlights.length).toBeLessThanOrEqual(6);
    for (const highlight of profile.highlights) {
      expect(highlight.length).toBeGreaterThan(10);
      expect(highlight.endsWith('.') || highlight.endsWith(')')).toBe(true);
    }
  });

  describe('duplicate detection', () => {
    it('counts exact duplicate rows', () => {
      const dupDb = new Database(':memory:');
      dupDb.exec('CREATE TABLE t (a TEXT, b INTEGER)');
      const insert = dupDb.prepare('INSERT INTO t VALUES (?, ?)');
      insert.run('x', 1);
      insert.run('x', 1);
      insert.run('x', 1);
      insert.run('y', 2);

      const result = profileDatabase(dupDb, [
        {
          name: 't',
          rowCount: 4,
          columns: [
            { name: 'a', type: 'TEXT', nullable: true, primaryKey: false },
            { name: 'b', type: 'INTEGER', nullable: true, primaryKey: false },
          ],
        },
      ]);
      dupDb.close();

      // Three identical rows means two are redundant.
      expect(result.tables[0]!.duplicateRows).toBe(2);
      expect(result.highlights.some((h) => h.includes('duplicate'))).toBe(true);
    });
  });

  describe('awkward inputs', () => {
    it('survives an empty table', () => {
      const emptyDb = new Database(':memory:');
      emptyDb.exec('CREATE TABLE t (a TEXT)');

      const result = profileDatabase(emptyDb, [
        { name: 't', rowCount: 0, columns: [{ name: 'a', type: 'TEXT', nullable: true, primaryKey: false }] },
      ]);
      emptyDb.close();

      expect(result.tables[0]!.columns[0]!.nullPercent).toBe(0);
      expect(result.correlations).toEqual([]);
    });

    it('handles identifiers containing quotes and spaces', () => {
      // Column names are interpolated into SQL, so this must not break.
      const oddDb = new Database(':memory:');
      oddDb.exec('CREATE TABLE "my table" ("a ""quoted"" col" TEXT, "with space" REAL)');
      oddDb.prepare('INSERT INTO "my table" VALUES (?, ?)').run('v', 1.5);

      const result = profileDatabase(oddDb, [
        {
          name: 'my table',
          rowCount: 1,
          columns: [
            { name: 'a "quoted" col', type: 'TEXT', nullable: true, primaryKey: false },
            { name: 'with space', type: 'REAL', nullable: true, primaryKey: false },
          ],
        },
      ]);
      oddDb.close();

      expect(result.tables[0]!.columns).toHaveLength(2);
    });

    it('handles a column where every value is identical', () => {
      const flatDb = new Database(':memory:');
      flatDb.exec('CREATE TABLE t (n REAL)');
      const insert = flatDb.prepare('INSERT INTO t VALUES (?)');
      for (let i = 0; i < 10; i += 1) insert.run(42);

      const result = profileDatabase(flatDb, [
        { name: 't', rowCount: 10, columns: [{ name: 'n', type: 'REAL', nullable: true, primaryKey: false }] },
      ]);
      flatDb.close();

      const n = result.tables[0]!.columns[0]!;
      expect(n.min).toBe(42);
      expect(n.max).toBe(42);
      expect(n.stdev).toBe(0);
      // No spread means no meaningful histogram.
      expect(n.histogram).toBeUndefined();
    });
  });
});
