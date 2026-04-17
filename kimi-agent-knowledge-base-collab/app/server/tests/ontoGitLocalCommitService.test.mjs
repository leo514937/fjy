import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { OntoGitLocalCommitService } from "../services/ontoGitLocalCommitService.mjs";

test("OntoGitLocalCommitService keeps markdown source files as raw text", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "ontogit-local-"));
  const service = new OntoGitLocalCommitService({ storageRoot });
  const markdown = "# 控制安全规则\n\n## 定义与定位\n用于验证 Markdown 原文写入。\n";

  const result = await service.writeVersion({
    projectId: "demo",
    filename: "graph-source/common/kimi-demo/控制安全规则.md",
    data: markdown,
    message: "写入 Markdown 源文件",
    agentName: "ontology-editor",
    committerName: "ontology-editor",
    timestamp: "2026-04-17T22:10:00+08:00",
  });

  assert.equal(result.version_id, 1);

  const targetFile = path.join(storageRoot, "demo", "graph-source", "common", "kimi-demo", "控制安全规则.md");
  const content = await readFile(targetFile, "utf8");
  assert.equal(content, markdown);
});
