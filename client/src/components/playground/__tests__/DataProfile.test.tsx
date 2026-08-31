import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataProfile from '../DataProfile';
import type { ColumnProfile, DatasetProfile } from '@/types/dataset';

const column = (overrides: Partial<ColumnProfile> = {}): ColumnProfile => ({
  name: 'revenue',
  type: 'REAL',
  kind: 'numeric',
  nullCount: 0,
  nullPercent: 0,
  distinctCount: 20,
  isUnique: false,
  isIdentifier: false,
  ...overrides,
});

const profile = (overrides: Partial<DatasetProfile> = {}): DatasetProfile => ({
  tables: [{ table: 'csv_data', rowCount: 100, columns: [column()], duplicateRows: 0 }],
  correlations: [],
  highlights: [],
  computedMs: 12,
  ...overrides,
});

describe('DataProfile', () => {
  it('shows a loading placeholder', () => {
    const { container } = render(<DataProfile profile={null} isLoading onAsk={vi.fn()} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('renders nothing when there is no profile', () => {
    const { container } = render(
      <DataProfile profile={null} isLoading={false} onAsk={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the columns with their statistics', () => {
    render(
      <DataProfile
        profile={profile({
          tables: [
            {
              table: 'csv_data',
              rowCount: 100,
              duplicateRows: 0,
              columns: [column({ min: 10, max: 5000, mean: 250 })],
            },
          ],
        })}
        isLoading={false}
        onAsk={vi.fn()}
      />
    );

    expect(screen.getByText('revenue')).toBeInTheDocument();
    expect(screen.getByText(/10 – 5K/)).toBeInTheDocument();
    expect(screen.getByText(/100 rows/)).toBeInTheDocument();
  });

  it('flags a column with substantial missing data', () => {
    render(
      <DataProfile
        profile={profile({
          tables: [
            {
              table: 'csv_data',
              rowCount: 100,
              duplicateRows: 0,
              columns: [column({ nullCount: 34, nullPercent: 34 })],
            },
          ],
        })}
        isLoading={false}
        onAsk={vi.fn()}
      />
    );

    expect(screen.getByText('34% empty')).toBeInTheDocument();
  });

  it('does not flag a small proportion of missing data as noise', () => {
    render(
      <DataProfile
        profile={profile({
          tables: [
            {
              table: 'csv_data',
              rowCount: 100,
              duplicateRows: 0,
              columns: [column({ nullCount: 2, nullPercent: 2 })],
            },
          ],
        })}
        isLoading={false}
        onAsk={vi.fn()}
      />
    );

    expect(screen.queryByText(/% empty/)).not.toBeInTheDocument();
  });

  it('shows highlights so findings are visible without asking', () => {
    render(
      <DataProfile
        profile={profile({ highlights: ['"region" holds one value throughout.'] })}
        isLoading={false}
        onAsk={vi.fn()}
      />
    );

    expect(screen.getByText(/holds one value throughout/)).toBeInTheDocument();
    expect(screen.getByText(/what stands out/i)).toBeInTheDocument();
  });

  it('turns a correlation into a question when clicked', async () => {
    const onAsk = vi.fn();
    render(
      <DataProfile
        profile={profile({
          correlations: [{ table: 'csv_data', a: 'units', b: 'revenue', coefficient: 0.94 }],
        })}
        isLoading={false}
        onAsk={onAsk}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /units ↔ revenue/ }));

    // The observation becomes the next question, which is the point of showing it.
    expect(onAsk).toHaveBeenCalledWith(
      'What is the relationship between units and revenue?'
    );
  });

  it('renders a histogram covering every bucket', () => {
    render(
      <DataProfile
        profile={profile({
          tables: [
            {
              table: 'csv_data',
              rowCount: 3,
              duplicateRows: 0,
              columns: [
                column({
                  histogram: [
                    { start: 0, end: 10, count: 2 },
                    { start: 10, end: 20, count: 0 },
                    { start: 20, end: 30, count: 1 },
                  ],
                }),
              ],
            },
          ],
        })}
        isLoading={false}
        onAsk={vi.fn()}
      />
    );

    const chart = screen.getByRole('img', { name: /value distribution/i });
    // An empty bucket renders zero-height so gaps read as genuinely empty.
    expect(chart.querySelectorAll('rect')).toHaveLength(3);
  });

  it('reports duplicate rows', () => {
    render(
      <DataProfile
        profile={profile({
          tables: [{ table: 'csv_data', rowCount: 100, duplicateRows: 7, columns: [column()] }],
        })}
        isLoading={false}
        onAsk={vi.fn()}
      />
    );

    expect(screen.getByText(/7 dup/)).toBeInTheDocument();
  });

  it('marks identifier columns', () => {
    render(
      <DataProfile
        profile={profile({
          tables: [
            {
              table: 'csv_data',
              rowCount: 100,
              duplicateRows: 0,
              columns: [column({ name: 'id', isIdentifier: true, isUnique: true })],
            },
          ],
        })}
        isLoading={false}
        onAsk={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/identifier/i)).toBeInTheDocument();
  });
});
