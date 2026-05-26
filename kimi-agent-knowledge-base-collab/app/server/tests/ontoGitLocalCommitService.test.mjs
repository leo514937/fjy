import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { OntoGitLocalCommitService } from "../services/ontoGitLocalCommitService.mjs";

test("OntoGitLocalCommitService keeps text source files as raw text", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "ontogit-local-"));
  const service = new OntoGitLocalCommitService({ storageRoot });
  const rawText = "# 控制安全规则\n\n## 定义与定位\n用于验证原文写入。\n";

  const result = await service.writeVersion({
    projectId: "demo",
    filename: "graph-source/common/kimi-demo/控制安全规则.json",
    data: rawText,
    message: "写入 JSON 源文件",
    agentName: "ontology-editor",
    committerName: "ontology-editor",
    timestamp: "2026-04-17T22:10:00+08:00",
  });

  assert.equal(result.version_id, 1);

  const targetFile = path.join(storageRoot, "demo", "graph-source", "common", "kimi-demo", "控制安全规则.json");
  const content = await readFile(targetFile, "utf8");
  assert.equal(content, rawText);
});

test("OntoGitLocalCommitService lists every local JSON file in a project", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "ontogit-local-"));
  const service = new OntoGitLocalCommitService({ storageRoot });

  await service.writeVersion({
    projectId: "demo",
    filename: "workflow_export.json",
    data: { exported: true },
    message: "写入导出文件",
    agentName: "ontology-export",
    committerName: "ontology-export",
  });

  const nestedDir = path.join(storageRoot, "demo", "graph-source", "common", "321");
  await mkdir(nestedDir, { recursive: true });
  await writeFile(path.join(nestedDir, "312.json"), '{ "title": "312" }\n', "utf8");

  const files = await service.listJsonFiles("demo");
  assert.deepEqual(files, [
    "graph-source/common/321/312.json",
    "workflow_export.json",
  ]);

  const timelines = await service.getJsonFileTimelines("demo");
  assert.deepEqual(
    timelines.map((timeline) => [timeline.filename, timeline.history.length]),
    [
      ["graph-source/common/321/312.json", 0],
      ["workflow_export.json", 1],
    ],
  );

  assert.deepEqual(await service.readJsonFile("demo", "graph-source/common/321/312.json"), {
    title: "312",
  });
});

test("OntoGitLocalCommitService initializes a visible local project directory", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "ontogit-local-"));
  const service = new OntoGitLocalCommitService({ storageRoot });

  const result = await service.initProject({
    projectId: "ADStest",
    name: "ADStest",
    description: "本地项目",
  });

  assert.equal(result.status, "created");
  assert.equal(result.project.project_id, "ADStest");

  const metaPath = path.join(storageRoot, "ADStest", "project_meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  assert.equal(meta.name, "ADStest");

  const projects = await service.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].project_id, "ADStest");
});

test("OntoGitLocalCommitService lists non-git project folders and maps ids to folder names", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "ontogit-local-"));
  const service = new OntoGitLocalCommitService({ storageRoot });

  const projectDir = path.join(storageRoot, "folder-project");
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, "project_meta.json"),
    JSON.stringify({
      project_id: "stale-meta-id",
      name: "Folder Project",
      updated_at: "2026-04-18 00:00:00",
    }),
    "utf8",
  );

  const projects = await service.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].project_id, "folder-project");
  assert.equal(projects[0].name, "Folder Project");
  assert.equal(projects[0].commit_count, 0);
});

test("OntoGitLocalCommitService updates project display names", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "ontogit-local-"));
  const service = new OntoGitLocalCommitService({ storageRoot });

  await service.initProject({
    projectId: "rename-me",
    name: "Old Name",
  });

  const result = await service.updateProjectName("rename-me", "New Name");
  assert.equal(result.project.project_id, "rename-me");
  assert.equal(result.project.name, "New Name");

  const meta = JSON.parse(await readFile(path.join(storageRoot, "rename-me", "project_meta.json"), "utf8"));
  assert.equal(meta.project_id, "rename-me");
  assert.equal(meta.name, "New Name");

  const projects = await service.listProjects();
  assert.equal(projects[0].name, "New Name");
});

test("OntoGitLocalCommitService deletes local project directories", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "ontogit-local-"));
  const service = new OntoGitLocalCommitService({ storageRoot });

  const projectDir = path.join(storageRoot, "delete-me");
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "project_meta.json"), '{ "name": "Delete Me" }\n', "utf8");

  const result = await service.deleteProject("delete-me");
  assert.equal(result.status, "deleted");
  assert.equal(result.project_id, "delete-me");
  assert.equal(existsSync(projectDir), false);
});
