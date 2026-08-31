import { describe, expect, it } from 'vitest';
import { isValidUuid, sanitizeColumnName, uniquifyColumnNames } from '../validation';

describe('isValidUuid', () => {
  it('accepts canonical UUIDs', () => {
    expect(isValidUuid('921c838c-541d-4361-8c96-70cb23abd9f5')).toBe(true);
    expect(isValidUuid('F47AC10B-58CC-4372-A567-0E02B2C3D479')).toBe(true);
  });

  it('rejects path traversal attempts', () => {
    // These are the strings that previously reached path.join unchecked.
    expect(isValidUuid('../../etc/passwd')).toBe(false);
    expect(isValidUuid('..\\..\\windows\\system32\\config')).toBe(false);
    expect(isValidUuid('921c838c-541d-4361-8c96-70cb23abd9f5/../../secret')).toBe(false);
    expect(isValidUuid('../921c838c-541d-4361-8c96-70cb23abd9f5')).toBe(false);
  });

  it('rejects malformed values', () => {
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('921c838c541d43618c9670cb23abd9f5')).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(42)).toBe(false);
    expect(isValidUuid({ toString: () => '921c838c-541d-4361-8c96-70cb23abd9f5' })).toBe(false);
  });
});

describe('sanitizeColumnName', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeColumnName('revenue', 0)).toBe('revenue');
    expect(sanitizeColumnName('unit_price', 0)).toBe('unit_price');
  });

  it('normalises spaces and strips punctuation', () => {
    expect(sanitizeColumnName('product name', 0)).toBe('product_name');
    expect(sanitizeColumnName('  gross income (%)  ', 0)).toBe('gross_income');
    // Hyphens are kept: they are common in real CSV headers and harmless
    // because identifiers are always emitted quoted.
    expect(sanitizeColumnName('year-over-year', 0)).toBe('year-over-year');
  });

  it('removes the characters that could break out of an identifier', () => {
    // Column names are interpolated into DDL, which no driver can parameterise,
    // so quotes, semicolons and backticks must not survive.
    for (const header of ['a"; DROP TABLE t; --', "x' OR 1=1 --", 'a`b`c', 'a;b']) {
      const sanitized = sanitizeColumnName(header, 0);
      expect(sanitized).not.toMatch(/["'`;]/);
    }
  });

  it('falls back to a positional name when nothing usable remains', () => {
    expect(sanitizeColumnName('', 0)).toBe('column_1');
    expect(sanitizeColumnName('!!!', 3)).toBe('column_4');
    // A leading digit is not a valid bare identifier.
    expect(sanitizeColumnName('2024', 1)).toBe('column_2');
  });
});

describe('uniquifyColumnNames', () => {
  it('leaves distinct names untouched', () => {
    expect(uniquifyColumnNames(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('disambiguates collisions produced by sanitisation', () => {
    // "product name" and "product-name" both sanitise to product_name.
    expect(uniquifyColumnNames(['product_name', 'product_name', 'product_name'])).toEqual([
      'product_name',
      'product_name_2',
      'product_name_3',
    ]);
  });

  it('treats collisions case-insensitively, as SQLite does', () => {
    expect(uniquifyColumnNames(['Total', 'total'])).toEqual(['Total', 'total_2']);
  });
});
