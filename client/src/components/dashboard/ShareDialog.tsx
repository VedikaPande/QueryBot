import { useState } from 'react';
import { Check, Copy, Globe, Link2Off, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DashboardAPI } from '@/services/dashboardAPI';
import type { Dashboard } from '@/types/dashboard';

interface ShareDialogProps {
  dashboard: Dashboard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (dashboard: Dashboard) => void;
}

/** Turn public sharing on or off and copy the resulting link. */
const ShareDialog = ({ dashboard, open, onOpenChange, onChange }: ShareDialogProps) => {
  const [isBusy, setIsBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = dashboard.share_token ? DashboardAPI.shareUrl(dashboard.share_token) : '';

  const setShared = async (shared: boolean) => {
    setIsBusy(true);
    try {
      onChange(await DashboardAPI.update(dashboard.id, { shared }));
      toast.success(shared ? 'Sharing enabled' : 'Link revoked');
    } catch {
      toast.error(shared ? 'Could not enable sharing' : 'Could not revoke the link');
    } finally {
      setIsBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the link');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {dashboard.is_shared ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            Share this dashboard
          </DialogTitle>
          <DialogDescription>
            {dashboard.is_shared
              ? 'Anyone with the link can view it. No account needed.'
              : 'It is private. Turn on sharing to get a link.'}
          </DialogDescription>
        </DialogHeader>

        {dashboard.is_shared ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input readOnly value={shareUrl} aria-label="Share link" className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            {/* Stated plainly so the person sharing knows what they are handing
                out. The API strips these fields; this explains that. */}
            <p className="text-muted-foreground text-xs leading-relaxed">
              Viewers see the charts, tables and answers on this dashboard. They do{' '}
              <strong>not</strong> see the SQL, your other dashboards, the underlying dataset, or
              anything about your account.
            </p>

            <Button
              variant="outline"
              onClick={() => setShared(false)}
              disabled={isBusy}
              className="w-full"
            >
              <Link2Off className="h-4 w-4" />
              Revoke this link
            </Button>
            <p className="text-muted-foreground text-xs">
              Revoking takes effect immediately. Re-enabling creates a different link, so the old
              one stays dead.
            </p>
          </div>
        ) : (
          <Button onClick={() => setShared(true)} disabled={isBusy} className="w-full">
            <Globe className="h-4 w-4" />
            Create a share link
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShareDialog;
