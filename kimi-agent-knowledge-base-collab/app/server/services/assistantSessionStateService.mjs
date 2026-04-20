import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function emptyState() {
  return {
    sessions: [],
    activeSessionId: "",
    businessPrompt: "",
    modelName: "gpt-4.1-mini",
  };
}

function normalizeSemanticStatus(status) {
  if (status === "failed") {
    return "interrupted";
  }

  return typeof status === "string" && status
    ? status
    : "thinking";
}

function truncateCommand(command) {
  const normalized = typeof command === "string"
    ? command.replace(/\s+/g, " ").trim()
    : "";

  if (!normalized) {
    return "";
  }

  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

function inferToolName(command) {
  const normalized = String(command || "").toLowerCase();
  if (normalized.includes("ner.sh") || normalized.includes("python -m ner")) {
    return "ner";
  }
  if (normalized.includes("re.sh") || normalized.includes("entity_relation")) {
    return "re";
  }
  return undefined;
}

function isInterruptedToolRun(toolRun) {
  if (!toolRun || typeof toolRun !== "object") {
    return false;
  }

  if (
    toolRun.status === "cancelled"
    || toolRun.status === "rejected"
    || toolRun.status === "timeout"
    || toolRun.status === "error"
  ) {
    return true;
  }

  return typeof toolRun.exitCode === "number" && toolRun.exitCode !== 0;
}

function executionStageLabel(status) {
  switch (status) {
    case "thinking":
      return "思考中...";
    case "executing":
      return "执行中...";
    case "reasoning":
      return "推理中...";
    case "observing":
      return "观察中...";
    case "interrupted":
      return "执行中断...";
    case "completed":
      return "执行结束...";
    default:
      return "思考中...";
  }
}

function normalizeExecutionStage(value) {
  const raw = asObject(value);
  if (!raw) {
    return null;
  }

  if (raw.sourceEventType === "legacy.tool_run") {
    return null;
  }

  const semanticStatus = normalizeSemanticStatus(raw.semanticStatus);

  return {
    id: typeof raw.id === "string" ? raw.id : "",
    semanticStatus,
    label: typeof raw.label === "string" ? raw.label : executionStageLabel(semanticStatus),
    phaseState: raw.phaseState === "completed" ? "completed" : "active",
    sourceEventType: typeof raw.sourceEventType === "string" ? raw.sourceEventType : "request.started",
    detail: typeof raw.detail === "string" ? raw.detail : "",
    callId: typeof raw.callId === "string" ? raw.callId : null,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : null,
  };
}

function createCompatibilityStage({
  id,
  semanticStatus,
  detail,
  sourceEventType,
  callId = null,
  startedAt = null,
  finishedAt = null,
}) {
  const normalizedStatus = normalizeSemanticStatus(semanticStatus);

  return {
    id,
    semanticStatus: normalizedStatus,
    label: executionStageLabel(normalizedStatus),
    phaseState: "completed",
    sourceEventType,
    detail,
    callId,
    startedAt,
    finishedAt: finishedAt || startedAt,
  };
}

function normalizeToolRun(value) {
  const raw = asObject(value);
  if (!raw) {
    return null;
  }

  return {
    callId: typeof raw.callId === "string" ? raw.callId : "",
    command: typeof raw.command === "string" ? raw.command : "",
    status: typeof raw.status === "string" ? raw.status : "cancelled",
    stdout: typeof raw.stdout === "string" ? raw.stdout : "",
    stderr: typeof raw.stderr === "string" ? raw.stderr : "",
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
    cwd: typeof raw.cwd === "string" ? raw.cwd : null,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : null,
    truncated: Boolean(raw.truncated),
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : null,
  };
}

function normalizeContentBlock(value) {
  const raw = asObject(value);
  if (!raw || typeof raw.type !== "string") {
    return null;
  }

  if (raw.type === "assistant") {
    return {
      id: typeof raw.id === "string" ? raw.id : "",
      type: "assistant",
      content: typeof raw.content === "string" ? raw.content : "",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
      completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
      phase: raw.phase === "streaming" ? "streaming" : "completed",
    };
  }

  if (raw.type === "tool_call") {
    const command = typeof raw.command === "string" ? raw.command : "";
    return {
      id: typeof raw.id === "string" ? raw.id : "",
      type: "tool_call",
      callId: typeof raw.callId === "string" ? raw.callId : "",
      command,
      reasoning: typeof raw.reasoning === "string" ? raw.reasoning : undefined,
      toolName: typeof raw.toolName === "string" ? raw.toolName : inferToolName(command),
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    };
  }

  if (raw.type === "tool_result") {
    const command = typeof raw.command === "string" ? raw.command : "";
    return {
      id: typeof raw.id === "string" ? raw.id : "",
      type: "tool_result",
      callId: typeof raw.callId === "string" ? raw.callId : "",
      command,
      toolName: typeof raw.toolName === "string" ? raw.toolName : inferToolName(command),
      status: typeof raw.status === "string" ? raw.status : "cancelled",
      stdout: typeof raw.stdout === "string" ? raw.stdout : "",
      stderr: typeof raw.stderr === "string" ? raw.stderr : "",
      exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
      cwd: typeof raw.cwd === "string" ? raw.cwd : null,
      durationMs: typeof raw.durationMs === "number" ? raw.durationMs : null,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
      finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : null,
    };
  }

  return null;
}

function deriveCompatibilityExecutionStages({ id, question, answer, toolRuns }) {
  const runs = Array.isArray(toolRuns) ? toolRuns : [];
  const answerText = typeof answer === "string" ? answer.trim() : "";
  const questionText = typeof question === "string" ? question.trim() : "";
  const stageIdPrefix = typeof id === "string" && id ? id : "message";

  if (runs.length === 0) {
    if (!answerText) {
      return [];
    }

    return [
      createCompatibilityStage({
        id: `${stageIdPrefix}-compat-thinking-no-tool`,
        semanticStatus: "thinking",
        detail: questionText ? `正在分析问题：${truncateCommand(questionText)}` : "正在分析问题与上下文",
        sourceEventType: "compat.thinking",
      }),
      createCompatibilityStage({
        id: `${stageIdPrefix}-compat-reasoning-no-tool`,
        semanticStatus: "reasoning",
        detail: "正在整理最终回答",
        sourceEventType: "compat.reasoning",
      }),
      createCompatibilityStage({
        id: `${stageIdPrefix}-compat-completed-no-tool`,
        semanticStatus: "completed",
        detail: "本轮执行已结束",
        sourceEventType: "compat.completed",
      }),
    ];
  }

  const firstRun = runs[0];
  const lastRun = runs[runs.length - 1];
  const firstTimestamp = firstRun.startedAt || firstRun.finishedAt || null;
  const lastTimestamp = lastRun.finishedAt || lastRun.startedAt || firstTimestamp;
  const hasInterruptedRun = runs.some(isInterruptedToolRun);
  const stages = [
    createCompatibilityStage({
      id: `${stageIdPrefix}-compat-thinking`,
      semanticStatus: "thinking",
      detail: questionText ? `正在分析问题：${truncateCommand(questionText)}` : "正在分析问题与上下文",
      sourceEventType: "compat.thinking",
      startedAt: firstTimestamp,
      finishedAt: firstTimestamp,
    }),
  ];

  runs.forEach((run, index) => {
    const startedAt = run.startedAt || run.finishedAt || firstTimestamp;
    const finishedAt = run.finishedAt || startedAt;
    const commandText = truncateCommand(run.command);

    stages.push(createCompatibilityStage({
      id: `${stageIdPrefix}-compat-executing-${run.callId || index}`,
      semanticStatus: "executing",
      detail: commandText ? `正在执行：${commandText}` : "正在发起命令执行",
      sourceEventType: "compat.executing",
      callId: run.callId || null,
      startedAt,
      finishedAt,
    }));

    if (run.stdout || run.stderr || run.truncated) {
      stages.push(createCompatibilityStage({
        id: `${stageIdPrefix}-compat-observing-${run.callId || index}`,
        semanticStatus: "observing",
        detail: run.stderr && !run.stdout ? "正在观察错误输出" : "正在观察命令输出",
        sourceEventType: "compat.observing",
        callId: run.callId || null,
        startedAt: finishedAt,
        finishedAt,
      }));
    }

    if (isInterruptedToolRun(run)) {
      stages.push(createCompatibilityStage({
        id: `${stageIdPrefix}-compat-interrupted-${run.callId || index}`,
        semanticStatus: "interrupted",
        detail: "执行过程被中断或返回异常",
        sourceEventType: "compat.interrupted",
        callId: run.callId || null,
        startedAt: finishedAt,
        finishedAt,
      }));
    }
  });

  if (answerText) {
    stages.push(createCompatibilityStage({
      id: `${stageIdPrefix}-compat-reasoning`,
      semanticStatus: "reasoning",
      detail: "正在整理最终回答",
      sourceEventType: "compat.reasoning",
      startedAt: lastTimestamp,
      finishedAt: lastTimestamp,
    }));
  }

  stages.push(createCompatibilityStage({
    id: `${stageIdPrefix}-compat-final`,
    semanticStatus: answerText || !hasInterruptedRun ? "completed" : "interrupted",
    detail: answerText || !hasInterruptedRun ? "本轮执行已结束" : "本轮执行已中断",
    sourceEventType: answerText || !hasInterruptedRun ? "compat.completed" : "compat.interrupted",
    startedAt: lastTimestamp,
    finishedAt: lastTimestamp,
  }));

  return stages;
}

function normalizeMessage(value) {
  const raw = asObject(value);
  if (!raw) {
    return null;
  }

  const toolRuns = Array.isArray(raw.toolRuns)
    ? raw.toolRuns.map(normalizeToolRun).filter(Boolean)
    : [];
  const normalizedExecutionStages = Array.isArray(raw.executionStages)
    ? raw.executionStages.map(normalizeExecutionStage).filter(Boolean)
    : [];
  const executionStages = normalizedExecutionStages.length > 0
    ? normalizedExecutionStages
    : deriveCompatibilityExecutionStages({
      id: typeof raw.id === "string" ? raw.id : "",
      question: typeof raw.question === "string" ? raw.question : "",
      answer: typeof raw.answer === "string" ? raw.answer : "",
      toolRuns,
    });

  return {
    id: typeof raw.id === "string" ? raw.id : "",
    question: typeof raw.question === "string" ? raw.question : "",
    answer: typeof raw.answer === "string" ? raw.answer : "",
    relatedNames: Array.isArray(raw.relatedNames)
      ? raw.relatedNames.filter((item) => typeof item === "string")
      : [],
    executionStages,
    toolRuns,
    contentBlocks: Array.isArray(raw.contentBlocks)
      ? raw.contentBlocks.map(normalizeContentBlock).filter(Boolean)
      : [],
  };
}

function normalizeSession(value) {
  const raw = asObject(value);
  if (!raw) {
    return null;
  }

  return {
    id: typeof raw.id === "string" ? raw.id : "",
    title: typeof raw.title === "string" ? raw.title : "",
    draftQuestion: typeof raw.draftQuestion === "string" ? raw.draftQuestion : "",
    messages: Array.isArray(raw.messages)
      ? raw.messages.map(normalizeMessage).filter(Boolean)
      : [],
    error: null,
    loading: false,
    statusMessage: null,
  };
}

function normalizeState(value) {
  const raw = asObject(value);
  if (!raw) {
    return emptyState();
  }

  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.map(normalizeSession).filter(Boolean)
    : [];
  const activeSessionId = typeof raw.activeSessionId === "string" ? raw.activeSessionId : "";
  const businessPrompt = typeof raw.businessPrompt === "string" ? raw.businessPrompt : "";
  const modelName = typeof raw.modelName === "string" && raw.modelName.trim()
    ? raw.modelName.trim()
    : "gpt-4.1-mini";

  return {
    sessions,
    activeSessionId,
    businessPrompt,
    modelName,
  };
}

export class AssistantSessionStateService {
  constructor(options) {
    this.statePath = path.join(
      options.runtimeRoot,
      ".agent",
      "web-chat-state.json",
    );
  }

  async load() {
    await this.ensureStorageDir();

    try {
      const content = await readFile(this.statePath, "utf8");
      return normalizeState(JSON.parse(content));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return emptyState();
      }
      throw error;
    }
  }

  async save(input) {
    await this.ensureStorageDir();
    const normalized = normalizeState(input);
    await writeFile(
      this.statePath,
      JSON.stringify({
        version: 1,
        ...normalized,
      }, null, 2),
      "utf8",
    );
    return normalized;
  }

  async ensureStorageDir() {
    await mkdir(path.dirname(this.statePath), { recursive: true });
  }
}
