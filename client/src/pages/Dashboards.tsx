import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Database,
  Globe,
  LayoutDashboard,
  Loader2,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import ThemeToggle from '@/components/theme/ThemeToggle';
import UserMenu from '@/components/UserMenu';
import DashboardGrid from '@/components/dashboard/DashboardGrid';
import ShareDialog from '@/components/dashboard/ShareDialog';
import { DashboardAPI } from '@/services/dashboardAPI';
import { getErrorMessage } from '@/services/apiClient';
import type { Dashboard, DashboardDetail, TileSize, TileView } from '@/types/dashboard';

/** Shared page chrome, so the list and detail views match the playground. */
const PageHeader = ({ children }: { children?: React.ReactNode }) => (
  <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
    <Link to="/" className="flex items-center gap-2">
      <div className="bg-primary/10 rounded-lg p-1.5">
        <Database className="text-primary h-4 w-4" />
      </div>
      <span className="font-semibold">QueryBot</span>
    </Link>
    <div className="ml-auto flex items-center gap-2">
      {children}
      <Button asChild variant="ghost" size="sm">
        <Link to="/playground">Playground</Link>
      </Button>
      <ThemeToggle />
      <UserMenu />
    </div>
  </header>
);

/** The list of a user's dashboards. */
const DashboardList = () => {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    DashboardAPI.list()
      .then(setDashboards)
      .catch((error) => toast.error(getErrorMessage(error, 'Could not load dashboards')))
      .finally(() => setIsLoading(false));
  }, []);

  const create = async () => {
    const title = newTitle.trim() || 'Untitled dashboard';
    setIsCreating(true);
    try {
      const dashboard = await DashboardAPI.create(title);
      setDashboards((previous) => [dashboard, ...previous]);
      setNewTitle('');
      toast.success('Dashboard created');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not create the dashboard'));
    } finally {
      setIsCreating(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await DashboardAPI.remove(id);
      setDashboards((previous) => previous.filter((dashboard) => dashboard.id !== id));
      toast.success('Dashboard deleted');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not delete the dashboard'));
    }
  };

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <PageHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <h1 className="mb-1 text-2xl font-bold">Dashboards</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Pin results from the playground to keep them, and share a dashboard with a link.
        </p>

        <div className="mb-6 flex gap-2">
          <Input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && create()}
            placeholder="New dashboard name..."
            aria-label="New dashboard name"
          />
          <Button onClick={create} disabled={isCreating}>
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create
          </Button>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : dashboards.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
            <LayoutDashboard className="text-muted-foreground h-8 w-8" />
            <p className="text-muted-foreground text-sm">
              No dashboards yet. Create one above, then pin a result to it.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {dashboards.map((dashboard) => (
              <li
                key={dashboard.id}
                className="border-border bg-card hover:border-primary/50 flex items-center gap-3 rounded-xl border p-4 transition-colors"
              >
                <Link to={`/dashboards/${dashboard.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium">{dashboard.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {dashboard.tile_count} tile{dashboard.tile_count === 1 ? '' : 's'}
                    {dashboard.is_shared && (
                      <span className="text-primary ml-2 inline-flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        shared
                      </span>
                    )}
                  </p>
                </Link>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(dashboard.id)}
                  className="hover:text-destructive"
                  aria-label={`Delete ${dashboard.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};

/** A single dashboard, editable by its owner. */
const DashboardDetailView = ({ id }: { id: string }) => {
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isShareOpen, setIsShareOpen] = useState(false);

  useEffect(() => {
    DashboardAPI.get(id)
      .then(setDashboard)
      .catch((error) => toast.error(getErrorMessage(error, 'Could not load the dashboard')))
      .finally(() => setIsLoading(false));
  }, [id]);

  /** Apply a tile change locally, then persist it. */
  const mutateTile = useCallback(
    async (tileId: string, changes: { view?: TileView; size?: TileSize }) => {
      setDashboard((previous) =>
        previous
          ? {
              ...previous,
              tiles: previous.tiles.map((tile) =>
                tile.id === tileId ? { ...tile, ...changes } : tile
              ),
            }
          : previous
      );

      try {
        const updated = await DashboardAPI.updateTile(id, tileId, changes);
        // Reconcile: the server recalculates the column span from the size.
        setDashboard((previous) =>
          previous
            ? {
                ...previous,
                tiles: previous.tiles.map((tile) => (tile.id === tileId ? updated : tile)),
              }
            : previous
        );
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not update the tile'));
      }
    },
    [id]
  );

  const removeTile = useCallback(
    async (tileId: string) => {
      setDashboard((previous) =>
        previous ? { ...previous, tiles: previous.tiles.filter((t) => t.id !== tileId) } : previous
      );
      try {
        await DashboardAPI.removeTile(id, tileId);
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not unpin the tile'));
      }
    },
    [id]
  );

  const reorder = useCallback(
    async (tileIds: string[]) => {
      try {
        setDashboard(await DashboardAPI.reorderTiles(id, tileIds));
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not save the new order'));
      }
    },
    [id]
  );

  if (isLoading) {
    return (
      <div className="bg-background flex min-h-dvh flex-col">
        <PageHeader />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="text-primary h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="bg-background flex min-h-dvh flex-col">
        <PageHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="font-medium">This dashboard could not be found</p>
          <Button asChild variant="outline">
            <Link to="/dashboards">Back to dashboards</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <PageHeader>
        <Button variant="outline" size="sm" onClick={() => setIsShareOpen(true)}>
          {dashboard.is_shared ? <Globe className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {dashboard.is_shared ? 'Shared' : 'Share'}
        </Button>
      </PageHeader>

      <div className="border-border flex items-center gap-3 border-b px-4 py-3">
        <Button asChild variant="ghost" size="icon-sm">
          <Link to="/dashboards" aria-label="Back to dashboards">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{dashboard.title}</h1>
          <p className="text-muted-foreground text-xs">
            {dashboard.tiles.length} tile{dashboard.tiles.length === 1 ? '' : 's'} · drag the handle
            to reorder
          </p>
        </div>
      </div>

      <main className="flex-1">
        <DashboardGrid
          tiles={dashboard.tiles}
          editable
          onReorder={reorder}
          onChangeView={(tileId, view) => mutateTile(tileId, { view })}
          onChangeSize={(tileId, size) => mutateTile(tileId, { size })}
          onRemove={removeTile}
        />
      </main>

      <ShareDialog
        dashboard={dashboard}
        open={isShareOpen}
        onOpenChange={setIsShareOpen}
        onChange={(updated) => setDashboard((previous) => (previous ? { ...previous, ...updated } : previous))}
      />
    </div>
  );
};

/** Routes to the list or a single dashboard depending on the URL. */
const Dashboards = () => {
  const { id } = useParams<{ id?: string }>();
  return id ? <DashboardDetailView id={id} /> : <DashboardList />;
};

export default Dashboards;
