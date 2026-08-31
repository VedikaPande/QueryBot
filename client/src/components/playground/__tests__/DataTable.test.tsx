import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataTable from '../DataTable';

const COLUMNS = ['city', 'total'];
const ROWS = [
  ['Yangon', 106200],
  ['Naypyitaw', 110569],
  ['Mandalay', 106198],
];

/** Read the first column of the rendered body, in display order. */
const bodyColumn = (index = 0): string[] => {
  const body = screen.getAllByRole('rowgroup')[1];
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[index].textContent ?? '');
};

describe('DataTable', () => {
  it('renders the headers and every row', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    expect(screen.getByRole('columnheader', { name: /city/i })).toBeInTheDocument();
    expect(screen.getByText('Yangon')).toBeInTheDocument();
    expect(screen.getByText(/3 rows/)).toBeInTheDocument();
  });

  it('explains an empty result instead of rendering a bare table', () => {
    render(<DataTable columns={COLUMNS} rows={[]} />);
    expect(screen.getByText(/returned no rows/i)).toBeInTheDocument();
  });

  it('sorts numerically rather than lexicographically', async () => {
    // The bug this guards: string sorting puts "9" above "10".
    render(<DataTable columns={['n']} rows={[[9], [10], [100], [2]]} />);

    await userEvent.click(screen.getByRole('button', { name: /sort by n/i }));
    expect(bodyColumn()).toEqual(['2', '9', '10', '100']);
  });

  it('cycles ascending, descending, then unsorted', async () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);
    const header = screen.getByRole('button', { name: /sort by total/i });

    await userEvent.click(header);
    expect(bodyColumn()).toEqual(['Mandalay', 'Yangon', 'Naypyitaw']);

    await userEvent.click(header);
    expect(bodyColumn()).toEqual(['Naypyitaw', 'Yangon', 'Mandalay']);

    // A third click restores the original order.
    await userEvent.click(header);
    expect(bodyColumn()).toEqual(['Yangon', 'Naypyitaw', 'Mandalay']);
  });

  it('sorts text case-insensitively and naturally', async () => {
    render(<DataTable columns={['name']} rows={[['banana'], ['Apple'], ['cherry']]} />);

    await userEvent.click(screen.getByRole('button', { name: /sort by name/i }));
    expect(bodyColumn()).toEqual(['Apple', 'banana', 'cherry']);
  });

  it('places nulls last whichever way the column is sorted', async () => {
    render(<DataTable columns={['n']} rows={[[3], [null], [1]]} />);
    const header = screen.getByRole('button', { name: /sort by n/i });

    await userEvent.click(header);
    expect(bodyColumn()[2]).toBe('null');

    await userEvent.click(header);
    expect(bodyColumn()[2]).toBe('null');
  });

  it('filters across every column', async () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    await userEvent.type(screen.getByLabelText(/filter rows/i), 'yangon');

    expect(screen.getByText('Yangon')).toBeInTheDocument();
    expect(screen.queryByText('Mandalay')).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 3 rows/)).toBeInTheDocument();
  });

  it('paginates and clamps the page when a filter shrinks the result', async () => {
    const many = Array.from({ length: 30 }, (_, index) => [`row-${index}`, index]);
    render(<DataTable columns={COLUMNS} rows={many} pageSize={10} />);

    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText(/page 2 of 3/i)).toBeInTheDocument();

    // Filtering down to a single row must not leave the view on page 2.
    await userEvent.type(screen.getByLabelText(/filter rows/i), 'row-7');
    expect(screen.getByText('row-7')).toBeInTheDocument();
  });

  it('marks sort direction for assistive technology', async () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    const header = screen.getByRole('columnheader', { name: /total/i });
    expect(header).toHaveAttribute('aria-sort', 'none');

    await userEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
  });

  it('formats numbers readably and labels missing values', () => {
    render(<DataTable columns={['n']} rows={[[1234567], [null]]} />);

    expect(screen.getByText('1,234,567')).toBeInTheDocument();
    expect(screen.getByText('null')).toBeInTheDocument();
  });
});
