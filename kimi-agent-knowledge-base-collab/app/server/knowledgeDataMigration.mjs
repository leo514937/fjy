import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ensureKnowledgeDataWorkspace, resolveKnowledgeDataPaths } from "./knowledgeDataPaths.mjs";
import { OntoGitLocalCommitService } from "./services/ontoGitLocalCommitService.mjs";

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = 1;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHistoryItem(item, index) {
  const normalized = isObject(item) ? { ...item } : {};
  normalized.sequence = index + 1;
  return normalized;
}

export function mergeExportContainers({ projectId, filename, containers }) {
  const mergedHistory = [];
  for (const container of containers || []) {
    const history = Array.isArray(container?.history) ? container.history : [];
    for (const item of history) {
      if (isObject(item) && typeof item.exported_at === "string" && item.exported_at.trim()) {
        mergedHistory.push({ ...item });
      }
    }
  }

  mergedHistory.sort((left, right) => {
    const leftTime = Date.parse(left.exported_at || "");
    const rightTime = Date.parse(right.exported_at || "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.exported_at || "").localeCompare(String(right.exported_at || ""));
  });

  return {
    schema_version: SCHEMA_VERSION,
    project_id: projectId,
    filename,
    history: mergedHistory.map((item, index) => normalizeHistoryItem(item, index)),
  };
}

function stripCommitFooters(message) {
  const lines = String(message || "").split(/\r?\n/);
  return lines
    .filter((line) => !/^XG-(Filename|VersionId|BaseVersion|ObjectName|CommitterName):/u.test(line.trim()))
    .join("\n")
    .trim();
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function listFilesRecursive(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)));
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

async function readLatestCommitMetadata(repoDir, filename) {
  if (!existsSync(path.join(repoDir, ".git"))) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoDir, "log", "--format=%aI%n%B", "-1", "--", filename],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const [authoredAt = "", ...messageLines] = stdout.split(/\r?\n/);
    const rawMessage = messageLines.join("\n").trim();
    const objectNameMatch = rawMessage.match(/^XG-ObjectName:\s*(.+)$/mu);
    const committerNameMatch = rawMessage.match(/^XG-CommitterName:\s*(.+)$/mu);
    return {
      authoredAt: authoredAt.trim(),
      message: stripCommitFooters(rawMessage) || `迁移 ${filename}`,
      agentName: objectNameMatch?.[1]?.trim() || "ontology-editor",
      committerName: committerNameMatch?.[1]?.trim() || "ontology-editor",
    };
  } catch {
    return null;
  }
}

async function copyWikiMarkdown(oldWikiDocsRoot, targetWikiDocsRoot) {
  for (const layer of ["common", "domain", "private"]) {
    const sourceLayer = path.join(oldWikiDocsRoot, layer);
    const targetLayer = path.join(targetWikiDocsRoot, layer);
    if (!existsSync(sourceLayer)) {
      continue;
    }
    await cp(sourceLayer, targetLayer, { recursive: true, force: true });
  }
}

async function copyStarsDirectory(oldStoreRoot, targetStoreRoot) {
  const sourceStarsDir = path.join(oldStoreRoot, ".xg_meta");
  const targetStarsDir = path.join(targetStoreRoot, ".xg_meta");
  if (!existsSync(sourceStarsDir)) {
    return;
  }
  await mkdir(targetStarsDir, { recursive: true });
  await cp(sourceStarsDir, targetStarsDir, { recursive: true, force: true });
}

async function migrateGraphSourceFiles({ legacyProjectDir, commitService, projectId }) {
  const graphSourceRoot = path.join(legacyProjectDir, "graph-source");
  const files = await listFilesRecursive(graphSourceRoot);
  const migrated = [];

  for (const filePath of files) {
    if (path.extname(filePath).toLowerCase() !== ".json") {
      continue;
    }

    const relativeFilename = path.relative(legacyProjectDir, filePath).replace(/\\/g, "/");
    const data = JSON.parse(await readFile(filePath, "utf8"));
    const legacyMeta = await readLatestCommitMetadata(legacyProjectDir, relativeFilename);
    const result = await commitService.writeVersion({
      projectId,
      filename: relativeFilename,
      data,
      message: legacyMeta?.message || `迁移 ${relativeFilename}`,
      agentName: legacyMeta?.agentName || "ontology-editor",
      committerName: legacyMeta?.committerName || "ontology-editor",
      timestamp: legacyMeta?.authoredAt || undefined,
    });
    migrated.push({
      filename: relativeFilename,
      version_id: result.version_id,
    });
  }

  return migrated;
}

async function migrateExportHistory({ containers, commitService, projectId, filename }) {
  const merged = mergeExportContainers({ projectId, filename, containers });
  const writes = [];
  for (let index = 0; index < merged.history.length; index += 1) {
    const history = merged.history.slice(0, index + 1);
    const snapshot = history[history.length - 1];
    const payload = {
      schema_version: SCHEMA_VERSION,
      project_id: projectId,
      filename,
      history,
    };
    const result = await commitService.writeVersion({
      projectId,
      filename,
      data: payload,
      message: "System: append WiKiMG export snapshot",
      agentName: "wikimg-export",
      committerName: "wikimg-export",
      timestamp: snapshot.exported_at,
    });
    writes.push({
      sequence: snapshot.sequence,
      version_id: result.version_id,
      exported_at: snapshot.exported_at,
    });
  }

  return {
    merged,
    writes,
  };
}

async function isNonEmptyDirectory(dirPath) {
  if (!existsSync(dirPath)) {
    return false;
  }
  const info = await stat(dirPath);
  if (!info.isDirectory()) {
    return false;
  }
  const entries = await readdir(dirPath);
  return entries.length > 0;
}

export async function migrateKnowledgeData(options = {}) {
  const paths = resolveKnowledgeDataPaths({
    workspaceRoot: options.workspaceRoot,
    env: options.env,
    defaultWikiMGCodeRoot: options.defaultWikiMGCodeRoot,
  });
  const ensured = ensureKnowledgeDataWorkspace(paths);
  const oldWikiRoot = path.resolve(options.oldWikiRoot || path.join(paths.wikimgCodeRoot, "wiki"));
  const oldStoreRoot = path.resolve(
    options.oldStoreRoot
      || path.join(paths.workspaceRoot, "OntoGit", "xiaogugit", "storage", "prod"),
  );
  const legacyProjectDir = path.join(oldWikiRoot, "demo");
  const oldStoreProjectDir = path.join(oldStoreRoot, "demo");
  const targetProjectDir = path.join(paths.ontoGitStorageRoot, options.projectId || "demo");

  await copyWikiMarkdown(oldWikiRoot, ensured.wikiDocsRoot);
  await copyStarsDirectory(oldStoreRoot, ensured.storeRoot);

  if (await isNonEmptyDirectory(targetProjectDir)) {
    return {
      status: "skipped",
      reason: "target-project-exists",
      knowledgeDataRoot: paths.knowledgeDataRoot,
      targetProjectDir,
    };
  }

  const commitService = new OntoGitLocalCommitService({
    storageRoot: paths.ontoGitStorageRoot,
  });
  const migratedSources = await migrateGraphSourceFiles({
    legacyProjectDir,
    commitService,
    projectId: options.projectId || "demo",
  });
  const exportMigration = await migrateExportHistory({
    containers: [
      await readJsonIfExists(path.join(legacyProjectDir, "wikimg_export.json")),
      await readJsonIfExists(path.join(oldStoreProjectDir, "wikimg_export.json")),
    ].filter(Boolean),
    commitService,
    projectId: options.projectId || "demo",
    filename: "wikimg_export.json",
  });

  return {
    status: "success",
    knowledgeDataRoot: paths.knowledgeDataRoot,
    wikiDocsRoot: paths.wikiDocsRoot,
    storeRoot: paths.ontoGitStorageRoot,
    projectId: options.projectId || "demo",
    migratedSources,
    exportHistoryCount: exportMigration.merged.history.length,
    exportWrites: exportMigration.writes,
  };
}
