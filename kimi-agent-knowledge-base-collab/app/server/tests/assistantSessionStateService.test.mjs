import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";

import { AssistantSessionStateService } from "../services/assistantSessionStateService.mjs";

test("AssistantSessionStateService returns an empty state before any save", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "assistant-session-state-"));
  const service = new AssistantSessionStateService({ runtimeRoot });

  const state = await service.load();

  assert.deepEqual(state, {
    sessions: [],
    activeSessionId: "",
    businessPrompt: "",
    modelName: "gpt-4.1-mini",
  });
});

test("AssistantSessionStateService persists frontend chat sessions", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "assistant-session-state-save-"));
  const service = new AssistantSessionStateService({ runtimeRoot });

  await service.save({
    sessions: [
      {
        id: "session-1",
        title: "测试会话",
        draftQuestion: "草稿问题",
        messages: [
          {
            id: "message-1",
            question: "什么是本体论？",
            answer: "关于存在者及其关系的结构化描述。",
            relatedNames: ["形式本体论"],
            contentBlocks: [
              {
                id: "block-assistant-1",
                type: "assistant",
                content: "先解释概念。",
                createdAt: "2026-04-15T02:00:00.000Z",
                completedAt: "2026-04-15T02:00:00.500Z",
                phase: "completed",
              },
              {
                id: "block-tool-call-1",
                type: "tool_call",
                callId: "call-1",
                command: "rg ontology",
                reasoning: "先查仓库中的相关术语",
                toolName: "ner",
                createdAt: "2026-04-15T02:00:01.000Z",
              },
              {
                id: "block-tool-result-1",
                type: "tool_result",
                callId: "call-1",
                command: "rg ontology",
                toolName: "ner",
                status: "success",
                stdout: "{\"ok\":true}",
                stderr: "",
                exitCode: 0,
                cwd: "/repo",
                durationMs: 12,
                createdAt: "2026-04-15T02:00:01.100Z",
                finishedAt: "2026-04-15T02:00:01.120Z",
              },
            ],
            executionStages: [
              {
                id: "stage-1",
                semanticStatus: "thinking",
                label: "思考中...",
                phaseState: "completed",
                sourceEventType: "status.changed",
                detail: "正在整理上下文",
                callId: null,
                startedAt: "2026-04-15T02:00:00.000Z",
                finishedAt: "2026-04-15T02:00:01.000Z",
              },
            ],
            toolRuns: [],
          },
        ],
        error: "ignored",
        loading: true,
        statusMessage: "ignored",
      },
    ],
    activeSessionId: "session-1",
    businessPrompt: "请优先使用知识库术语回答。",
    modelName: "gpt-4.1",
  });

  const state = await service.load();

  assert.deepEqual(state, {
    sessions: [
      {
        id: "session-1",
        title: "测试会话",
        draftQuestion: "草稿问题",
        messages: [
          {
            id: "message-1",
            question: "什么是本体论？",
            answer: "关于存在者及其关系的结构化描述。",
            relatedNames: ["形式本体论"],
            contentBlocks: [
              {
                id: "block-assistant-1",
                type: "assistant",
                content: "先解释概念。",
                createdAt: "2026-04-15T02:00:00.000Z",
                completedAt: "2026-04-15T02:00:00.500Z",
                phase: "completed",
              },
              {
                id: "block-tool-call-1",
                type: "tool_call",
                callId: "call-1",
                command: "rg ontology",
                reasoning: "先查仓库中的相关术语",
                toolName: "ner",
                createdAt: "2026-04-15T02:00:01.000Z",
              },
              {
                id: "block-tool-result-1",
                type: "tool_result",
                callId: "call-1",
                command: "rg ontology",
                toolName: "ner",
                status: "success",
                stdout: "{\"ok\":true}",
                stderr: "",
                exitCode: 0,
                cwd: "/repo",
                durationMs: 12,
                createdAt: "2026-04-15T02:00:01.100Z",
                finishedAt: "2026-04-15T02:00:01.120Z",
              },
            ],
            executionStages: [
              {
                id: "stage-1",
                semanticStatus: "thinking",
                label: "思考中...",
                phaseState: "completed",
                sourceEventType: "status.changed",
                detail: "正在整理上下文",
                callId: null,
                startedAt: "2026-04-15T02:00:00.000Z",
                finishedAt: "2026-04-15T02:00:01.000Z",
              },
            ],
            toolRuns: [],
          },
        ],
        error: null,
        loading: false,
        statusMessage: null,
      },
    ],
    activeSessionId: "session-1",
    businessPrompt: "请优先使用知识库术语回答。",
    modelName: "gpt-4.1",
  });
});

test("AssistantSessionStateService derives rich compatibility stages for legacy tool runs", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "assistant-session-state-legacy-"));
  const service = new AssistantSessionStateService({ runtimeRoot });

  await service.save({
    sessions: [
      {
        id: "session-legacy",
        title: "旧会话",
        draftQuestion: "",
        messages: [
          {
            id: "message-legacy",
            question: "列出目录",
            answer: "已列出",
            relatedNames: [],
            contentBlocks: [],
            executionStages: [
              {
                id: "legacy-stage-tool-legacy",
                semanticStatus: "completed",
                label: "执行结束...",
                phaseState: "completed",
                sourceEventType: "legacy.tool_run",
                detail: "dir",
                callId: "tool-legacy",
                startedAt: "2026-04-15T02:00:00.000Z",
                finishedAt: "2026-04-15T02:00:01.000Z",
              },
            ],
            toolRuns: [
              {
                callId: "tool-legacy",
                command: "dir",
                status: "success",
                stdout: "file-a\n",
                stderr: "",
                exitCode: 0,
                cwd: "D:\\code\\FJY",
                durationMs: 32,
                truncated: false,
                startedAt: "2026-04-15T02:00:00.000Z",
                finishedAt: "2026-04-15T02:00:01.000Z",
              },
            ],
          },
        ],
      },
    ],
    activeSessionId: "session-legacy",
    businessPrompt: "",
    modelName: "gpt-4.1-mini",
  });

  const state = await service.load();
  const executionStages = state.sessions[0].messages[0].executionStages;

  assert.equal(Array.isArray(executionStages), true);
  assert.equal(executionStages.length >= 4, true);
  assert.equal(executionStages[0].semanticStatus, "thinking");
  assert.equal(executionStages.some((stage) => stage.semanticStatus === "executing"), true);
  assert.equal(executionStages.some((stage) => stage.semanticStatus === "observing"), true);
  assert.equal(executionStages.some((stage) => stage.semanticStatus === "reasoning"), true);
  assert.equal(executionStages.at(-1)?.semanticStatus, "completed");
  assert.equal(state.sessions[0].messages[0].toolRuns.length, 1);
  assert.equal(state.sessions[0].messages[0].toolRuns[0].callId, "tool-legacy");
  assert.deepEqual(state.sessions[0].messages[0].contentBlocks, []);
});

test("AssistantSessionStateService infers tool names from legacy content blocks when missing", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "assistant-session-state-content-"));
  const service = new AssistantSessionStateService({ runtimeRoot });

  await service.save({
    sessions: [
      {
        id: "session-content",
        title: "内容块会话",
        draftQuestion: "",
        messages: [
          {
            id: "message-content",
            question: "抽取实体",
            answer: "完成",
            relatedNames: [],
            contentBlocks: [
              {
                id: "block-tool-call-ner",
                type: "tool_call",
                callId: "call-ner",
                command: "/tmp/runtime/ner.sh extract --input a.txt --stdout",
                createdAt: "2026-04-15T02:00:01.000Z",
              },
              {
                id: "block-tool-result-ner",
                type: "tool_result",
                callId: "call-ner",
                command: "/tmp/runtime/ner.sh extract --input a.txt --stdout",
                status: "success",
                stdout: "{\"ok\":true}",
                stderr: "",
                exitCode: 0,
                cwd: "/tmp/runtime",
                durationMs: 12,
                createdAt: "2026-04-15T02:00:01.100Z",
                finishedAt: "2026-04-15T02:00:01.120Z",
              },
            ],
            executionStages: [],
            toolRuns: [],
          },
        ],
      },
    ],
    activeSessionId: "session-content",
    businessPrompt: "",
    modelName: "gpt-4.1-mini",
  });

  const state = await service.load();
  const blocks = state.sessions[0].messages[0].contentBlocks;

  assert.equal(blocks[0].toolName, "ner");
  assert.equal(blocks[1].toolName, "ner");
});
