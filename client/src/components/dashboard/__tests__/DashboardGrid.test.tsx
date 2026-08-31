import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardGrid from '../DashboardGrid';
import type { DashboardTile } from '@/types/dashboard';

const tile = (overrides: Partial<DashboardTile> = {}): DashboardTile => ({
  id: 't1',
  title: 'Revenue by city',
  view: 'chart',
  size: 'medium',
  columns: 4,
  position: 0,
  chart_image_base64: 'iVBORw0KGgo=',
  answer: 'Yangon leads.',
  result_rows: [['Yangon', 1912.95]],
  result_columns: ['city', 'revenue'],
  ...overrides,
});

describe('DashboardGrid', () => {
  it('explains how to populate an empty dashboard', () => {
    render(<DashboardGrid tiles={[]} />);
    expect(screen.getByText(/nothing pinned yet/i)).toBeInTheDocument();
    expect(screen.getByText(/pin to dashboard/i)).toBeInTheDocument();
  });

  it('renders a tile with its chart', () => {
    render(<DashboardGrid tiles={[tile()]} />);

    expect(screen.getByText('Revenue by city')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Revenue by city' })).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw0KGgo='
    );
  });

  it('renders the requested view rather than always the chart', () => {
    render(<DashboardGrid tiles={[tile({ view: 'answer' })]} />);

    expect(screen.getByText('Yangon leads.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Revenue by city' })).not.toBeInTheDocument();
  });

  it('sizes tiles by their column span', () => {
    const { container } = render(
      <DashboardGrid tiles={[tile({ id: 'a', columns: 12 }), tile({ id: 'b', columns: 3 })]} />
    );

    const articles = container.querySelectorAll('article');
    expect(articles[0]).toHaveStyle({ gridColumn: 'span 12' });
    expect(articles[1]).toHaveStyle({ gridColumn: 'span 3' });
  });

  it('clamps an out-of-range span so the grid cannot break', () => {
    const { container } = render(<DashboardGrid tiles={[tile({ columns: 99 })]} />);
    expect(container.querySelector('article')).toHaveStyle({ gridColumn: 'span 12' });
  });

  describe('read-only mode', () => {
    /**
     * A publicly shared dashboard renders through this same component, so the
     * absence of editing affordances is a security-relevant assertion, not just
     * cosmetic.
     */
    it('offers no reorder handle or tile menu', () => {
      render(<DashboardGrid tiles={[tile()]} />);

      expect(screen.queryByRole('button', { name: /reorder tile/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /tile options/i })).not.toBeInTheDocument();
    });

    it('still allows expanding a tile to read it', () => {
      render(<DashboardGrid tiles={[tile()]} />);
      expect(screen.getByRole('button', { name: /expand tile/i })).toBeInTheDocument();
    });
  });

  describe('editable mode', () => {
    it('exposes the reorder handle and the tile menu', () => {
      render(<DashboardGrid tiles={[tile()]} editable />);

      expect(screen.getByRole('button', { name: /reorder tile/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /tile options/i })).toBeInTheDocument();
    });

    it('changes the view from the menu', async () => {
      const onChangeView = vi.fn();
      render(<DashboardGrid tiles={[tile()]} editable onChangeView={onChangeView} />);

      await userEvent.click(screen.getByRole('button', { name: /tile options/i }));
      await userEvent.click(screen.getByRole('menuitem', { name: /table/i }));

      expect(onChangeView).toHaveBeenCalledWith('t1', 'table');
    });

    it('offers only the views the pinned result actually has', async () => {
      // No chart and no rows, so only the answer can be shown.
      render(
        <DashboardGrid
          tiles={[tile({ chart_image_base64: undefined, result_rows: [], view: 'answer' })]}
          editable
        />
      );

      await userEvent.click(screen.getByRole('button', { name: /tile options/i }));

      const menu = screen.getByRole('menu');
      // A single option means the "Show" group is omitted entirely.
      expect(within(menu).queryByRole('menuitem', { name: /^chart$/i })).not.toBeInTheDocument();
      expect(within(menu).queryByRole('menuitem', { name: /^table$/i })).not.toBeInTheDocument();
    });

    it('resizes a tile from the menu', async () => {
      const onChangeSize = vi.fn();
      render(<DashboardGrid tiles={[tile()]} editable onChangeSize={onChangeSize} />);

      await userEvent.click(screen.getByRole('button', { name: /tile options/i }));
      await userEvent.click(screen.getByRole('menuitem', { name: /full width/i }));

      expect(onChangeSize).toHaveBeenCalledWith('t1', 'full');
    });

    it('unpins a tile from the menu', async () => {
      const onRemove = vi.fn();
      render(<DashboardGrid tiles={[tile()]} editable onRemove={onRemove} />);

      await userEvent.click(screen.getByRole('button', { name: /tile options/i }));
      await userEvent.click(screen.getByRole('menuitem', { name: /unpin/i }));

      expect(onRemove).toHaveBeenCalledWith('t1');
    });
  });
});
