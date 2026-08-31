import { useState } from 'react';
import { Check, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/types/playground';

interface HistorySidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

/** Render a timestamp as a short relative age. */
const relativeTime = (iso: string | null): string => {
  if (!iso) return '';

  const elapsed = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(elapsed)) return '';

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
};

/** Past conversations, so previous analyses can be reopened. */
const HistorySidebar = ({
  conversations,
  activeId,
  isLoading,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: HistorySidebarProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const startEditing = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
  };

  const commitRename = () => {
    if (editingId && draftTitle.trim()) {
      onRename(editingId, draftTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="p-3">
        <Button variant="outline" size="sm" className="w-full" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          New conversation
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        {isLoading ? (
          <div className="flex flex-col gap-1.5 px-1">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">
            Your past questions will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeId;
              const isEditing = conversation.id === editingId;

              return (
                <li key={conversation.id}>
                  {isEditing ? (
                    <div className="flex items-center gap-1 p-1">
                      <Input
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename();
                          if (event.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        aria-label="Conversation title"
                        className="h-7 text-xs"
                      />
                      <Button variant="ghost" size="icon-sm" onClick={commitRename} aria-label="Save">
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors',
                        isActive ? 'bg-primary/10' : 'hover:bg-muted'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(conversation.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      >
                        <MessageSquare
                          className={cn(
                            'mt-0.5 h-3.5 w-3.5 shrink-0',
                            isActive ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium" title={conversation.title}>
                            {conversation.title}
                          </span>
                          <span className="text-muted-foreground block truncate text-[11px]">
                            {conversation.dataset_name} · {relativeTime(conversation.updated_at)}
                          </span>
                        </span>
                      </button>

                      {/* Revealed on hover, and always available to keyboard users. */}
                      <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-6 w-6"
                          onClick={() => startEditing(conversation)}
                          title="Rename"
                          aria-label={`Rename ${conversation.title}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive h-6 w-6"
                          onClick={() => onDelete(conversation.id)}
                          title="Delete"
                          aria-label={`Delete ${conversation.title}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default HistorySidebar;
