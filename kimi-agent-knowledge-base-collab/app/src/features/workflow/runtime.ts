import { apiFetch, parseSseEvent } from '@/shared/api/http';
import { WORKFLOW_STAGE_KEYS } from '../../shared/workflowStages.js';

export interface WorkflowStageResult {
  stage: string;
  order: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  started_at?: string | null;
  finished_at?: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
}

export interface IngestResult {
  entity_id: string;
  entity_name: string;
  filename: string;
  status: string;
  commit_id: string;
  version_id: number | null;
  error?: string;
}

export interface FileWorkflowRunResponse {
  ok: boolean;
  workflow: {
    mode: string;
    status: string;
    steps: string[];
  };
  input_file?: {
    originalName?: string;
    storedName?: string;
    size?: number;
    path?: string;
  };
  stage_results: WorkflowStageResult[];
  ingest_results: IngestResult[];
  errors: Array<{ stage: string; message: string }>;
  runtime_root: string;
  started_at?: string;
  finished_at?: string;
}

export interface WorkflowLogItem {
  id: string;
  level: 'info' | 'success' | 'error';
  message: string;
  stage?: string;
  createdAt: string;
}

export interface WorkflowRunSession {
  conversationId: string;
  projectId: string;
  statusMessage: string;
  isRunning: boolean;
  runResult: FileWorkflowRunResponse | null;
  logs: WorkflowLogItem[];
  lastRunAt: string | null;
  updatedAt: string;
}

type Subscriber = (session: WorkflowRunSession) => void;
type SessionsSubscriber = (sessions: WorkflowRunSession[]) => void;

const STORAGE_KEY = 'kimi.fileWorkflow.sessions.v1';
const MAX_LOG_ITEMS = 120;
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function createConversationId() {
  return `file-workflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendUniqueLog(prev: WorkflowLogItem[], next: WorkflowLogItem): WorkflowLogItem[] {
  return [...prev, next].slice(-MAX_LOG_ITEMS);
}

function mergeStageResult(
  stageResults: WorkflowStageResult[],
  nextStage: WorkflowStageResult,
): WorkflowStageResult[] {
  const exists = stageResults.some((stage) => stage.stage === nextStage.stage);
  if (!exists) return [...stageResults, nextStage].sort((a, b) => a.order - b.order);
  return stageResults
    .map((stage) => (stage.stage === nextStage.stage ? { ...stage, ...nextStage } : stage))
    .sort((a, b) => a.order - b.order);
}

function createPendingRunResult(file: File, projectId: string): FileWorkflowRunResponse {
  return {
    ok: false,
    workflow: {
      mode: 'linear',
      status: 'running',
      steps: [...WORKFLOW_STAGE_KEYS],
    },
    input_file: {
      originalName: file.name,
      size: file.size,
      path: projectId,
    },
    stage_results: WORKFLOW_STAGE_KEYS.map((stage, index) => ({
      stage,
      order: index + 1,
      status: 'pending',
      started_at: null,
      finished_at: null,
      output: null,
      error: null,
    })),
    ingest_results: [],
    errors: [],
    runtime_root: '',
    started_at: new Date().toISOString(),
  };
}

function createRetryDraft(prev: FileWorkflowRunResponse, startStage: string): FileWorkflowRunResponse {
  const targetIndex = WORKFLOW_STAGE_KEYS.indexOf(startStage);
  const targetOrder = targetIndex === -1 ? Number.MAX_SAFE_INTEGER : targetIndex + 1;
  return {
    ...prev,
    workflow: {
      ...prev.workflow,
      status: 'running',
    },
    errors: prev.errors.filter((item) => {
      const index = WORKFLOW_STAGE_KEYS.indexOf(item.stage);
      return index !== -1 && index + 1 < targetOrder;
    }),
    ingest_results: targetOrder <= WORKFLOW_STAGE_KEYS.length ? [] : prev.ingest_results,
    stage_results: prev.stage_results.map((stage) => (
      stage.order >= targetOrder
        ? {
          ...stage,
          status: 'pending',
          started_at: null,
          finished_at: null,
          output: null,
          error: null,
        }
        : stage
    )),
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

class WorkflowRuntimeManager {
  private sessions = new Map<string, WorkflowRunSession>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private sessionSubscribers = new Set<SessionsSubscriber>();
  private latestConversationId: string | null = null;
  private currentReader: ReadableStreamDefaultReader | null = null;

  constructor() {
    this.restore();
  }

  private restore() {
    if (!canUseStorage()) return;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        latestConversationId?: string | null;
        sessions?: WorkflowRunSession[];
      };
      this.latestConversationId = parsed.latestConversationId ?? null;
      for (const session of parsed.sessions ?? []) {
        this.sessions.set(session.conversationId, {
          ...session,
          isRunning: false,
          statusMessage: session.isRunning
            ? '已恢复最近一次工作流快照，切换页面前的最新状态如下'
            : session.statusMessage,
        });
      }
    } catch {
      this.sessions.clear();
      this.latestConversationId = null;
    }
  }

  private persist() {
    if (!canUseStorage()) return;
    const sessions = Array.from(this.sessions.values()).sort((a, b) => (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ));
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      latestConversationId: this.latestConversationId,
      sessions,
    }));
  }

  private getSortedSessions() {
    return Array.from(this.sessions.values()).sort((a, b) => (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ));
  }

  private emitSessions() {
    const sessions = this.getSortedSessions();
    this.sessionSubscribers.forEach((subscriber) => subscriber(sessions));
  }

  private emit(conversationId: string) {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    this.persist();
    this.emitSessions();
    const callbacks = this.subscribers.get(conversationId);
    callbacks?.forEach((callback) => callback(session));
  }

  private update(conversationId: string, updater: (current: WorkflowRunSession) => WorkflowRunSession) {
    const current = this.sessions.get(conversationId);
    if (!current) return;
    const next = updater(current);
    this.sessions.set(conversationId, next);
    this.latestConversationId = conversationId;
    this.emit(conversationId);
  }

  getLatestSession() {
    if (!this.latestConversationId) return null;
    return this.sessions.get(this.latestConversationId) ?? null;
  }

  getAllSessions() {
    return this.getSortedSessions();
  }

  getSession(conversationId: string) {
    return this.sessions.get(conversationId) ?? null;
  }

  subscribe(conversationId: string, subscriber: Subscriber) {
    const callbacks = this.subscribers.get(conversationId) ?? new Set<Subscriber>();
    callbacks.add(subscriber);
    this.subscribers.set(conversationId, callbacks);
    const session = this.sessions.get(conversationId);
    if (session) {
      subscriber(session);
    }
    return () => {
      const current = this.subscribers.get(conversationId);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) {
        this.subscribers.delete(conversationId);
      }
    };
  }

  subscribeSessions(subscriber: SessionsSubscriber) {
    this.sessionSubscribers.add(subscriber);
    subscriber(this.getSortedSessions());
    return () => {
      this.sessionSubscribers.delete(subscriber);
    };
  }

  activateSession(conversationId: string) {
    if (!this.sessions.has(conversationId)) {
      return;
    }
    this.latestConversationId = conversationId;
    this.persist();
    this.emitSessions();
    const session = this.sessions.get(conversationId);
    const callbacks = this.subscribers.get(conversationId);
    if (session) {
      callbacks?.forEach((callback) => callback(session));
    }
  }

  removeSession(conversationId: string) {
    this.sessions.delete(conversationId);
    this.subscribers.delete(conversationId);
    if (this.latestConversationId === conversationId) {
      const nextLatest = Array.from(this.sessions.values()).sort((a, b) => (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ))[0];
      this.latestConversationId = nextLatest?.conversationId ?? null;
    }
    this.persist();
    this.emitSessions();
  }

  startRun(input: {
    file: File;
    projectId: string;
  }) {
    const conversationId = createConversationId();
    const draft = createPendingRunResult(input.file, input.projectId);
    const session: WorkflowRunSession = {
      conversationId,
      projectId: input.projectId,
      statusMessage: '正在建立流式连接，准备执行八阶段工作流...',
      isRunning: true,
      runResult: draft,
      logs: [
        {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          level: 'info',
          message: '已创建执行草稿，等待后端分阶段返回结果',
          createdAt: new Date().toLocaleTimeString(),
        },
      ],
      lastRunAt: null,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(conversationId, session);
    this.latestConversationId = conversationId;
    this.emit(conversationId);

    // 启动前先尝试取消旧读取器
    if (this.currentReader) {
      void this.currentReader.cancel().catch(() => {});
      this.currentReader = null;
    }

    void this.consumeStream({
      conversationId,
      draft,
      request: apiFetch(
        `/api/workflow/file/run/stream?fileName=${encodeURIComponent(input.file.name)}&projectId=${encodeURIComponent(input.projectId)}&conversationId=${encodeURIComponent(conversationId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': input.file.type || 'application/octet-stream',
            Accept: 'text/event-stream',
          },
          body: input.file,
        },
      ),
    });
    return conversationId;
  }

  retryFromStage(input: {
    conversationId: string;
    startStage: string;
  }) {
    const session = this.sessions.get(input.conversationId);
    if (!session?.runResult) {
      throw new Error('未找到可重试的工作流会话');
    }
    const draft = createRetryDraft(session.runResult, input.startStage);
    this.update(input.conversationId, (current) => ({
      ...current,
      statusMessage: `准备从 ${input.startStage} 继续执行`,
      isRunning: true,
      runResult: draft,
      logs: appendUniqueLog(current.logs, {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        level: 'info',
        message: `用户触发从 ${input.startStage} 重试`,
        stage: input.startStage,
        createdAt: new Date().toLocaleTimeString(),
      }),
      updatedAt: new Date().toISOString(),
    }));

    void this.consumeStream({
      conversationId: input.conversationId,
      draft,
      request: apiFetch(
        `/api/workflow/file/retry/stream?projectId=${encodeURIComponent(session.projectId)}&conversationId=${encodeURIComponent(input.conversationId)}&startStage=${encodeURIComponent(input.startStage)}`,
        {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
          },
        },
      ),
    });
  }

  async terminateRun(conversationId: string) {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    // 先斩后奏：立即更新本地状态，让用户感觉到“已终止”
    this.update(conversationId, (current) => ({
      ...current,
      statusMessage: '正在请求终止后台任务...',
      isRunning: false,
      logs: appendUniqueLog(current.logs, {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        level: 'error',
        message: '用户点击了终止按钮',
        createdAt: new Date().toLocaleTimeString(),
      }),
      updatedAt: new Date().toISOString(),
    }));

    try {
      if (this.currentReader) {
        void this.currentReader.cancel().catch(() => {});
        this.currentReader = null;
      }
      await apiFetch(`/api/workflow/terminate?conversationId=${encodeURIComponent(conversationId)}`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Termination API failed:', error);
    }
  }

  private async consumeStream(input: {
    conversationId: string;
    draft: FileWorkflowRunResponse;
    request: Promise<Response>;
  }) {
    try {
      const response = await input.request;
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `请求失败：${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        this.currentReader = reader; // 记录当前读取器
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex !== -1) {
          const rawEvent = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          const parsed = parseSseEvent(rawEvent);
          if (parsed) {
            this.handleEvent(input.conversationId, input.draft, parsed.event, parsed.data);
          }
          boundaryIndex = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件直传失败';
      this.update(input.conversationId, (current) => ({
        ...current,
        statusMessage: message,
        isRunning: false,
        logs: appendUniqueLog(current.logs, {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          level: 'error',
          message,
          createdAt: new Date().toLocaleTimeString(),
        }),
        updatedAt: new Date().toISOString(),
      }));
    }
  }

  private handleEvent(
    conversationId: string,
    draft: FileWorkflowRunResponse,
    event: string,
    data: unknown,
  ) {
    if (event === 'status') {
      const message = asText(asRecord(data).message) || '工作流状态更新';
      this.update(conversationId, (current) => ({
        ...current,
        statusMessage: message,
        logs: appendUniqueLog(current.logs, {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          level: 'info',
          message,
          createdAt: new Date().toLocaleTimeString(),
        }),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    if (event === 'workflow_stage') {
      const stageData = data as WorkflowStageResult;
      this.update(conversationId, (current) => {
        const base = current.runResult ?? draft;
        const previousStage = base.stage_results.find((stage) => stage.stage === stageData.stage) ?? null;
        const shouldAppendLog = (
          !previousStage
          || previousStage.status !== stageData.status
          || previousStage.error !== stageData.error
          || previousStage.finished_at !== stageData.finished_at
        );
        return {
          ...current,
          runResult: {
            ...base,
            stage_results: mergeStageResult(base.stage_results, stageData),
            workflow: {
              ...base.workflow,
              status: stageData.status === 'failed' ? 'failed' : 'running',
            },
          },
          logs: shouldAppendLog
            ? appendUniqueLog(current.logs, {
              id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              level: stageData.status === 'failed' ? 'error' : stageData.status === 'success' ? 'success' : 'info',
              message: `${stageData.order}. ${stageData.stage} ${stageData.status === 'running' ? '开始' : stageData.status === 'success' ? '完成' : '失败'}`,
              stage: stageData.stage,
              createdAt: new Date().toLocaleTimeString(),
            })
            : current.logs,
          updatedAt: new Date().toISOString(),
        };
      });
      return;
    }

    if (event === 'complete') {
      const payload = data as FileWorkflowRunResponse;
      this.update(conversationId, (current) => ({
        ...current,
        runResult: payload,
        lastRunAt: new Date().toLocaleString(),
        statusMessage: payload.ok
          ? '工作流执行完成，所有结果已同步展示。'
          : (payload.errors?.[0]?.message || '工作流失败'),
        isRunning: false,
        logs: appendUniqueLog(current.logs, {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          level: payload.ok ? 'success' : 'error',
          message: payload.ok ? '工作流完成，图谱与仓库已同步刷新' : (payload.errors?.[0]?.message || '工作流失败'),
          createdAt: new Date().toLocaleTimeString(),
        }),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    if (event === 'error') {
      const message = asText(asRecord(data).message) || '工作流异常中断';
      this.update(conversationId, (current) => ({
        ...current,
        statusMessage: message,
        isRunning: false,
        logs: appendUniqueLog(current.logs, {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          level: 'error',
          message,
          createdAt: new Date().toLocaleTimeString(),
        }),
        updatedAt: new Date().toISOString(),
      }));
    }
  }
}

const workflowRuntimeManager = new WorkflowRuntimeManager();

export function getLatestWorkflowSession() {
  return workflowRuntimeManager.getLatestSession();
}

export function getWorkflowSession(conversationId: string) {
  return workflowRuntimeManager.getSession(conversationId);
}

export function getAllWorkflowSessions() {
  return workflowRuntimeManager.getAllSessions();
}

export function subscribeWorkflowSession(conversationId: string, subscriber: Subscriber) {
  return workflowRuntimeManager.subscribe(conversationId, subscriber);
}

export function subscribeWorkflowSessions(subscriber: SessionsSubscriber) {
  return workflowRuntimeManager.subscribeSessions(subscriber);
}

export function startWorkflowRun(input: { file: File; projectId: string }) {
  return workflowRuntimeManager.startRun(input);
}

export function retryWorkflowRunFromStage(input: { conversationId: string; startStage: string }) {
  return workflowRuntimeManager.retryFromStage(input);
}

export function removeWorkflowSession(conversationId: string) {
  return workflowRuntimeManager.removeSession(conversationId);
}

export function terminateWorkflowRun(conversationId: string) {
  return workflowRuntimeManager.terminateRun(conversationId);
}

export function activateWorkflowSession(conversationId: string) {
  return workflowRuntimeManager.activateSession(conversationId);
}
