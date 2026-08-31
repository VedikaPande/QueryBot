/**
 * Read-only SQL enforcement.
 *
 * The database is opened read-only, which already blocks writes at the driver
 * level. This guard closes the remaining gaps: statements that read outside the
 * intended file (ATTACH), that load native code (load_extension), or that leak
 * server internals (PRAGMA). It is deliberately an allow-list on the leading
 * keyword rather than a deny-list of dangerous ones.
 */

export interface SqlValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Remove comments and string literals so keyword matching cannot be defeated by
 * hiding a keyword inside a quoted value, nor produce false positives from a
 * literal that merely contains one.
 */
const stripCommentsAndLiterals = (sql: string): string => {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }

    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    const char = sql[i];

    // Quoted regions: single-quoted literals, and double/backtick/bracket
    // identifiers. Replaced by a placeholder so token boundaries survive.
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const closing = char === '[' ? ']' : char;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === closing) {
          // A doubled quote is an escaped quote, not a terminator.
          if (sql[i + 1] === closing) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += ' x ';
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
};

/** Statements that may appear as the leading keyword of a read-only query. */
const ALLOWED_LEADING_KEYWORDS = ['select', 'with'];

/**
 * Keywords that must not appear anywhere, even in a subquery. `pragma` is
 * included because several pragmas disclose file paths, and `attach` because it
 * would let a query read any SQLite file the process can open.
 */
const FORBIDDEN_KEYWORDS = [
  'attach',
  'detach',
  'pragma',
  'vacuum',
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'replace',
  'truncate',
  'reindex',
  'load_extension',
];

export const validateReadOnlySql = (rawSql: string): SqlValidationResult => {
  if (typeof rawSql !== 'string' || rawSql.trim().length === 0) {
    return { ok: false, reason: 'Query must be a non-empty string.' };
  }

  if (rawSql.length > 20_000) {
    return { ok: false, reason: 'Query exceeds the maximum supported length.' };
  }

  const normalized = stripCommentsAndLiterals(rawSql).toLowerCase();
  const trimmed = normalized.trim().replace(/;+\s*$/, '');

  if (trimmed.includes(';')) {
    return { ok: false, reason: 'Only a single statement may be executed per request.' };
  }

  const leadingKeyword = trimmed.match(/^[a-z]+/)?.[0] ?? '';
  if (!ALLOWED_LEADING_KEYWORDS.includes(leadingKeyword)) {
    return { ok: false, reason: 'Only SELECT and WITH queries are permitted.' };
  }

  const forbidden = FORBIDDEN_KEYWORDS.find((keyword) =>
    new RegExp(`\\b${keyword}\\b`).test(trimmed)
  );
  if (forbidden) {
    return { ok: false, reason: `The "${forbidden.toUpperCase()}" keyword is not permitted.` };
  }

  return { ok: true };
};
