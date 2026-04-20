import { buildApiUrl, parseJson, parseSseEvent, asObject } from '@/shared/api/http';
import type { Entity } from '@/types/ontology';

export interface OntologyAssistantContext {
  entity?: Entity | null;
  related?: Entity[];
  searchHits?: Entity[];
}

export interface OntologyAssistantResponse {
  answer: string;
  context?: OntologyAssistantContext;
  raw?: unknown;
  stderr?: string;
}

export interface OntologyAssistantUploadResponse {
  ok: boolean;
  conversationId: string;
  runtimeRoot: string;
  uploadsDir: string;
  filePath: string;
  fileName: string;
  mimeType: string;
}

export interface OntologyAssistantHistoryTurn {
  question: string;
  answer: string;
  toolRuns?: PersistedOntologyAssistantToolRun[];
  contentBlocks?: PersistedOntologyAssistantContentBlock[];
}

export interface OntologyAssistantToolStartedEvent {
  callId: string;
  command: string;
  reasoning?: string;
  cwd: string | null;
  startedAt: string;
}

export interface OntologyAssistantToolOutputEvent {
  callId: string;
  command: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
  cwd: string | null;
  startedAt: string;
}

export interface OntologyAssistantToolFinishedEvent {
  callId: string;
  command: string;
  status: 'running' | 'success' | 'error' | 'timeout' | 'cancelled' | 'rejected';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cwd: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string;
}

export interface OntologyAssistantAssistantCompletedEvent {
  assistantMessageId: string;
  content: string;
  createdAt: string;
}

export type OntologyAssistantSemanticStatus =
  | 'thinking'
  | 'executing'
  | 'reasoning'
  | 'observing'
  | 'interrupted'
  | 'completed';

export interface OntologyAssistantExecutionStageEvent {
  id: string;
  semanticStatus: OntologyAssistantSemanticStatus;
  label: string;
  phaseState: 'active' | 'completed';
  sourceEventType: string;
  detail: string;
  callId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PersistedOntologyAssistantToolRun {
  callId: string;
  command: string;
  status: 'running' | 'success' | 'error' | 'timeout' | 'cancelled' | 'rejected';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cwd: string | null;
  durationMs: number | null;
  truncated: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AssistantGraphEntity {
  entity_id: string;
  text: string;
  normalized_text?: string;
  label?: string;
  confidence?: number | null;
  source_sentence?: string;
  metadata?: Record<string, unknown>;
  display_level?: number;
  visible?: boolean;
  highlight?: boolean;
  pinned?: boolean;
  focus?: boolean;
  start?: number;
  end?: number;
}

export interface AssistantGraphRelation {
  relation_id?: string;
  source_entity_id?: string;
  target_entity_id?: string;
  source_text?: string;
  target_text?: string;
  relation_type?: string;
  confidence?: number | null;
  evidence_sentence?: string;
  metadata?: Record<string, unknown>;
  display_level?: number;
  visible?: boolean;
  highlight?: boolean;
}

export interface AssistantGraphOverlay {
  version: number;
  conversationId: string;
  updatedAt: string;
  nodes: AssistantGraphEntity[];
  relations: AssistantGraphRelation[];
}

export type PersistedOntologyAssistantContentBlock =
  | {
      id: string;
      type: 'assistant';
      content: string;
      createdAt: string;
      completedAt: string | null;
      phase: 'streaming' | 'completed';
    }
  | {
      id: string;
      type: 'tool_call';
      callId: string;
      command: string;
      reasoning?: string;
      toolName?: string;
      createdAt: string;
    }
  | {
      id: string;
      type: 'tool_result';
      callId: string;
      command: string;
      toolName?: string;
      status: 'running' | 'success' | 'error' | 'timeout' | 'cancelled' | 'rejected';
      stdout: string;
      stderr: string;
      exitCode: number | null;
      cwd: string | null;
      durationMs: number | null;
      createdAt: string;
      finishedAt: string | null;
    };

export interface PersistedOntologyAssistantMessage {
  id: string;
  question: string;
  answer: string;
  relatedNames: string[];
  executionStages: PersistedOntologyAssistantExecutionStage[];
  toolRuns: PersistedOntologyAssistantToolRun[];
  contentBlocks: PersistedOntologyAssistantContentBlock[];
}

export type PersistedOntologyAssistantExecutionStage = OntologyAssistantExecutionStageEvent;

export interface PersistedOntologyAssistantSession {
  id: string;
  title: string;
  draftQuestion: string;
  messages: PersistedOntologyAssistantMessage[];
  error: string | null;
  loading: boolean;
  statusMessage: string | null;
}

export interface OntologyAssistantSessionState {
  sessions: PersistedOntologyAssistantSession[];
  activeSessionId: string;
  businessPrompt: string;
  modelName: string;
}

export interface OntologyAssistantStreamHandlers {
  onStatus?: (message: string) => void;
  onContext?: (context: OntologyAssistantContext) => void;
  onAnswerDelta?: (delta: string) => void;
  onAssistantCompleted?: (event: OntologyAssistantAssistantCompletedEvent) => void;
  onExecutionStage?: (event: OntologyAssistantExecutionStageEvent) => void;
  onToolStarted?: (event: OntologyAssistantToolStartedEvent) => void;
  onToolOutput?: (event: OntologyAssistantToolOutputEvent) => void;
  onToolFinished?: (event: OntologyAssistantToolFinishedEvent) => void;
  onComplete?: (response: OntologyAssistantResponse) => void;
}

export async function askOntologyAssistant(input: {
  question: string;
  entityId?: string;
  conversationId?: string;
  businessPrompt?: string;
  modelName?: string;
  conversationHistory?: OntologyAssistantHistoryTurn[];
}): Promise<OntologyAssistantResponse> {
  const response = await fetch(buildApiUrl('/api/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJson(response);
}

export async function fetchOntologyAssistantState(): Promise<OntologyAssistantSessionState> {
  const response = await fetch(buildApiUrl('/api/chat/state'));
  return parseJson<OntologyAssistantSessionState>(response);
}

export async function saveOntologyAssistantState(
  input: OntologyAssistantSessionState,
): Promise<OntologyAssistantSessionState> {
  const response = await fetch(buildApiUrl('/api/chat/state'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJson<OntologyAssistantSessionState>(response);
}

export async function uploadOntologyAssistantFile(input: {
  conversationId: string;
  fileName: string;
  contentBase64: string;
  mimeType?: string;
}): Promise<OntologyAssistantUploadResponse> {
  const response = await fetch(buildApiUrl('/api/chat/upload'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJson<OntologyAssistantUploadResponse>(response);
}

export async function fetchAssistantGraphOverlay(conversationId: string): Promise<AssistantGraphOverlay> {
  const response = await fetch(buildApiUrl(`/api/chat/graph?conversationId=${encodeURIComponent(conversationId)}`));
  return parseJson<AssistantGraphOverlay>(response);
}

export async function saveAssistantGraphOverlay(input: AssistantGraphOverlay): Promise<AssistantGraphOverlay> {
  const response = await fetch(buildApiUrl('/api/chat/graph'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJson<AssistantGraphOverlay>(response);
}

export async function askOntologyAssistantStream(
  input: {
    question: string;
    entityId?: string;
    conversationId?: string;
    businessPrompt?: string;
    modelName?: string;
    conversationHistory?: OntologyAssistantHistoryTurn[];
  },
  handlers: OntologyAssistantStreamHandlers = {},
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<OntologyAssistantResponse> {
  const response = await fetch(buildApiUrl('/api/chat/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Streaming response body is missing.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: OntologyAssistantResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (parsed) {
        const eventData = asObject(parsed.data);
        if (parsed.event === 'status') {
          handlers.onStatus?.(typeof eventData?.message === 'string' ? eventData.message : '');
        } else if (parsed.event === 'context') {
          handlers.onContext?.((parsed.data as OntologyAssistantResponse['context']) ?? {});
        } else if (parsed.event === 'answer_delta') {
          handlers.onAnswerDelta?.(typeof eventData?.delta === 'string' ? eventData.delta : '');
        } else if (parsed.event === 'assistant_completed') {
          handlers.onAssistantCompleted?.(parsed.data as OntologyAssistantAssistantCompletedEvent);
        } else if (parsed.event === 'execution_stage') {
          handlers.onExecutionStage?.(parsed.data as OntologyAssistantExecutionStageEvent);
        } else if (parsed.event === 'tool_started') {
          handlers.onToolStarted?.(parsed.data as OntologyAssistantToolStartedEvent);
        } else if (parsed.event === 'tool_output') {
          handlers.onToolOutput?.(parsed.data as OntologyAssistantToolOutputEvent);
        } else if (parsed.event === 'tool_finished') {
          handlers.onToolFinished?.(parsed.data as OntologyAssistantToolFinishedEvent);
        } else if (parsed.event === 'complete') {
          finalResponse = parsed.data as OntologyAssistantResponse;
          handlers.onComplete?.(finalResponse);
          return finalResponse;
        } else if (parsed.event === 'error') {
          throw new Error(typeof eventData?.message === 'string' ? eventData.message : 'Streaming request failed.');
        }
      }
      boundary = buffer.indexOf('\n\n');
    }

    if (done) {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error('Question stream ended before completion.');
  }

  return finalResponse;
}
