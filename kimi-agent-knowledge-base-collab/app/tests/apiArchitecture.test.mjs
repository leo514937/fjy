import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { appRoot, resolveAppPath } from "./testPaths.mjs";

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }
      return [fullPath];
    }),
  );

  return files.flat();
}

test("前端 API 已按 shared/ontology/assistant/workspace 分域拆分", async () => {
  const requiredFiles = [
    "src/shared/api/http.ts",
    "src/features/ontology/api.ts",
    "src/features/assistant/api.ts",
    "src/features/workspace/api.ts",
  ];

  for (const relativePath of requiredFiles) {
    const filePath = resolveAppPath(relativePath);
    await assert.doesNotReject(() => fs.access(filePath), `${relativePath} 应存在`);
  }
});

test("业务代码不再从 '@/lib/api' 读取全站 API 入口", async () => {
  const sourceFiles = (await collectFiles(path.join(appRoot, "src")))
    .filter((filePath) => /\.(ts|tsx)$/.test(filePath));

  for (const filePath of sourceFiles) {
    const source = await fs.readFile(filePath, "utf8");
    assert.doesNotMatch(
      source,
      /@\/lib\/api/,
      `${path.relative(appRoot, filePath)} 不应再依赖 @/lib/api`,
    );
  }
});

test("V2 页面刷新后默认回接最近一次会话", async () => {
  const source = await fs.readFile(resolveAppPath("src/app/pages/FileWorkflowV2Page.tsx"), "utf8");
  assert.match(
    source,
    /useState<WorkflowV2RunSession \| null>\(\(\) => getLatestWorkflowV2Session\(\)\)/,
    "V2 页面应从最近会话初始化，避免刷新后丢失运行进度",
  );
});

test("V2 会话更新应异步持久化，避免阻塞启动 UI", async () => {
  const source = await fs.readFile(resolveAppPath("src/features/workflow/runtimeV2.ts"), "utf8");
  assert.match(
    source,
    /private schedulePersist\(\)\s*\{[\s\S]*?setTimeout\(\(\) => \{\s*this\.persistTimer = null;\s*this\.persist\(\);/m,
    "V2 会话更新应通过异步调度持久化",
  );
  assert.match(
    source,
    /private emit\(conversationId: string\)\s*\{\s*const session = this\.sessions\.get\(conversationId\);\s*if \(!session\) return;\s*this\.schedulePersist\(\);/s,
    "emit 不应直接同步写 sessionStorage",
  );
});

test("V2 hydrate 到 running 快照时会自动重新接回后台任务", async () => {
  const source = await fs.readFile(resolveAppPath("src/features/workflow/runtimeV2.ts"), "utf8");
  assert.match(
    source,
    /const refreshedSession = this\.sessions\.get\(conversationId\);\s*if \(\s*refreshedSession\s*&&\s*refreshedSession\.runResult\?\.workflow\?\.status === 'running'\s*&&\s*!this\.activeReaders\.has\(conversationId\)\s*\)\s*\{\s*void this\.attachToRunningSession\(conversationId\);\s*\}/s,
    "hydrate 后应在 running 时自动尝试 attach",
  );
});

test("V2 刷新恢复时不应提前把 running 快照降级为 failed", async () => {
  const source = await fs.readFile(resolveAppPath("src/features/workflow/runtimeV2.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /demoteRecoveredRunningSnapshot\(session\.runResult\)/,
    "restore 阶段不应再提前降级 running 快照",
  );
  assert.match(
    source,
    /isRunning:\s*recoverableRunning,|isRunning:\s*session\.runResult\?\.workflow\?\.status === 'running'/,
    "running 快照应在恢复时直接保留为运行中",
  );
  assert.doesNotMatch(
    source,
    /RECOVERABLE_RUNNING_SESSION_MAX_AGE_MS/,
    "running 快照恢复不应再受时间窗口限制",
  );
});
