import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { runAnalysis } from '@/services/analysisAPI';
import { ConversationAPI } from '@/services/conversationAPI';
import { DatasetAPI } from '@/services/datasetAPI';
import { getErrorMessage } from '@/services/apiClient';
import { config } from '@/config/env';
import type { Dataset, DatasetProfile, DatasetTable } from '@/types/dataset';
import type {
  AnalysisResult,
  ChatMessage,
  Conversation,
  StoredMessage,
  WorkflowStep,
} from '@/types/playground';

/** Stable id for a locally created message. */
const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;

/** Rebuild a chat message from its persisted form. */
const fromStored = (stored: StoredMessage): ChatMessage => ({
  id: stored.id,
  role: stored.role,
  content: stored.content,
  createdAt: stored.created_at ?? new Date().toISOString(),
  // Came from the database, so the id is real and the result can be pinned.
  persisted: true,
  durationMs: stored.duration_ms,
  result:
    stored.role === 'assistant'
      ? {
          answer: stored.content,
          sql_query: stored.sql_query,
          visualization: stored.visualization,
          chart_spec: stored.chart_spec,
          insights: stored.insights,
          data_narrative: stored.data_narrative,
          formatted_table: stored.formatted_table,
          chart_image_base64: stored.chart_image_base64,
          results: stored.result_rows,
          result_columns: stored.result_columns,
          error: stored.error,
        }
      : undefined,
});

/**
 * Owns all Playground state: the active dataset, the conversation thread, the
 * streaming run, and the history list.
 *
 * Results live on individual messages rather than one mutable blob, which is
 * what lets a past conversation be reopened with its charts intact.
 */
export const usePlayground = () => {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [tables, setTables] = useState<DatasetTable[]>([]);
  const [isSchemaLoading, setIsSchemaLoading] = useState(false);
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<WorkflowStep | undefined>();

  const [activeResult, setActiveResult] = useState<AnalysisResult | null>(null);
  const [activeQuestion, setActiveQuestion] = useState('');
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  // Lets an in-flight run be cancelled by the Stop button or by unmounting.
  const abortRef = useRef<AbortController | null>(null);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((previous) => [...previous, message]);
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await ConversationAPI.list());
    } catch (error) {
      console.error('Could not load conversations:', error);
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const loadSchema = useCallback(async (datasetUuid: string) => {
    setIsSchemaLoading(true);
    setIsProfileLoading(true);

    // Schema and profile are requested together but settled independently: the
    // schema is what the UI needs to be usable, so it must not wait behind the
    // slower full-table scan that profiling performs.
    DatasetAPI.getSchema(datasetUuid)
      .then((schema) => setTables(schema.tables))
      .catch((error) => {
        // An expired dataset is the common case and not worth a toast on load.
        console.error('Could not load the schema:', error);
        setTables([]);
      })
      .finally(() => setIsSchemaLoading(false));

    DatasetAPI.getProfile(datasetUuid)
      .then(setProfile)
      .catch((error) => {
        console.error('Could not profile the dataset:', error);
        setProfile(null);
      })
      .finally(() => setIsProfileLoading(false));
  }, []);

  // Restore the most recent dataset so a reload does not lose the session.
  // Declared after loadSchema so the reference is initialised, not hoisted.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const [datasets] = await Promise.all([DatasetAPI.list(), refreshConversations()]);
        if (cancelled || datasets.length === 0) return;

        const mostRecent = datasets[0];
        if (!mostRecent) return;

        setDataset(mostRecent);
        void loadSchema(mostRecent.uuid);
      } catch (error) {
        console.error('Could not restore the session:', error);
      }
    };

    void restore();

    // Captured so the cleanup aborts whatever run is in flight at unmount.
    const controller = abortRef;
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, [loadSchema, refreshConversations]);

  const uploadDataset = useCallback(
    async (file: File) => {
      if (file.size > config.MAX_UPLOAD_BYTES) {
        toast.error(`That file is larger than the ${Math.round(config.MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit`);
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);

      try {
        const uploaded = await DatasetAPI.upload(file, setUploadProgress);

        setDataset(uploaded);
        // A new dataset starts a new conversation: prior turns refer to data
        // that is no longer loaded.
        setConversationId(null);
        setMessages([
          {
            id: createId(),
            role: 'system',
            content: `${uploaded.file_name} is ready — ${uploaded.table_count} table${uploaded.table_count === 1 ? '' : 's'}, ${uploaded.row_count.toLocaleString()} rows.`,
            createdAt: new Date().toISOString(),
          },
        ]);
        setActiveResult(null);
        setActiveMessageId(null);

        await loadSchema(uploaded.uuid);
        toast.success('Dataset uploaded');
      } catch (error) {
        toast.error(getErrorMessage(error, 'The upload failed'));
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
      }
    },
    [loadSchema]
  );

  const addFileToDataset = useCallback(
    async (file: File) => {
      if (!dataset) return;

      if (file.size > config.MAX_UPLOAD_BYTES) {
        toast.error(`That file is larger than the ${Math.round(config.MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit`);
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);

      try {
        const { dataset: updated, addedTables } = await DatasetAPI.addFile(
          dataset.uuid,
          file,
          setUploadProgress
        );

        setDataset(updated);
        appendMessage({
          id: createId(),
          role: 'system',
          content: `Added ${file.name} as ${addedTables.map((t) => `"${t}"`).join(', ')}. You can now ask questions that span all ${updated.table_count} tables.`,
          createdAt: new Date().toISOString(),
        });

        // The schema and profile both changed.
        await loadSchema(updated.uuid);
        toast.success(`Added ${addedTables.length} table${addedTables.length === 1 ? '' : 's'}`);
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not add the file'));
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
      }
    },
    [dataset, appendMessage, loadSchema]
  );

  const removeDataset = useCallback(async () => {
    if (!dataset) return;

    try {
      await DatasetAPI.remove(dataset.uuid);
      setDataset(null);
      setTables([]);
      setProfile(null);
      setMessages([]);
      setActiveResult(null);
      setActiveMessageId(null);
      setConversationId(null);
      await refreshConversations();
      toast.success('Dataset removed');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove the dataset'));
    }
  }, [dataset, refreshConversations]);

  const ask = useCallback(
    async (question: string) => {
      if (!dataset || !question.trim() || isRunning) return;

      const trimmed = question.trim();
      const pendingId = createId();

      appendMessage({
        id: createId(),
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      });
      appendMessage({
        id: pendingId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        pending: true,
      });

      setInput('');
      setIsRunning(true);
      setCurrentStep(undefined);
      setActiveQuestion(trimmed);
      setActiveResult(null);
      setActiveMessageId(pendingId);

      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = Date.now();

      try {
        const {
          result,
          conversationId: resolvedId,
          messageId: persistedId,
        } = await runAnalysis({
          question: trimmed,
          datasetUuid: dataset.uuid,
          conversationId,
          signal: controller.signal,
          onUpdate: (partial, step) => {
            setActiveResult(partial);
            if (step) setCurrentStep(step);
            // Show the answer in the thread as soon as it exists, rather than
            // only after every downstream node has finished.
            if (partial.answer) {
              setMessages((previous) =>
                previous.map((message) =>
                  message.id === pendingId
                    ? { ...message, content: partial.answer ?? '', currentStep: step }
                    : message
                )
              );
            } else if (step) {
              setMessages((previous) =>
                previous.map((message) =>
                  message.id === pendingId ? { ...message, currentStep: step } : message
                )
              );
            }
          },
        });

        if (resolvedId) setConversationId(resolvedId);

        setActiveResult(result);
        setActiveMessageId(persistedId ?? pendingId);

        setMessages((previous) =>
          previous.map((message) =>
            message.id === pendingId
              ? {
                  ...message,
                  // Adopt the server's id so the turn matches what a reopened
                  // conversation returns, and so it can be pinned.
                  id: persistedId ?? message.id,
                  role: result.error && !result.answer ? 'error' : 'assistant',
                  content: result.answer || result.error || 'No answer was produced.',
                  result,
                  pending: false,
                  persisted: Boolean(persistedId),
                  durationMs: Date.now() - startedAt,
                }
              : message
          )
        );

        void refreshConversations();
      } catch (error) {
        const aborted = controller.signal.aborted;
        const message = aborted ? 'Cancelled.' : getErrorMessage(error, 'The analysis failed');

        setMessages((previous) =>
          previous.map((entry) =>
            entry.id === pendingId
              ? { ...entry, role: aborted ? 'system' : 'error', content: message, pending: false }
              : entry
          )
        );

        if (!aborted) toast.error(message);
      } finally {
        setIsRunning(false);
        setCurrentStep(undefined);
        abortRef.current = null;
      }
    },
    [dataset, isRunning, conversationId, appendMessage, refreshConversations]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const selectMessage = useCallback((message: ChatMessage) => {
    if (!message.result) return;
    setActiveResult(message.result);
    setActiveMessageId(message.id);
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      try {
        const conversation = await ConversationAPI.get(id);

        setConversationId(conversation.id);
        const restored = conversation.messages.map(fromStored);
        setMessages(restored);

        // Show the most recent answer so the panel is not empty on open.
        const lastAnswer = [...restored].reverse().find((message) => message.result);
        setActiveResult(lastAnswer?.result ?? null);
        setActiveMessageId(lastAnswer?.id ?? null);

        const lastQuestion = [...restored].reverse().find((message) => message.role === 'user');
        setActiveQuestion(lastQuestion?.content ?? conversation.title);

        // The conversation may belong to a different dataset than the one loaded.
        if (conversation.dataset_uuid && conversation.dataset_uuid !== dataset?.uuid) {
          const datasets = await DatasetAPI.list();
          const match = datasets.find((entry) => entry.uuid === conversation.dataset_uuid);
          if (match) {
            setDataset(match);
            void loadSchema(match.uuid);
          } else {
            toast.warning('The dataset for this conversation has expired. Upload it again to ask more questions.');
          }
        }
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not open that conversation'));
      }
    },
    // Depends on the whole dataset object rather than one property, matching
    // what the React Compiler infers from the body.
    [dataset, loadSchema]
  );

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setActiveResult(null);
    setActiveMessageId(null);
    setActiveQuestion('');
  }, []);

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      // Update optimistically; the list re-syncs on the next refresh.
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === id ? { ...conversation, title } : conversation
        )
      );

      try {
        await ConversationAPI.rename(id, title);
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not rename that conversation'));
        void refreshConversations();
      }
    },
    [refreshConversations]
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await ConversationAPI.remove(id);
        setConversations((previous) => previous.filter((conversation) => conversation.id !== id));

        if (id === conversationId) {
          startNewConversation();
        }
        toast.success('Conversation deleted');
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not delete that conversation'));
      }
    },
    [conversationId, startNewConversation]
  );

  return {
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
    /**
     * The id to pin, or undefined when the shown result has not been persisted —
     * mid-stream, or a locally created system message.
     */
    pinnableMessageId: messages.find((message) => message.id === activeMessageId)?.persisted
      ? (activeMessageId ?? undefined)
      : undefined,

    conversations,
    conversationId,
    isHistoryLoading,
    openConversation,
    startNewConversation,
    renameConversation,
    deleteConversation,
  };
};
