// Type-only import: erased at build time, so it adds nothing to the bundle
// while still letting the sheet be typed before the writer is loaded.
import type { Row, SheetData } from 'write-excel-file/browser';
import type { CellValue } from '@/types/api';
import type { AnalysisResult } from '@/types/playground';

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'pdf' | 'png' | 'md';

/** Trigger a browser download for a blob or data URL. */
const download = (source: Blob | string, filename: string): void => {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  if (typeof source !== 'string') {
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

/** Build a filesystem-safe filename stem from a question. */
export const buildFileStem = (question: string, prefix = 'querybot'): string => {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const stamp = new Date().toISOString().slice(0, 10);
  return slug ? `${prefix}-${slug}-${stamp}` : `${prefix}-${stamp}`;
};

/**
 * Escape a value for CSV.
 *
 * A leading =, +, - or @ is prefixed with a quote: spreadsheet applications
 * otherwise interpret such a cell as a formula, which is a well-known injection
 * vector when the data came from an uploaded file.
 */
const toCsvCell = (value: CellValue): string => {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (columns: string[], rows: CellValue[][]): string =>
  [columns.map((c) => toCsvCell(c)).join(','), ...rows.map((row) => row.map(toCsvCell).join(','))].join('\r\n');

export const exportCsv = (columns: string[], rows: CellValue[][], filename: string): void => {
  // The BOM makes Excel read the file as UTF-8 rather than the local codepage.
  const blob = new Blob(['﻿', toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  download(blob, `${filename}.csv`);
};

export const exportJson = (payload: unknown, filename: string): void => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  download(blob, `${filename}.json`);
};

/** Export a real .xlsx workbook. */
export const exportExcel = async (
  columns: string[],
  rows: CellValue[][],
  filename: string
): Promise<void> => {
  // Loaded on demand: the writer is sizeable and most sessions never export.
  // The /browser entrypoint is required; the package root exposes no export map
  // entry and the default build targets Node.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  const header: Row = columns.map((column) => ({
    value: column,
    fontWeight: 'bold' as const,
  }));

  // Typed as Row so numbers land in numeric cells rather than as text, which is
  // what makes the exported sheet sortable and chartable in Excel.
  const body: Row[] = rows.map((row) =>
    row.map((cell): Row[number] => {
      if (cell === null || cell === undefined) {
        // An omitted value produces a genuinely blank cell rather than "null".
        return { type: String };
      }
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        return { value: cell, type: Number };
      }
      if (typeof cell === 'boolean') {
        return { value: cell, type: Boolean };
      }
      return { value: String(cell), type: String };
    })
  );

  const sheet: SheetData = [header, ...body];

  // The browser build returns a builder rather than writing the file itself, so
  // the blob goes through the same download path as every other format.
  const blob = await writeXlsxFile(sheet, { columns: columns.map(() => ({ width: 18 })) }).toBlob();
  download(blob, `${filename}.xlsx`);
};

/** Save the chart image on its own. */
export const exportChartPng = (base64: string, filename: string): void => {
  download(`data:image/png;base64,${base64}`, `${filename}.png`);
};

/**
 * Export the full analysis as a PDF: answer, chart, insights and data table.
 */
export const exportPdf = async (
  question: string,
  result: AnalysisResult,
  filename: string
): Promise<void> => {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  let cursorY = margin;

  /** Start a new page when the next block would overflow. */
  const ensureSpace = (needed: number): void => {
    if (cursorY + needed > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
  };

  const writeParagraph = (text: string, size: number, style: 'normal' | 'bold' = 'normal'): void => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    ensureSpace(lines.length * size * 1.3);
    doc.text(lines, margin, cursorY);
    cursorY += lines.length * size * 1.3 + 8;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('QueryBot Analysis', margin, cursorY);
  cursorY += 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(new Date().toLocaleString(), margin, cursorY);
  doc.setTextColor(0);
  cursorY += 24;

  writeParagraph(question, 13, 'bold');

  if (result.answer) {
    writeParagraph(result.answer, 11);
  }

  if (result.chart_image_base64) {
    try {
      const properties = doc.getImageProperties(`data:image/png;base64,${result.chart_image_base64}`);
      const height = (properties.height * contentWidth) / properties.width;
      ensureSpace(height + 16);
      doc.addImage(
        `data:image/png;base64,${result.chart_image_base64}`,
        'PNG',
        margin,
        cursorY,
        contentWidth,
        height
      );
      cursorY += height + 20;
    } catch {
      // A chart that will not decode should not abort the whole export.
      writeParagraph('[The chart could not be embedded]', 10);
    }
  }

  if (result.insights) {
    writeParagraph('Insights', 13, 'bold');
    // Strip Markdown emphasis; the PDF has no renderer for it.
    writeParagraph(result.insights.replace(/[*_`#]/g, ''), 10);
  }

  if (result.data_narrative) {
    writeParagraph('Interpretation', 13, 'bold');
    writeParagraph(result.data_narrative.replace(/[*_`#]/g, ''), 10);
  }

  if (result.sql_query) {
    writeParagraph('SQL', 13, 'bold');
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    const sqlLines = doc.splitTextToSize(result.sql_query, contentWidth) as string[];
    ensureSpace(sqlLines.length * 11);
    doc.text(sqlLines, margin, cursorY);
    cursorY += sqlLines.length * 11 + 16;
  }

  const rows = result.results ?? [];
  if (rows.length > 0) {
    const columns = result.result_columns?.length
      ? result.result_columns
      : rows[0].map((_, index) => `Column ${index + 1}`);

    ensureSpace(60);
    autoTable(doc, {
      head: [columns],
      // Cap the table: a PDF with thousands of rows is neither useful nor small.
      body: rows.slice(0, 500).map((row) => row.map((cell) => (cell === null ? '' : String(cell)))),
      startY: cursorY,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [16, 122, 96], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 248, 246] },
    });

    if (rows.length > 500) {
      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
      cursorY = (finalY ?? cursorY) + 16;
      writeParagraph(`Showing 500 of ${rows.length.toLocaleString()} rows.`, 9);
    }
  }

  doc.save(`${filename}.pdf`);
};

/** Export the analysis as a Markdown document. */
export const exportMarkdown = (question: string, result: AnalysisResult, filename: string): void => {
  const sections = [`# ${question}`, ''];

  if (result.answer) sections.push(result.answer, '');
  if (result.insights) sections.push('## Insights', '', result.insights, '');
  if (result.data_narrative) sections.push('## Interpretation', '', result.data_narrative, '');
  if (result.sql_query) sections.push('## SQL', '', '```sql', result.sql_query, '```', '');
  if (result.formatted_table) sections.push('## Data', '', result.formatted_table, '');

  sections.push('---', `_Generated by QueryBot on ${new Date().toLocaleString()}_`);

  const blob = new Blob([sections.join('\n')], { type: 'text/markdown;charset=utf-8' });
  download(blob, `${filename}.md`);
};
