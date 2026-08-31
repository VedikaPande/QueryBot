import { describe, expect, it } from 'vitest';
import { validateReadOnlySql } from '../sqlGuard';

describe('validateReadOnlySql', () => {
  const accepts = (sql: string) => expect(validateReadOnlySql(sql).ok).toBe(true);
  const rejects = (sql: string) => expect(validateReadOnlySql(sql).ok).toBe(false);

  it('accepts ordinary read-only queries', () => {
    accepts('SELECT * FROM sales');
    accepts('  select name, count(*) from users group by name  ');
    accepts('WITH totals AS (SELECT 1 AS n) SELECT * FROM totals');
    accepts('SELECT * FROM sales;');
    accepts('SELECT `product name` FROM `sales sheet` WHERE city != \'N/A\'');
  });

  it('rejects anything that writes', () => {
    rejects('INSERT INTO users VALUES (1)');
    rejects('UPDATE users SET name = \'x\'');
    rejects('DELETE FROM users');
    rejects('DROP TABLE users');
    rejects('ALTER TABLE users ADD COLUMN x TEXT');
    rejects('CREATE TABLE t (a INT)');
  });

  it('rejects statements that reach outside the database', () => {
    // ATTACH would let a query read any SQLite file the process can open.
    rejects("ATTACH DATABASE '/etc/secrets.sqlite' AS leak");
    rejects('PRAGMA database_list');
    rejects("SELECT load_extension('evil.so')");
    rejects('VACUUM');
  });

  it('rejects a write hidden in a subquery', () => {
    rejects('SELECT * FROM (SELECT 1) WHERE 1 = (DELETE FROM users)');
    rejects("SELECT * FROM t WHERE x IN (ATTACH DATABASE 'x' AS y)");
  });

  it('rejects stacked statements', () => {
    rejects('SELECT 1; DROP TABLE users');
    rejects('SELECT 1; SELECT 2');
  });

  it('does not treat a keyword inside a string literal as a statement', () => {
    // The word "delete" here is data, not SQL, and must not trip the guard.
    accepts("SELECT * FROM logs WHERE action = 'delete'");
    accepts("SELECT * FROM t WHERE note = 'drop table users'");
    accepts("SELECT 'O''Reilly; DROP TABLE users' AS quoted");
  });

  it('ignores keywords inside comments', () => {
    accepts('SELECT 1 -- DROP TABLE users');
    accepts('SELECT 1 /* DELETE FROM users */');
    // A comment must not be able to hide a second statement either.
    rejects('SELECT 1 /* comment */ ; DROP TABLE users');
  });

  it('rejects empty and oversized input', () => {
    rejects('');
    rejects('   ');
    rejects(`SELECT '${'x'.repeat(20_001)}'`);
  });
});
