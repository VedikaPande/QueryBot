import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DatasetPanel from '../DatasetPanel';
import type { Dataset } from '@/types/dataset';

const dataset = (overrides: Partial<Dataset> = {}): Dataset => ({
  id: 'd1',
  uuid: '1b0ba789-e0ea-4896-9a69-312dab650f6f',
  file_name: 'sales.csv',
  size_bytes: 8192,
  table_count: 1,
  row_count: 6,
  created_at: new Date().toISOString(),
  last_used_at: new Date().toISOString(),
  expires_at: null,
  ...overrides,
});

const noop = () => {};

const renderPanel = (overrides: Partial<Dataset> = {}) =>
  render(
    <DatasetPanel
      dataset={dataset(overrides)}
      tables={[]}
      profile={null}
      isUploading={false}
      uploadProgress={0}
      isSchemaLoading={false}
      isProfileLoading={false}
      onUpload={noop}
      onAddFile={noop}
      onRemove={noop}
      onAsk={noop}
    />
  );

describe('DatasetPanel expiry', () => {
  /** Pin the clock so the countdown is deterministic. */
  const at = (msFromNow: number): string => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    return new Date(Date.parse('2026-01-01T00:00:00Z') + msFromNow).toISOString();
  };

  it('never renders 60 minutes instead of rolling over to the next hour', () => {
    // 3h 59m 40s. Rounding the minute remainder on its own produced "3h 60m".
    vi.useFakeTimers();
    renderPanel({ expires_at: at(3 * 3_600_000 + 59 * 60_000 + 40_000) });
    vi.useRealTimers();

    expect(screen.getByText(/Expires in 4h 0m/)).toBeInTheDocument();
    expect(screen.queryByText(/60m/)).not.toBeInTheDocument();
  });

  it('shows hours and minutes', () => {
    vi.useFakeTimers();
    renderPanel({ expires_at: at(2 * 3_600_000 + 30 * 60_000) });
    vi.useRealTimers();

    expect(screen.getByText(/Expires in 2h 30m/)).toBeInTheDocument();
  });

  it('drops the hour component under an hour', () => {
    vi.useFakeTimers();
    renderPanel({ expires_at: at(12 * 60_000) });
    vi.useRealTimers();

    expect(screen.getByText(/Expires in 12m/)).toBeInTheDocument();
  });

  it('reports an elapsed window as expired', () => {
    vi.useFakeTimers();
    renderPanel({ expires_at: at(-60_000) });
    vi.useRealTimers();

    expect(screen.getByText(/Expired/)).toBeInTheDocument();
  });

  it('omits the line when no expiry is known', () => {
    renderPanel({ expires_at: null });
    expect(screen.queryByText(/Expires|Expired/)).not.toBeInTheDocument();
  });

  it('summarises the dataset', () => {
    renderPanel({ row_count: 1234, table_count: 2 });
    expect(screen.getByText(/2 tables · 1,234 rows · 8\.0 KB/)).toBeInTheDocument();
  });
});
