import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ExecutionStageClassifierService, getExecutionStageLabel } from "./executionStageClassifierService.mjs";

const WEB_CHAT_CONVERSATION_STATE_VERSION = 2;
const DEFAULT_HISTORY_TURN_LIMIT = 6;
const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
const DEFAULT_CONTROL_TIMEOUT_MS = 15_000;
const DEFAULT_EXECUTION_STAGE_DETAIL = "已整理知识库上下文，准备连接 Agent CLI...";

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function createExecutionStageId() {
  return `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractExecutionStageDetail(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};

  if (event.type === "request.started") {
    return typeof payload.detail === "string" ? payload.detail : DEFAULT_EXECUTION_STAGE_DETAIL;
  }

  if (event.type === "status.changed") {
    return typeof payload.detail === "string" ? payload.detail : "";
  }

  if (event.type === "tool.started") {
    const toolName = asNonEmptyString(payload?.toolCall?.name);
    return toolName ? `正在调用 ${toolName} 工具` : "正在发起工具执行";
  }

  if (event.type === "tool.output.delta") {
    return payload.stream === "stderr" ? "正在观察错误输出" : "正在观察命令输出";
  }

  if (event.type === "assistant.delta" || event.type === "assistant.completed") {
    return "正在整理回答内容";
  }

  if (event.type === "runtime.error") {
    return typeof payload.message === "string" ? payload.message : "运行阶段出现异常";
  }

  if (event.type === "runtime.aborted") {
    return typeof payload.reason === "string" ? payload.reason : "本轮执行已中断";
  }

  if (event.type === "command.completed") {
    return "本轮执行已完成";
  }

  return "";
}

function extractExecutionStageCallId(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  if (typeof payload.callId === "string") {
    return payload.callId;
  }
  if (typeof payload?.toolCall?.id === "string") {
    return payload.toolCall.id;
  }
  if (typeof payload?.result?.callId === "string") {
    return payload.result.callId;
  }

  return null;
}

class ExecutionStageTracker {
  constructor(options) {
    this.classifier = options.classifier;
    this.handlers = options.handlers;
    this.modelConfig = options.modelConfig;
    this.currentStage = null;
  }

  async track(event, options = {}) {
    const classification = await this.classifier.classify({
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
      modelConfig: this.modelConfig,
      currentSemanticStatus: this.currentStage?.semanticStatus,
    });

    if (!classification?.semanticStatus) {
      return;
    }

    const detail = extractExecutionStageDetail(event);
    const callId = extractExecutionStageCallId(event);
    const createdAt = event.createdAt || new Date().toISOString();
    const terminal = options.terminal === true;
    const sameSourceType = this.currentStage?.sourceEventType === event.type;
    const sameCallId = callId
      ? this.currentStage?.callId === callId
      : this.currentStage?.callId == null;
    const sameDetail = Boolean(detail && this.currentStage?.detail === detail);
    const shouldReuseCurrentStage = sameSourceType && sameCallId && sameDetail;

    if (
      this.currentStage
      && this.currentStage.semanticStatus === classification.semanticStatus
      && !terminal
      && shouldReuseCurrentStage
    ) {
      return;
    }

    if (
      this.currentStage
      && this.currentStage.semanticStatus === classification.semanticStatus
      && terminal
      && (sameSourceType || sameCallId || sameDetail)
    ) {
      const nextStage = {
        ...this.currentStage,
        phaseState: "completed",
        finishedAt: createdAt,
        detail: detail || this.currentStage.detail,
      };
      this.currentStage = nextStage;
      this.handlers.onExecutionStage?.(nextStage);
      return;
    }

    const nextStage = {
      id: createExecutionStageId(),
      semanticStatus: classification.semanticStatus,
      label: getExecutionStageLabel(classification.semanticStatus),
      phaseState: terminal ? "completed" : "active",
      sourceEventType: event.type,
      detail,
      callId,
      startedAt: createdAt,
      finishedAt: terminal ? createdAt : null,
    };

    this.currentStage = nextStage;
    this.handlers.onExecutionStage?.(nextStage);
  }
}

function extractAssistantText(result) {
  const uiMessages = result?.payload?.uiMessages;
  if (Array.isArray(uiMessages)) {
    const assistant = [...uiMessages].reverse().find((message) => message.role === "assistant");
    if (assistant?.content) {
      return assistant.content;
    }
  }

  return "";
}

function extractRuntimeError(result) {
  if (result?.code === "approval.required" || result?.status === "approval_required") {
    return "QAgent 尝试调用 shell 工具并进入审批流程，当前 Web 问答链路不会继续等待审批。";
  }

  const uiMessages = result?.payload?.uiMessages;
  if (Array.isArray(uiMessages)) {
    const lastError = [...uiMessages].reverse().find((message) => message.role === "error");
    if (lastError?.content) {
      return lastError.content;
    }
  }

  const commandMessages = result?.messages;
  if (Array.isArray(commandMessages)) {
    const errorMessage = commandMessages.find((message) => message.level === "error");
    if (errorMessage?.text) {
      return errorMessage.text;
    }
  }

  return "QAgent 运行失败";
}

function summarizePrompt(prompt) {
  const normalized = typeof prompt === "string" ? prompt.replace(/\s+/g, " ").trim() : "";
  if (!normalized) {
    return "";
  }
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

function hasDisplayableAnswer(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveStreamDisplayAnswer({
  assistantDeltaBuffer,
  lastNonEmptyAssistantCompleted,
  lastErrorMessage,
  lastInfoMessage,
}) {
  if (hasDisplayableAnswer(lastNonEmptyAssistantCompleted)) {
    return {
      answer: lastNonEmptyAssistantCompleted,
      source: "assistant.completed",
    };
  }

  if (hasDisplayableAnswer(assistantDeltaBuffer)) {
    return {
      answer: assistantDeltaBuffer,
      source: "assistant.delta",
    };
  }

  if (hasDisplayableAnswer(lastErrorMessage)) {
    return {
      answer: lastErrorMessage,
      source: "error",
    };
  }

  if (hasDisplayableAnswer(lastInfoMessage)) {
    return {
      answer: lastInfoMessage,
      source: "info",
    };
  }

  return {
    answer: "QAgent 本次流式运行已结束，但没有产出可显示的回答。",
    source: "fallback",
  };
}

function buildStreamUiMessage(answer, source) {
  return {
    id: `ui-stream-${source.replace(/[^a-z.]+/g, "-").replace(/\./g, "-")}`,
    role: source === "error" || source === "fallback" ? "error" : "assistant",
    content: answer,
    createdAt: new Date().toISOString(),
  };
}

function mergeStreamAggregationResult(rawResult, {
  answer,
  answerSource,
  exitCode,
  lastErrorMessage,
}) {
  const normalizedExitCode = typeof exitCode === "number" ? exitCode : 0;
  const basePayload = rawResult?.payload && typeof rawResult.payload === "object" && !Array.isArray(rawResult.payload)
    ? rawResult.payload
    : {};
  const nextRawResult = rawResult
    ? {
        ...rawResult,
        messages: Array.isArray(rawResult.messages) ? [...rawResult.messages] : [],
        payload: { ...basePayload },
      }
    : {
        status: (
          answerSource === "assistant.completed"
          || answerSource === "assistant.delta"
        ) && !hasDisplayableAnswer(lastErrorMessage)
          ? "success"
          : "runtime_error",
        code: "run.completed",
        exitCode: normalizedExitCode,
        messages: [],
        payload: {},
      };

  if (typeof nextRawResult.exitCode !== "number") {
    nextRawResult.exitCode = normalizedExitCode;
  }

  if (answerSource === "error") {
    nextRawResult.status = "runtime_error";
    nextRawResult.code = "run.stream_error";
  } else if (answerSource === "info") {
    nextRawResult.status = "runtime_error";
    nextRawResult.code = "run.stream_info_fallback";
  } else if (answerSource === "fallback") {
    nextRawResult.status = "runtime_error";
    nextRawResult.code = "run.empty_answer";
  } else if (!nextRawResult.code || nextRawResult.code === "run.empty_answer") {
    nextRawResult.code = hasDisplayableAnswer(lastErrorMessage)
      ? "run.stream_partial_answer"
      : "run.completed";
  }

  const uiMessages = Array.isArray(nextRawResult.payload?.uiMessages)
    ? [...nextRawResult.payload.uiMessages]
    : [];
  const hasSameContent = uiMessages.some((message) => (
    message
    && typeof message === "object"
    && typeof message.content === "string"
    && message.content === answer
  ));

  if (hasDisplayableAnswer(answer) && !hasSameContent) {
    uiMessages.push(buildStreamUiMessage(answer, answerSource));
  }

  nextRawResult.payload = {
    ...nextRawResult.payload,
    uiMessages,
  };

  if (
    hasDisplayableAnswer(lastErrorMessage)
    && !nextRawResult.messages.some((message) => message?.level === "error" && message.text === lastErrorMessage)
  ) {
    nextRawResult.messages.push({
      level: "error",
      text: lastErrorMessage,
    });
  }

  return nextRawResult;
}

function baseUrlForProvider(provider) {
  return provider === "openrouter"
    ? "https://openrouter.ai/api/v1"
    : "https://api.openai.com/v1";
}

function normalizeConversationHistory(value, limit = DEFAULT_HISTORY_TURN_LIMIT) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const question = typeof item.question === "string"
        ? item.question.trim()
        : "";
      const answer = typeof item.answer === "string"
        ? item.answer.trim()
        : "";

      if (!question || !answer) {
        return null;
      }

      return { question, answer };
    })
    .filter(Boolean)
    .slice(-limit);
}

export class QAgentService {
  constructor(options) {
    this.qagentCommand = options.qagentCommand;
    this.qagentRoot = options.qagentRoot;
    this.projectRoot = options.projectRoot;
    this.runtimeRoot = options.runtimeRoot || options.projectRoot;
    this.conversationWorklines = new Map();
    this.conversationWorklinesLoaded = false;
    this.executionStageClassifier = options.executionStageClassifier || new ExecutionStageClassifierService();
  }

  buildPrompt(question, context, options = {}) {
    void context;
    const conversationHistory = normalizeConversationHistory(options.conversationHistory);

    if (conversationHistory.length === 0) {
      return `用户问题：${question}`;
    }

    return [
      `最近对话历史（按时间顺序，越靠后越新）：\n${JSON.stringify(conversationHistory, null, 2)}`,
      `用户问题：${question}`,
    ].join("\n\n");
  }

  async ask(question, context, options = {}) {
    const prompt = this.buildPrompt(question, context, options);
    const result = await this.runQAgent(prompt, options);

    if (result.raw?.status !== "success") {
      return {
        ok: false,
        error: extractRuntimeError(result.raw),
        raw: result.raw,
        stderr: result.stderr,
      };
    }

    return {
      ok: true,
      answer: result.answer,
      raw: result.raw,
      stderr: result.stderr,
    };
  }

  async askStream(question, context, handlers = {}, options = {}) {
    const prompt = this.buildPrompt(question, context, options);
    const result = await this.runQAgentStream(prompt, handlers, options);

    if (!hasDisplayableAnswer(result.answer)) {
      return {
        ok: false,
        error: extractRuntimeError(result.raw),
        raw: result.raw,
        stderr: result.stderr,
      };
    }

    return {
      ok: true,
      answer: result.answer,
      raw: result.raw,
      stderr: result.stderr,
    };
  }

  async runQAgent(prompt, options = {}) {
    const requestRuntimeRoot = await this.prepareIsolatedRuntime(options);
    const [command, ...baseArgs] = this.getSpawnCommand();
    const providerOverride = await this.detectProviderOverride(requestRuntimeRoot);
    const spawnArgs = [
      ...baseArgs,
      ...(providerOverride ? ["--provider", providerOverride] : []),
      "--json",
      "--cwd",
      requestRuntimeRoot,
      "run",
      prompt,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(
        command,
        spawnArgs,
        this.createSpawnOptions(["ignore", "pipe", "pipe"]),
      );

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        void this.cleanupIsolatedRuntime(requestRuntimeRoot);
        if (code !== 0 && stdout.trim().length === 0) {
          reject(new Error(stderr.trim() || `QAgent exited with code ${code}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          const answer = extractAssistantText(parsed);
          if (parsed?.status === "success" && !hasDisplayableAnswer(answer)) {
            console.warn("[QAgentService] Empty assistant response from non-stream run", {
              code: parsed?.code,
              stderr: stderr.trim(),
              prompt: summarizePrompt(prompt),
              runtimeRoot: requestRuntimeRoot,
            });
            resolve({
              raw: {
                status: "runtime_error",
                code: "run.empty_answer",
                exitCode: code ?? 0,
                messages: [
                  {
                    level: "error",
                    text: "QAgent 本次运行已结束，但没有产出可显示的回答。",
                  },
                ],
                payload: parsed?.payload,
              },
              answer: "",
              stderr: stderr.trim(),
            });
            return;
          }
          resolve({
            raw: parsed,
            answer,
            stderr: stderr.trim(),
          });
        } catch (error) {
          reject(
            new Error(`Failed to parse QAgent response: ${error instanceof Error ? error.message : String(error)}`)
          );
        }
      });
    });
  }

  async runQAgentStream(prompt, handlers = {}, options = {}) {
    const requestRuntimeRoot = await this.prepareIsolatedRuntime(options);
    const executionStageModelConfig = await this.resolveExecutionStageModelConfig(requestRuntimeRoot, options);
    const [command, ...baseArgs] = this.getSpawnCommand();
    const providerOverride = await this.detectProviderOverride(requestRuntimeRoot);
    const spawnArgs = [
      ...baseArgs,
      ...(providerOverride ? ["--provider", providerOverride] : []),
      "--stream",
      "--cwd",
      requestRuntimeRoot,
      "run",
      prompt,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(
        command,
        spawnArgs,
        this.createSpawnOptions(["ignore", "pipe", "pipe"]),
      );

      let stdoutBuffer = "";
      let stderr = "";
      let assistantDeltaBuffer = "";
      let lastNonEmptyAssistantCompleted = "";
      let lastErrorMessage = "";
      let lastInfoMessage = "";
      let rawResult = null;
      let completed = false;
      let stageQueue = Promise.resolve();
      let abortStageQueued = false;
      const seenToolOutputCallIds = new Set();
      const executionStageTracker = new ExecutionStageTracker({
        classifier: this.executionStageClassifier,
        handlers,
        modelConfig: executionStageModelConfig,
      });
      const streamTimeoutMs = this.resolveStreamTimeoutMs(options);
      let timeoutId = null;
      let forceKillTimeoutId = null;

      const enqueueExecutionStage = (event, stageOptions = {}) => {
        stageQueue = stageQueue
          .then(() => executionStageTracker.track(event, stageOptions))
          .catch(() => {});
        return stageQueue;
      };

      void enqueueExecutionStage({
        type: "request.started",
        createdAt: new Date().toISOString(),
        payload: {
          detail: DEFAULT_EXECUTION_STAGE_DETAIL,
        },
      });

      const stopChild = (signalName = "SIGTERM") => {
        if (!completed) {
          this.terminateChildProcess(child, signalName);
        }
      };

      const signal = options.signal;
      const handleAbort = () => {
        if (!abortStageQueued) {
          abortStageQueued = true;
          void enqueueExecutionStage({
            type: "runtime.aborted",
            createdAt: new Date().toISOString(),
            payload: {
              reason: "用户已中断当前执行",
            },
          }, { terminal: true });
        }
        stopChild();
        reject(new Error("QAgent stream aborted"));
      };

      if (signal) {
        if (signal.aborted) {
          handleAbort();
          return;
        }
        signal.addEventListener("abort", handleAbort, { once: true });
      }

      const cleanupAbortListener = () => {
        signal?.removeEventListener("abort", handleAbort);
      };

      const cleanupTimers = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (forceKillTimeoutId) {
          clearTimeout(forceKillTimeoutId);
          forceKillTimeoutId = null;
        }
      };

      if (Number.isFinite(streamTimeoutMs) && streamTimeoutMs > 0) {
        timeoutId = setTimeout(() => {
          if (completed) {
            return;
          }

          lastErrorMessage = `QAgent 流式回答超过 ${Math.ceil(streamTimeoutMs / 1000)} 秒仍未完成，已终止本次请求。`;
          handlers.onStatus?.("QAgent 响应超时，正在结束这次回答...");
          if (!abortStageQueued) {
            abortStageQueued = true;
            void enqueueExecutionStage({
              type: "runtime.aborted",
              createdAt: new Date().toISOString(),
              payload: {
                reason: lastErrorMessage,
              },
            }, { terminal: true });
          }
          stopChild("SIGTERM");
          forceKillTimeoutId = setTimeout(() => {
            stopChild("SIGKILL");
          }, 5_000);
        }, streamTimeoutMs);
      }

      const handleRuntimeEvent = (event) => {
        if (!event || typeof event.type !== "string") {
          return;
        }

        if (event.type === "status.changed") {
          const detail = event.payload?.detail;
          if (typeof detail === "string" && detail.trim()) {
            lastInfoMessage = detail;
            handlers.onStatus?.(detail, event);
          }
          void enqueueExecutionStage(event);
          return;
        }

        if (event.type === "assistant.delta") {
          const delta = event.payload?.delta;
          if (typeof delta === "string" && delta.length > 0) {
            assistantDeltaBuffer += delta;
            handlers.onAnswerDelta?.(delta, event);
          }
          if (executionStageTracker.currentStage?.semanticStatus !== "reasoning") {
            void enqueueExecutionStage(event);
          }
          return;
        }

        if (event.type === "assistant.completed") {
          const content = event.payload?.content;
          if (typeof content === "string" && content.length > 0) {
            lastNonEmptyAssistantCompleted = content;
          }
          void enqueueExecutionStage(event);
          return;
        }

        if (event.type === "tool.started") {
          const toolCall = event.payload?.toolCall;
          const command = toolCall?.input?.command;
          if (toolCall?.id && typeof command === "string") {
            handlers.onToolStarted?.({
              callId: toolCall.id,
              command,
              cwd: null,
              startedAt: toolCall.createdAt || event.createdAt,
            }, event);
          }
          void enqueueExecutionStage(event);
          return;
        }

        if (event.type === "tool.output.delta") {
          const chunk = event.payload?.chunk;
          const command = event.payload?.command;
          const stream = event.payload?.stream;
          if (
            typeof chunk === "string"
            && chunk.length > 0
            && typeof command === "string"
            && (stream === "stdout" || stream === "stderr")
            && typeof event.payload?.callId === "string"
          ) {
            handlers.onToolOutput?.({
              callId: event.payload.callId,
              command,
              stream,
              chunk,
              cwd: typeof event.payload?.cwd === "string" ? event.payload.cwd : null,
              startedAt: typeof event.payload?.startedAt === "string" ? event.payload.startedAt : event.createdAt,
            }, event);
            if (!seenToolOutputCallIds.has(event.payload.callId)) {
              seenToolOutputCallIds.add(event.payload.callId);
              void enqueueExecutionStage(event);
            }
          }
          return;
        }

        if (event.type === "tool.finished") {
          const result = event.payload?.result;
          if (result?.callId && typeof result.command === "string") {
            handlers.onToolFinished?.({
              callId: result.callId,
              command: result.command,
              status: result.status,
              stdout: result.stdout || "",
              stderr: result.stderr || "",
              exitCode: result.exitCode ?? null,
              cwd: result.cwd || null,
              durationMs: result.durationMs ?? null,
              startedAt: result.startedAt || event.createdAt,
              finishedAt: result.finishedAt || event.createdAt,
            }, event);
          }
          if (result?.status && result.status !== "success" && result.status !== "running") {
            void enqueueExecutionStage(event, { terminal: true });
          }
          return;
        }

        if (event.type === "runtime.error") {
          if (hasDisplayableAnswer(event.payload?.message)) {
            lastErrorMessage = event.payload.message;
          }
          void enqueueExecutionStage(event, { terminal: true });
          return;
        }

        if (event.type === "command.completed") {
          rawResult = event.payload?.result || rawResult;
          const commandCompletedAnswer = extractAssistantText(rawResult);
          if (hasDisplayableAnswer(commandCompletedAnswer)) {
            lastNonEmptyAssistantCompleted = commandCompletedAnswer;
          }
          void enqueueExecutionStage(event, {
            terminal: true,
          });
        }
      };

      const flushStdoutBuffer = () => {
        let newlineIndex = stdoutBuffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          if (line) {
            try {
              handleRuntimeEvent(JSON.parse(line));
            } catch (error) {
              lastErrorMessage = `Failed to parse QAgent stream event: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
          newlineIndex = stdoutBuffer.indexOf("\n");
        }
      };

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();
        flushStdoutBuffer();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        cleanupAbortListener();
        cleanupTimers();
        void this.cleanupIsolatedRuntime(requestRuntimeRoot);
        reject(error);
      });
      child.on("close", (code) => {
        completed = true;
        cleanupAbortListener();
        cleanupTimers();
        void this.cleanupIsolatedRuntime(requestRuntimeRoot);
        flushStdoutBuffer();

        if (stdoutBuffer.trim()) {
          try {
            handleRuntimeEvent(JSON.parse(stdoutBuffer.trim()));
          } catch (error) {
            lastErrorMessage = `Failed to parse QAgent stream event: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        if (code !== 0) {
          const stderrText = stderr.trim();
          if (stderrText) {
            lastErrorMessage = stderrText;
          } else if (!hasDisplayableAnswer(lastErrorMessage)) {
            lastErrorMessage = `QAgent exited with code ${code}`;
          }
        }

        const { answer: resolvedAnswer, source: answerSource } = resolveStreamDisplayAnswer({
          assistantDeltaBuffer,
          lastNonEmptyAssistantCompleted,
          lastErrorMessage,
          lastInfoMessage,
        });

        rawResult = mergeStreamAggregationResult(rawResult, {
          answer: resolvedAnswer,
          answerSource,
          exitCode: code ?? 0,
          lastErrorMessage,
        });

        if (answerSource === "fallback") {
          console.warn("[QAgentService] Empty assistant response from stream run", {
            code: rawResult?.code,
            processExitCode: code ?? 0,
            stderr: stderr.trim(),
            lastErrorMessage,
            lastInfoMessage,
            prompt: summarizePrompt(prompt),
            runtimeRoot: requestRuntimeRoot,
          });
        }

        const finalStageEvent = {
          type: abortStageQueued
            ? "runtime.aborted"
            : rawResult?.status === "success"
              ? "command.completed"
              : "runtime.error",
          createdAt: new Date().toISOString(),
          payload: abortStageQueued
            ? { reason: lastErrorMessage || "本轮执行已中断" }
            : rawResult?.status === "success"
              ? { result: { status: "success", exitCode: code ?? 0 } }
              : { message: lastErrorMessage || "QAgent 运行失败" },
        };

        stageQueue
          .then(() => enqueueExecutionStage(finalStageEvent, { terminal: true }))
          .then(() => {
            resolve({
              raw: rawResult,
              answer: resolvedAnswer,
              stderr: stderr.trim(),
            });
          });
      });
    });
  }

  getSpawnCommand() {
    const [command] = this.qagentCommand || [];
    if (!command) {
      throw new Error("QAgent command is not configured");
    }

    const executableToCheck = this.qagentCommand.at(-1);
    if (executableToCheck && !existsSync(executableToCheck)) {
      throw new Error(`QAgent entry not found at ${executableToCheck}`);
    }

    return this.qagentCommand;
  }

  async ensureRuntimeRoot(options = {}) {
    const targetRuntimeRoot = options.runtimeRoot || this.runtimeRoot;
    await mkdir(targetRuntimeRoot, { recursive: true });

    const agentDir = path.join(targetRuntimeRoot, ".agent");
    const configPath = path.join(agentDir, "config.json");
    await mkdir(agentDir, { recursive: true });

    let config = {};
    try {
      config = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const providerOverride = await this.detectProviderOverride(targetRuntimeRoot);
    const modelOverride = typeof options.modelName === "string"
      ? options.modelName.trim()
      : "";

    const nextConfig = {
      ...config,
      model: {
        ...(config.model ?? {}),
        ...(providerOverride
          ? {
              provider: providerOverride,
              baseUrl: baseUrlForProvider(providerOverride),
            }
          : {}),
        ...(modelOverride ? { model: modelOverride } : {}),
      },
      tool: {
        ...(config.tool ?? {}),
        approvalMode: "never",
      },
    };

    await writeFile(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
  }

  async prepareRuntime() {
    const providerOverride = await this.detectProviderOverride();

    if (providerOverride) {
      await this.runControlCommand(["model", "provider", providerOverride]);
    }

    await this.runControlCommand(["hook", "fetch-memory", "off"]);
    await this.runControlCommand(["hook", "save-memory", "off"]);
    await this.runControlCommand(["hook", "auto-compact", "off"]);
  }

  async ensureConversationSession(conversationId) {
    if (conversationId && typeof conversationId === "string") {
      await this.clearPersistedConversationWorkline(conversationId);
    }

    await this.runControlCommand(["session", "reset-context"]);
  }

  async clearPersistedConversationWorkline(conversationId) {
    await this.loadConversationWorklines();

    if (!this.conversationWorklines.has(conversationId)) {
      return;
    }

    this.conversationWorklines.delete(conversationId);
    await this.saveConversationWorklines();
  }

  buildConversationWorklineName(conversationId) {
    const normalized = conversationId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

    return `kimi-chat-v2-${normalized || "session"}`;
  }

  buildFreshConversationWorklineName(conversationId) {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return `${this.buildConversationWorklineName(conversationId)}-${suffix}`;
  }

  async tryActivateConversationWorkline(worklineId) {
    if (!worklineId || typeof worklineId !== "string") {
      return false;
    }

    if (!(await this.isWorklineReusable(worklineId))) {
      return false;
    }

    try {
      await this.runControlCommand(["work", "switch", worklineId]);
      return true;
    } catch (error) {
      return false;
    }
  }

  async isWorklineReusable(worklineId) {
    const headStatePath = path.join(
      this.runtimeRoot,
      ".agent",
      "sessions",
      "__repo",
      "heads",
      `${worklineId}.json`,
    );

    try {
      const content = await readFile(headStatePath, "utf8");
      const parsed = JSON.parse(content);
      const runtimeStatus = parsed?.runtimeState?.status;
      const status = parsed?.status;

      if (runtimeStatus === "running" || status === "running") {
        return false;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return false;
      }
    }

    return true;
  }

  async loadConversationWorklines() {
    if (this.conversationWorklinesLoaded) {
      return;
    }

    const statePath = this.getConversationStatePath();

    try {
      const content = await readFile(statePath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed?.version !== WEB_CHAT_CONVERSATION_STATE_VERSION) {
        this.conversationWorklinesLoaded = true;
        return;
      }
      const rawConversations = parsed?.conversations;

      if (rawConversations && typeof rawConversations === "object" && !Array.isArray(rawConversations)) {
        for (const [conversationId, value] of Object.entries(rawConversations)) {
          if (typeof value === "string" && value.trim()) {
            this.conversationWorklines.set(conversationId, value);
            continue;
          }

          if (value && typeof value === "object" && typeof value.worklineId === "string" && value.worklineId.trim()) {
            this.conversationWorklines.set(conversationId, value.worklineId);
          }
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    this.conversationWorklinesLoaded = true;
  }

  async saveConversationWorklines() {
    const statePath = this.getConversationStatePath();
    await mkdir(path.dirname(statePath), { recursive: true });

    const conversations = Object.fromEntries(
      [...this.conversationWorklines.entries()].map(([conversationId, worklineId]) => (
        [conversationId, {
          worklineId,
          updatedAt: new Date().toISOString(),
        }]
      )),
    );

    await writeFile(
      statePath,
      JSON.stringify({
        version: WEB_CHAT_CONVERSATION_STATE_VERSION,
        conversations,
      }, null, 2),
      "utf8",
    );
  }

  getConversationStatePath() {
    return path.join(this.runtimeRoot, ".agent", "web-chat-conversations.json");
  }

  createSpawnOptions(stdio = ["ignore", "pipe", "pipe"]) {
    return {
      cwd: this.qagentRoot,
      env: {
        ...process.env,
        QAGENT_APPROVAL_MODE: process.env.QAGENT_APPROVAL_MODE || "never",
      },
      stdio,
      detached: process.platform !== "win32",
    };
  }

  terminateChildProcess(child, signalName = "SIGTERM") {
    const pid = child?.pid;
    if (!pid) {
      return;
    }

    if (process.platform !== "win32") {
      try {
        process.kill(-pid, signalName);
        return;
      } catch (error) {
        // Fall back to terminating only the direct child process.
      }
    }

    try {
      child.kill(signalName);
    } catch (error) {
      // Ignore process-kill races during shutdown.
    }
  }

  async runControlCommand(args, options = {}) {
    const [command, ...baseArgs] = this.getSpawnCommand();
    const targetRuntimeRoot = options.runtimeRoot || this.runtimeRoot;
    const fullArgs = [...baseArgs, "--json", "--cwd", targetRuntimeRoot, ...args];

    return new Promise((resolve, reject) => {
      const child = spawn(
        command,
        fullArgs,
        this.createSpawnOptions(["ignore", "pipe", "pipe"]),
      );

      let stdout = "";
      let stderr = "";
      const controlTimeoutMs = this.resolveControlTimeoutMs();
      let timeoutId = null;
      let forceKillTimeoutId = null;

      const cleanupTimers = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (forceKillTimeoutId) {
          clearTimeout(forceKillTimeoutId);
          forceKillTimeoutId = null;
        }
      };

      if (Number.isFinite(controlTimeoutMs) && controlTimeoutMs > 0) {
        timeoutId = setTimeout(() => {
          stderr = `QAgent 控制命令超时（>${Math.ceil(controlTimeoutMs / 1000)} 秒）：${args.join(" ")}`;
          this.terminateChildProcess(child, "SIGTERM");
          forceKillTimeoutId = setTimeout(() => {
            this.terminateChildProcess(child, "SIGKILL");
          }, 5_000);
        }, controlTimeoutMs);
      }

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        cleanupTimers();
        reject(error);
      });
      child.on("close", (code) => {
        cleanupTimers();
        if (code !== 0) {
          reject(new Error(stderr.trim() || `QAgent control command failed with code ${code}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          if (parsed?.status !== "success") {
            reject(new Error(extractRuntimeError(parsed)));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(
            new Error(`Failed to parse QAgent control response: ${error instanceof Error ? error.message : String(error)}`),
          );
        }
      });
    });
  }

  async detectProviderOverride() {
    const configRoot = arguments[0];
    if (process.env.QAGENT_PROVIDER === "openai" || process.env.QAGENT_PROVIDER === "openrouter") {
      return process.env.QAGENT_PROVIDER;
    }

    const configPaths = [
      configRoot ? path.join(configRoot, ".agent", "config.json") : path.join(this.runtimeRoot, ".agent", "config.json"),
      path.join(os.homedir(), ".agent", "config.json"),
    ];

    for (const configPath of configPaths) {
      try {
        const config = JSON.parse(await readFile(configPath, "utf8"));
        const configuredProvider = config?.model?.provider;
        if (configuredProvider === "openai" || configuredProvider === "openrouter") {
          return configuredProvider;
        }

        const apiKey = config?.model?.apiKey;
        if (typeof apiKey === "string" && apiKey.startsWith("sk-or-v1")) {
          return "openrouter";
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }

    return undefined;
  }

  async resolveExecutionStageModelConfig(configRoot, options = {}) {
    const configPaths = [
      configRoot ? path.join(configRoot, ".agent", "config.json") : null,
      path.join(os.homedir(), ".agent", "config.json"),
    ].filter(Boolean);

    let modelConfig = {};
    for (const configPath of configPaths) {
      try {
        const parsed = JSON.parse(await readFile(configPath, "utf8"));
        if (parsed?.model && typeof parsed.model === "object") {
          modelConfig = {
            ...parsed.model,
            ...modelConfig,
          };
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }

    let provider = process.env.QAGENT_PROVIDER;
    if (provider !== "openai" && provider !== "openrouter") {
      if (modelConfig.provider === "openai" || modelConfig.provider === "openrouter") {
        provider = modelConfig.provider;
      } else if (typeof modelConfig.apiKey === "string" && modelConfig.apiKey.startsWith("sk-or-v1")) {
        provider = "openrouter";
      } else if (process.env.OPENROUTER_API_KEY) {
        provider = "openrouter";
      } else if (process.env.OPENAI_API_KEY || modelConfig.apiKey) {
        provider = "openai";
      } else {
        provider = undefined;
      }
    }

    const modelName = typeof options.modelName === "string" && options.modelName.trim()
      ? options.modelName.trim()
      : typeof modelConfig.model === "string" && modelConfig.model.trim()
        ? modelConfig.model.trim()
        : undefined;
    const apiKey = provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY || modelConfig.apiKey
      : process.env.OPENAI_API_KEY || modelConfig.apiKey;
    const baseUrl = typeof modelConfig.baseUrl === "string" && modelConfig.baseUrl.trim()
      ? modelConfig.baseUrl.trim()
      : provider
        ? baseUrlForProvider(provider)
        : undefined;

    return {
      provider,
      modelName,
      apiKey,
      baseUrl,
    };
  }

  resolveStreamTimeoutMs(options = {}) {
    const rawValue = options.streamTimeoutMs ?? process.env.QAGENT_STREAM_TIMEOUT_MS;
    const parsed = Number(rawValue);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    return DEFAULT_STREAM_TIMEOUT_MS;
  }

  resolveControlTimeoutMs() {
    const parsed = Number(process.env.QAGENT_CONTROL_TIMEOUT_MS);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    return DEFAULT_CONTROL_TIMEOUT_MS;
  }

  async prepareIsolatedRuntime(options = {}) {
    const runtimeParent = path.join(this.runtimeRoot, ".web-chat-runs");
    await mkdir(runtimeParent, { recursive: true });
    const isolatedRuntimeRoot = await mkdtemp(path.join(runtimeParent, "run-"));
    await this.ensureRuntimeRoot({
      ...options,
      runtimeRoot: isolatedRuntimeRoot,
    });
    await this.runControlCommand(["hook", "fetch-memory", "off"], {
      runtimeRoot: isolatedRuntimeRoot,
    });
    await this.runControlCommand(["hook", "save-memory", "off"], {
      runtimeRoot: isolatedRuntimeRoot,
    });
    await this.runControlCommand(["hook", "auto-compact", "off"], {
      runtimeRoot: isolatedRuntimeRoot,
    });
    return isolatedRuntimeRoot;
  }

  async cleanupIsolatedRuntime(runtimeRoot) {
    if (!runtimeRoot || typeof runtimeRoot !== "string") {
      return;
    }

    try {
      await rm(runtimeRoot, { recursive: true, force: true });
    } catch (error) {
      // Best-effort cleanup only.
    }
  }
}
