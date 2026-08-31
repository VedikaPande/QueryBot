import { useEffect, useState } from 'react';
import { Check, Loader2, Pin, Plus } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { DashboardAPI } from '@/services/dashboardAPI';
import { getErrorMessage } from '@/services/apiClient';
import type { Dashboard } from '@/types/dashboard';

interface PinToDashboardProps {
  /** The persisted assistant message to pin. Absent while a run is streaming. */
  messageId?: string;
  disabled?: boolean;
}

/**
 * Pin the current result onto a dashboard.
 *
 * Requires a persisted message id, which only exists once the run has finished
 * and the server has written the turn — so the control is disabled mid-stream
 * rather than failing on click.
 */
const PinToDashboard = ({ messageId, disabled }: PinToDashboardProps) => {
  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [pinnedTo, setPinnedTo] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  // Null until fetched, so loading is derived from the data rather than tracked
  // by a second state variable that the effect would have to set synchronously.
  const isLoading = isOpen && dashboards === null;

  // Fetched when the menu opens rather than on mount: most sessions never pin,
  // and this keeps a request off the playground's initial load.
  useEffect(() => {
    if (!isOpen || dashboards !== null) return;

    let cancelled = false;

    DashboardAPI.list()
      .then((list) => {
        if (!cancelled) setDashboards(list);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(getErrorMessage(error, 'Could not load dashboards'));
        setDashboards([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, dashboards]);

  const pin = async (dashboardId: string, dashboardTitle: string) => {
    if (!messageId) return;

    try {
      await DashboardAPI.addTile(dashboardId, { messageId });
      setPinnedTo(dashboardId);
      toast.success(`Pinned to ${dashboardTitle}`);
      // Cleared so pinning the same result elsewhere still reads as available.
      setTimeout(() => setPinnedTo(null), 3000);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not pin this result'));
    }
  };

  const createAndPin = async () => {
    const title = newTitle.trim();
    if (!title || !messageId) return;

    try {
      const dashboard = await DashboardAPI.create(title);
      setDashboards((previous) => [dashboard, ...(previous ?? [])]);
      setNewTitle('');
      await pin(dashboard.id, dashboard.title);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not create the dashboard'));
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !messageId}
          title={messageId ? 'Pin to a dashboard' : 'Available once the answer is complete'}
        >
          <Pin className="h-4 w-4" />
          Pin
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Pin to dashboard</DropdownMenuLabel>

        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : (
          (dashboards ?? []).map((dashboard) => (
            <DropdownMenuItem
              key={dashboard.id}
              onSelect={(event) => {
                // Keeps the menu open so several dashboards can be chosen.
                event.preventDefault();
                pin(dashboard.id, dashboard.title);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{dashboard.title}</span>
              {pinnedTo === dashboard.id && <Check className="text-primary h-4 w-4" />}
            </DropdownMenuItem>
          ))
        )}

        {!isLoading && dashboards?.length === 0 && (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">No dashboards yet.</p>
        )}

        <DropdownMenuSeparator />

        <div className="flex gap-1 p-1">
          <Input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                createAndPin();
              }
            }}
            placeholder="New dashboard..."
            aria-label="New dashboard name"
            className="h-8 text-xs"
          />
          <Button
            size="icon-sm"
            onClick={createAndPin}
            disabled={!newTitle.trim()}
            aria-label="Create and pin"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PinToDashboard;
