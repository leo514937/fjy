import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_STATUS = "开发中";

function validateProjectId(projectId) {
  const normalized = String(projectId || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("projectId 只能包含字母、数字、下划线和短横线");
  }
  return normalized;
}

function validateFilename(filename) {
  const normalized = path.posix.normalize(String(filename || "").replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("filename 不能为空");
  }
  if (path.isAbsolute(normalized) || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("filename 非法，禁止路径穿越");
  }
  if (normalized.startsWith(".git")) {
    throw new Error("filename 非法，禁止写入 .git 目录");
  }
  return normalized;
}

function nowTimestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function runGit(cwd, args, { allowFailure = false } = {}) {
  try {
    return await execFileAsync("git", args, {
      cwd,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFailure) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || "",
      };
    }
    throw new Error(error.stderr?.trim() || error.stdout?.trim() || "git command failed");
  }
}

async function ensureGitRepo(projectDir) {
  if (existsSync(path.join(projectDir, ".git"))) {
    return;
  }
  await runGit(projectDir, ["init"]);
}

async function readLatestVersionId(projectDir, filename) {
  const result = await runGit(projectDir, ["log", "--format=%B", "-1", "--", filename], { allowFailure: true });
  const lines = String(result.stdout || "").split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("XG-VersionId:")) {
      const raw = line.split(":", 2)[1]?.trim() || "";
      if (/^\d+$/.test(raw)) {
        return Number(raw);
      }
    }
  }
  return 0;
}

async function writeProjectMeta(projectDir, projectId, { agentName, committerName, message, basevision }) {
  const metaPath = path.join(projectDir, "project_meta.json");
  let current = {};
  if (existsSync(metaPath)) {
    try {
      current = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {
      current = {};
    }
  }

  const now = nowTimestamp();
  const meta = {
    project_id: projectId,
    name: current.name || projectId,
    description: current.description || "",
    status: current.status || DEFAULT_STATUS,
    created_at: current.created_at || now,
    updated_at: now,
    official_recommendations: current.official_recommendations || {},
    official_history: current.official_history || {},
    last_agent: agentName,
    last_committer: committerName,
    last_message: message,
    last_basevision: basevision,
  };

  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

function serializeFileData(data) {
  if (typeof data === "string") {
    return data.endsWith("\n") ? data : `${data}\n`;
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

export class OntoGitLocalCommitService {
  constructor(options = {}) {
    this.storageRoot = options.storageRoot;
    this.defaultAgentName = options.defaultAgentName || "ontology-editor";
    this.defaultCommitterName = options.defaultCommitterName || "ontology-editor";
  }

  async writeVersion({
    projectId,
    filename,
    data,
    message,
    agentName = this.defaultAgentName,
    committerName = this.defaultCommitterName,
    timestamp,
  }) {
    const safeProjectId = validateProjectId(projectId);
    const safeFilename = validateFilename(filename);
    const projectDir = path.join(this.storageRoot, safeProjectId);

    await mkdir(path.dirname(path.join(projectDir, safeFilename)), { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await ensureGitRepo(projectDir);

    const basevision = await readLatestVersionId(projectDir, safeFilename);
    const nextVersionId = basevision + 1;
    const filePath = path.join(projectDir, safeFilename);
    await writeFile(filePath, serializeFileData(data), "utf8");
    await writeProjectMeta(projectDir, safeProjectId, {
      agentName,
      committerName,
      message,
      basevision,
    });

    await runGit(projectDir, ["add", safeFilename, "project_meta.json"]);

    const fullMessage = [
      String(message || "").trim() || "System: version update",
      "",
      `XG-Filename: ${safeFilename}`,
      `XG-VersionId: ${nextVersionId}`,
      `XG-BaseVersion: ${basevision}`,
      `XG-ObjectName: ${agentName}`,
      `XG-CommitterName: ${committerName}`,
    ].join("\n");

    const commitEnv = timestamp
      ? {
          ...process.env,
          GIT_AUTHOR_DATE: timestamp,
          GIT_COMMITTER_DATE: timestamp,
        }
      : process.env;

    await execFileAsync("git", [
      "-c",
      `user.name=${committerName}`,
      "-c",
      `user.email=${committerName}@local`,
      "commit",
      "--allow-empty",
      `--author=${committerName} <${committerName}@local>`,
      "-m",
      fullMessage,
    ], {
      cwd: projectDir,
      env: commitEnv,
      maxBuffer: 20 * 1024 * 1024,
    });

    const commitResult = await runGit(projectDir, ["rev-parse", "HEAD"]);
    return {
      status: "success",
      filename: safeFilename,
      path: filePath,
      version_id: nextVersionId,
      basevision,
      commit_id: String(commitResult.stdout || "").trim(),
    };
  }
}
