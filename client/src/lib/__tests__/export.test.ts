import { describe, expect, it } from 'vitest';
import { buildFileStem, toCsv } from '../export';

describe('toCsv', () => {
  it('writes a header row followed by the data', () => {
    const csv = toCsv(['city', 'total'], [['Naypyitaw', 110569], ['Yangon', 106200]]);
    expect(csv.split('\r\n')).toEqual(['city,total', 'Naypyitaw,110569', 'Yangon,106200']);
  });

  it('quotes values containing a comma, quote or newline', () => {
    const csv = toCsv(['note'], [['a,b'], ['say "hi"'], ['line1\nline2']]);
    expect(csv).toContain('"a,b"');
    // A literal double quote is escaped by doubling it.
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it('renders null and undefined as an empty field', () => {
    expect(toCsv(['a', 'b'], [[null, undefined as never]])).toBe('a,b\r\n,');
  });

  describe('formula injection', () => {
    // A cell beginning with one of these is executed as a formula when the file
    // is opened in Excel or Sheets. The data comes from user uploads, so it is
    // untrusted.
    it.each(['=1+1', '+1', '-1', '@SUM(A1)', '=cmd|\' /c calc\'!A1'])(
      'neutralises %s by prefixing a quote',
      (payload) => {
        const csv = toCsv(['x'], [[payload]]);
        const cell = csv.split('\r\n')[1];
        expect(cell.startsWith("'") || cell.startsWith('"\'')).toBe(true);
      }
    );

    it('leaves ordinary values untouched', () => {
      expect(toCsv(['x'], [['normal']])).toBe('x\r\nnormal');
      expect(toCsv(['x'], [[42]])).toBe('x\r\n42');
    });

    it('also neutralises a dangerous header', () => {
      expect(toCsv(['=EVIL()'], [['a']])).toContain("'=EVIL()");
    });
  });
});

describe('buildFileStem', () => {
  it('slugifies the question and appends the date', () => {
    const stem = buildFileStem('What is the Total Revenue?');
    expect(stem).toMatch(/^querybot-what-is-the-total-revenue-\d{4}-\d{2}-\d{2}$/);
  });

  it('produces a filesystem-safe name from awkward input', () => {
    const stem = buildFileStem('a/b\\c:d*e?f"g<h>i|j');
    // No character that any common filesystem would reject.
    expect(stem).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('caps the slug so the filename stays a sane length', () => {
    const stem = buildFileStem('word '.repeat(100));
    expect(stem.length).toBeLessThan(80);
  });

  it('still produces a usable name when the question is empty', () => {
    expect(buildFileStem('')).toMatch(/^querybot-\d{4}-\d{2}-\d{2}$/);
    expect(buildFileStem('!!!')).toMatch(/^querybot-\d{4}-\d{2}-\d{2}$/);
  });
});
