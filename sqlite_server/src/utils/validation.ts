/**
 * A canonical RFC 4122 UUID. Dataset identifiers are interpolated into
 * filesystem paths, so anything that is not exactly this shape is rejected
 * before it can reach the disk.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

/**
 * Column names are embedded into DDL, which no driver can parameterise.
 * Rather than trying to escape them, we reduce them to a conservative
 * character set and guarantee uniqueness and non-emptiness.
 */
export const sanitizeColumnName = (name: string, index: number): string => {
  const cleaned = name
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  // A purely symbolic header, or one starting with a digit, would produce
  // invalid SQL - fall back to a positional name.
  if (!cleaned || /^\d/.test(cleaned)) {
    return `column_${index + 1}`;
  }
  return cleaned;
};

/** Ensure sanitisation collisions do not produce duplicate column names. */
export const uniquifyColumnNames = (names: string[]): string[] => {
  const seen = new Map<string, number>();

  return names.map((name) => {
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
};
