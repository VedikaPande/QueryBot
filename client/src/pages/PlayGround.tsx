import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, History, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import ThemeToggle from '@/components/theme/ThemeToggle';
import UserMenu from '@/components/UserMenu';
import ChatPanel from '@/components/playground/ChatPanel';
import DatasetPanel from '@/components/playground/DatasetPanel';
import ExportMenu from '@/components/playground/ExportMenu';
import PinToDashboard from '@/components/playground/PinToDashboard';
import HistorySidebar from '@/components/playground/HistorySidebar';
import ResultsPanel from '@/components/playground/ResultsPanel';
import { usePlayground } from '@/hooks/usePlayground';
import { cn } from '@/lib/utils';

/**
 * The analysis workspace: the dataset and history rail, the conversation, and
 * the results. The rail collapses and the columns stack on narrow screens.
 */
const PlayGround = () => {
  const [isRailOpen, setIsRailOpen] = useState(true);
  const [railTab, setRailTab] = useState<'dataset' | 'history'>('dataset');

  const {
    dataset,
    tables,
    isSchemaLoading,
    profile,
    isProfileLoading,
    isUploading,
    uploadProgress,
    uploadDataset,
    addFileToDataset,
    removeDataset,
    messages,
    input,
    setInput,
    isRunning,
    currentStep,
    ask,
    stop,
    selectMessage,
    activeResult,
    activeQuestion,
    activeMessageId,
    pinnableMessageId,
    conversations,
    conversationId,
    isHistoryLoading,
    openConversation,
    startNewConversation,
    renameConversation,
    deleteConversation,
  } = usePlayground();

  return (
    <div className="bg-background flex h-dvh flex-col">
      <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setIsRailOpen((open) => !open)}
          title={isRailOpen ? 'Hide the sidebar' : 'Show the sidebar'}
          aria-label={isRailOpen ? 'Hide the sidebar' : 'Show the sidebar'}
          className="hidden lg:inline-flex"
        >
          {isRailOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </Button>

        <Link to="/" className="flex items-center gap-2">
          <div className="bg-primary/10 rounded-lg p-1.5">
            <Database className="text-primary h-4 w-4" />
          </div>
          <span className="font-semibold">QueryBot</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <PinToDashboard messageId={pinnableMessageId} disabled={isRunning} />
          <ExportMenu question={activeQuestion} result={activeResult} />
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Rail: dataset and history */}
        <aside
          className={cn(
            'border-border bg-surface flex shrink-0 flex-col border-b lg:border-r lg:border-b-0',
            isRailOpen ? 'lg:w-80' : 'lg:hidden',
            'max-h-72 lg:max-h-none'
          )}
        >
          <div className="border-border flex shrink-0 border-b">
            <button
              type="button"
              onClick={() => setRailTab('dataset')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
                railTab === 'dataset'
                  ? 'text-primary border-primary border-b-2'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Database className="h-3.5 w-3.5" />
              Dataset
            </button>
            <button
              type="button"
              onClick={() => setRailTab('history')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
                railTab === 'history'
                  ? 'text-primary border-primary border-b-2'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <History className="h-3.5 w-3.5" />
              History
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {railTab === 'dataset' ? (
              <DatasetPanel
                dataset={dataset}
                tables={tables}
                profile={profile}
                isUploading={isUploading}
                uploadProgress={uploadProgress}
                isSchemaLoading={isSchemaLoading}
                isProfileLoading={isProfileLoading}
                onUpload={uploadDataset}
                onAddFile={addFileToDataset}
                onRemove={removeDataset}
                onAsk={ask}
              />
            ) : (
              <HistorySidebar
                conversations={conversations}
                activeId={conversationId}
                isLoading={isHistoryLoading}
                onSelect={openConversation}
                onCreate={startNewConversation}
                onRename={renameConversation}
                onDelete={deleteConversation}
              />
            )}
          </div>
        </aside>

        {/* Conversation */}
        <section className="border-border bg-card flex min-h-0 flex-1 flex-col border-b lg:max-w-md lg:border-r lg:border-b-0">
          <ChatPanel
            messages={messages}
            input={input}
            isRunning={isRunning}
            canSend={Boolean(dataset)}
            activeMessageId={activeMessageId}
            onInputChange={setInput}
            onSend={() => ask(input)}
            onStop={stop}
            onSelectMessage={selectMessage}
          />
        </section>

        {/* Results */}
        <section className="bg-background flex min-h-0 flex-2 flex-col">
          <ResultsPanel
            result={activeResult}
            question={activeQuestion}
            datasetUuid={dataset?.uuid ?? null}
            isRunning={isRunning}
            currentStep={currentStep}
            hasDataset={Boolean(dataset)}
            onAsk={ask}
          />
        </section>
      </div>

      <Separator className="lg:hidden" />
    </div>
  );
};

export default PlayGround;
