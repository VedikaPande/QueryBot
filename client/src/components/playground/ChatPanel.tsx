import { useEffect, useRef, type KeyboardEvent } from 'react';
import { AlertCircle, BarChart3, Send, Sparkles, Square, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import { cn } from '@/lib/utils';
import { SAMPLE_QUESTIONS, STEP_LABELS } from '@/types/playground';
import type { ChatMessage } from '@/types/playground';

interface ChatPanelProps {
  messages: ChatMessage[];
  input: string;
  isRunning: boolean;
  canSend: boolean;
  activeMessageId: string | null;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onSelectMessage: (message: ChatMessage) => void;
}

/** Short summary of what a completed answer contains. */
const resultBadges = (message: ChatMessage) => {
  const badges: { icon: typeof BarChart3; label: string }[] = [];
  if (message.result?.chart_image_base64) badges.push({ icon: BarChart3, label: 'Chart' });
  if (message.result?.results?.length) {
    badges.push({ icon: Table2, label: `${message.result.results.length.toLocaleString()} rows` });
  }
  if (message.result?.insights) badges.push({ icon: Sparkles, label: 'Insights' });
  return badges;
};

/** The conversation thread and composer. */
const ChatPanel = ({
  messages,
  input,
  isRunning,
  canSend,
  activeMessageId,
  onInputChange,
  onSend,
  onStop,
  onSelectMessage,
}: ChatPanelProps) => {
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="bg-primary/10 rounded-2xl p-3">
              <Sparkles className="text-primary h-6 w-6" />
            </div>
            <div>
              <p className="font-medium">Ask a question about your data</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {canSend ? 'Try one of these to get started' : 'Upload a dataset to begin'}
              </p>
            </div>

            {canSend && (
              <div className="flex flex-col gap-1.5 pt-2">
                {SAMPLE_QUESTIONS.slice(0, 4).map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => onInputChange(question)}
                    className="border-border hover:border-primary hover:bg-primary/5 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="animate-slide-in flex justify-end">
                    <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
                      <p className="break-words whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                );
              }

              if (message.role === 'error') {
                return (
                  <div key={message.id} className="animate-slide-in flex justify-start">
                    <div className="border-destructive/40 bg-destructive/10 text-destructive flex max-w-[90%] gap-2 rounded-2xl rounded-bl-md border px-4 py-2.5 text-sm">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p className="break-words">{message.content}</p>
                    </div>
                  </div>
                );
              }

              if (message.role === 'system') {
                return (
                  <div key={message.id} className="animate-slide-in flex justify-center">
                    <p className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs">
                      {message.content}
                    </p>
                  </div>
                );
              }

              // Assistant turn. Selecting it loads its results into the main panel,
              // which is what makes past answers revisitable.
              const isActive = message.id === activeMessageId;
              const badges = resultBadges(message);

              return (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => !message.pending && onSelectMessage(message)}
                  disabled={message.pending}
                  className={cn(
                    'animate-slide-in w-full rounded-2xl rounded-bl-md border p-3 text-left text-sm transition-colors',
                    isActive
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border bg-card hover:border-primary/40',
                    message.pending && 'cursor-default'
                  )}
                >
                  {message.pending ? (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {message.currentStep ? STEP_LABELS[message.currentStep] : 'Thinking'}
                      </span>
                      <span className="flex gap-1">
                        <span className="bg-primary processing-dot h-1.5 w-1.5 rounded-full" />
                        <span className="bg-primary processing-dot h-1.5 w-1.5 rounded-full" />
                        <span className="bg-primary processing-dot h-1.5 w-1.5 rounded-full" />
                      </span>
                    </div>
                  ) : (
                    <>
                      <MarkdownRenderer content={message.content} className="text-sm" />

                      {badges.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {badges.map(({ icon: Icon, label }) => (
                            <span
                              key={label}
                              className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs"
                            >
                              <Icon className="h-3 w-3" />
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </button>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-border border-t p-3">
        <div className="border-border focus-within:border-primary bg-card flex items-end gap-2 rounded-xl border p-2 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={canSend ? 'Ask about your data...' : 'Upload a dataset first'}
            disabled={!canSend}
            aria-label="Your question"
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none disabled:cursor-not-allowed"
          />
          {isRunning ? (
            <Button size="icon" variant="outline" onClick={onStop} title="Stop" aria-label="Stop">
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSend}
              disabled={!canSend || !input.trim()}
              title="Send"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-muted-foreground mt-1.5 px-1 text-xs">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;
