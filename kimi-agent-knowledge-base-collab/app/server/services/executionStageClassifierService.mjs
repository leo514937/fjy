const EXECUTION_STAGE_LABELS = Object.freeze({
  thinking: "思考中...",
  executing: "执行中...",
  reasoning: "推理中...",
  observing: "观察中...",
  interrupted: "执行中断...",
  completed: "执行结束...",
});

const VALID_EXECUTION_STAGE_STATUSES = new Set(Object.keys(EXECUTION_STAGE_LABELS));
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;
const ALL_EXECUTION_STAGE_STATUSES = Object.freeze(Object.keys(EXECUTION_STAGE_LABELS));

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function inferStatusFromText(detail, fallback = "thinking") {
  const normalized = asTrimmedString(detail).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (
    normalized.includes("中断")
    || normalized.includes("abort")
    || normalized.includes("cancel")
    || normalized.includes("timeout")
    || normalized.includes("超时")
  ) {
    return "interrupted";
  }

  if (
    normalized.includes("失败")
    || normalized.includes("error")
    || normalized.includes("exception")
    || normalized.includes("stderr")
  ) {
    return "interrupted";
  }

  if (
    normalized.includes("观察")
    || normalized.includes("读取输出")
    || normalized.includes("查看结果")
    || normalized.includes("scan result")
  ) {
    return "observing";
  }

  if (
    normalized.includes("推理")
    || normalized.includes("回答")
    || normalized.includes("答案")
    || normalized.includes("reason")
  ) {
    return "reasoning";
  }

  if (
    normalized.includes("执行")
    || normalized.includes("运行")
    || normalized.includes("tool")
    || normalized.includes("shell")
    || normalized.includes("command")
  ) {
    return "executing";
  }

  if (
    normalized.includes("完成")
    || normalized.includes("结束")
    || normalized.includes("done")
    || normalized.includes("complete")
  ) {
    return "completed";
  }

  return fallback;
}

function normalizeSemanticStatus(value) {
  const normalized = asTrimmedString(value)
    .toLowerCase()
    .replace(/[`"'{}\[\]\s]/g, "");

  if (!normalized) {
    return null;
  }

  if (VALID_EXECUTION_STAGE_STATUSES.has(normalized)) {
    return normalized;
  }

  return inferStatusFromText(normalized, null);
}

function buildCandidateStatuses(input) {
  const type = asTrimmedString(input?.type);
  const payload = input?.payload && typeof input.payload === "object" ? input.payload : {};
  const resultStatus = asTrimmedString(payload?.result?.status || payload?.status).toLowerCase();

  switch (type) {
    case "request.started":
      return ["thinking"];
    case "status.changed":
      return ["thinking", "executing", "reasoning", "observing"];
    case "tool.started":
      return ["executing"];
    case "tool.output.delta":
      return ["observing"];
    case "assistant.delta":
    case "assistant.completed":
      return ["reasoning"];
    case "runtime.error":
      return ["interrupted"];
    case "runtime.aborted":
      return ["interrupted"];
    case "command.completed":
    case "tool.finished":
      if (resultStatus === "cancelled" || resultStatus === "rejected" || resultStatus === "timeout") {
        return ["interrupted"];
      }
      if (resultStatus === "success") {
        return ["completed"];
      }
      return ["interrupted"];
    default:
      return [...ALL_EXECUTION_STAGE_STATUSES];
  }
}

function normalizeSemanticStatusWithinCandidates(value, candidateStatuses) {
  const normalized = normalizeSemanticStatus(value);
  if (!normalized) {
    return null;
  }

  return candidateStatuses.includes(normalized) ? normalized : null;
}

function extractLlmContent(payload) {
  const choice = payload?.choices?.[0]?.message?.content;
  if (typeof choice === "string") {
    return choice;
  }

  if (Array.isArray(choice)) {
    return choice
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function classifyCommandCompletedResult(result) {
  const status = asTrimmedString(result?.status).toLowerCase();

  if (status === "success") {
    return "completed";
  }

  if (
    status === "cancelled"
    || status === "rejected"
    || status === "timeout"
  ) {
    return "interrupted";
  }

  if (status) {
    return "interrupted";
  }

  if (typeof result?.exitCode === "number" && result.exitCode === 0) {
    return "completed";
  }

  return "interrupted";
}

export function getExecutionStageLabel(status) {
  return EXECUTION_STAGE_LABELS[status] || EXECUTION_STAGE_LABELS.thinking;
}

export function classifyExecutionStageFallback(input) {
  const type = asTrimmedString(input?.type);
  const payload = input?.payload && typeof input.payload === "object" ? input.payload : {};

  if (type === "request.started") {
    return "thinking";
  }

  if (type === "status.changed") {
    return inferStatusFromText(payload.detail, "thinking");
  }

  if (type === "tool.started") {
    return "executing";
  }

  if (type === "tool.output.delta") {
    return "observing";
  }

  if (type === "assistant.delta" || type === "assistant.completed") {
    return "reasoning";
  }

  if (type === "runtime.error") {
    return "interrupted";
  }

  if (type === "runtime.aborted") {
    return "interrupted";
  }

  if (type === "command.completed") {
    return classifyCommandCompletedResult(payload.result);
  }

  if (type === "tool.finished") {
    return classifyCommandCompletedResult(payload.result);
  }

  return inferStatusFromText(
    payload.detail
      || payload.message
      || payload.reason
      || payload.command,
    "thinking",
  );
}

function buildUserPrompt(input) {
  const payload = input?.payload && typeof input.payload === "object" ? input.payload : {};
  const candidateStatuses = buildCandidateStatuses(input);
  const snapshot = {
    eventType: input?.type || "",
    candidateStatuses,
    currentSemanticStatus: input?.currentSemanticStatus || null,
    detail: asTrimmedString(payload.detail) || null,
    message: asTrimmedString(payload.message) || null,
    reason: asTrimmedString(payload.reason) || null,
    command: asTrimmedString(payload.command)
      || asTrimmedString(payload?.toolCall?.input?.command)
      || asTrimmedString(payload?.result?.command)
      || null,
    stream: asTrimmedString(payload.stream) || null,
    status: asTrimmedString(payload.status)
      || asTrimmedString(payload?.result?.status)
      || null,
    delta: asTrimmedString(payload.delta).slice(0, 120) || null,
    chunk: asTrimmedString(payload.chunk).slice(0, 120) || null,
  };

  return JSON.stringify(snapshot);
}

function buildSystemPrompt(input) {
  const candidateStatuses = buildCandidateStatuses(input);

  return [
    "你是运行事件语义阶段分类器。",
    `当前事件只能从以下候选英文 code 中选择一个：${candidateStatuses.join(", ")}。`,
    "你的任务是把当前事件路由到最接近的执行阶段，而不是偷懒选择看起来最稳妥的终态。",
    "不要为了省事把大量事件都归到 completed，也不要把大量事件都归到 thinking。",
    "只有明确成功收口的终止事件才能选择 completed。",
    "只有明确取消、超时、拒绝、中断时才能选择 interrupted。",
    "执行报错、异常退出、工具失败等异常情况，也统一选择 interrupted。",
    "一般来说：开始规划更接近 thinking，发起工具或命令更接近 executing，读取工具输出更接近 observing，整理回答更接近 reasoning。",
    "如果多个候选都勉强合理，优先选择最贴近当前事件语义、并能让整条执行链路阶段分布自然均匀的那个。",
    "只输出一个英文 code，不要输出解释、标点、JSON 或额外文本。",
  ].join(" ");
}

export class ExecutionStageClassifierService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    this.requestTimeoutMs = Number.isFinite(Number(options.requestTimeoutMs))
      ? Number(options.requestTimeoutMs)
      : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async classify(input) {
    const candidateStatuses = buildCandidateStatuses(input);
    const fallbackStatus = classifyExecutionStageFallback(input);
    const fallbackResult = {
      semanticStatus: fallbackStatus,
      label: getExecutionStageLabel(fallbackStatus),
      via: "fallback",
    };

    if (!this.canUseLlm(input?.modelConfig)) {
      return fallbackResult;
    }

    try {
      const llmStatus = await this.classifyWithLlm(input);
      const normalized = normalizeSemanticStatusWithinCandidates(llmStatus, candidateStatuses);
      if (!normalized) {
        return fallbackResult;
      }

      return {
        semanticStatus: normalized,
        label: getExecutionStageLabel(normalized),
        via: "llm",
      };
    } catch {
      return fallbackResult;
    }
  }

  canUseLlm(modelConfig) {
    return Boolean(
      this.fetchImpl
      && asTrimmedString(modelConfig?.apiKey)
      && asTrimmedString(modelConfig?.baseUrl)
      && asTrimmedString(modelConfig?.modelName),
    );
  }

  async classifyWithLlm(input) {
    const modelConfig = input.modelConfig;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await this.fetchImpl(
        `${modelConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${modelConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: modelConfig.modelName,
            temperature: 0,
            max_tokens: 8,
            messages: [
              {
                role: "system",
                content: buildSystemPrompt(input),
              },
              {
                role: "user",
                content: buildUserPrompt(input),
              },
            ],
          }),
          signal: controller.signal,
        },
      );

      if (!response?.ok) {
        throw new Error(`Classifier request failed with status ${response?.status ?? "unknown"}`);
      }

      const payload = await response.json();
      return extractLlmContent(payload);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
