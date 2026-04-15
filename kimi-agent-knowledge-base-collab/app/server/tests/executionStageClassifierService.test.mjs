import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionStageClassifierService } from "../services/executionStageClassifierService.mjs";

test("ExecutionStageClassifierService normalizes llm output into fixed semantic statuses", async () => {
  const service = new ExecutionStageClassifierService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "observing",
            },
          },
        ],
      }),
    }),
  });

  const result = await service.classify({
    type: "tool.output.delta",
    payload: {
      stream: "stdout",
      chunk: "hello\n",
    },
    createdAt: "2026-04-15T02:00:00.000Z",
    modelConfig: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-4.1-mini",
    },
  });

  assert.equal(result.semanticStatus, "observing");
  assert.equal(result.label, "观察中...");
  assert.equal(result.via, "llm");
});

test("ExecutionStageClassifierService falls back when llm output is invalid", async () => {
  const service = new ExecutionStageClassifierService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "not-a-valid-status",
            },
          },
        ],
      }),
    }),
  });

  const result = await service.classify({
    type: "assistant.delta",
    payload: {
      delta: "正在整理答案",
    },
    createdAt: "2026-04-15T02:00:00.000Z",
    modelConfig: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-4.1-mini",
    },
  });

  assert.equal(result.semanticStatus, "reasoning");
  assert.equal(result.label, "推理中...");
  assert.equal(result.via, "fallback");
});

test("ExecutionStageClassifierService constrains llm prompt to event-appropriate statuses and avoids completed bias", async () => {
  let requestBody = null;

  const service = new ExecutionStageClassifierService({
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "observing",
              },
            },
          ],
        }),
      };
    },
  });

  const result = await service.classify({
    type: "tool.output.delta",
    payload: {
      callId: "tool-1",
      command: "dir",
      stream: "stdout",
      chunk: "file-a\n",
    },
    createdAt: "2026-04-15T02:00:00.000Z",
    modelConfig: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-4.1-mini",
    },
  });

  assert.equal(result.semanticStatus, "observing");
  assert.equal(result.via, "llm");
  assert.ok(requestBody);
  assert.match(
    requestBody.messages[0].content,
    /不要为了省事把大量事件都归到 completed/,
  );
  assert.match(
    requestBody.messages[0].content,
    /只有明确成功收口的终止事件才能选择 completed/,
  );
  assert.match(
    requestBody.messages[1].content,
    /"candidateStatuses":\s*\["observing"\]/,
  );
});

test("ExecutionStageClassifierService maps interrupt and error paths into six fixed statuses", async () => {
  const service = new ExecutionStageClassifierService();

  const interrupted = await service.classify({
    type: "runtime.aborted",
    payload: {
      reason: "timeout",
    },
    createdAt: "2026-04-15T02:00:00.000Z",
  });
  const failed = await service.classify({
    type: "runtime.error",
    payload: {
      message: "Shell failed",
    },
    createdAt: "2026-04-15T02:00:01.000Z",
  });
  const completed = await service.classify({
    type: "command.completed",
    payload: {
      result: {
        status: "success",
      },
    },
    createdAt: "2026-04-15T02:00:02.000Z",
  });

  assert.equal(interrupted.semanticStatus, "interrupted");
  assert.equal(interrupted.label, "执行中断...");
  assert.equal(failed.semanticStatus, "interrupted");
  assert.equal(failed.label, "执行中断...");
  assert.equal(completed.semanticStatus, "completed");
  assert.equal(completed.label, "执行结束...");
});
