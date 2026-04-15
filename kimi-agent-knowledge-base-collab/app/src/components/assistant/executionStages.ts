import type {
  PersistedOntologyAssistantExecutionStage,
  PersistedOntologyAssistantMessage,
  PersistedOntologyAssistantToolRun,
} from '@/lib/api';

export interface ExecutionFlowStage extends PersistedOntologyAssistantExecutionStage {
  toolRun?: PersistedOntologyAssistantToolRun | null;
}

function normalizeSemanticStatus(
  status: PersistedOntologyAssistantExecutionStage['semanticStatus'] | 'failed' | undefined,
): PersistedOntologyAssistantExecutionStage['semanticStatus'] {
  if (status === 'failed') {
    return 'interrupted';
  }

  return status ?? 'thinking';
}

function truncateCommand(command: string): string {
  const normalized = command.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

function isInterruptedToolRun(toolRun: PersistedOntologyAssistantToolRun): boolean {
  if (toolRun.status === 'cancelled' || toolRun.status === 'rejected' || toolRun.status === 'timeout' || toolRun.status === 'error') {
    return true;
  }

  return typeof toolRun.exitCode === 'number' && toolRun.exitCode !== 0;
}

function createCompatibilityStage(params: {
  id: string;
  semanticStatus: PersistedOntologyAssistantExecutionStage['semanticStatus'];
  detail: string;
  sourceEventType: string;
  callId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}): PersistedOntologyAssistantExecutionStage {
  const semanticStatus = normalizeSemanticStatus(params.semanticStatus);

  return {
    id: params.id,
    semanticStatus,
    label: semanticStatusLabel(semanticStatus),
    phaseState: 'completed',
    sourceEventType: params.sourceEventType,
    detail: params.detail,
    callId: params.callId ?? null,
    startedAt: params.startedAt ?? null,
    finishedAt: params.finishedAt ?? params.startedAt ?? null,
  };
}

export function semanticStatusLabel(
  status: PersistedOntologyAssistantExecutionStage['semanticStatus'],
): string {
  switch (status) {
    case 'thinking':
      return '思考中...';
    case 'executing':
      return '执行中...';
    case 'reasoning':
      return '推理中...';
    case 'observing':
      return '观察中...';
    case 'interrupted':
      return '执行中断...';
    case 'completed':
      return '执行结束...';
    default:
      return '思考中...';
  }
}

function normalizeExecutionStage(
  stage: Partial<PersistedOntologyAssistantExecutionStage>,
): PersistedOntologyAssistantExecutionStage | null {
  if (stage.sourceEventType === 'legacy.tool_run') {
    return null;
  }

  const semanticStatus = normalizeSemanticStatus(stage.semanticStatus);

  return {
    id: stage.id ?? `stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    semanticStatus,
    label: stage.label ?? semanticStatusLabel(semanticStatus),
    phaseState: stage.phaseState === 'completed' ? 'completed' : 'active',
    sourceEventType: stage.sourceEventType ?? 'request.started',
    detail: stage.detail ?? '',
    callId: stage.callId ?? null,
    startedAt: stage.startedAt ?? null,
    finishedAt: stage.finishedAt ?? null,
  };
}

export function deriveExecutionStagesFromToolRuns(
  toolRuns: PersistedOntologyAssistantToolRun[],
): PersistedOntologyAssistantExecutionStage[] {
  return deriveCompatibilityStages({
    id: 'compat-legacy',
    question: '',
    answer: '',
    toolRuns,
  });
}

function deriveCompatibilityStages(message: Pick<PersistedOntologyAssistantMessage, 'id' | 'question' | 'answer' | 'toolRuns'>): PersistedOntologyAssistantExecutionStage[] {
  const toolRuns = Array.isArray(message.toolRuns) ? message.toolRuns : [];
  const answer = typeof message.answer === 'string' ? message.answer.trim() : '';
  const question = typeof message.question === 'string' ? message.question.trim() : '';
  const stageIdPrefix = message.id || 'message';

  if (toolRuns.length === 0) {
    if (!answer) {
      return [];
    }

    return [
      createCompatibilityStage({
        id: `${stageIdPrefix}-compat-thinking-no-tool`,
        semanticStatus: 'thinking',
        detail: question ? `正在分析问题：${truncateCommand(question)}` : '正在分析问题与上下文',
        sourceEventType: 'compat.thinking',
      }),
      createCompatibilityStage({
        id: `${stageIdPrefix}-compat-reasoning-no-tool`,
        semanticStatus: 'reasoning',
        detail: '正在整理最终回答',
        sourceEventType: 'compat.reasoning',
      }),
      createCompatibilityStage({
        id: `${stageIdPrefix}-compat-completed-no-tool`,
        semanticStatus: 'completed',
        detail: '本轮执行已结束',
        sourceEventType: 'compat.completed',
      }),
    ];
  }

  const firstToolRun = toolRuns[0];
  const lastToolRun = toolRuns[toolRuns.length - 1];
  const firstTimestamp = firstToolRun.startedAt ?? firstToolRun.finishedAt ?? null;
  const lastTimestamp = lastToolRun.finishedAt ?? lastToolRun.startedAt ?? firstTimestamp;
  const hasInterruptedRun = toolRuns.some(isInterruptedToolRun);

  const stages: PersistedOntologyAssistantExecutionStage[] = [
    createCompatibilityStage({
      id: `${stageIdPrefix}-compat-thinking`,
      semanticStatus: 'thinking',
      detail: question ? `正在分析问题：${truncateCommand(question)}` : '正在分析问题与上下文',
      sourceEventType: 'compat.thinking',
      startedAt: firstTimestamp,
      finishedAt: firstTimestamp,
    }),
  ];

  toolRuns.forEach((toolRun, index) => {
    const startedAt = toolRun.startedAt ?? toolRun.finishedAt ?? firstTimestamp;
    const finishedAt = toolRun.finishedAt ?? startedAt;
    const commandText = truncateCommand(toolRun.command);

      stages.push(createCompatibilityStage({
      id: `${stageIdPrefix}-compat-executing-${toolRun.callId || index}`,
      semanticStatus: 'executing',
      detail: commandText ? `正在执行：${commandText}` : '正在发起命令执行',
      sourceEventType: 'compat.executing',
      callId: toolRun.callId,
      startedAt,
      finishedAt,
    }));

    if (toolRun.stdout || toolRun.stderr || toolRun.truncated) {
      stages.push(createCompatibilityStage({
        id: `${stageIdPrefix}-compat-observing-${toolRun.callId || index}`,
        semanticStatus: 'observing',
        detail: toolRun.stderr && !toolRun.stdout ? '正在观察错误输出' : '正在观察命令输出',
        sourceEventType: 'compat.observing',
        callId: toolRun.callId,
        startedAt: finishedAt,
        finishedAt,
      }));
    }

    if (isInterruptedToolRun(toolRun)) {
      stages.push(createCompatibilityStage({
        id: `${stageIdPrefix}-compat-interrupted-${toolRun.callId || index}`,
        semanticStatus: 'interrupted',
        detail: '执行过程被中断或返回异常',
        sourceEventType: 'compat.interrupted',
        callId: toolRun.callId,
        startedAt: finishedAt,
        finishedAt,
      }));
    }
  });

  if (answer) {
    stages.push(createCompatibilityStage({
      id: `${stageIdPrefix}-compat-reasoning`,
      semanticStatus: 'reasoning',
      detail: '正在整理最终回答',
      sourceEventType: 'compat.reasoning',
      startedAt: lastTimestamp,
      finishedAt: lastTimestamp,
    }));
  }

  stages.push(createCompatibilityStage({
    id: `${stageIdPrefix}-compat-final`,
    semanticStatus: answer || !hasInterruptedRun ? 'completed' : 'interrupted',
    detail: answer || !hasInterruptedRun ? '本轮执行已结束' : '本轮执行已中断',
    sourceEventType: answer || !hasInterruptedRun ? 'compat.completed' : 'compat.interrupted',
    startedAt: lastTimestamp,
    finishedAt: lastTimestamp,
  }));

  return stages;
}

export function upsertExecutionStage(
  stages: PersistedOntologyAssistantExecutionStage[],
  incomingStage: Partial<PersistedOntologyAssistantExecutionStage>,
): PersistedOntologyAssistantExecutionStage[] {
  const normalizedStage = normalizeExecutionStage(incomingStage);
  if (!normalizedStage) {
    return stages;
  }
  const existingIndex = stages.findIndex((stage) => stage.id === normalizedStage.id);

  if (existingIndex !== -1) {
    const nextStages = [...stages];
    nextStages[existingIndex] = {
      ...nextStages[existingIndex],
      ...normalizedStage,
    };
    return nextStages;
  }

  const nextStages: PersistedOntologyAssistantExecutionStage[] = stages.map((stage, index) => {
    if (index !== stages.length - 1 || stage.phaseState === 'completed') {
      return stage;
    }

    return {
      ...stage,
      phaseState: 'completed' as const,
      finishedAt: normalizedStage.startedAt ?? stage.finishedAt,
    };
  });

  nextStages.push(normalizedStage);
  return nextStages;
}

export function normalizeAssistantMessageStages<T extends Pick<PersistedOntologyAssistantMessage, 'toolRuns'> & {
  executionStages?: PersistedOntologyAssistantExecutionStage[];
  question?: string;
  answer?: string;
  id?: string;
}>(message: T): T & { executionStages: PersistedOntologyAssistantExecutionStage[] } {
  const normalizedExecutionStages = Array.isArray(message.executionStages) && message.executionStages.length > 0
    ? message.executionStages.map(normalizeExecutionStage).filter(Boolean)
    : [];
  const executionStages = normalizedExecutionStages.length > 0
    ? normalizedExecutionStages
    : deriveCompatibilityStages({
      id: message.id ?? 'message',
      question: message.question ?? '',
      answer: message.answer ?? '',
      toolRuns: message.toolRuns,
    });

  return {
    ...message,
    executionStages,
  };
}

export function buildExecutionFlowStages(messages: PersistedOntologyAssistantMessage[]): ExecutionFlowStage[] {
  return messages.flatMap((message) => {
    const normalizedMessage = normalizeAssistantMessageStages(message);
    return normalizedMessage.executionStages.map((stage) => ({
      ...stage,
      toolRun: stage.callId
        ? normalizedMessage.toolRuns.find((toolRun) => toolRun.callId === stage.callId) ?? null
        : null,
    }));
  });
}
