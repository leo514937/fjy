import * as React from 'react';
import { toast } from 'sonner';

import {
  askOntologyAssistantStream,
  fetchOntologyAssistantState,
  saveOntologyAssistantState,
  uploadOntologyAssistantFile,
  type OntologyAssistantAssistantCompletedEvent,
  type OntologyAssistantHistoryTurn,
  type OntologyAssistantSessionState,
  type OntologyAssistantToolFinishedEvent,
  type OntologyAssistantToolStartedEvent,
  type PersistedOntologyAssistantContentBlock,
} from '@/features/assistant/api';
import {
  applyToolFinished,
  applyToolOutput,
  applyToolStarted,
} from '@/features/assistant/controller';
import type { Entity } from '@/types/ontology';
import type { ConversationExecutionStage, ConversationSession } from '@/components/assistant/types';
import {
  buildExecutionFlowStages,
  normalizeAssistantMessageStages,
  upsertExecutionStage,
} from '@/components/assistant/executionStages';
import {
  createAssistantSession,
  removeAssistantSession,
} from '@/hooks/assistantSessionState';

const STORAGE_KEY = 'ontology-assistant-state-v1';

export const DEFAULT_MODEL = 'gpt-4.1-mini';
export const CUSTOM_MODEL_KEY = '__custom__';
export const MODEL_PRESETS = [
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'o4-mini', label: 'o4-mini' },
];

function finalizeStreamingAssistantBlocks(
  blocks: PersistedOntologyAssistantContentBlock[],
): PersistedOntologyAssistantContentBlock[] {
  return blocks.map((block) => (
    block.type === 'assistant' && block.phase === 'streaming'
      ? {
        ...block,
        phase: 'completed',
        completedAt: block.completedAt ?? block.createdAt,
      }
      : block
  ));
}

function combineAssistantBlockText(
  blocks: PersistedOntologyAssistantContentBlock[],
): string {
  return blocks
    .filter((block) => block.type === 'assistant')
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

function appendAssistantDeltaBlock(
  blocks: PersistedOntologyAssistantContentBlock[],
  delta: string,
): PersistedOntologyAssistantContentBlock[] {
  if (!delta) {
    return blocks;
  }

  const nextBlocks = [...blocks];
  const lastBlock = nextBlocks[nextBlocks.length - 1];
  if (lastBlock?.type === 'assistant' && lastBlock.phase === 'streaming') {
    nextBlocks[nextBlocks.length - 1] = {
      ...lastBlock,
      content: `${lastBlock.content}${delta}`,
    };
    return nextBlocks;
  }

  nextBlocks.push({
    id: `block-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'assistant',
    content: delta,
    createdAt: new Date().toISOString(),
    completedAt: null,
    phase: 'streaming',
  });
  return nextBlocks;
}

function appendAssistantCompletedBlock(
  blocks: PersistedOntologyAssistantContentBlock[],
  event: OntologyAssistantAssistantCompletedEvent,
): PersistedOntologyAssistantContentBlock[] {
  const nextBlocks = [...blocks];
  const lastBlock = nextBlocks[nextBlocks.length - 1];

  if (lastBlock?.type === 'assistant' && lastBlock.phase === 'streaming') {
    nextBlocks[nextBlocks.length - 1] = {
      ...lastBlock,
      content: event.content || lastBlock.content,
      phase: 'completed',
      completedAt: event.createdAt,
    };
    return nextBlocks;
  }

  if (!event.content.trim()) {
    return nextBlocks;
  }

  nextBlocks.push({
    id: `block-assistant-${event.assistantMessageId || Date.now().toString(36)}`,
    type: 'assistant',
    content: event.content,
    createdAt: event.createdAt,
    completedAt: event.createdAt,
    phase: 'completed',
  });
  return nextBlocks;
}

function inferToolName(command: string) {
  const normalized = command.toLowerCase();
  if (normalized.includes('ner.sh') || normalized.includes('python -m ner')) {
    return 'ner';
  }
  if (normalized.includes('re.sh') || normalized.includes('entity_relation')) {
    return 're';
  }
  return undefined;
}

function appendToolCallBlock(
  blocks: PersistedOntologyAssistantContentBlock[],
  event: OntologyAssistantToolStartedEvent,
): PersistedOntologyAssistantContentBlock[] {
  const existing = blocks.some((block) => block.type === 'tool_call' && block.callId === event.callId);
  if (existing) {
    return blocks;
  }

  return [
    ...finalizeStreamingAssistantBlocks(blocks),
    {
      id: `block-tool-call-${event.callId}`,
      type: 'tool_call',
      callId: event.callId,
      command: event.command,
      reasoning: event.reasoning,
      toolName: inferToolName(event.command),
      createdAt: event.startedAt,
    },
  ];
}

function appendToolResultBlock(
  blocks: PersistedOntologyAssistantContentBlock[],
  event: OntologyAssistantToolFinishedEvent,
): PersistedOntologyAssistantContentBlock[] {
  const nextBlocks = blocks.filter((block) => !(
    block.type === 'tool_result' && block.callId === event.callId
  ));

  return [
    ...nextBlocks,
    {
      id: `block-tool-result-${event.callId}`,
      type: 'tool_result',
      callId: event.callId,
      command: event.command,
      toolName: inferToolName(event.command),
      status: event.status,
      stdout: event.stdout,
      stderr: event.stderr,
      exitCode: event.exitCode,
      cwd: event.cwd,
      durationMs: event.durationMs,
      createdAt: event.finishedAt || event.startedAt,
      finishedAt: event.finishedAt,
    },
  ];
}

function readBrowserState() {
  if (typeof window === 'undefined') {
    return null;
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return null;
  }

  try {
    const parsed = JSON.parse(saved) as Partial<OntologyAssistantSessionState>;
    return {
      ...parsed,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.map((session) => ({
          ...session,
          messages: Array.isArray(session.messages)
            ? session.messages.map((message) => normalizeAssistantMessageStages(message))
            : [],
        }))
        : [],
    } as Partial<OntologyAssistantSessionState>;
  } catch {
    return null;
  }
}

export function useAssistantController(selectedEntity: Entity | null) {
  const initialState = React.useMemo(() => readBrowserState(), []);

  const [sessions, setSessions] = React.useState<ConversationSession[]>(() => (
    initialState?.sessions && initialState.sessions.length > 0
      ? initialState.sessions as ConversationSession[]
      : [createAssistantSession()]
  ));
  const [activeSessionId, setActiveSessionId] = React.useState<string>(() => (
    initialState?.activeSessionId || ''
  ));
  const [businessPrompt, setBusinessPrompt] = React.useState<string>(() => (
    initialState?.businessPrompt || ''
  ));
  const [modelName, setModelName] = React.useState<string>(() => (
    initialState?.modelName || DEFAULT_MODEL
  ));
  const [hydrated, setHydrated] = React.useState(false);

  const activeSession = React.useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0] || null,
    [activeSessionId, sessions],
  );
  const isBusy = React.useMemo(
    () => sessions.some((session) => session.loading),
    [sessions],
  );
  const currentToolRuns = React.useMemo(
    () => buildExecutionFlowStages(activeSession?.messages || []),
    [activeSession],
  );

  React.useEffect(() => {
    if (!activeSessionId && sessions[0]) {
      setActiveSessionId(sessions[0].id);
      return;
    }

    if (activeSessionId && !sessions.some((session) => session.id === activeSessionId) && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  React.useEffect(() => {
    const init = async () => {
      try {
        const state = await fetchOntologyAssistantState();
        if (state?.sessions?.length) {
          setSessions(
            state.sessions.map((session) => ({
              ...session,
          messages: session.messages.map((message) => normalizeAssistantMessageStages(message)),
            })) as ConversationSession[],
          );
          setActiveSessionId(state.activeSessionId || state.sessions[0]?.id || '');
          setBusinessPrompt(state.businessPrompt || '');
          setModelName(state.modelName || DEFAULT_MODEL);
        }
      } catch (error) {
        console.warn('Backend state recovery failed:', error);
      } finally {
        setHydrated(true);
      }
    };

    init();
  }, []);

  React.useEffect(() => {
    if (!hydrated) {
      return;
    }

    const snapshot: OntologyAssistantSessionState = {
      sessions,
      activeSessionId,
      businessPrompt,
      modelName,
    };

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }

    const persistTask = window.setTimeout(() => {
      saveOntologyAssistantState(snapshot).catch(() => {});
    }, 1000);

    return () => window.clearTimeout(persistTask);
  }, [sessions, activeSessionId, businessPrompt, modelName, hydrated]);

  const updateActiveSession = React.useCallback((updater: (session: ConversationSession) => ConversationSession) => {
    setSessions((previous) => previous.map((session) => (
      session.id === activeSessionId ? updater(session) : session
    )));
  }, [activeSessionId]);

  const onNewSession = React.useCallback(() => {
    const session = createAssistantSession(sessions.length + 1);
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(session.id);
  }, [sessions.length]);

  const onDeleteSession = React.useCallback((sessionId: string) => {
    setSessions((previous) => {
      const nextState = removeAssistantSession(previous, sessionId, activeSessionId);
      if (nextState.activeSessionId !== activeSessionId) {
        setActiveSessionId(nextState.activeSessionId);
      }
      return nextState.sessions;
    });
  }, [activeSessionId]);

  const abortControllerRef = React.useRef<AbortController | null>(null);

  const onStop = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const onDraftChange = React.useCallback((value: string) => {
    updateActiveSession((session) => ({
      ...session,
      draftQuestion: value,
      error: null,
    }));
  }, [updateActiveSession]);

  const onUploadFile = React.useCallback(async (file: File) => {
    if (!activeSession || !file) {
      return;
    }

    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result !== 'string') {
            reject(new Error('文件读取失败'));
            return;
          }
          const base64 = result.includes(',') ? result.split(',', 2)[1] : result;
          resolve(base64);
        };
        reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
        reader.readAsDataURL(file);
      });

      await uploadOntologyAssistantFile({
        conversationId: activeSession.id,
        fileName: file.name,
        contentBase64,
        mimeType: file.type || 'application/octet-stream',
      });
      toast.success(`已上传到稳定 runtime: ${file.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '上传失败');
      throw error;
    }
  }, [activeSession]);

  const onAsk = React.useCallback(async (question?: string) => {
    if (!activeSession) {
      return;
    }

    const query = (question || activeSession.draftQuestion).trim();
    if (!query || isBusy) {
      return;
    }

    onStop(); // Ensure any previous request is aborted
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const messageId = `msg-${Date.now()}`;
    const conversationId = activeSession.id;

    if (activeSession.messages.length === 0) {
      updateActiveSession((session) => ({
        ...session,
        title: query.slice(0, 18),
      }));
    }

    const conversationHistory: OntologyAssistantHistoryTurn[] = activeSession.messages
      .map((message) => ({
        question: message.question,
        answer: message.answer,
        toolRuns: message.toolRuns,
        contentBlocks: message.contentBlocks,
      }));

    updateActiveSession((session) => ({
      ...session,
      loading: true,
      error: null,
      statusMessage: 'AI 思考中...',
      draftQuestion: '',
      messages: [
        ...session.messages,
        normalizeAssistantMessageStages({
          id: messageId,
          question: query,
          answer: '',
          relatedNames: [],
          executionStages: [],
          toolRuns: [],
          contentBlocks: [],
        }),
      ],
    }));

    try {
      let accumulatedAnswer = '';
      let relatedNames: string[] = [];

      await askOntologyAssistantStream(
        {
          question: query,
          entityId: selectedEntity?.id,
          conversationId,
          businessPrompt: businessPrompt || undefined,
          modelName: modelName || DEFAULT_MODEL,
          conversationHistory,
        },
        {
          onStatus: (statusMessage) => {
            updateActiveSession((session) => ({
              ...session,
              statusMessage,
            }));
          },
          onContext: (context) => {
            relatedNames = context.related?.map((entity) => entity.name) || [];
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? { ...message, relatedNames }
                  : message
              )),
            }));
          },
          onAnswerDelta: (delta) => {
            accumulatedAnswer += delta;
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    answer: accumulatedAnswer,
                    contentBlocks: appendAssistantDeltaBlock(message.contentBlocks || [], delta),
                  }
                  : message
              )),
            }));
          },
          onAssistantCompleted: (assistantTurn) => {
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    contentBlocks: appendAssistantCompletedBlock(message.contentBlocks || [], assistantTurn),
                  }
                  : message
              )),
            }));
          },
          onExecutionStage: (event) => {
            updateActiveSession((session) => ({
              ...session,
              statusMessage: event.label,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    executionStages: upsertExecutionStage(message.executionStages || [], event),
                  }
                  : message
              )),
            }));
          },
          onToolStarted: (event) => {
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    toolRuns: applyToolStarted(message.toolRuns, event),
                    contentBlocks: appendToolCallBlock(message.contentBlocks || [], event),
                  }
                  : message
              )),
            }));
          },
          onToolOutput: (event) => {
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    toolRuns: applyToolOutput(message.toolRuns, event),
                  }
                  : message
              )),
            }));
          },
          onToolFinished: (event) => {
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    toolRuns: applyToolFinished(message.toolRuns, event),
                    contentBlocks: appendToolResultBlock(message.contentBlocks || [], event),
                  }
                  : message
              )),
            }));
          },
          onComplete: (response) => {
            updateActiveSession((session) => ({
              ...session,
              loading: false,
              error: null,
              statusMessage: null,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? (() => {
                    const finalizedBlocks = finalizeStreamingAssistantBlocks(message.contentBlocks || []);
                    return {
                      ...message,
                      answer: combineAssistantBlockText(finalizedBlocks) || response.answer || accumulatedAnswer,
                      relatedNames: response.context?.related?.map((entity) => entity.name) || relatedNames,
                      contentBlocks: finalizedBlocks,
                    };
                  })()
                  : message
              )),
            }));
          },
        },
        { signal: controller.signal },
      );

      updateActiveSession((session) => (
        session.loading || session.statusMessage
          ? {
            ...session,
            loading: false,
            statusMessage: null,
          }
          : session
      ));
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        toast.error(error.message || '上传失败');
      }
      updateActiveSession((session) => ({
        ...session,
        loading: false,
        statusMessage: null,
        error: error instanceof Error && error.name === 'AbortError' ? null : (error instanceof Error ? error.message : '推理中断'),
      }));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [activeSession, businessPrompt, isBusy, modelName, onStop, selectedEntity?.id, updateActiveSession]);

  const onDeleteSessions = React.useCallback((sessionIds: string[]) => {
    setSessions((previous) => {
      const filtered = previous.filter((s) => !sessionIds.includes(s.id));
      const nextSessions = filtered.length > 0 ? filtered : [createAssistantSession()];
      
      let nextActiveId = activeSessionId;
      if (sessionIds.includes(activeSessionId)) {
        nextActiveId = nextSessions[0]?.id || '';
      }
      
      if (nextActiveId !== activeSessionId) {
        setActiveSessionId(nextActiveId);
      }
      return nextSessions;
    });
  }, [activeSessionId]);

  return {
    sessions,
    activeSession,
    activeSessionId,
    businessPrompt,
    currentExecutionStages: currentToolRuns as ConversationExecutionStage[],
    isBusy,
    modelName,
    onAsk,
    onStop,
    onDraftChange,
    onUploadFile,
    onNewSession,
    onDeleteSession,
    onDeleteSessions,
    setActiveSessionId,
    setBusinessPrompt,
    setModelName,
  };
}
