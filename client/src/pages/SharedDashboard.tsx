import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/theme/ThemeToggle';
import DashboardGrid from '@/components/dashboard/DashboardGrid';
import { DashboardAPI } from '@/services/dashboardAPI';
import type { DashboardDetail } from '@/types/dashboard';

/**
 * A publicly shared dashboard.
 *
 * Reachable without an account: the token in the URL is the capability. Rendered
 * read-only, and the payload the API returns already omits the SQL and every
 * account detail, so there is nothing here to hide in the UI layer.
 */
const SharedDashboard = () => {
  const { token } = useParams<{ token: string }>();
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  // Derived rather than corrected inside the effect: with no token there is
  // nothing to fetch, so the page was never loading in the first place.
  const [isLoading, setIsLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) return;

    DashboardAPI.getShared(token)
      .then(setDashboard)
      // A revoked or unknown link is the expected failure, so it is presented as
      // an unavailable dashboard rather than an error.
      .catch(() => setDashboard(null))
      .finally(() => setIsLoading(false));
  }, [token]);

  if (isLoading) {
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="bg-background flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="bg-muted rounded-2xl p-4">
          <Database className="text-muted-foreground h-8 w-8" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">This dashboard is not available</h1>
          <p className="text-muted-foreground mt-2 max-w-sm text-sm">
            The link may have been revoked, or it was never valid. Ask whoever shared it for a new
            one.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/">Go to QueryBot</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <Link to="/" className="flex items-center gap-2">
          <div className="bg-primary/10 rounded-lg p-1.5">
            <Database className="text-primary h-4 w-4" />
          </div>
          <span className="font-semibold">QueryBot</span>
        </Link>

        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
          Shared view
        </span>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button asChild size="sm">
            <Link to="/auth">Analyse your own data</Link>
          </Button>
        </div>
      </header>

      <div className="border-border border-b px-4 py-4">
        <h1 className="text-xl font-semibold">{dashboard.title}</h1>
        {dashboard.description && (
          <p className="text-muted-foreground mt-1 text-sm">{dashboard.description}</p>
        )}
        <p className="text-muted-foreground mt-1 text-xs">
          {dashboard.tiles.length} result{dashboard.tiles.length === 1 ? '' : 's'}
        </p>
      </div>

      <main className="flex-1">
        {/* Not editable: no reorder handles, no tile menus. */}
        <DashboardGrid tiles={dashboard.tiles} />
      </main>

      <footer className="border-border text-muted-foreground border-t px-4 py-3 text-center text-xs">
        Made with QueryBot — ask questions about your data in plain English.
      </footer>
    </div>
  );
};

export default SharedDashboard;
