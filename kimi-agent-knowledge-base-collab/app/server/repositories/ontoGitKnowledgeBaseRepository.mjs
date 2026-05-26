import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateWorkflowEntityFileData } from "../workflowEntityFormat.mjs";

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeJsonParse(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const GATEWAY_LOGIN_TIMEOUT_MS = 8_000;
const CACHE_SCHEMA_VERSION = 2;
const MAX_PROJECT_DATASET_CACHE = 6;

function resolveGatewayRequestUrl(gatewayBaseUrl, pathname) {
  const requestPath = asText(pathname);
  if (!requestPath) {
    return new URL(gatewayBaseUrl);
  }

  const baseUrl = new URL(gatewayBaseUrl);
  if (baseUrl.pathname && baseUrl.pathname !== "/" && requestPath.startsWith("/xg/")) {
    const normalizedBasePath = baseUrl.pathname.replace(/\/$/, "");
    const normalizedRequestPath = requestPath.replace(/^\/+/, "");
    return new URL(`${normalizedBasePath}/${normalizedRequestPath}${baseUrl.search}`, `${baseUrl.origin}/`);
  }

  return new URL(requestPath, gatewayBaseUrl);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value) {
  return asText(value).toLowerCase();
}

function getTimelineRevisionToken(timeline) {
  const commits = Array.isArray(timeline?.commits)
    ? timeline.commits
    : Array.isArray(timeline?.history)
      ? timeline.history
      : [];
  const latest = commits.at(-1) || {};
  return [
    asText(timeline?.filename),
    asText(timeline?.latest_commit_id || latest.commit_id || latest.id),
    asText(timeline?.latest_version_id || latest.version_id || latest.versionId),
    String(commits.length),
  ].join(":");
}

function buildProjectTimelineState(timelines) {
  const fileVersions = new Map();
  const revisionTokens = [];

  if (Array.isArray(timelines)) {
    for (const timeline of timelines) {
      const token = getTimelineRevisionToken(timeline);
      if (token) {
        revisionTokens.push(token);
      }

      const filename = asText(timeline?.filename);
      if (!filename) {
        continue;
      }

      fileVersions.set(filename, token);
    }
  }

  return {
    fingerprint: revisionTokens.sort().join("|"),
    fileVersions,
  };
}

function buildProjectFingerprint(timelines) {
  return buildProjectTimelineState(timelines).fingerprint;
}

function buildKnowledgeGraphSliceKey(refs) {
  return Array.isArray(refs) ? refs.join("\u001f") : "";
}

function hashText(value) {
  return createHash("sha1").update(asText(value), "utf8").digest("hex");
}

function buildGlobalEntityId(projectId, entityId) {
  return `${projectId}:${entityId}`;
}

function buildKnowledgeGraphProjectCacheDir(cacheDir, projectId) {
  if (!asText(cacheDir)) {
    return "";
  }

  return path.join(cacheDir, `project-${hashText(projectId || "demo")}`);
}

function buildKnowledgeGraphCachePath(cacheDir, projectId, fingerprint) {
  const projectCacheDir = buildKnowledgeGraphProjectCacheDir(cacheDir, projectId);
  if (!projectCacheDir) {
    return "";
  }

  return path.join(projectCacheDir, `graph-${hashText(fingerprint || "")}.json`);
}

function getCandidateEntityFiles(timelines) {
  return Array.isArray(timelines)
    ? timelines
      .map((timeline) => asText(timeline?.filename))
      .filter((filename) => isCandidateEntityFile(filename))
      .sort((left, right) => left.localeCompare(right))
    : [];
}

function parseFileVersionsPayload(fileVersions) {
  const map = new Map();

  if (Array.isArray(fileVersions)) {
    for (const entry of fileVersions) {
      if (Array.isArray(entry)) {
        const filename = asText(entry[0]);
        const token = asText(entry[1]);
        if (filename && token) {
          map.set(filename, token);
        }
        continue;
      }

      if (entry && typeof entry === "object") {
        const filename = asText(entry.filename);
        const token = asText(entry.token);
        if (filename && token) {
          map.set(filename, token);
        }
      }
    }
    return map;
  }

  if (fileVersions && typeof fileVersions === "object") {
    for (const [filename, token] of Object.entries(fileVersions)) {
      const safeFilename = asText(filename);
      const safeToken = asText(token);
      if (safeFilename && safeToken) {
        map.set(safeFilename, safeToken);
      }
    }
  }

  return map;
}

function buildRecordByFilename(records) {
  const map = new Map();

  if (Array.isArray(records)) {
    for (const record of records) {
      const filename = asText(record?.filename);
      if (!filename || map.has(filename)) {
        continue;
      }
      map.set(filename, record);
    }
  }

  return map;
}

function createRuntimeDataset({ fingerprint, records, knowledgeGraph, fileVersions }) {
  const normalizedRecords = Array.isArray(records) ? records.filter(Boolean) : [];
  const normalizedFileVersions = fileVersions instanceof Map
    ? new Map(fileVersions)
    : parseFileVersionsPayload(fileVersions);

  return {
    fingerprint: asText(fingerprint),
    records: normalizedRecords,
    recordByFilename: buildRecordByFilename(normalizedRecords),
    fileVersions: normalizedFileVersions,
    knowledgeGraph,
    sliceCache: new Map(),
  };
}

function parseProjectsPayload(payload) {
  const list = Array.isArray(payload?.projects)
    ? payload.projects
    : Array.isArray(payload)
      ? payload
      : [];

  return list
    .map((item) => asText(item?.project_id || item?.id))
    .filter(Boolean);
}

function parseTimelinesPayload(payload) {
  const list = Array.isArray(payload?.timelines)
    ? payload.timelines
    : Array.isArray(payload)
      ? payload
      : [];

  return list
    .map((item) => asText(item?.filename))
    .filter(Boolean);
}

function isCandidateEntityFile(filename) {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".json")) {
    return false;
  }
  if (lower === "project_meta.json" || lower === "init.txt") {
    return false;
  }
  return true;
}

function delay(ms) {
  const duration = Math.max(0, Math.floor(Number(ms) || 0));
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  const safeConcurrency = Math.max(1, Math.floor(Number(concurrency) || 1));
  const results = new Array(list.length);
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(list[index], index);
    }
  }

  const workerCount = Math.min(safeConcurrency, list.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function parseWorkflowEntityRecord(raw, projectId, filename) {
  const root = safeObject(raw);
  const validation = validateWorkflowEntityFileData(root);
  if (!validation.ok) {
    return null;
  }

  const ontology = safeObject(root.ontology);
  const entity = safeObject(root.entity);
  const relationsRaw = Array.isArray(root.relations) ? root.relations : [];
  const ablationRaw = safeObject(root.ablation);

  const sourceProject = asText(ontology.project_id) || projectId;
  const entityId = asText(entity.id);
  const entityName = asText(entity.name);
  if (!entityId || !entityName) {
    return null;
  }

  const globalEntityId = buildGlobalEntityId(sourceProject, entityId);
  const properties = safeObject(entity.properties);
  const citations = Array.isArray(entity.citations) ? entity.citations.map(asText).filter(Boolean) : [];
  const abilities = Array.isArray(entity.abilities) ? entity.abilities.map(asText).filter(Boolean) : [];

  const normalizedRelations = relationsRaw
    .map((item) => {
      const relation = safeObject(item);
      const sourceEntityId = asText(relation.source_entity_id);
      const targetEntityId = asText(relation.target_entity_id);
      const sourceName = asText(relation.source_name);
      const targetName = asText(relation.target_name);
      const relationType = asText(relation.relation_type);
      if (!sourceEntityId || !targetEntityId || !sourceName || !targetName || !relationType) {
        return null;
      }

      return {
        projectId: sourceProject,
        sourceEntityId,
        targetEntityId,
        sourceName,
        targetName,
        relationType,
        evidence: asText(relation.evidence),
      };
    })
    .filter(Boolean);

  return {
    projectId: sourceProject,
    filename,
    entity: {
      id: globalEntityId,
      name: entityName,
      type: asText(entity.type) || asText(properties.kind) || "workflow-entity",
      domain: sourceProject,
      layer: "domain",
      level: asNumber(entity.level, 1),
      source: asText(entity.source) || asText(root.source) || "linear-workflow",
      definition: asText(entity.summary) || `${entityName}（由文件工作流生成）`,
      properties: {
        ...properties,
        abilities,
        citations,
        original_entity_id: entityId,
        project_id: sourceProject,
        filename,
      },
      ablation: Object.keys(ablationRaw).length > 0 ? ablationRaw : null,
    },
    relations: normalizedRelations,
    ablation: Object.keys(ablationRaw).length > 0 ? ablationRaw : null,
  };
}

export class OntoGitKnowledgeBaseRepository {
  constructor(options = {}) {
    this.gatewayBaseUrl = asText(options.gatewayBaseUrl);
    this.gatewayApiKey = asText(options.gatewayApiKey);
    this.authUsername = asText(options.authUsername);
    this.authPassword = asText(options.authPassword);
    this.cacheDir = asText(options.cacheDir);
    this.cacheByProject = new Map();
    this.pendingDatasetLoads = new Map();
    this.skipDiskCacheOnce = false;
    this.skipDiskCacheProjects = new Set();
    this.cacheGeneration = 0;
    this.gatewayAccessToken = "";
    this.gatewayLoginPromise = null;
  }

  invalidateCache(projectId) {
    const normalizedProjectId = asText(projectId);
    if (normalizedProjectId) {
      this.cacheByProject.delete(normalizedProjectId);
      for (const loadKey of this.pendingDatasetLoads.keys()) {
        if (loadKey.startsWith(`${normalizedProjectId}\u001f`)) {
          this.pendingDatasetLoads.delete(loadKey);
        }
      }
      this.skipDiskCacheProjects.add(normalizedProjectId);
      this.cacheGeneration += 1;
      return;
    }

    this.cacheByProject.clear();
    this.pendingDatasetLoads.clear();
    this.skipDiskCacheOnce = true;
    this.skipDiskCacheProjects.clear();
    this.cacheGeneration += 1;
  }

  getCachedProjectDataset(projectId) {
    const cached = this.cacheByProject.get(projectId);
    if (!cached) {
      return null;
    }

    this.cacheByProject.delete(projectId);
    this.cacheByProject.set(projectId, cached);
    return cached;
  }

  setCachedProjectDataset(projectId, dataset) {
    if (this.cacheByProject.has(projectId)) {
      this.cacheByProject.delete(projectId);
    }
    this.cacheByProject.set(projectId, dataset);

    while (this.cacheByProject.size > MAX_PROJECT_DATASET_CACHE) {
      const oldestProjectId = this.cacheByProject.keys().next().value;
      if (oldestProjectId === undefined) {
        break;
      }
      this.cacheByProject.delete(oldestProjectId);
    }
  }

  async buildGatewayHeaders(forceRefresh = false) {
    if (forceRefresh) {
      this.gatewayAccessToken = "";
    }

    if (!this.gatewayAccessToken && this.authUsername && this.authPassword && this.gatewayBaseUrl) {
      await this.ensureGatewayLogin(true).catch(() => null);
    }

    const headers = {};
    if (this.gatewayAccessToken) {
      headers.Authorization = `Bearer ${this.gatewayAccessToken}`;
      return headers;
    }

    if (this.gatewayApiKey) {
      headers["X-API-Key"] = this.gatewayApiKey;
      return headers;
    }

    throw new Error("未能获取 OntoGit gateway 鉴权凭证。");
  }

  async ensureGatewayLogin(forceRefresh = false) {
    if (forceRefresh) {
      this.gatewayAccessToken = "";
    }
    if (this.gatewayAccessToken) {
      return this.gatewayAccessToken;
    }
    if (this.gatewayLoginPromise) {
      return this.gatewayLoginPromise;
    }
    if (!this.authUsername || !this.authPassword) {
      throw new Error("OntoGit 自动登录失败：缺少用户名或密码。");
    }
    if (!this.gatewayBaseUrl) {
      throw new Error("OntoGit 自动登录失败：缺少 gateway 地址。");
    }

    this.gatewayLoginPromise = (async () => {
      const loginUrl = new URL("/auth/login", this.gatewayBaseUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GATEWAY_LOGIN_TIMEOUT_MS);

      try {
        const response = await fetch(loginUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            username: this.authUsername,
            password: this.authPassword,
          }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload?.detail || payload?.error || `${response.status} ${response.statusText}`;
          throw new Error(`OntoGit 自动登录失败: ${detail}`);
        }

        const token = asText(payload?.access_token);
        if (!token) {
          throw new Error("OntoGit 自动登录失败：返回中没有 access_token。");
        }
        this.gatewayAccessToken = token;
        return token;
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "ABORT_ERR") {
          throw new Error("OntoGit 自动登录失败：gateway 登录请求超时（8 秒）。");
        }

        const detail = asText(error?.message) || "未知错误";
        throw new Error(`OntoGit 自动登录失败: ${detail}`);
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    try {
      return await this.gatewayLoginPromise;
    } finally {
      this.gatewayLoginPromise = null;
    }
  }

  async requestGatewayJson(pathname, { method = "GET", payload, retryWithLogin = true } = {}) {
    if (!this.gatewayBaseUrl) {
      throw new Error("未配置 OntoGit gateway 地址。");
    }

    const url = resolveGatewayRequestUrl(this.gatewayBaseUrl, pathname);
    const headers = await this.buildGatewayHeaders();
    let body;
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      body = JSON.stringify(payload);
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
    });

    const responseText = await response.text();
    const responsePayload = safeJsonParse(responseText) ?? {};
    if (response.status === 401 && retryWithLogin) {
      await this.ensureGatewayLogin(true).catch(() => null);
      return this.requestGatewayJson(pathname, { method, payload, retryWithLogin: false });
    }
    if (!response.ok) {
      const detail = responsePayload?.detail || responsePayload?.error || responseText || `${response.status} ${response.statusText}`;
      const error = new Error(`OntoGit gateway 调用失败 (${pathname}): ${detail}`);
      error.status = response.status;
      error.pathname = pathname;
      error.detail = detail;
      throw error;
    }
    return responsePayload;
  }

  async fetchGatewayJson(pathname, options = {}) {
    return this.requestGatewayJson(pathname, { ...options, method: "GET" });
  }

  async invokeGatewayJson(pathname, payload, options = {}) {
    return this.requestGatewayJson(pathname, { ...options, method: "POST", payload });
  }

  async readProjectFile(projectId, filename) {
    const safeProject = encodeURIComponent(projectId);
    const safeFilename = filename.split("/").map((part) => encodeURIComponent(part)).join("/");
    const payload = await this.fetchGatewayJson(`/xg/read/${safeProject}/${safeFilename}`);
    if (payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data")) {
      return payload.data;
    }
    return payload;
  }

  async listProjects() {
    const payload = await this.fetchGatewayJson("/xg/projects");
    const list = Array.isArray(payload?.projects)
      ? payload.projects
      : Array.isArray(payload)
        ? payload
        : [];

    return list
      .map((item) => {
        const projectId = asText(item?.project_id || item?.id);
        if (!projectId) {
          return null;
        }

        return {
          project_id: projectId,
          id: projectId,
          name: asText(item?.name) || projectId,
          description: asText(item?.description),
          status: asText(item?.status),
          updated_at: asText(item?.updated_at || item?.updatedAt),
        };
      })
      .filter(Boolean);
  }

  async initProject({ projectId, name, description = "" }) {
    return this.invokeGatewayJson("/xg/projects/init", {
      project_id: asText(projectId),
      name: asText(name) || asText(projectId),
      description: asText(description),
    });
  }

  async updateProjectName(projectId, name) {
    return this.requestGatewayJson(`/xg/projects/${encodeURIComponent(asText(projectId))}`, {
      method: "PATCH",
      payload: { name: asText(name) },
    });
  }

  async deleteProject(projectId) {
    return this.requestGatewayJson(`/xg/projects/${encodeURIComponent(asText(projectId))}`, {
      method: "DELETE",
    });
  }

  async getJsonFileTimelines(projectId) {
    let payload;
    try {
      payload = await this.fetchGatewayJson(`/xg/timelines/${encodeURIComponent(asText(projectId))}`);
    } catch (error) {
      if (Number(error?.status) === 404) {
        return [];
      }
      throw error;
    }
    const list = Array.isArray(payload?.timelines)
      ? payload.timelines
      : Array.isArray(payload)
        ? payload
        : [];

    return list
      .map((item) => {
        const filename = asText(item?.filename);
        if (!filename) {
          return null;
        }

        return {
          filename,
          commits: Array.isArray(item?.commits)
            ? item.commits
            : Array.isArray(item?.history)
              ? item.history
              : [],
        };
      })
      .filter(Boolean);
  }

  async readJsonFile(projectId, filename, commitId) {
    const safeProject = encodeURIComponent(asText(projectId));
    const safeFilename = String(filename || "")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const suffix = commitId ? `?commit_id=${encodeURIComponent(asText(commitId))}` : "";
    const payload = await this.fetchGatewayJson(`/xg/read/${safeProject}/${safeFilename}${suffix}`);
    if (payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data")) {
      return payload.data;
    }
    return payload;
  }

  async loadLatestVersionIdMap(projectId) {
    const timelines = await this.getJsonFileTimelines(projectId);
    const map = new Map();

    for (const timeline of timelines) {
      const filename = asText(timeline?.filename);
      if (!filename) {
        continue;
      }

      const commits = Array.isArray(timeline?.commits)
        ? timeline.commits
        : Array.isArray(timeline?.history)
          ? timeline.history
          : [];
      const latest = commits.at(-1);
      const versionId = Number(latest?.versionId ?? latest?.version_id ?? 0);
      map.set(filename, Number.isFinite(versionId) && versionId > 0 ? versionId : 0);
    }

    return map;
  }

  async getLatestVersionId(projectId, filename) {
    const map = await this.loadLatestVersionIdMap(projectId);
    return Number(map.get(filename) || 0);
  }

  async writeWorkflowEntity({
    projectId,
    filename,
    data,
    message,
    agentName = "ontology-editor",
    committerName = "ontology-editor",
    basevision,
    inferenceMessage = "Workflow inference update",
    inferenceAgentName = agentName,
    inferenceCommitterName = committerName,
    skipInference = false,
  }) {
    const validation = validateWorkflowEntityFileData(data);
    if (!validation.ok) {
      throw new Error(`OntoGit 写入被拒绝：仅支持标准工作流 JSON。${validation.error}`);
    }

    await this.ensureGatewayLogin(true);

    if (!Number.isFinite(Number(basevision))) {
      throw new Error("OntoGit 写入被拒绝：必须提供 basevision 版本号。");
    }

    const pathname = skipInference ? "/xg/write" : "/xg/write-and-infer";
    return this.invokeGatewayJson(pathname, {
      project_id: asText(projectId),
      filename: asText(filename),
      data,
      message: asText(message) || "System: version update",
      agent_name: asText(agentName),
      committer_name: asText(committerName),
      basevision: Number(basevision),
      ...(skipInference ? {} : {
        inference_message: asText(inferenceMessage),
        inference_agent_name: asText(inferenceAgentName),
        inference_committer_name: asText(inferenceCommitterName),
      }),
    });
  }

  async readWorkflowEntityFileWithRetry(projectId, filename, options = {}) {
    const retryCount = Math.max(0, Math.floor(Number(options.retryCount) || 0));
    const retryDelayMs = Math.max(0, Math.floor(Number(options.retryDelayMs) || 0));

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const rawData = await this.readProjectFile(projectId, filename);
        return parseWorkflowEntityRecord(rawData, projectId, filename);
      } catch (error) {
        if (attempt >= retryCount) {
          console.warn(`[OntoGit] 无法读取文件 ${filename}:`, error.message);
          return null;
        }
        if (retryDelayMs > 0) {
          await delay(retryDelayMs * (attempt + 1));
        }
      }
    }

    return null;
  }

  async scanWorkflowEntityRecords(projectId, timelines = null, options = {}) {
    const normalizedProjectId = asText(projectId) || "demo";
    const timelineList = Array.isArray(timelines) ? timelines : await this.getJsonFileTimelines(normalizedProjectId);
    const allowedFiles = Array.isArray(options.filenames) && options.filenames.length > 0
      ? new Set(options.filenames.map(asText).filter(Boolean))
      : null;
    const candidateFiles = getCandidateEntityFiles(timelineList);
    const filesToScan = allowedFiles
      ? candidateFiles.filter((filename) => allowedFiles.has(filename))
      : candidateFiles;

    if (filesToScan.length === 0) {
      return [];
    }

    const results = await mapWithConcurrency(
      filesToScan,
      options.concurrency || 8,
      async (filename) => this.readWorkflowEntityFileWithRetry(normalizedProjectId, filename, {
        retryCount: options.retryCount ?? 2,
        retryDelayMs: options.retryDelayMs ?? 100,
      }),
    );

    return results.filter(Boolean);
  }

  async readCachePayload(cachePath) {
    if (!asText(cachePath)) {
      return null;
    }

    try {
      return JSON.parse(await readFile(cachePath, "utf8"));
    } catch {
      return null;
    }
  }

  async readCachedDataset(projectId, fingerprint) {
    const cachePath = buildKnowledgeGraphCachePath(this.cacheDir, projectId, fingerprint);
    if (!cachePath) {
      return null;
    }

    try {
      const payload = await this.readCachePayload(cachePath);
      const normalizedProjectId = asText(projectId) || "demo";
      if (
        !payload
        || Number(payload?.schemaVersion || 0) < 1
        || payload?.projectId !== normalizedProjectId
        || payload?.fingerprint !== fingerprint
        || !payload?.knowledgeGraph
      ) {
        return null;
      }

      return createRuntimeDataset({
        fingerprint,
        records: payload.records,
        knowledgeGraph: payload.knowledgeGraph,
        fileVersions: payload.fileVersions,
      });
    } catch {
      return null;
    }
  }

  async readLatestCachedDatasetWithRecords(projectId, excludeFingerprints = new Set()) {
    const projectCacheDir = buildKnowledgeGraphProjectCacheDir(this.cacheDir, projectId);
    if (!projectCacheDir) {
      return null;
    }

    const normalizedProjectId = asText(projectId) || "demo";
    const entries = await readdir(projectCacheDir, { withFileTypes: true }).catch(() => []);
    const cacheFiles = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(projectCacheDir, entry.name);
      const stats = await stat(filePath).catch(() => null);
      if (!stats) {
        continue;
      }

      cacheFiles.push({
        filePath,
        mtimeMs: stats.mtimeMs,
      });
    }

    cacheFiles.sort((left, right) => right.mtimeMs - left.mtimeMs);

    for (const { filePath } of cacheFiles) {
      const payload = await this.readCachePayload(filePath);
      if (!payload || payload?.projectId !== normalizedProjectId) {
        continue;
      }
      if (excludeFingerprints.has(payload?.fingerprint)) {
        continue;
      }
      if (Number(payload?.schemaVersion || 0) < CACHE_SCHEMA_VERSION) {
        continue;
      }
      if (!payload?.knowledgeGraph || !Array.isArray(payload?.records)) {
        continue;
      }

      const fileVersions = parseFileVersionsPayload(payload.fileVersions);
      if (fileVersions.size === 0) {
        continue;
      }

      return createRuntimeDataset({
        fingerprint: payload.fingerprint,
        records: payload.records,
        knowledgeGraph: payload.knowledgeGraph,
        fileVersions,
      });
    }

    return null;
  }

  async writeCachedDataset(projectId, dataset) {
    const cachePath = buildKnowledgeGraphCachePath(this.cacheDir, projectId, dataset?.fingerprint);
    if (!cachePath) {
      return false;
    }

    const payload = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      projectId: asText(projectId) || "demo",
      fingerprint: dataset.fingerprint,
      cachedAt: new Date().toISOString(),
      records: Array.isArray(dataset?.records) ? dataset.records : [],
      fileVersions: dataset?.fileVersions instanceof Map
        ? [...dataset.fileVersions.entries()]
        : [...parseFileVersionsPayload(dataset?.fileVersions).entries()],
      knowledgeGraph: dataset.knowledgeGraph,
    };

    const cacheDir = path.dirname(cachePath);
    const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(tempPath, JSON.stringify(payload), "utf8");
      await unlink(cachePath).catch(() => null);
      await rename(tempPath, cachePath);
      await this.pruneCacheDirectory(cacheDir, 3);
      return true;
    } catch (error) {
      await unlink(tempPath).catch(() => null);
      console.warn(`[OntoGit] 无法写入知识图谱磁盘缓存:`, error?.message || error);
      return false;
    }
  }

  async rebuildDatasetIncrementally(projectId, timelines, fingerprint, currentFileVersions, baseDataset) {
    if (!baseDataset || !(baseDataset.fileVersions instanceof Map) || baseDataset.fileVersions.size === 0) {
      return null;
    }

    const candidateFiles = getCandidateEntityFiles(timelines);
    const baseRecordByFilename = baseDataset.recordByFilename instanceof Map && baseDataset.recordByFilename.size > 0
      ? baseDataset.recordByFilename
      : buildRecordByFilename(baseDataset.records);
    if (baseRecordByFilename.size === 0) {
      return null;
    }

    if (candidateFiles.length === 0) {
      return createRuntimeDataset({
        fingerprint,
        records: [],
        knowledgeGraph: this.buildKnowledgeGraphFromRecords([]),
        fileVersions: currentFileVersions,
      });
    }

    const changedFiles = [];
    for (const filename of candidateFiles) {
      const currentToken = asText(currentFileVersions.get(filename));
      const previousToken = asText(baseDataset.fileVersions.get(filename));
      if (!currentToken || !previousToken || currentToken !== previousToken || !baseRecordByFilename.has(filename)) {
        changedFiles.push(filename);
      }
    }

    const changedRecordByFilename = new Map();
    if (changedFiles.length > 0) {
      const changedRecords = await this.scanWorkflowEntityRecords(projectId, timelines, {
        filenames: changedFiles,
      });
      for (const record of changedRecords) {
        const filename = asText(record?.filename);
        if (filename) {
          changedRecordByFilename.set(filename, record);
        }
      }
    }

    const mergedRecords = [];
    for (const filename of candidateFiles) {
      const currentToken = asText(currentFileVersions.get(filename));
      const previousToken = asText(baseDataset.fileVersions.get(filename));
      const reusableRecord = baseRecordByFilename.get(filename);
      if (reusableRecord && currentToken && previousToken && currentToken === previousToken) {
        mergedRecords.push(reusableRecord);
        continue;
      }

      const changedRecord = changedRecordByFilename.get(filename);
      if (changedRecord) {
        mergedRecords.push(changedRecord);
      }
    }

    const knowledgeGraph = this.buildKnowledgeGraphFromRecords(mergedRecords);
    return createRuntimeDataset({
      fingerprint,
      records: mergedRecords,
      knowledgeGraph,
      fileVersions: currentFileVersions,
    });
  }

  async pruneCacheDirectory(cacheDir, keepCount = 3) {
    if (!asText(cacheDir)) {
      return;
    }

    try {
      const entries = await readdir(cacheDir, { withFileTypes: true });
      const cacheFiles = [];

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }

        const filePath = path.join(cacheDir, entry.name);
        const stats = await stat(filePath).catch(() => null);
        if (!stats) {
          continue;
        }
        cacheFiles.push({
          filePath,
          mtimeMs: stats.mtimeMs,
        });
      }

      cacheFiles.sort((left, right) => right.mtimeMs - left.mtimeMs);
      const excess = cacheFiles.slice(Math.max(0, keepCount));
      await Promise.allSettled(excess.map((item) => unlink(item.filePath)));
    } catch {
      // 忽略缓存裁剪失败，不影响主流程
    }
  }

  buildKnowledgeGraphFromRecords(records) {
    const entityIndex = {};
    const pendingRelations = [];
    const nameToEntityIds = new Map();
    const entityIdConflicts = new Map();

    for (const record of records) {
      const entityId = record.entity.id;
      const existingEntity = entityIndex[entityId];
      if (!existingEntity) {
        entityIndex[entityId] = record.entity;
      } else {
        const conflict = entityIdConflicts.get(entityId) || {
          entity_id: entityId,
          filenames: [
            asText(existingEntity.properties?.filename) || "",
          ].filter(Boolean),
          entity_names: [
            asText(existingEntity.name) || "",
          ].filter(Boolean),
        };
        conflict.filenames.push(asText(record.entity.properties?.filename) || "");
        conflict.entity_names.push(asText(record.entity.name) || "");
        entityIdConflicts.set(entityId, conflict);
      }
      const key = normalizeText(record.entity.name);
      const list = nameToEntityIds.get(key) || [];
      list.push(entityId);
      nameToEntityIds.set(key, list);
      pendingRelations.push(...record.relations);
    }

    const conflicts = [...entityIdConflicts.values()];

    const resolveEntityId = (projectId, originalEntityId, fallbackName) => {
      const scoped = buildGlobalEntityId(projectId, originalEntityId);
      const exactEntity = entityIndex[scoped];
      if (exactEntity) {
        const normalizedFallbackName = normalizeText(fallbackName);
        if (normalizedFallbackName && normalizeText(exactEntity.name) !== normalizedFallbackName) {
          const byName = nameToEntityIds.get(normalizedFallbackName) || [];
          if (byName.length === 1) {
            return byName[0];
          }
        }
        return scoped;
      }

      const byName = nameToEntityIds.get(normalizeText(fallbackName)) || [];
      if (byName.length === 1) {
        return byName[0];
      }
      return "";
    };

    const crossReferences = [];
    const dedupe = new Set();

    for (const relation of pendingRelations) {
      const source = resolveEntityId(relation.projectId, relation.sourceEntityId, relation.sourceName);
      const target = resolveEntityId(relation.projectId, relation.targetEntityId, relation.targetName);
      if (!source || !target) {
        continue;
      }

      const edge = {
        source,
        target,
        relation: relation.relationType,
        description: relation.evidence,
      };
      const key = `${edge.source}\u001f${edge.target}\u001f${edge.relation}\u001f${edge.description}`;
      if (dedupe.has(key)) {
        continue;
      }
      dedupe.add(key);
      crossReferences.push(edge);
    }

    const entities = Object.values(entityIndex);
    const domains = unique(entities.map((item) => asText(item.domain)));
    const levels = unique(entities.map((item) => asNumber(item.level, 1))).sort((a, b) => a - b);
    const sources = unique(entities.map((item) => asText(item.source)));
    const layerCounts = {
      common: 0,
      domain: entities.length,
      private: 0,
    };

    return {
      metadata: {
        title: "OntoGit Workflow Knowledge Graph",
        version: "1",
        description: "Scanned from all OntoGit workflow entity JSON files.",
      },
      statistics: {
        total_entities: entities.length,
        total_relations: crossReferences.length,
        duplicate_entity_groups: conflicts.length,
        duplicate_entity_records: conflicts.reduce((sum, item) => sum + Math.max(0, item.filenames.length - 1), 0),
        domains,
        levels,
        sources,
        layers: ["domain"],
        layer_counts: layerCounts,
      },
      entity_index: entityIndex,
      entity_id_conflicts: conflicts,
      cross_references: crossReferences,
    };
  }

  async loadDataset(projectId) {
    const normalizedProjectId = asText(projectId) || "demo";
    const loadGeneration = this.cacheGeneration;
    const timelines = await this.getJsonFileTimelines(normalizedProjectId);
    const timelineState = buildProjectTimelineState(timelines);
    const fingerprint = timelineState.fingerprint;
    const fileVersions = timelineState.fileVersions;
    const cached = this.getCachedProjectDataset(normalizedProjectId);
    if (cached && cached.fingerprint === fingerprint) {
      return cached;
    }

    const loadKey = `${normalizedProjectId}\u001f${fingerprint}`;
    const pending = this.pendingDatasetLoads.get(loadKey);
    if (pending) {
      return pending;
    }

    const bypassDiskCache = this.skipDiskCacheOnce || this.skipDiskCacheProjects.has(normalizedProjectId);
    const datasetPromise = (async () => {
      if (!bypassDiskCache) {
        const exactCachedDataset = await this.readCachedDataset(normalizedProjectId, fingerprint);
        if (exactCachedDataset) {
          if (loadGeneration === this.cacheGeneration) {
            this.setCachedProjectDataset(normalizedProjectId, exactCachedDataset);
          }
          return exactCachedDataset;
        }

        const memoryBaseDataset = cached && cached.fingerprint !== fingerprint ? cached : null;
        if (memoryBaseDataset) {
          const incrementalDataset = await this.rebuildDatasetIncrementally(
            normalizedProjectId,
            timelines,
            fingerprint,
            fileVersions,
            memoryBaseDataset,
          );
          if (incrementalDataset) {
            if (loadGeneration === this.cacheGeneration) {
              this.setCachedProjectDataset(normalizedProjectId, incrementalDataset);
              await this.writeCachedDataset(normalizedProjectId, incrementalDataset);
            }
            return incrementalDataset;
          }
        }

        const excludeFingerprints = new Set([fingerprint]);
        if (memoryBaseDataset?.fingerprint) {
          excludeFingerprints.add(memoryBaseDataset.fingerprint);
        }

        const diskBaseDataset = await this.readLatestCachedDatasetWithRecords(normalizedProjectId, excludeFingerprints);
        if (diskBaseDataset) {
          const incrementalDataset = await this.rebuildDatasetIncrementally(
            normalizedProjectId,
            timelines,
            fingerprint,
            fileVersions,
            diskBaseDataset,
          );
          if (incrementalDataset) {
            if (loadGeneration === this.cacheGeneration) {
              this.setCachedProjectDataset(normalizedProjectId, incrementalDataset);
              await this.writeCachedDataset(normalizedProjectId, incrementalDataset);
            }
            return incrementalDataset;
          }
        }
      }

      const records = await this.scanWorkflowEntityRecords(normalizedProjectId, timelines);
      const knowledgeGraph = this.buildKnowledgeGraphFromRecords(records);
      const dataset = createRuntimeDataset({
        fingerprint,
        records,
        knowledgeGraph,
        fileVersions,
      });
      if (loadGeneration === this.cacheGeneration) {
        this.setCachedProjectDataset(normalizedProjectId, dataset);
        await this.writeCachedDataset(normalizedProjectId, dataset);
      }
      return dataset;
    })();

    this.pendingDatasetLoads.set(loadKey, datasetPromise);
    try {
      return await datasetPromise;
    } finally {
      if (this.skipDiskCacheProjects.has(normalizedProjectId)) {
        this.skipDiskCacheProjects.delete(normalizedProjectId);
      }
      if (bypassDiskCache) {
        this.skipDiskCacheOnce = false;
      }
      this.pendingDatasetLoads.delete(loadKey);
    }
  }

  async getKnowledgeGraph(projectId = "demo") {
    const dataset = await this.loadDataset(projectId);
    return dataset.knowledgeGraph;
  }

  async getKnowledgeGraphSlice(refs, projectId = "demo") {
    const normalizedRefs = Array.isArray(refs)
      ? [...new Set(refs.map((ref) => asText(ref)).filter(Boolean))]
      : [];

    if (normalizedRefs.length === 0) {
      return {
        viewedRefs: [],
        missingRefs: [],
        entities: [],
        crossReferences: [],
      };
    }

    const dataset = await this.loadDataset(projectId);
    const cachedSlice = dataset.sliceCache.get(buildKnowledgeGraphSliceKey(normalizedRefs));
    if (cachedSlice) {
      return cachedSlice;
    }

    const graph = dataset.knowledgeGraph;
    const visible = new Set(normalizedRefs);
    const entities = [];
    const missingRefs = [];

    for (const ref of normalizedRefs) {
      const entity = graph.entity_index[ref];
      if (entity) {
        entities.push(entity);
      } else {
        missingRefs.push(ref);
      }
    }

    const crossReferences = graph.cross_references.filter((edge) => (
      visible.has(edge.source) && visible.has(edge.target)
    ));

    const slice = {
      viewedRefs: normalizedRefs,
      missingRefs,
      entities,
      crossReferences,
    };
    dataset.sliceCache.set(buildKnowledgeGraphSliceKey(normalizedRefs), slice);
    return slice;
  }

  async getOntologies() {
    return {
      philosophicalOntology: {
        metadata: {
          title: "OntoGit Workflow Philosophical Module",
          created_by: "ontogit",
          version: "1",
          description: "Derived from OntoGit workflow entities.",
        },
      },
      formalOntology: {
        metadata: {
          title: "OntoGit Workflow Formal Module",
          created_by: "ontogit",
          version: "1",
          description: "Derived from OntoGit workflow entities.",
        },
      },
      scientificOntology: {
        metadata: {
          title: "OntoGit Workflow Scientific Module",
          created_by: "ontogit",
          version: "1",
          description: "Derived from OntoGit workflow entities.",
        },
      },
    };
  }

  async listEntities(projectId = "demo") {
    const graph = await this.getKnowledgeGraph(projectId);
    return Object.values(graph.entity_index);
  }

  async getEntityById(entityId, projectId) {
    const inferredProjectId = asText(projectId) || asText(entityId).split(":")[0] || "demo";
    const graph = await this.getKnowledgeGraph(inferredProjectId);
    return graph.entity_index[entityId];
  }

  async searchEntities(query, projectId = "demo") {
    const needle = normalizeText(query);
    if (!needle) {
      return [];
    }

    const entities = await this.listEntities(projectId);
    return entities.filter((entity) => {
      const haystacks = [
        entity.name,
        entity.definition,
        entity.domain,
        entity.layer,
        entity.type,
        JSON.stringify(entity.properties || {}),
      ];
      return haystacks.some((item) => normalizeText(item).includes(needle));
    });
  }

  async getRelatedEntities(entityId, projectId) {
    const inferredProjectId = asText(projectId) || asText(entityId).split(":")[0] || "demo";
    const graph = await this.getKnowledgeGraph(inferredProjectId);
    const related = graph.cross_references.filter((edge) => edge.source === entityId || edge.target === entityId);
    return related
      .map((edge) => {
        const relatedId = edge.source === entityId ? edge.target : edge.source;
        return graph.entity_index[relatedId];
      })
      .filter(Boolean);
  }

  async getAnalysisRecord() {
    return null;
  }

  async getSystemRecord() {
    return null;
  }

  async getEducationContent() {
    return {
      featured_topic: {
        title: "OntoGit 工作流知识图谱导读",
        summary: "图谱由 OntoGit 全量实体扫描构建，并按 relations 自动连接。",
        audience: "平台使用者",
        reading_time: "5 分钟",
        takeaways: [
          "实体来自工作流标准 JSON 文件。",
          "关系完全由 relations 字段驱动。",
          "不再兼容旧格式解析。",
        ],
      },
      primers: [],
      scenarios: [],
      selected_entity_guide: null,
    };
  }

  async getAboutContent() {
    return {
      platform: {
        name: "OntoGit Workflow Graph",
        vision: "以 OntoGit 全量实体文件构建统一知识图谱。",
        description: "当前图谱仅解析工作流标准 JSON 产物，不包含旧数据兼容逻辑。",
      },
      modules: [],
      workflow: [],
      roadmap: [],
    };
  }

  async getEditorTemplate() {
    const first = (await this.listEntities())[0] || null;
    return {
      defaults: {
        name: first?.name || "新概念",
        type: first?.type || "workflow-entity",
        domain: first?.domain || "demo",
        source: first?.source || "linear-workflow",
        definition: first?.definition || "请填写定义。",
        properties: safeObject(first?.properties),
      },
      suggestions: {
        recommended_type: first?.type || "workflow-entity",
        suggested_relations: [],
        rdf_preview: `<${first?.name || "新概念"}> rdf:type <${first?.type || "workflow-entity"}> .`,
        owl_preview: `Class: ${first?.name || "新概念"}`,
      },
    };
  }

  async getChatContext(question, entityId) {
    const inferredProjectId = asText(entityId).split(":")[0] || "demo";
    const graph = await this.getKnowledgeGraph(inferredProjectId);
    const entity = entityId ? graph.entity_index[entityId] || null : null;
    const related = entity ? (await this.getRelatedEntities(entityId, inferredProjectId)).slice(0, 6) : [];
    const searchHits = (await this.searchEntities(question, inferredProjectId)).slice(0, 8);

    return {
      entity,
      related,
      searchHits,
      currentDocument: null,
      relatedDocuments: [],
      searchDocuments: [],
    };
  }
}
