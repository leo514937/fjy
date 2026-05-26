import { apiFetch, parseJson, parseSseEvent } from '@/shared/api/http';
import { WORKFLOW_V2_STAGE_KEYS } from '../../shared/workflowV2Stages.js';

export interface WorkflowV2StageResult {
  stage: string;
  order: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  started_at?: string | null;
  finished_at?: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
}

export interface WorkflowV2Result {
  document: Record<string, unknown> | null;
  chunks: Array<Record<string, unknown>>;
  windows: Array<Record<string, unknown>>;
  objects: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  ablation: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  reason?: string;
}

export interface WorkflowV2RunResponse {
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
    mimeType?: string;
  };
  stage_results: WorkflowV2StageResult[];
  errors: Array<{ stage: string; message: string }>;
  runtime_root: string;
  result: WorkflowV2Result;
  started_at?: string;
  finished_at?: string;
}

export interface WorkflowV2LogItem {
  id: string;
  level: 'info' | 'success' | 'error';
  message: string;
  stage?: string;
  createdAt: string;
}

export interface WorkflowV2WindowExtractProgress {
  completed: number;
  total: number;
  parallel: number;
  lastWindowId: string | null;
}

export interface WorkflowV2ObjectDecomposeProgress {
  completed: number;
  total: number;
  failed: number;
  lastObjectName: string | null;
  lastFailedObjectName: string | null;
}

export interface WorkflowV2AblationAnalysisProgress {
  completed: number;
  total: number;
  lastParentObjectId: string | null;
  lastParentObjectName: string | null;
  currentParentObjectId: string | null;
  currentParentObjectName: string | null;
  currentChildObjectId: string | null;
  currentChildObjectName: string | null;
  processedChildCount: number;
  totalChildCount: number;
}

export interface WorkflowV2RunSession {
  conversationId: string;
  projectId: string;
  statusMessage: string;
  isRunning: boolean;
  runResult: WorkflowV2RunResponse | null;
  windowExtractProgress: WorkflowV2WindowExtractProgress | null;
  objectDecomposeProgress: WorkflowV2ObjectDecomposeProgress | null;
  ablationAnalysisProgress: WorkflowV2AblationAnalysisProgress | null;
  logs: WorkflowV2LogItem[];
  lastRunAt: string | null;
  updatedAt: string;
}

type Subscriber = (session: WorkflowV2RunSession) => void;
type SessionsSubscriber = (sessions: WorkflowV2RunSession[]) => void;

const STORAGE_KEY = 'kimi.fileWorkflowV2.sessions.v1';
const MAX_LOG_ITEMS = 120;
const MAX_PERSISTED_SESSIONS = 6;
const RECOVERABLE_RUNNING_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

function trimText(value: unknown, limit = 240): string {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function compactArray<T>(value: unknown, limit: number, mapper: (item: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, limit).map((item, index) => mapper(item, index));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getStageOutput(runResult: WorkflowV2RunResponse | null | undefined, stageKey: string): Record<string, unknown> {
  const stage = runResult?.stage_results?.find((item) => item.stage === stageKey) ?? null;
  return asRecord(stage?.output);
}

function extractWindowProgressFromRunResult(runResult: WorkflowV2RunResponse | null | undefined): WorkflowV2WindowExtractProgress | null {
  const progress = asRecord(getStageOutput(runResult, 'window_extract').progress);
  const completed = Number(progress.completed);
  const total = Number(progress.total);
  const parallel = Number(progress.parallel);
  if (!Number.isFinite(completed) || !Number.isFinite(total)) {
    return null;
  }
  return {
    completed: Math.max(0, Math.floor(completed)),
    total: Math.max(0, Math.floor(total)),
    parallel: Number.isFinite(parallel) ? Math.max(1, Math.floor(parallel)) : 1,
    lastWindowId: null,
  };
}

function extractObjectDecomposeProgressFromRunResult(runResult: WorkflowV2RunResponse | null | undefined): WorkflowV2ObjectDecomposeProgress | null {
  const progress = asRecord(getStageOutput(runResult, 'object_decompose').progress);
  const completed = Number(progress.completed);
  const total = Number(progress.total);
  const failed = Number(progress.failed);
  if (!Number.isFinite(completed) || !Number.isFinite(total)) {
    return null;
  }
  return {
    completed: Math.max(0, Math.floor(completed)),
    total: Math.max(0, Math.floor(total)),
    failed: Number.isFinite(failed) ? Math.max(0, Math.floor(failed)) : 0,
    lastObjectName: null,
    lastFailedObjectName: null,
  };
}

function extractAblationAnalysisProgressFromRunResult(runResult: WorkflowV2RunResponse | null | undefined): WorkflowV2AblationAnalysisProgress | null {
  const progress = asRecord(getStageOutput(runResult, 'ablation_analysis').progress);
  const completed = Number(progress.completed);
  const total = Number(progress.total);
  if (!Number.isFinite(completed) || !Number.isFinite(total)) {
    return null;
  }
  return {
    completed: Math.max(0, Math.floor(completed)),
    total: Math.max(0, Math.floor(total)),
    lastParentObjectId: null,
    lastParentObjectName: null,
    currentParentObjectId: null,
    currentParentObjectName: null,
    currentChildObjectId: null,
    currentChildObjectName: null,
    processedChildCount: 0,
    totalChildCount: 0,
  };
}

function createConversationId() {
  return `file-workflow-v2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendUniqueLog(prev: WorkflowV2LogItem[], next: WorkflowV2LogItem): WorkflowV2LogItem[] {
  return [...prev, next].slice(-MAX_LOG_ITEMS);
}

function compactStageOutput(stage: string, output: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!output) {
    return output;
  }

  if (stage === 'chunk_parse') {
    return {
      total_chunks: output.total_chunks,
      reason: trimText(output.reason, 300),
      chunks: compactArray(output.chunks, 24, (item) => {
        const record = asRecord(item);
        return {
          chunk_id: record.chunk_id,
          order: record.order,
          text: trimText(record.text, 180),
          reason: trimText(record.reason, 120),
        };
      }),
    };
  }

  if (stage === 'window_extract') {
    const windows = Array.isArray(output.windows) ? output.windows : [];
    const windowResults = Array.isArray(output.window_results) ? output.window_results : [];
    return {
      total_windows: Number(output.total_windows ?? windows.length) || windows.length,
      reason: trimText(output.reason, 300),
      progress: asRecord(output.progress),
      windows: compactArray(windows, 20, (item) => {
        const record = asRecord(item);
        return {
          window_id: record.window_id,
          order: record.order,
          chunk_ids: compactArray(record.chunk_ids, 8, (chunkId) => trimText(chunkId, 32)),
          reason: trimText(record.reason, 120),
        };
      }),
      window_results: compactArray(windowResults, 20, (item) => {
        const record = asRecord(item);
        return {
          window_id: record.window_id,
          reason: trimText(record.reason, 120),
          objects: compactArray(record.objects, 12, (objectItem) => {
            const objectRecord = asRecord(objectItem);
            return {
              object_name: trimText(objectRecord.object_name, 80),
              normalized_name: trimText(objectRecord.normalized_name, 80),
              confidence: objectRecord.confidence,
            };
          }),
        };
      }),
    };
  }

  if (stage === 'object_fusion') {
    const fusedObjects = Array.isArray(output.fused_objects) ? output.fused_objects : [];
    return {
      total_fused_objects: Number(output.total_fused_objects ?? fusedObjects.length) || fusedObjects.length,
      reason: trimText(output.reason, 300),
      fused_objects: compactArray(fusedObjects, 30, (item) => {
        const record = asRecord(item);
        return {
          object_id: record.object_id,
          object_name: trimText(record.object_name, 100),
          normalized_name: trimText(record.normalized_name, 100),
          aliases: compactArray(record.aliases, 6, (alias) => trimText(alias, 60)),
          citations: compactArray(record.citations, 4, (citation) => trimText(citation, 140)),
          citation_count: Array.isArray(record.citations) ? record.citations.length : 0,
          confidence: record.confidence,
          reason: trimText(record.reason, 120),
        };
      }),
    };
  }

  if (stage === 'function_analysis') {
    const functionObjects = Array.isArray(output.function_objects) ? output.function_objects : [];
    return {
      total_function_objects: Number(output.total_function_objects ?? functionObjects.length) || functionObjects.length,
      reason: trimText(output.reason, 300),
      progress: asRecord(output.progress),
      function_objects: compactArray(functionObjects, 30, (item) => {
        const record = asRecord(item);
        return {
          object_id: record.object_id,
          object_name: trimText(record.object_name, 100),
          normalized_name: trimText(record.normalized_name, 100),
          aliases: compactArray(record.aliases, 6, (alias) => trimText(alias, 60)),
          citations: compactArray(record.citations, 4, (citation) => trimText(citation, 140)),
          citation_count: Array.isArray(record.citations) ? record.citations.length : 0,
          core_function: trimText(record.core_function, 160),
          citation: compactArray(record.citation, 4, (citation) => trimText(citation, 140)),
          confidence: record.confidence,
          reason: trimText(record.reason, 120),
        };
      }),
    };
  }

  if (stage === 'object_decompose') {
    const decompositionResults = Array.isArray(output.decomposition_results) ? output.decomposition_results : [];
    const failedObjects = Array.isArray(output.failed_objects) ? output.failed_objects : [];
    const totalDecompositions = decompositionResults.reduce((sum, item) => {
      const record = asRecord(item);
      return sum + (Array.isArray(record.decompositions) ? record.decompositions.length : 0);
    }, 0);
    return {
      total_decomposition_groups: Number(output.total_decomposition_groups ?? decompositionResults.length) || decompositionResults.length,
      total_decompositions: Number(output.total_decompositions ?? totalDecompositions) || totalDecompositions,
      total_failed_objects: Number(output.total_failed_objects ?? failedObjects.length) || failedObjects.length,
      reason: trimText(output.reason, 300),
      progress: asRecord(output.progress),
      decomposition_results: compactArray(decompositionResults, 24, (item) => {
        const record = asRecord(item);
        return {
          object_id: record.object_id,
          reason: trimText(record.reason, 120),
          decompositions: compactArray(record.decompositions, 8, (edgeItem) => {
            const edgeRecord = asRecord(edgeItem);
            return {
              parent_object_name: trimText(edgeRecord.parent_object_name, 80),
              child_object_name: trimText(edgeRecord.child_object_name, 80),
              relation: trimText(edgeRecord.relation, 40),
              citation: trimText(edgeRecord.citation, 120),
              confidence: edgeRecord.confidence,
              reason: trimText(edgeRecord.reason, 120),
            };
          }),
        };
      }),
      failed_objects: compactArray(failedObjects, 8, (item) => {
        const record = asRecord(item);
        return {
          object_id: record.object_id,
          object_name: trimText(record.object_name, 100),
          reason: trimText(record.reason, 160),
          attempts: compactArray(record.attempts, 3, (attemptItem) => {
            const attemptRecord = asRecord(attemptItem);
            return {
              attempt: attemptRecord.attempt,
              error: trimText(attemptRecord.error, 160),
              model_output: trimText(attemptRecord.model_output, 320),
            };
          }),
        };
      }),
    };
  }

  if (stage === 'graph_build') {
    const edges = Array.isArray(output.edges) ? output.edges : [];
    const removedCycleEdges = Array.isArray(output.removed_cycle_edges) ? output.removed_cycle_edges : [];
    return {
      total_edges: Number(output.total_edges ?? edges.length) || edges.length,
      total_removed_cycle_edges: Number(output.total_removed_cycle_edges ?? removedCycleEdges.length) || removedCycleEdges.length,
      reason: trimText(output.reason, 300),
      edges: compactArray(edges, 40, (item) => {
        const record = asRecord(item);
        return {
          edge_id: record.edge_id,
          source_object_id: record.source_object_id,
          target_object_id: record.target_object_id,
          citation: trimText(record.citation, 140),
          reason: trimText(record.reason, 120),
        };
      }),
      removed_cycle_edges: compactArray(removedCycleEdges, 12, (item) => {
        const record = asRecord(item);
        return {
          edge_id: record.edge_id,
          citation: trimText(record.citation, 140),
          reason: trimText(record.reason, 120),
        };
      }),
    };
  }

  if (stage === 'ablation_analysis') {
    const parentSummaries = Array.isArray(output.parent_summaries) ? output.parent_summaries : [];
    return {
      total_parent_summaries: Number(output.total_parent_summaries ?? parentSummaries.length) || parentSummaries.length,
      reason: trimText(output.reason, 300),
      progress: asRecord(output.progress),
      parent_summaries: compactArray(parentSummaries, 16, (item) => {
        const record = asRecord(item);
        return {
          parent_object_id: record.parent_object_id,
          reason: trimText(record.reason, 120),
          sibling_dependency_table: compactArray(record.sibling_dependency_table, 8, (impact) => {
            const impactRecord = asRecord(impact);
            return {
              ablated_child_object_id: impactRecord.ablated_child_object_id,
              target_sibling_object_id: impactRecord.target_sibling_object_id,
              impact_level: impactRecord.impact_level,
            };
          }),
          child_importance_list: compactArray(record.child_importance_list, 8, (impact) => {
            const impactRecord = asRecord(impact);
            return {
              ablated_child_object_id: impactRecord.ablated_child_object_id,
              importance_level: impactRecord.importance_level,
            };
          }),
        };
      }),
    };
  }

  return {
    reason: trimText(output.reason, 300),
  };
}

function compactRunResultForStorage(runResult: WorkflowV2RunResponse | null, mode: 'normal' | 'minimal'): WorkflowV2RunResponse | null {
  if (!runResult) {
    return null;
  }

  const stageResults = runResult.stage_results.map((stage) => ({
    ...stage,
    output: mode === 'minimal' ? null : compactStageOutput(stage.stage, stage.output),
  }));

  return {
    ...runResult,
    stage_results: stageResults,
    result: {
      document: runResult.result?.document ? {
        document_id: asRecord(runResult.result.document).document_id,
        file_name: asRecord(runResult.result.document).file_name,
        project_id: asRecord(runResult.result.document).project_id,
        language: asRecord(runResult.result.document).language,
        reason: trimText(asRecord(runResult.result.document).reason, 160),
      } : null,
      chunks: mode === 'minimal' ? [] : compactArray(runResult.result?.chunks, 20, (item) => {
        const record = asRecord(item);
        return {
          chunk_id: record.chunk_id,
          order: record.order,
          text: trimText(record.text, 160),
          reason: trimText(record.reason, 120),
        };
      }),
      windows: mode === 'minimal' ? [] : compactArray(runResult.result?.windows, 16, (item) => {
        const record = asRecord(item);
        return {
          window_id: record.window_id,
          order: record.order,
          chunk_ids: compactArray(record.chunk_ids, 8, (chunkId) => trimText(chunkId, 32)),
        };
      }),
      objects: mode === 'minimal' ? [] : compactArray(runResult.result?.objects, 24, (item) => {
        const record = asRecord(item);
        return {
          object_id: record.object_id,
          object_name: trimText(record.object_name, 100),
          normalized_name: trimText(record.normalized_name, 100),
          core_function: trimText(record.core_function, 140),
          is_isolated: record.is_isolated === true,
          structure_status: trimText(record.structure_status, 32),
          structure_reason: trimText(record.structure_reason, 120),
        };
      }),
      edges: mode === 'minimal' ? [] : compactArray(runResult.result?.edges, 30, (item) => {
        const record = asRecord(item);
        return {
          edge_id: record.edge_id,
          source_object_id: record.source_object_id,
          target_object_id: record.target_object_id,
        };
      }),
      ablation: mode === 'minimal' ? [] : compactArray(runResult.result?.ablation, 12, (item) => {
        const record = asRecord(item);
        return {
          parent_object_id: record.parent_object_id,
          reason: trimText(record.reason, 120),
        };
      }),
      meta: asRecord(runResult.result?.meta),
      reason: trimText(runResult.result?.reason, 200),
    },
  };
}

function compactSessionForStorage(session: WorkflowV2RunSession, mode: 'normal' | 'minimal'): WorkflowV2RunSession {
  return {
    ...session,
    isRunning: false,
    statusMessage: trimText(session.statusMessage, 240),
    runResult: compactRunResultForStorage(session.runResult, mode),
    windowExtractProgress: session.windowExtractProgress,
    objectDecomposeProgress: session.objectDecomposeProgress,
    ablationAnalysisProgress: session.ablationAnalysisProgress,
    logs: mode === 'minimal'
      ? compactArray(session.logs, 12, (item) => {
        const record = asRecord(item);
        return {
          id: record.id as string,
          level: (record.level as WorkflowV2LogItem['level']) || 'info',
          message: trimText(record.message, 120),
          stage: typeof record.stage === 'string' ? record.stage : undefined,
          createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
        };
      })
      : compactArray(session.logs, 24, (item) => {
        const record = asRecord(item);
        return {
          id: record.id as string,
          level: (record.level as WorkflowV2LogItem['level']) || 'info',
          message: trimText(record.message, 180),
          stage: typeof record.stage === 'string' ? record.stage : undefined,
          createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
        };
      }),
  };
}

function mergeStageResult(
  stageResults: WorkflowV2StageResult[],
  nextStage: WorkflowV2StageResult,
): WorkflowV2StageResult[] {
  const exists = stageResults.some((stage) => stage.stage === nextStage.stage);
  if (!exists) return [...stageResults, nextStage].sort((a, b) => a.order - b.order);
  return stageResults
    .map((stage) => (stage.stage === nextStage.stage ? { ...stage, ...nextStage } : stage))
    .sort((a, b) => a.order - b.order);
}

function createEmptyWorkflowResult(): WorkflowV2Result {
  return {
    document: null,
    chunks: [],
    windows: [],
    objects: [],
    edges: [],
    ablation: [],
    meta: {
      total_chunks: 0,
      total_windows: 0,
      total_objects: 0,
      total_edges: 0,
      is_dag: true,
    },
  };
}

function createPendingRunResult(file: File, projectId: string): WorkflowV2RunResponse {
  return {
    ok: false,
    workflow: {
      mode: 'analysis-v2',
      status: 'running',
      steps: [...WORKFLOW_V2_STAGE_KEYS],
    },
    input_file: {
      originalName: file.name,
      size: file.size,
      path: projectId,
      mimeType: file.type || 'application/octet-stream',
    },
    stage_results: WORKFLOW_V2_STAGE_KEYS.map((stage, index) => ({
      stage,
      order: index + 1,
      status: 'pending',
      started_at: null,
      finished_at: null,
      output: null,
      error: null,
    })),
    errors: [],
    runtime_root: '',
    result: createEmptyWorkflowResult(),
    started_at: new Date().toISOString(),
  };
}

function createRetryDraft(prev: WorkflowV2RunResponse, startStage: string): WorkflowV2RunResponse {
  const targetIndex = WORKFLOW_V2_STAGE_KEYS.indexOf(startStage);
  const targetOrder = targetIndex === -1 ? Number.MAX_SAFE_INTEGER : targetIndex + 1;
  return {
    ...prev,
    workflow: {
      ...prev.workflow,
      status: 'running',
    },
    errors: prev.errors.filter((item) => {
      const index = WORKFLOW_V2_STAGE_KEYS.indexOf(item.stage);
      return index !== -1 && index + 1 < targetOrder;
    }),
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

function getWorkflowV2RetryBlockReason(runResult: WorkflowV2RunResponse | null, startStage: string): string | null {
  if (!runResult) {
    return '未找到可重试的 V2 工作流结果';
  }

  const targetIndex = WORKFLOW_V2_STAGE_KEYS.indexOf(startStage);
  if (targetIndex === -1) {
    return '目标阶段不存在';
  }

  const targetStage = runResult.stage_results.find((stage) => stage.stage === startStage) ?? null;
  if (!targetStage || !['success', 'failed'].includes(targetStage.status)) {
    return `阶段 ${startStage} 当前状态不可重试`;
  }

  for (let index = 0; index < targetIndex; index += 1) {
    const previousStage = runResult.stage_results.find((stage) => stage.stage === WORKFLOW_V2_STAGE_KEYS[index]) ?? null;
    if (!previousStage || previousStage.status !== 'success') {
      return `前序阶段 ${WORKFLOW_V2_STAGE_KEYS[index]} 尚未成功完成`;
    }
  }

  return null;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function getSessionFreshnessTimestamp(session: WorkflowV2RunSession | null | undefined) {
  if (!session) {
    return 0;
  }
  const candidates = [
    session.updatedAt,
    session.lastRunAt,
    session.runResult?.finished_at,
    session.runResult?.started_at,
  ];
  for (const candidate of candidates) {
    const timestamp = typeof candidate === 'string' ? new Date(candidate).getTime() : NaN;
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return timestamp;
    }
  }
  return 0;
}

function isRecoverableRunningSession(session: WorkflowV2RunSession | null | undefined) {
  if (!session?.runResult || session.runResult.workflow?.status !== 'running') {
    return false;
  }
  const timestamp = getSessionFreshnessTimestamp(session);
  if (!timestamp) {
    return false;
  }
  return (Date.now() - timestamp) <= RECOVERABLE_RUNNING_SESSION_MAX_AGE_MS;
}

function demoteRecoveredRunningSnapshot(runResult: WorkflowV2RunResponse | null | undefined): WorkflowV2RunResponse | null {
  if (!runResult || runResult.workflow?.status !== 'running') {
    return runResult ?? null;
  }
  return {
    ...runResult,
    workflow: {
      ...runResult.workflow,
      status: 'failed',
    },
    stage_results: runResult.stage_results.map((stage) => (
      stage.status === 'running'
        ? {
          ...stage,
          status: 'failed',
          finished_at: stage.finished_at ?? new Date().toISOString(),
          error: stage.error || '恢复页面时未检测到可继续接管的后台 V2 任务。',
        }
        : stage
    )),
    errors: runResult.errors.length > 0
      ? runResult.errors
      : [{ stage: 'resume', message: '恢复页面时未检测到可继续接管的后台 V2 任务。' }],
  };
}

class WorkflowRuntimeV2Manager {
  private sessions = new Map<string, WorkflowV2RunSession>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private sessionSubscribers = new Set<SessionsSubscriber>();
  private latestConversationId: string | null = null;
  private activeReaders = new Map<string, ReadableStreamDefaultReader>();
  private hydrationPromises = new Map<string, Promise<void>>();

  constructor() {
    this.restore();
    if (typeof window !== 'undefined') {
      queueMicrotask(() => {
        void this.resumeRecoverableSessions();
      });
    }
  }

  private restore() {
    if (!canUseStorage()) return;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        latestConversationId?: string | null;
        sessions?: WorkflowV2RunSession[];
      };
      this.latestConversationId = parsed.latestConversationId ?? null;
      for (const session of parsed.sessions ?? []) {
        const recoverableRunning = isRecoverableRunningSession(session);
        const restoredRunResult = recoverableRunning
          ? session.runResult
          : demoteRecoveredRunningSnapshot(session.runResult);
        this.sessions.set(session.conversationId, {
          ...session,
          isRunning: false,
          runResult: restoredRunResult,
          windowExtractProgress: session.windowExtractProgress ?? null,
          objectDecomposeProgress: session.objectDecomposeProgress ?? null,
          ablationAnalysisProgress: session.ablationAnalysisProgress ?? null,
          statusMessage: recoverableRunning
            ? '已恢复近期 V2 工作流快照，正在尝试重新连接后台任务...'
            : (session.runResult?.workflow?.status === 'running'
              ? '已恢复历史 V2 快照；旧运行任务未自动接管。'
              : session.statusMessage),
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
    const limitedSessions = sessions.slice(0, MAX_PERSISTED_SESSIONS);
    const persistPayload = (mode: 'normal' | 'minimal') => JSON.stringify({
      latestConversationId: this.latestConversationId,
      sessions: limitedSessions.map((session) => compactSessionForStorage(session, mode)),
    });

    try {
      window.sessionStorage.setItem(STORAGE_KEY, persistPayload('normal'));
      return;
    } catch (error) {
      console.warn('Persisting full V2 session snapshot exceeded storage quota, falling back to compact snapshot.', error);
    }

    try {
      window.sessionStorage.setItem(STORAGE_KEY, persistPayload('minimal'));
      return;
    } catch (error) {
      console.warn('Persisting compact V2 session snapshot still exceeded storage quota, clearing stored snapshot.', error);
    }

    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore cleanup failure
    }
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

  private update(conversationId: string, updater: (current: WorkflowV2RunSession) => WorkflowV2RunSession) {
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
    void this.hydrateSessionFromServer(conversationId);
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
    void this.hydrateSessionFromServer(conversationId);
  }

  removeSession(conversationId: string) {
    this.sessions.delete(conversationId);
    this.subscribers.delete(conversationId);
    const activeReader = this.activeReaders.get(conversationId);
    if (activeReader) {
      void activeReader.cancel().catch(() => {});
      this.activeReaders.delete(conversationId);
    }
    if (this.latestConversationId === conversationId) {
      const nextLatest = this.getSortedSessions()[0];
      this.latestConversationId = nextLatest?.conversationId ?? null;
    }
    this.persist();
    this.emitSessions();
  }

  startRun(input: { file: File; projectId: string }) {
    const conversationId = createConversationId();
    const draft = createPendingRunResult(input.file, input.projectId);
    const session: WorkflowV2RunSession = {
      conversationId,
      projectId: input.projectId,
      statusMessage: '正在建立流式连接，准备执行文件工作流 V2...',
      isRunning: true,
      runResult: draft,
      windowExtractProgress: null,
      objectDecomposeProgress: null,
      ablationAnalysisProgress: null,
      logs: [
        {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          level: 'info',
          message: '已创建 V2 执行草稿，等待后端按阶段返回结果。',
          createdAt: new Date().toLocaleTimeString(),
        },
      ],
      lastRunAt: null,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(conversationId, session);
    this.latestConversationId = conversationId;
    this.emit(conversationId);

    void this.consumeStream({
      conversationId,
      draft,
      request: apiFetch(
        `/api/workflow/v2/file/run/stream?fileName=${encodeURIComponent(input.file.name)}&projectId=${encodeURIComponent(input.projectId)}&conversationId=${encodeURIComponent(conversationId)}`,
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

  retryFromStage(input: { conversationId: string; startStage: string }) {
    const session = this.sessions.get(input.conversationId);
    if (!session?.runResult) {
      throw new Error('未找到可重试的 V2 工作流会话');
    }
    const retryBlockReason = getWorkflowV2RetryBlockReason(session.runResult, input.startStage);
    if (retryBlockReason) {
      throw new Error(retryBlockReason);
    }
    const targetIndex = WORKFLOW_V2_STAGE_KEYS.indexOf(input.startStage);
    const draft = createRetryDraft(session.runResult, input.startStage);
    this.update(input.conversationId, (current) => ({
      ...current,
      statusMessage: `准备从 ${input.startStage} 继续执行`,
      isRunning: true,
      runResult: draft,
      windowExtractProgress: targetIndex <= WORKFLOW_V2_STAGE_KEYS.indexOf('window_extract') ? null : current.windowExtractProgress,
      objectDecomposeProgress: targetIndex <= WORKFLOW_V2_STAGE_KEYS.indexOf('object_decompose') ? null : current.objectDecomposeProgress,
      ablationAnalysisProgress: targetIndex <= WORKFLOW_V2_STAGE_KEYS.indexOf('ablation_analysis') ? null : current.ablationAnalysisProgress,
      logs: appendUniqueLog(current.logs, {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        level: 'info',
        message: `用户触发从 ${input.startStage} 重试 V2 工作流`,
        stage: input.startStage,
        createdAt: new Date().toLocaleTimeString(),
      }),
      updatedAt: new Date().toISOString(),
    }));

    void this.consumeStream({
      conversationId: input.conversationId,
      draft,
      request: apiFetch(
        `/api/workflow/v2/file/retry/stream?projectId=${encodeURIComponent(session.projectId)}&conversationId=${encodeURIComponent(input.conversationId)}&startStage=${encodeURIComponent(input.startStage)}`,
        {
          method: 'POST',
          headers: { Accept: 'text/event-stream' },
        },
      ),
    });
  }

  async terminateRun(conversationId: string) {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    this.update(conversationId, (current) => ({
      ...current,
      statusMessage: '正在请求终止后台 V2 任务...',
      isRunning: false,
      logs: appendUniqueLog(current.logs, {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        level: 'error',
        message: '用户点击了 V2 工作流的终止按钮',
        createdAt: new Date().toLocaleTimeString(),
      }),
      updatedAt: new Date().toISOString(),
    }));

    try {
      const activeReader = this.activeReaders.get(conversationId);
      if (activeReader) {
        void activeReader.cancel().catch(() => {});
        this.activeReaders.delete(conversationId);
      }
      await apiFetch(`/api/workflow/v2/terminate?conversationId=${encodeURIComponent(conversationId)}`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('V2 termination API failed:', error);
    }
  }

  private async resumeRecoverableSessions() {
    const recoverableSessions = this.getSortedSessions().filter((session) => isRecoverableRunningSession(session));
    for (const session of recoverableSessions) {
      if (this.activeReaders.has(session.conversationId)) {
        continue;
      }
      await this.hydrateSessionFromServer(session.conversationId);
      void this.attachToRunningSession(session.conversationId);
    }
  }

  private async hydrateSessionFromServer(conversationId: string) {
    if (!conversationId || !this.sessions.has(conversationId)) {
      return;
    }
    const pending = this.hydrationPromises.get(conversationId);
    if (pending) {
      await pending;
      return;
    }

    const promise = (async () => {
      try {
        const response = await apiFetch(`/api/workflow/v2/session?conversationId=${encodeURIComponent(conversationId)}`);
        const payload = await parseJson<WorkflowV2RunResponse>(response);
        this.update(conversationId, (current) => {
          const workflowStatus = payload.workflow?.status || current.runResult?.workflow?.status || 'idle';
          const nextIsRunning = workflowStatus === 'running';
          const hydratedWindowProgress = extractWindowProgressFromRunResult(payload);
          const hydratedObjectDecomposeProgress = extractObjectDecomposeProgressFromRunResult(payload);
          const hydratedAblationAnalysisProgress = extractAblationAnalysisProgressFromRunResult(payload);
          const nextStatusMessage = nextIsRunning
            ? current.statusMessage
            : workflowStatus === 'success'
              ? '已从服务端恢复完整 V2 结果。'
              : (payload.errors?.[0]?.message || current.statusMessage);
          return {
            ...current,
            runResult: payload,
            isRunning: nextIsRunning,
            windowExtractProgress: hydratedWindowProgress ?? current.windowExtractProgress,
            objectDecomposeProgress: hydratedObjectDecomposeProgress ?? current.objectDecomposeProgress,
            ablationAnalysisProgress: hydratedAblationAnalysisProgress ?? current.ablationAnalysisProgress,
            statusMessage: nextStatusMessage,
            updatedAt: new Date().toISOString(),
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('snapshot not found') || message.includes('Request failed with status 404')) {
          return;
        }
        console.warn('Hydrating workflow V2 session from server failed:', error);
      } finally {
        this.hydrationPromises.delete(conversationId);
      }
    })();

    this.hydrationPromises.set(conversationId, promise);
    await promise;
  }

  private async attachToRunningSession(conversationId: string) {
    const session = this.sessions.get(conversationId);
    if (!session || this.activeReaders.has(conversationId) || !isRecoverableRunningSession(session)) {
      return;
    }
    this.update(conversationId, (current) => ({
      ...current,
      isRunning: true,
      statusMessage: '已恢复最近一次 V2 工作流快照，正在尝试重新连接后台任务...',
      updatedAt: new Date().toISOString(),
    }));
    void this.consumeStream({
      conversationId,
      draft: session.runResult ?? createPendingRunResult(new File([], 'resume.txt'), session.projectId),
      request: apiFetch(`/api/workflow/v2/attach/stream?conversationId=${encodeURIComponent(conversationId)}`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      }),
      mode: 'attach',
    });
  }

  private async consumeStream(input: {
    conversationId: string;
    draft: WorkflowV2RunResponse;
    request: Promise<Response>;
    mode?: 'run' | 'attach';
  }) {
    try {
      const response = await input.request;
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        if (input.mode === 'attach' && response.status === 404) {
          throw new Error('__workflow_v2_attach_not_found__');
        }
        throw new Error(text || `请求失败：${response.status}`);
      }

      const reader = response.body.getReader();
      this.activeReaders.set(input.conversationId, reader);
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
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
      if (input.mode === 'attach' && error instanceof Error && error.message === '__workflow_v2_attach_not_found__') {
        this.update(input.conversationId, (current) => ({
          ...current,
          statusMessage: '未检测到正在运行的后台任务，当前展示的是刷新前保留的最近一次快照。',
          isRunning: false,
          logs: appendUniqueLog(current.logs, {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            level: 'info',
            message: '刷新后尝试恢复 V2 流式连接，但服务端未发现仍在运行的同会话任务。',
            createdAt: new Date().toLocaleTimeString(),
          }),
          updatedAt: new Date().toISOString(),
        }));
        return;
      }
      const current = this.sessions.get(input.conversationId) ?? null;
      const failedStage = current?.runResult?.stage_results?.find((stage) => stage.status === 'failed') ?? null;
      const fallbackMessage = current?.statusMessage || failedStage?.error || '文件工作流 V2 执行失败';
      const rawMessage = error instanceof Error ? error.message : '文件工作流 V2 执行失败';
      const message = rawMessage === 'fetch failed' ? fallbackMessage : rawMessage;
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
    } finally {
      this.activeReaders.delete(input.conversationId);
    }
  }

  private handleEvent(
    conversationId: string,
    draft: WorkflowV2RunResponse,
    event: string,
    data: unknown,
  ) {
    if (event === 'status') {
      const message = asText(asRecord(data).message) || 'V2 工作流状态更新';
      const payload = asRecord(data);
      const stage = asText(payload.stage);
      const completed = Number(payload.completed);
      const total = Number(payload.total);
      const parallel = Number(payload.parallel);
      const windowId = asText(payload.window_id) || null;
      const failed = Number(payload.failed);
      const objectName = asText(payload.object_name) || null;
      const parentObjectId = asText(payload.parent_object_id) || null;
      const parentObjectName = asText(payload.parent_object_name) || null;
      const currentParentObjectId = asText(payload.current_parent_object_id) || null;
      const currentParentObjectName = asText(payload.current_parent_object_name) || null;
      const currentChildObjectId = asText(payload.current_child_object_id) || null;
      const currentChildObjectName = asText(payload.current_child_object_name) || null;
      const processedChildCount = Number(payload.processed_child_count);
      const totalChildCount = Number(payload.total_child_count);
      const skipped = payload.skipped === true;
      const isWindowExtractProgress = (
        stage === 'window_extract'
        && Number.isFinite(completed)
        && Number.isFinite(total)
      );
      const isObjectDecomposeProgress = (
        stage === 'object_decompose'
        && Number.isFinite(completed)
        && Number.isFinite(total)
      );
      const isAblationAnalysisProgress = (
        stage === 'ablation_analysis'
        && Number.isFinite(completed)
        && Number.isFinite(total)
      );
      this.update(conversationId, (current) => ({
        ...current,
        statusMessage: message,
        windowExtractProgress: isWindowExtractProgress
          ? {
            completed: Math.max(0, Math.floor(completed)),
            total: Math.max(0, Math.floor(total)),
            parallel: Number.isFinite(parallel) ? Math.max(1, Math.floor(parallel)) : 1,
            lastWindowId: windowId || current.windowExtractProgress?.lastWindowId || null,
          }
          : current.windowExtractProgress,
        objectDecomposeProgress: isObjectDecomposeProgress
          ? {
            completed: Math.max(0, Math.floor(completed)),
            total: Math.max(0, Math.floor(total)),
            failed: Number.isFinite(failed) ? Math.max(0, Math.floor(failed)) : current.objectDecomposeProgress?.failed ?? 0,
            lastObjectName: objectName || current.objectDecomposeProgress?.lastObjectName || null,
            lastFailedObjectName: skipped
              ? (objectName || current.objectDecomposeProgress?.lastFailedObjectName || null)
              : current.objectDecomposeProgress?.lastFailedObjectName || null,
          }
          : current.objectDecomposeProgress,
        ablationAnalysisProgress: isAblationAnalysisProgress
          ? {
            completed: Math.max(0, Math.floor(completed)),
            total: Math.max(0, Math.floor(total)),
            lastParentObjectId: parentObjectId || current.ablationAnalysisProgress?.lastParentObjectId || null,
            lastParentObjectName: parentObjectName || current.ablationAnalysisProgress?.lastParentObjectName || null,
            currentParentObjectId: currentParentObjectId ?? (
              parentObjectId && Math.max(0, Math.floor(completed)) >= Math.max(0, Math.floor(total))
                ? null
                : current.ablationAnalysisProgress?.currentParentObjectId ?? null
            ),
            currentParentObjectName: currentParentObjectName ?? (
              parentObjectName && Math.max(0, Math.floor(completed)) >= Math.max(0, Math.floor(total))
                ? null
                : current.ablationAnalysisProgress?.currentParentObjectName ?? null
            ),
            currentChildObjectId: currentChildObjectId || (
              parentObjectId && Math.max(0, Math.floor(completed)) >= Math.max(0, Math.floor(total))
                ? null
                : current.ablationAnalysisProgress?.currentChildObjectId ?? null
            ),
            currentChildObjectName: currentChildObjectName || (
              parentObjectName && Math.max(0, Math.floor(completed)) >= Math.max(0, Math.floor(total))
                ? null
                : current.ablationAnalysisProgress?.currentChildObjectName ?? null
            ),
            processedChildCount: Number.isFinite(processedChildCount)
              ? Math.max(0, Math.floor(processedChildCount))
              : current.ablationAnalysisProgress?.processedChildCount ?? 0,
            totalChildCount: Number.isFinite(totalChildCount)
              ? Math.max(0, Math.floor(totalChildCount))
              : current.ablationAnalysisProgress?.totalChildCount ?? 0,
          }
          : current.ablationAnalysisProgress,
        logs: isWindowExtractProgress || isObjectDecomposeProgress || isAblationAnalysisProgress
          ? current.logs
          : appendUniqueLog(current.logs, {
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
      const stageData = data as WorkflowV2StageResult;
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
          windowExtractProgress: stageData.stage === 'window_extract' && stageData.status === 'success'
            ? (() => {
              const output = asRecord(stageData.output);
              const progress = asRecord(output.progress);
              const completed = Number(progress.completed);
              const total = Number(progress.total);
              const parallel = Number(progress.parallel);
              if (!Number.isFinite(completed) || !Number.isFinite(total)) {
                return current.windowExtractProgress;
              }
              return {
                completed: Math.max(0, Math.floor(completed)),
                total: Math.max(0, Math.floor(total)),
                parallel: Number.isFinite(parallel) ? Math.max(1, Math.floor(parallel)) : 1,
                lastWindowId: current.windowExtractProgress?.lastWindowId ?? null,
              };
            })()
            : current.windowExtractProgress,
          objectDecomposeProgress: stageData.stage === 'object_decompose' && stageData.status === 'success'
            ? (() => {
              const output = asRecord(stageData.output);
              const progress = asRecord(output.progress);
              const completed = Number(progress.completed);
              const total = Number(progress.total);
              const failed = Number(progress.failed);
              if (!Number.isFinite(completed) || !Number.isFinite(total)) {
                return current.objectDecomposeProgress;
              }
              return {
                completed: Math.max(0, Math.floor(completed)),
                total: Math.max(0, Math.floor(total)),
                failed: Number.isFinite(failed) ? Math.max(0, Math.floor(failed)) : current.objectDecomposeProgress?.failed ?? 0,
                lastObjectName: current.objectDecomposeProgress?.lastObjectName ?? null,
                lastFailedObjectName: current.objectDecomposeProgress?.lastFailedObjectName ?? null,
              };
            })()
            : current.objectDecomposeProgress,
          ablationAnalysisProgress: stageData.stage === 'ablation_analysis' && stageData.status === 'success'
            ? (() => {
              const output = asRecord(stageData.output);
              const progress = asRecord(output.progress);
              const completed = Number(progress.completed);
              const total = Number(progress.total);
              if (!Number.isFinite(completed) || !Number.isFinite(total)) {
                return current.ablationAnalysisProgress;
              }
              return {
                completed: Math.max(0, Math.floor(completed)),
                total: Math.max(0, Math.floor(total)),
                lastParentObjectId: current.ablationAnalysisProgress?.lastParentObjectId ?? null,
                lastParentObjectName: current.ablationAnalysisProgress?.lastParentObjectName ?? null,
                currentParentObjectId: null,
                currentParentObjectName: null,
                currentChildObjectId: null,
                currentChildObjectName: null,
                processedChildCount: current.ablationAnalysisProgress?.processedChildCount ?? 0,
                totalChildCount: current.ablationAnalysisProgress?.totalChildCount ?? 0,
              };
            })()
            : current.ablationAnalysisProgress,
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
      const payload = data as WorkflowV2RunResponse;
      this.update(conversationId, (current) => ({
        ...current,
        runResult: payload,
        lastRunAt: new Date().toLocaleString(),
        statusMessage: payload.ok
          ? 'V2 工作流执行完成，分析结果已同步展示。'
          : (payload.errors?.[0]?.message || 'V2 工作流失败'),
        isRunning: false,
        windowExtractProgress: current.windowExtractProgress,
        objectDecomposeProgress: current.objectDecomposeProgress,
        ablationAnalysisProgress: current.ablationAnalysisProgress,
        logs: appendUniqueLog(current.logs, {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          level: payload.ok ? 'success' : 'error',
          message: payload.ok ? 'V2 工作流完成，DAG 与消融结果已就绪' : (payload.errors?.[0]?.message || 'V2 工作流失败'),
          createdAt: new Date().toLocaleTimeString(),
        }),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    if (event === 'error') {
      const message = asText(asRecord(data).message) || 'V2 工作流异常中断';
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

const workflowRuntimeV2Manager = new WorkflowRuntimeV2Manager();

export function getLatestWorkflowV2Session() {
  return workflowRuntimeV2Manager.getLatestSession();
}

export function getWorkflowV2Session(conversationId: string) {
  return workflowRuntimeV2Manager.getSession(conversationId);
}

export function getAllWorkflowV2Sessions() {
  return workflowRuntimeV2Manager.getAllSessions();
}

export function subscribeWorkflowV2Session(conversationId: string, subscriber: Subscriber) {
  return workflowRuntimeV2Manager.subscribe(conversationId, subscriber);
}

export function subscribeWorkflowV2Sessions(subscriber: SessionsSubscriber) {
  return workflowRuntimeV2Manager.subscribeSessions(subscriber);
}

export function startWorkflowV2Run(input: { file: File; projectId: string }) {
  return workflowRuntimeV2Manager.startRun(input);
}

export function retryWorkflowV2RunFromStage(input: { conversationId: string; startStage: string }) {
  return workflowRuntimeV2Manager.retryFromStage(input);
}

export function removeWorkflowV2Session(conversationId: string) {
  return workflowRuntimeV2Manager.removeSession(conversationId);
}

export function terminateWorkflowV2Run(conversationId: string) {
  return workflowRuntimeV2Manager.terminateRun(conversationId);
}

export function activateWorkflowV2Session(conversationId: string) {
  return workflowRuntimeV2Manager.activateSession(conversationId);
}
