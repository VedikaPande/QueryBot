import { useState } from 'react';
import { Download, FileCode, FileJson, FileSpreadsheet, FileText, Image, Loader2, Table } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  buildFileStem,
  exportChartPng,
  exportCsv,
  exportExcel,
  exportJson,
  exportMarkdown,
  exportPdf,
} from '@/lib/export';
import type { AnalysisResult } from '@/types/playground';

interface ExportMenuProps {
  question: string;
  result: AnalysisResult | null;
}

/** Export the current analysis in any supported format. */
const ExportMenu = ({ question, result }: ExportMenuProps) => {
  const [isBusy, setIsBusy] = useState(false);

  const rows = result?.results ?? [];
  const columns = result?.result_columns?.length
    ? result.result_columns
    : rows[0]?.map((_, index) => `Column ${index + 1}`) ?? [];

  const hasRows = rows.length > 0;
  const hasChart = Boolean(result?.chart_image_base64);
  const hasAnything = Boolean(result && (hasRows || hasChart || result.answer));

  /** Run an export, surfacing failures rather than leaving the menu silent. */
  const run = async (label: string, task: () => void | Promise<void>) => {
    setIsBusy(true);
    try {
      await task();
      toast.success(`Exported as ${label}`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error(`Could not export as ${label}`);
    } finally {
      setIsBusy(false);
    }
  };

  const stem = buildFileStem(question);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!hasAnything || isBusy}>
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Data</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!hasRows}
          onSelect={() => run('CSV', () => exportCsv(columns, rows, stem))}
        >
          <Table className="h-4 w-4" />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasRows}
          onSelect={() => run('Excel', () => exportExcel(columns, rows, stem))}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasRows}
          onSelect={() =>
            run('JSON', () =>
              exportJson(
                { question, columns, rows, generatedAt: new Date().toISOString() },
                stem
              )
            )
          }
        >
          <FileJson className="h-4 w-4" />
          JSON
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Report</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!result}
          onSelect={() => run('PDF', () => exportPdf(question, result!, stem))}
        >
          <FileText className="h-4 w-4" />
          PDF report
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!result}
          onSelect={() => run('Markdown', () => exportMarkdown(question, result!, stem))}
        >
          <FileCode className="h-4 w-4" />
          Markdown
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasChart}
          onSelect={() => run('PNG', () => exportChartPng(result!.chart_image_base64!, stem))}
        >
          <Image className="h-4 w-4" />
          Chart image
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ExportMenu;
