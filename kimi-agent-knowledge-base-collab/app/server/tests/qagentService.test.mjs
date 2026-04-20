import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { QAgentService } from "../services/qagentService.mjs";

function createEmptyContext() {
  return {
    entity: null,
    related: [],
    searchHits: [],
    currentDocument: null,
    relatedDocuments: [],
    searchDocuments: [],
  };
}

function createRuntimeEvent(type, payload, createdAt = new Date().toISOString()) {
  return {
    id: `event-${type}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    createdAt,
    sessionId: "session-1",
    worklineId: "workline-1",
    executorId: "executor-1",
    headId: "head-1",
    agentId: "agent-1",
    payload,
  };
}

test("QAgentService buildPrompt omits hardcoded business prompt by default", () => {
  const service = new QAgentService({
    qagentCommand: [process.execPath, "fake-qagent.mjs"],
    qagentRoot: os.tmpdir(),
    projectRoot: os.tmpdir(),
  });

  const prompt = service.buildPrompt("什么是本体论？", createEmptyContext());

  assert.equal(prompt, "用户问题：什么是本体论？");
  assert.equal(prompt.includes("你是一个本体论知识库助手"), false);
  assert.equal(prompt.includes("当前知识库中没有足够依据"), false);
});

test("QAgentService buildPrompt ignores frontend business prompt when provided", () => {
  const service = new QAgentService({
    qagentCommand: [process.execPath, "fake-qagent.mjs"],
    qagentRoot: os.tmpdir(),
    projectRoot: os.tmpdir(),
  });

  const prompt = service.buildPrompt(
    "什么是本体论？",
    createEmptyContext(),
    { businessPrompt: "请优先基于知识库定义回答。" },
  );

  assert.equal(prompt, "用户问题：什么是本体论？");
});

test("QAgentService buildPrompt includes recent conversation history when provided", () => {
  const service = new QAgentService({
    qagentCommand: [process.execPath, "fake-qagent.mjs"],
    qagentRoot: os.tmpdir(),
    projectRoot: os.tmpdir(),
  });

  const prompt = service.buildPrompt(
    "继续展开一下",
    createEmptyContext(),
    {
      conversationHistory: [
        { question: "先介绍 FJY 目录。", answer: "FJY 里主要有三个项目。" },
        { question: "重点看看 QAgent。", answer: "QAgent 是命令行代理项目。" },
      ],
    },
  );

  assert.equal(prompt.includes("最近对话历史"), true);
  assert.equal(prompt.includes("先介绍 FJY 目录。"), true);
  assert.equal(prompt.includes("QAgent 是命令行代理项目。"), true);
  assert.equal(prompt.endsWith("用户问题：继续展开一下"), true);
});

test("QAgentService buildPrompt includes tool traces when provided", () => {
  const service = new QAgentService({
    qagentCommand: [process.execPath, "fake-qagent.mjs"],
    qagentRoot: os.tmpdir(),
    projectRoot: os.tmpdir(),
  });

  const prompt = service.buildPrompt(
    "继续查看工具执行结果",
    createEmptyContext(),
    {
      conversationHistory: [
        {
          question: "先列出目录。",
          answer: "我先看一下仓库结构。",
          toolRuns: [
            {
              callId: "call-1",
              command: "find . -maxdepth 2",
              status: "success",
              stdout: "app/\nserver/\n",
              stderr: "",
              exitCode: 0,
              cwd: "/repo",
              durationMs: 12,
              startedAt: "2026-04-15T02:00:00.000Z",
              finishedAt: "2026-04-15T02:00:00.100Z",
            },
          ],
          contentBlocks: [
            {
              id: "block-tool-call-1",
              type: "tool_call",
              callId: "call-1",
              command: "find . -maxdepth 2",
              reasoning: "先确认目录结构",
              createdAt: "2026-04-15T02:00:00.000Z",
            },
            {
              id: "block-tool-result-1",
              type: "tool_result",
              callId: "call-1",
              command: "find . -maxdepth 2",
              status: "success",
              stdout: "app/\nserver/\n",
              stderr: "",
              exitCode: 0,
              cwd: "/repo",
              durationMs: 12,
              createdAt: "2026-04-15T02:00:00.100Z",
              finishedAt: "2026-04-15T02:00:00.100Z",
            },
          ],
        },
      ],
    },
  );

  assert.equal(prompt.includes("tool_call"), true);
  assert.equal(prompt.includes("tool_result"), true);
  assert.equal(prompt.includes("find . -maxdepth 2"), true);
  assert.equal(prompt.includes("stdout="), true);
});

test("QAgentService writes the graph-overlay skill into the isolated runtime workspace", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-skill-"));
  const service = new QAgentService({
    qagentCommand: [process.execPath, "fake-qagent.mjs"],
    qagentRoot: tempDir,
    projectRoot: tempDir,
    runtimeRoot: path.join(tempDir, "runtime"),
  });

  const runtimeRoot = path.join(tempDir, "runtime", ".web-chat-runs", "conversation-test");
  await service.ensureOntologyFactorySkills(runtimeRoot);

  const skillPath = path.join(runtimeRoot, ".agent", "skills", "graph-overlay", "SKILL.md");
  const skillContent = await readFile(skillPath, "utf8");

  assert.equal(skillContent.includes("knowledge-graph/overlay.json"), true);
  assert.equal(skillContent.includes("display_level"), true);
  assert.equal(skillContent.includes("不要重写底图"), false);
  assert.equal(skillContent.includes("Never rewrite the base knowledge graph JSON"), true);
});

test("QAgentService writes the ner and relation wrapper commands into skills", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-wrappers-"));
  const service = new QAgentService({
    qagentCommand: [process.execPath, "fake-qagent.mjs"],
    qagentRoot: tempDir,
    projectRoot: tempDir,
    runtimeRoot: path.join(tempDir, "runtime"),
  });

  const runtimeRoot = path.join(tempDir, "runtime", ".web-chat-runs", "conversation-test");
  await service.ensureOntologyFactorySkills(runtimeRoot);

  const nerSkill = await readFile(path.join(runtimeRoot, ".agent", "skills", "ner", "SKILL.md"), "utf8");
  const relationSkill = await readFile(path.join(runtimeRoot, ".agent", "skills", "entity-relation", "SKILL.md"), "utf8");
  const nerWrapperPath = path.join(runtimeRoot, "ner.sh");
  const relationWrapperPath = path.join(runtimeRoot, "re.sh");

  assert.equal(nerSkill.includes(nerWrapperPath), true);
  assert.equal(relationSkill.includes(relationWrapperPath), true);
  assert.equal(nerSkill.includes("initial runtime directory"), true);
  assert.equal(relationSkill.includes("initial runtime directory"), true);
});

test("QAgentService writes the entity workflow skill into the isolated runtime workspace", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-workflow-"));
  const service = new QAgentService({
    qagentCommand: [process.execPath, "fake-qagent.mjs"],
    qagentRoot: tempDir,
    projectRoot: tempDir,
    runtimeRoot: path.join(tempDir, "runtime"),
  });

  const runtimeRoot = path.join(tempDir, "runtime", ".web-chat-runs", "conversation-test");
  await service.ensureOntologyFactorySkills(runtimeRoot);

  const workflowSkill = await readFile(
    path.join(runtimeRoot, ".agent", "skills", "entity-ner-re-graph-wiki-workflow", "SKILL.md"),
    "utf8",
  );
  const nerWrapperPath = path.join(runtimeRoot, "ner.sh");
  const relationWrapperPath = path.join(runtimeRoot, "re.sh");
  const wikimgWrapperPath = path.join(runtimeRoot, "wikimg.sh");

  assert.equal(workflowSkill.includes(nerWrapperPath), true);
  assert.equal(workflowSkill.includes(relationWrapperPath), true);
  assert.equal(workflowSkill.includes(wikimgWrapperPath), true);
  assert.equal(workflowSkill.includes("visible: false"), true);
  assert.equal(workflowSkill.includes("wiki/"), true);
  assert.equal(workflowSkill.includes("There is no `graph-overlay.sh`"), true);
  assert.equal(workflowSkill.includes(".agent/skills/entity-ner-re-graph-wiki-workflow/SKILL.md"), true);
});

test("QAgentService writes the selected model into runtime config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-model-"));
  const runtimeRoot = path.join(tempDir, "runtime");
  const service = new QAgentService({
    qagentCommand: [process.execPath, "fake-qagent.mjs"],
    qagentRoot: tempDir,
    projectRoot: tempDir,
    runtimeRoot,
  });

  await service.ensureRuntimeRoot({ modelName: "gpt-4.1" });

  const config = JSON.parse(
    await readFile(path.join(runtimeRoot, ".agent", "config.json"), "utf8"),
  );

  assert.equal(config.model.model, "gpt-4.1");
});

test("QAgentService can bridge CLI streaming events into deltas and final answer", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const now = new Date().toISOString();

  await writeFile(
    cliPath,
    `
const isStream = process.argv.includes("--stream");
const successResult = {
  status: "success",
  code: "run.completed",
  exitCode: 0,
  messages: [],
  payload: {
    uiMessages: [
      {
        id: "ui-assistant",
        role: "assistant",
        content: "你好，流式世界",
        createdAt: "${now}",
      }
    ]
  }
};

if (isStream) {
  const events = [
    {
      id: "event-status",
      type: "status.changed",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        status: "running",
        detail: "QAgent 正在思考",
      },
    },
    {
      id: "event-tool-start",
      type: "tool.started",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        toolCall: {
          id: "tool-1",
          name: "shell",
          createdAt: "${now}",
          input: {
            command: "echo hello",
          },
        },
      },
    },
    {
      id: "event-tool-output-stdout",
      type: "tool.output.delta",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        callId: "tool-1",
        command: "echo hello",
        stream: "stdout",
        chunk: "hello\\n",
        cwd: "/tmp/demo",
        startedAt: "${now}",
      },
    },
    {
      id: "event-tool-output-stderr",
      type: "tool.output.delta",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        callId: "tool-1",
        command: "echo hello",
        stream: "stderr",
        chunk: "warn\\n",
        cwd: "/tmp/demo",
        startedAt: "${now}",
      },
    },
    {
      id: "event-tool-finish",
      type: "tool.finished",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        result: {
          callId: "tool-1",
          name: "shell",
          command: "echo hello",
          status: "success",
          exitCode: 0,
          stdout: "hello\\n",
          stderr: "warn\\n",
          cwd: "/tmp/demo",
          durationMs: 12,
          startedAt: "${now}",
          finishedAt: "${now}",
        },
      },
    },
    {
      id: "event-delta-1",
      type: "assistant.delta",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        delta: "你好，",
        text: "你好，",
      },
    },
    {
      id: "event-delta-2",
      type: "assistant.delta",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        delta: "流式世界",
        text: "你好，流式世界",
      },
    },
    {
      id: "event-complete",
      type: "assistant.completed",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        assistantMessageId: "assistant-1",
        content: "你好，流式世界",
        toolCalls: [],
      },
    },
  ];

  for (const event of events) {
    process.stdout.write(JSON.stringify(event) + "\\n");
  }
} else {
  process.stdout.write(JSON.stringify(successResult));
}
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  const statuses = [];
  const deltas = [];
  const toolStarts = [];
  const toolOutputs = [];
  const toolFinishes = [];
  const executionStages = [];
  const result = await service.askStream(
    "请开始流式回答",
    createEmptyContext(),
    {
      onStatus(message) {
        statuses.push(message);
      },
      onAnswerDelta(delta) {
        deltas.push(delta);
      },
      onToolStarted(event) {
        toolStarts.push(event);
      },
      onToolOutput(event) {
        toolOutputs.push(event);
      },
      onToolFinished(event) {
        toolFinishes.push(event);
      },
      onExecutionStage(event) {
        executionStages.push(event);
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.answer, "你好，流式世界");
  assert.deepEqual(deltas, ["你好，", "流式世界"]);
  assert.deepEqual(statuses, ["QAgent 正在思考"]);
  assert.deepEqual(toolStarts, [{
    callId: "tool-1",
    command: "echo hello",
    reasoning: undefined,
    cwd: null,
    startedAt: now,
  }]);
  assert.deepEqual(toolOutputs, [
    {
      callId: "tool-1",
      command: "echo hello",
      stream: "stdout",
      chunk: "hello\n",
      cwd: "/tmp/demo",
      startedAt: now,
    },
    {
      callId: "tool-1",
      command: "echo hello",
      stream: "stderr",
      chunk: "warn\n",
      cwd: "/tmp/demo",
      startedAt: now,
    },
  ]);
  assert.deepEqual(toolFinishes, [{
    callId: "tool-1",
    command: "echo hello",
    status: "success",
    stdout: "hello\n",
    stderr: "warn\n",
    exitCode: 0,
    cwd: "/tmp/demo",
    durationMs: 12,
    startedAt: now,
    finishedAt: now,
  }]);
  assert.deepEqual(
    executionStages.map((stage) => stage.semanticStatus),
    ["thinking", "thinking", "executing", "observing", "reasoning", "reasoning", "completed"],
  );
  assert.equal(executionStages.at(-1)?.label, "执行结束...");
});

test("QAgentService returns the last runtime error as displayable answer when stream has no assistant text", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-stream-error-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const now = new Date().toISOString();
  const streamEvents = [
    createRuntimeEvent("status.changed", {
      status: "running",
      detail: "正在搜索目录",
    }, now),
    createRuntimeEvent("runtime.error", {
      message: "Shell 命令执行失败",
    }, now),
  ];

  await writeFile(
    cliPath,
    `
const isStream = process.argv.includes("--stream");
const streamEvents = ${JSON.stringify(streamEvents)};

if (isStream) {
  for (const event of streamEvents) {
    process.stdout.write(JSON.stringify(event) + "\\n");
  }
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  status: "success",
  code: "run.completed",
  exitCode: 0,
  messages: [],
  payload: {
    uiMessages: [],
  },
}));
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  const result = await service.askStream("请回退到错误信息", createEmptyContext());

  assert.equal(result.ok, true);
  assert.equal(result.answer, "Shell 命令执行失败");
});

test("QAgentService returns the last status detail as displayable answer when stream has no assistant text or error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-stream-info-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const now = new Date().toISOString();
  const streamEvents = [
    createRuntimeEvent("status.changed", {
      status: "running",
      detail: "正在整理上下文",
    }, now),
    createRuntimeEvent("status.changed", {
      status: "running",
      detail: "正在扫描 FJY 目录",
    }, now),
  ];

  await writeFile(
    cliPath,
    `
const isStream = process.argv.includes("--stream");
const streamEvents = ${JSON.stringify(streamEvents)};

if (isStream) {
  for (const event of streamEvents) {
    process.stdout.write(JSON.stringify(event) + "\\n");
  }
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  status: "success",
  code: "run.completed",
  exitCode: 0,
  messages: [],
  payload: {
    uiMessages: [],
  },
}));
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  const result = await service.askStream("请回退到状态信息", createEmptyContext());

  assert.equal(result.ok, true);
  assert.equal(result.answer, "正在扫描 FJY 目录");
});

test("QAgentService keeps accumulated assistant delta as final answer even when runtime error arrives later", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-stream-delta-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const now = new Date().toISOString();
  const streamEvents = [
    createRuntimeEvent("assistant.delta", {
      delta: "已经找到",
      text: "已经找到",
    }, now),
    createRuntimeEvent("assistant.delta", {
      delta: "目录结构",
      text: "已经找到目录结构",
    }, now),
    createRuntimeEvent("runtime.error", {
      message: "后续写入 memory 失败",
    }, now),
  ];

  await writeFile(
    cliPath,
    `
const isStream = process.argv.includes("--stream");
const streamEvents = ${JSON.stringify(streamEvents)};

if (isStream) {
  for (const event of streamEvents) {
    process.stdout.write(JSON.stringify(event) + "\\n");
  }
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  status: "success",
  code: "run.completed",
  exitCode: 0,
  messages: [],
  payload: {
    uiMessages: [],
  },
}));
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  const result = await service.askStream("请保留已有正文", createEmptyContext());

  assert.equal(result.ok, true);
  assert.equal(result.answer, "已经找到目录结构");
});

test("QAgentService prefers the last non-empty assistant completion over streamed deltas", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-stream-completed-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const now = new Date().toISOString();
  const streamEvents = [
    createRuntimeEvent("assistant.delta", {
      delta: "先给出一部分",
      text: "先给出一部分",
    }, now),
    createRuntimeEvent("assistant.completed", {
      content: "",
      toolCalls: [
        {
          id: "tool-1",
          name: "shell",
        },
      ],
    }, now),
    createRuntimeEvent("assistant.completed", {
      content: "最终答案已经整理完成",
      toolCalls: [],
    }, now),
  ];

  await writeFile(
    cliPath,
    `
const isStream = process.argv.includes("--stream");
const streamEvents = ${JSON.stringify(streamEvents)};

if (isStream) {
  for (const event of streamEvents) {
    process.stdout.write(JSON.stringify(event) + "\\n");
  }
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  status: "success",
  code: "run.completed",
  exitCode: 0,
  messages: [],
  payload: {
    uiMessages: [],
  },
}));
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  const result = await service.askStream("请优先使用最终 completed 文本", createEmptyContext());

  assert.equal(result.ok, true);
  assert.equal(result.answer, "最终答案已经整理完成");
});

test("QAgentService keeps the final assistant answer after Windows-like empty assistant and shell retries", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-stream-windows-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const now = new Date().toISOString();
  const streamEvents = [
    createRuntimeEvent("status.changed", {
      status: "running",
      detail: "正在分析 FJY 目录",
    }, now),
    createRuntimeEvent("assistant.completed", {
      content: "",
      toolCalls: [
        {
          id: "tool-1",
          name: "shell",
        },
      ],
    }, now),
    createRuntimeEvent("tool.started", {
      toolCall: {
        id: "tool-1",
        createdAt: now,
        input: {
          command: "cd D:\\\\code\\\\FJY && dir /s",
        },
      },
    }, now),
    createRuntimeEvent("tool.output.delta", {
      callId: "tool-1",
      command: "cd D:\\\\code\\\\FJY && dir /s",
      stream: "stderr",
      chunk: "'&&' 不是内部或外部命令，也不是可运行的程序或批处理文件。\\n",
      cwd: "D:\\\\code\\\\FJY",
      startedAt: now,
    }, now),
    createRuntimeEvent("tool.finished", {
      result: {
        callId: "tool-1",
        command: "cd D:\\\\code\\\\FJY && dir /s",
        status: "error",
        stdout: "",
        stderr: "'&&' 不是内部或外部命令，也不是可运行的程序或批处理文件。\\n",
        exitCode: 1,
        cwd: "D:\\\\code\\\\FJY",
        durationMs: 18,
        startedAt: now,
        finishedAt: now,
      },
    }, now),
    createRuntimeEvent("status.changed", {
      status: "running",
      detail: "正在切换为 PowerShell 兼容命令",
    }, now),
    createRuntimeEvent("assistant.completed", {
      content: "",
      toolCalls: [
        {
          id: "tool-2",
          name: "shell",
        },
      ],
    }, now),
    createRuntimeEvent("tool.started", {
      toolCall: {
        id: "tool-2",
        createdAt: now,
        input: {
          command: "Get-ChildItem -Path D:\\\\code\\\\FJY -Recurse -Filter qagentService.mjs",
        },
      },
    }, now),
    createRuntimeEvent("tool.output.delta", {
      callId: "tool-2",
      command: "Get-ChildItem -Path D:\\\\code\\\\FJY -Recurse -Filter qagentService.mjs",
      stream: "stdout",
      chunk: "D:\\\\code\\\\FJY\\\\kimi-agent-knowledge-base-collab\\\\app\\\\server\\\\services\\\\qagentService.mjs\\n",
      cwd: "D:\\\\code\\\\FJY",
      startedAt: now,
    }, now),
    createRuntimeEvent("tool.finished", {
      result: {
        callId: "tool-2",
        command: "Get-ChildItem -Path D:\\\\code\\\\FJY -Recurse -Filter qagentService.mjs",
        status: "success",
        stdout: "D:\\\\code\\\\FJY\\\\kimi-agent-knowledge-base-collab\\\\app\\\\server\\\\services\\\\qagentService.mjs\\n",
        stderr: "",
        exitCode: 0,
        cwd: "D:\\\\code\\\\FJY",
        durationMs: 31,
        startedAt: now,
        finishedAt: now,
      },
    }, now),
    createRuntimeEvent("assistant.completed", {
      content: "已经在 FJY 目录中定位到 qagentService.mjs，并确认可以继续修复流式聚合逻辑。",
      toolCalls: [],
    }, now),
  ];

  await writeFile(
    cliPath,
    `
const isStream = process.argv.includes("--stream");
const streamEvents = ${JSON.stringify(streamEvents)};

if (isStream) {
  for (const event of streamEvents) {
    process.stdout.write(JSON.stringify(event) + "\\n");
  }
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  status: "success",
  code: "run.completed",
  exitCode: 0,
  messages: [],
  payload: {
    uiMessages: [],
  },
}));
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  const result = await service.askStream("请模拟 Windows 下的工具重试流", createEmptyContext());

  assert.equal(result.ok, true);
  assert.equal(result.answer, "已经在 FJY 目录中定位到 qagentService.mjs，并确认可以继续修复流式聚合逻辑。");
});

test("QAgentService answers conversation requests without issuing control commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-session-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const logPath = path.join(tempDir, "command-log.txt");
  const now = new Date().toISOString();

  await writeFile(
    cliPath,
    `
	import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, args.join(" ") + "\\n");

const commandArgs = args.filter((arg) => arg !== "--json" && arg !== "--stream");
const cwdIndex = commandArgs.indexOf("--cwd");
const normalizedArgs = cwdIndex >= 0
  ? [...commandArgs.slice(0, cwdIndex), ...commandArgs.slice(cwdIndex + 2)]
  : commandArgs;

	const success = (payload = {}) => ({
	  status: "success",
	  code: "ok",
	  exitCode: 0,
	  messages: [],
	  payload,
	});

if (args.includes("--stream")) {
  const events = [
    {
      id: "event-status",
      type: "status.changed",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        status: "running",
        detail: "QAgent 正在思考",
      },
    },
    {
      id: "event-delta",
      type: "assistant.delta",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        delta: "空会话回答",
      },
    },
    {
      id: "event-complete",
      type: "command.completed",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        domain: "run",
        status: "success",
        code: "run.completed",
        result: {
          status: "success",
          code: "run.completed",
          exitCode: 0,
          messages: [],
          payload: {
            uiMessages: [
              {
                id: "ui-assistant",
                role: "assistant",
                content: "空会话回答",
                createdAt: "${now}",
              }
            ]
          }
        },
      },
    },
  ];

  for (const event of events) {
    process.stdout.write(JSON.stringify(event) + "\\n");
  }
  process.exit(0);
}

process.stdout.write(JSON.stringify(success({
  uiMessages: [
    {
      id: "ui-assistant",
      role: "assistant",
      content: "普通回答",
      createdAt: "${now}",
    }
  ]
})));
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  await service.askStream("第一次提问", createEmptyContext(), {}, { conversationId: "session-alpha" });
  await service.askStream("第二次提问", createEmptyContext(), {}, { conversationId: "session-alpha" });

  const commandLog = await readFile(logPath, "utf8");
  assert.equal(commandLog.includes("hook fetch-memory off"), true);
  assert.equal(commandLog.includes("hook save-memory off"), true);
  assert.equal(commandLog.includes("hook auto-compact off"), true);
  assert.equal(/\s(work|session|model)\s/.test(commandLog), false);
});

test("QAgentService ignores persisted workline mappings and answers from an isolated runtime", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-stuck-workline-"));
  const runtimeRoot = path.join(tempDir, "runtime");
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const logPath = path.join(tempDir, "command-log.txt");
  const now = new Date().toISOString();
  const stuckWorklineId = "kimi-chat-v2-session-alpha-stuck";

  await writeFile(
    cliPath,
    `
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, args.join(" ") + "\\n");

const commandArgs = args.filter((arg) => arg !== "--json" && arg !== "--stream");
const cwdIndex = commandArgs.indexOf("--cwd");
const normalizedArgs = cwdIndex >= 0
  ? [...commandArgs.slice(0, cwdIndex), ...commandArgs.slice(cwdIndex + 2)]
  : commandArgs;

const success = (payload = {}) => ({
  status: "success",
  code: "ok",
  exitCode: 0,
  messages: [],
  payload,
});

if (args.includes("--stream")) {
  process.stdout.write(JSON.stringify({
    id: "event-complete",
    type: "command.completed",
    createdAt: "${now}",
    payload: {
      domain: "run",
      status: "success",
      code: "run.completed",
      result: {
        status: "success",
        code: "run.completed",
        exitCode: 0,
        messages: [],
        payload: {
          uiMessages: [
            {
              id: "ui-assistant",
              role: "assistant",
              content: "已恢复新 workline",
              createdAt: "${now}",
            }
          ]
        }
      },
    },
  }) + "\\n");
  process.exit(0);
}

process.stdout.write(JSON.stringify(success()));
`,
    "utf8",
  );

  await mkdir(path.join(runtimeRoot, ".agent", "sessions", "__repo", "heads"), { recursive: true });
  await writeFile(
    path.join(runtimeRoot, ".agent", "web-chat-conversations.json"),
    JSON.stringify({
      version: 2,
      conversations: {
        "session-alpha": {
          worklineId: stuckWorklineId,
          updatedAt: now,
        },
      },
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(runtimeRoot, ".agent", "sessions", "__repo", "heads", `${stuckWorklineId}.json`),
    JSON.stringify({
      id: stuckWorklineId,
      status: "running",
      runtimeState: {
        status: "running",
      },
    }, null, 2),
    "utf8",
  );
  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
    runtimeRoot,
  });

  const result = await service.askStream("帮我继续回答", createEmptyContext(), {}, {
    conversationId: "session-alpha",
  });

  assert.equal(result.ok, true);
  assert.equal(result.answer, "已恢复新 workline");

  const commandLog = await readFile(logPath, "utf8");
  const persistedState = JSON.parse(
    await readFile(path.join(runtimeRoot, ".agent", "web-chat-conversations.json"), "utf8"),
  );

  assert.equal(commandLog.includes(`work switch ${stuckWorklineId}`), false);
  assert.equal(commandLog.includes("work new "), false);
  assert.equal(commandLog.includes("session reset-context"), false);
  assert.deepEqual(persistedState.conversations["session-alpha"], {
    worklineId: stuckWorklineId,
    updatedAt: now,
  });
});

test("QAgentService returns a stream timeout as displayable content instead of hanging forever", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-timeout-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");

  await writeFile(
    cliPath,
    `
const isStream = process.argv.includes("--stream");

if (isStream) {
  process.stdout.write(JSON.stringify({
    id: "event-status",
    type: "status.changed",
    payload: {
      detail: "QAgent 正在慢慢思考",
    },
  }) + "\\n");

  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      id: "event-complete",
      type: "command.completed",
      payload: {
        result: {
          status: "success",
          code: "run.completed",
          exitCode: 0,
          messages: [],
          payload: {
            uiMessages: [
              {
                id: "ui-assistant",
                role: "assistant",
                content: "理论上不该走到这里",
                createdAt: new Date().toISOString(),
              }
            ]
          }
        },
      },
    }) + "\\n");
    process.exit(0);
  }, 1000);
} else {
  process.stdout.write(JSON.stringify({
    status: "success",
    code: "run.completed",
    exitCode: 0,
    messages: [],
    payload: {
      uiMessages: [
        {
          id: "ui-assistant",
          role: "assistant",
          content: "普通回答",
          createdAt: new Date().toISOString(),
        }
      ]
    }
  }));
}
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  const result = await service.askStream(
    "这次请求应该超时",
    createEmptyContext(),
    {},
    { streamTimeoutMs: 50 },
  );

  assert.equal(result.ok, true);
  assert.equal(result.answer.includes("已终止本次请求"), true);
});

test("QAgentService can stream without triggering control commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-control-timeout-"));
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const logPath = path.join(tempDir, "command-log.txt");

  await writeFile(
    cliPath,
    `
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, args.join(" ") + "\\n");

if (args.includes("--stream")) {
  process.stdout.write(JSON.stringify({
    id: "event-complete",
    type: "command.completed",
    payload: {
      result: {
        status: "success",
        code: "run.completed",
        exitCode: 0,
        messages: [],
        payload: {
          uiMessages: [
            {
              id: "ui-assistant",
              role: "assistant",
              content: "不依赖控制命令也能回答",
              createdAt: new Date().toISOString(),
            }
          ]
        }
      },
    },
  }) + "\\n");
} else {
  process.stdout.write(JSON.stringify({
    status: "success",
    code: "run.completed",
    exitCode: 0,
    messages: [],
    payload: {
      uiMessages: []
    }
  }));
}
`,
    "utf8",
  );

  const service = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
  });

  const result = await service.askStream("这次不该触发控制命令", createEmptyContext(), {}, {
    conversationId: "session-control-timeout",
  });

  const commandLog = await readFile(logPath, "utf8");

  assert.equal(result.ok, true);
  assert.equal(result.answer, "不依赖控制命令也能回答");
  assert.equal(commandLog.includes("hook fetch-memory off"), true);
  assert.equal(commandLog.includes("hook save-memory off"), true);
  assert.equal(commandLog.includes("hook auto-compact off"), true);
  assert.equal(/\b(work|model)\b/.test(commandLog), false);
});

test("QAgentService removes persisted workline mappings across service instances", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qagent-service-persist-"));
  const runtimeRoot = path.join(tempDir, "runtime");
  const cliPath = path.join(tempDir, "fake-qagent.mjs");
  const logPath = path.join(tempDir, "command-log.txt");
  const now = new Date().toISOString();

  await mkdir(path.join(runtimeRoot, ".agent"), { recursive: true });

  await writeFile(
    cliPath,
    `
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, args.join(" ") + "\\n");

const commandArgs = args.filter((arg) => arg !== "--json" && arg !== "--stream");
const cwdIndex = commandArgs.indexOf("--cwd");
const normalizedArgs = cwdIndex >= 0
  ? [...commandArgs.slice(0, cwdIndex), ...commandArgs.slice(cwdIndex + 2)]
  : commandArgs;

const success = (payload = {}) => ({
  status: "success",
  code: "ok",
  exitCode: 0,
  messages: [],
  payload,
});

if (args.includes("--stream")) {
  const events = [
    {
      id: "event-status",
      type: "status.changed",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        status: "running",
        detail: "QAgent 正在思考",
      },
    },
    {
      id: "event-complete",
      type: "command.completed",
      createdAt: "${now}",
      sessionId: "session-1",
      worklineId: "workline-1",
      executorId: "executor-1",
      headId: "head-1",
      agentId: "agent-1",
      payload: {
        domain: "run",
        status: "success",
        code: "run.completed",
        result: {
          status: "success",
          code: "run.completed",
          exitCode: 0,
          messages: [],
          payload: {
            uiMessages: [
              {
                id: "ui-assistant",
                role: "assistant",
                content: "持久化恢复回答",
                createdAt: "${now}",
              }
            ]
          }
        },
      },
    },
  ];

  for (const event of events) {
    process.stdout.write(JSON.stringify(event) + "\\n");
  }
  process.exit(0);
}

process.stdout.write(JSON.stringify(success()));
`,
    "utf8",
  );

  const firstService = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
    runtimeRoot,
  });

  await writeFile(
    path.join(runtimeRoot, ".agent", "web-chat-conversations.json"),
    JSON.stringify({
      version: 2,
      conversations: {
        "session-persist": {
          worklineId: "kimi-chat-v2-session-persist-stale",
          updatedAt: now,
        },
      },
    }, null, 2),
    "utf8",
  );

  await firstService.askStream("第一次提问", createEmptyContext(), {}, { conversationId: "session-persist" });

  const secondService = new QAgentService({
    qagentCommand: [process.execPath, cliPath],
    qagentRoot: tempDir,
    projectRoot: tempDir,
    runtimeRoot,
  });

  await secondService.askStream("第二次提问", createEmptyContext(), {}, { conversationId: "session-persist" });

  const commandLog = await readFile(logPath, "utf8");
  const persistedState = JSON.parse(await readFile(path.join(runtimeRoot, ".agent", "web-chat-conversations.json"), "utf8"));

  assert.equal(commandLog.includes("work new "), false);
  assert.equal(commandLog.includes("work switch "), false);
  assert.equal(commandLog.includes("session reset-context"), false);
  assert.equal(persistedState.version, 2);
  assert.deepEqual(persistedState.conversations["session-persist"], {
    worklineId: "kimi-chat-v2-session-persist-stale",
    updatedAt: now,
  });
});
