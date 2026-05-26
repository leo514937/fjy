import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { OntoGitKnowledgeBaseRepository } from "./repositories/ontoGitKnowledgeBaseRepository.mjs";
import { KnowledgeBaseService } from "./services/knowledgeBaseService.mjs";
import { AssistantSessionStateService } from "./services/assistantSessionStateService.mjs";
import { ConversationGraphStateService } from "./services/conversationGraphStateService.mjs";
import { LinearWorkflowService } from "./services/linearWorkflowService.mjs";
import { WorkflowV2Service } from "./services/workflowV2Service.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const workflowRuntimeRoot = path.join(projectRoot, ".workflow-runtime");
const knowledgeGraphCacheRoot = path.join(appRoot, "storage", "cache", "knowledge-graph");
export const DEFAULT_GATEWAY_URL = "http://81.70.12.214:8080";
const WINDOWS_GLOBAL_ENV_NAMES = [
  "ONTOGIT_PROJECT_ID",
  "ONTOGIT_GATEWAY_URL",
  "XG_GATEWAY_URL",
  "GATEWAY_URL",
  "XG_GATEWAY_API_KEY",
  "GATEWAY_SERVICE_API_KEY",
  "ONTOGIT_AUTH_USERNAME",
  "XG_AUTH_USERNAME",
  "ONTOGIT_AUTH_PASSWORD",
  "XG_AUTH_PASSWORD",
  "WORKFLOW_TIMEOUT_MS",
  "WORKFLOW_LLM_BASE_URL",
  "OPENROUTER_BASE_URL",
  "DMXAPI_BASE_URL",
  "WORKFLOW_LLM_API_KEY",
  "OPENROUTER_API_KEY",
  "DMXAPI_API_KEY",
  "WORKFLOW_MODEL",
  "OPENROUTER_MODEL",
  "DMXAPI_MODEL",
];

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readAgentConfig(options = {}) {
  const configPath = asText(options.configPath)
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".agent", "config.json") : "")
    || (process.env.HOME ? path.join(process.env.HOME, ".agent", "config.json") : "");
  if (!configPath) {
    return {};
  }

  try {
    const content = readFileSync(configPath, "utf8");
    return safeObject(safeJsonParse(content));
  } catch {
    return {};
  }
}

function resolveAgentConfigValue(agentConfig, paths) {
  for (const pathParts of paths) {
    let current = agentConfig;
    for (const part of pathParts) {
      current = current && typeof current === "object" ? current[part] : undefined;
    }
    const value = asText(current);
    if (value) {
      return value;
    }
  }
  return "";
}

function resolveEnvValue(keys, windowsGlobalEnv) {
  for (const key of keys) {
    const processValue = asText(process.env[key]);
    if (processValue) {
      return processValue;
    }

    const windowsValue = asText(windowsGlobalEnv[key]);
    if (windowsValue) {
      return windowsValue;
    }
  }

  return "";
}

function extractEntitySequenceNumber(entityId) {
  const normalized = asText(entityId);
  if (!normalized) {
    return 0;
  }

  const scoped = normalized.includes(":") ? normalized.split(":").pop() : normalized;
  const match = asText(scoped).match(/_(\d+)$/);
  return match ? Number(match[1]) : 0;
}

let envCache = null;
let lastCacheTime = 0;
const CACHE_TTL = 60_000; // 缓存 1 分钟

export function readWindowsGlobalEnv(names, options = {}) {
  if (process.platform !== "win32") {
    return {};
  }

  const now = Date.now();
  if (envCache && (now - lastCacheTime < CACHE_TTL)) {
    return envCache;
  }

  const uniqueNames = [...new Set((Array.isArray(names) ? names : []).map(asText).filter(Boolean))];
  if (uniqueNames.length === 0) {
    return {};
  }

  const exec = typeof options.exec === "function" ? options.exec : execFileSync;
  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const quotedNames = uniqueNames.map((name) => `'${name.replace(/'/g, "''")}'`).join(", ");
  const command = [
    "$result = @{}",
    `$names = @(${quotedNames})`,
    "foreach ($name in $names) {",
    "  $value = [Environment]::GetEnvironmentVariable($name, 'User')",
    "  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'Machine') }",
    "  if ($value) { $result[$name] = $value }",
    "}",
    "$result | ConvertTo-Json -Compress",
  ].join("; ");

  try {
    const output = exec(
      powershellPath,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        encoding: "utf8",
        timeout: 3_000,
        windowsHide: true,
      },
    );
    const parsed = safeJsonParse(output);
    envCache = safeObject(parsed);
    lastCacheTime = now;
    return envCache;
  } catch {
    return {};
  }
}

export function createAppServices(options = {}) {
  const readAgentConfigSnapshot = () => safeObject(
    typeof options.agentConfigReader === "function"
      ? options.agentConfigReader()
      : readAgentConfig({ configPath: options.agentConfigPath }),
  );
  const readWindowsGlobalEnvSnapshot = () => safeObject(
    typeof options.windowsEnvReader === "function"
      ? options.windowsEnvReader(WINDOWS_GLOBAL_ENV_NAMES)
      : readWindowsGlobalEnv(WINDOWS_GLOBAL_ENV_NAMES),
  );
  const agentConfig = readAgentConfigSnapshot();
  const windowsGlobalEnv = readWindowsGlobalEnvSnapshot();
  const ontoGitProjectId = resolveEnvValue(["ONTOGIT_PROJECT_ID"], windowsGlobalEnv) || "demo";
  const gatewayBaseUrl = resolveEnvValue(["ONTOGIT_GATEWAY_URL", "XG_GATEWAY_URL", "GATEWAY_URL"], windowsGlobalEnv) || DEFAULT_GATEWAY_URL;
  const gatewayApiKeyRaw = resolveEnvValue(["XG_GATEWAY_API_KEY", "GATEWAY_SERVICE_API_KEY"], windowsGlobalEnv);
  const gatewayApiKey = gatewayApiKeyRaw && gatewayApiKeyRaw !== "change-me" ? gatewayApiKeyRaw : "";
  const authUsername = resolveEnvValue(["ONTOGIT_AUTH_USERNAME", "XG_AUTH_USERNAME"], windowsGlobalEnv) || "mogong";
  const authPassword = resolveEnvValue(["ONTOGIT_AUTH_PASSWORD", "XG_AUTH_PASSWORD"], windowsGlobalEnv) || "123456";
  const workflowTimeoutMs = Number(resolveEnvValue(["WORKFLOW_TIMEOUT_MS"], windowsGlobalEnv) || 120000);
  const workflowLlmBaseUrl = resolveEnvValue(["WORKFLOW_LLM_BASE_URL", "OPENROUTER_BASE_URL", "DMXAPI_BASE_URL"], windowsGlobalEnv)
    || resolveAgentConfigValue(agentConfig, [["model", "baseUrl"], ["model", "baseURL"], ["model", "apiBaseUrl"], ["model", "api_base_url"]])
    || "https://openrouter.ai/api/v1";
  const workflowLlmApiKey = resolveEnvValue(["WORKFLOW_LLM_API_KEY", "OPENROUTER_API_KEY", "DMXAPI_API_KEY"], windowsGlobalEnv)
    || resolveAgentConfigValue(agentConfig, [["model", "apiKey"], ["model", "api_key"]]);
  const workflowModel = resolveEnvValue(["WORKFLOW_MODEL_A", "WORKFLOW_MODEL", "OPENROUTER_MODEL", "DMXAPI_MODEL"], windowsGlobalEnv)
    || resolveAgentConfigValue(agentConfig, [["model", "name"], ["model", "model"]])
    || "deepseek/deepseek-v4-flash";
  const workflowModelB = resolveEnvValue(["WORKFLOW_MODEL_B"], windowsGlobalEnv) || workflowModel;
  const workflowJudgeModel = resolveEnvValue(["WORKFLOW_MODEL_JUDGE"], windowsGlobalEnv) || workflowModel;
  const workflowParallelCount = Number(resolveEnvValue(["WORKFLOW_PARALLEL_COUNT"], windowsGlobalEnv) || 1);
  const workflowDebateRounds = Number(resolveEnvValue(["WORKFLOW_DEBATE_ROUNDS"], windowsGlobalEnv) || 1);
  const workflowEnvResolver = () => {
    const nextAgentConfig = readAgentConfigSnapshot();
    const nextWindowsGlobalEnv = readWindowsGlobalEnvSnapshot();
    const nextWorkflowModel = resolveEnvValue(["WORKFLOW_MODEL_A", "WORKFLOW_MODEL", "OPENROUTER_MODEL", "DMXAPI_MODEL"], nextWindowsGlobalEnv)
      || resolveAgentConfigValue(nextAgentConfig, [["model", "name"], ["model", "model"]])
      || "deepseek/deepseek-v4-flash";
    return {
      workflowLlmBaseUrl: resolveEnvValue(["WORKFLOW_LLM_BASE_URL", "OPENROUTER_BASE_URL", "DMXAPI_BASE_URL"], nextWindowsGlobalEnv)
        || resolveAgentConfigValue(nextAgentConfig, [["model", "baseUrl"], ["model", "baseURL"], ["model", "apiBaseUrl"], ["model", "api_base_url"]])
        || "https://openrouter.ai/api/v1",
      workflowLlmApiKey: resolveEnvValue(["WORKFLOW_LLM_API_KEY", "OPENROUTER_API_KEY", "DMXAPI_API_KEY"], nextWindowsGlobalEnv)
        || resolveAgentConfigValue(nextAgentConfig, [["model", "apiKey"], ["model", "api_key"]]),
      workflowModelA: nextWorkflowModel,
      workflowModelB: resolveEnvValue(["WORKFLOW_MODEL_B"], nextWindowsGlobalEnv) || nextWorkflowModel,
      workflowJudgeModel: resolveEnvValue(["WORKFLOW_MODEL_JUDGE"], nextWindowsGlobalEnv) || nextWorkflowModel,
      workflowParallelCount: Number(resolveEnvValue(["WORKFLOW_PARALLEL_COUNT"], nextWindowsGlobalEnv) || 1),
      workflowDebateRounds: Number(resolveEnvValue(["WORKFLOW_DEBATE_ROUNDS"], nextWindowsGlobalEnv) || 1),
    };
  };

  const repository = new OntoGitKnowledgeBaseRepository({
    gatewayBaseUrl,
    gatewayApiKey,
    authUsername,
    authPassword,
    cacheDir: knowledgeGraphCacheRoot,
  });
  const entityIdSeedLoader = async (projectId) => {
    try {
      const knowledgeGraph = await repository.getKnowledgeGraph(projectId);
      const entityIndex = knowledgeGraph && typeof knowledgeGraph.entity_index === "object" && !Array.isArray(knowledgeGraph.entity_index)
        ? knowledgeGraph.entity_index
        : {};
      let maxSequence = 0;
      for (const entityId of Object.keys(entityIndex)) {
        maxSequence = Math.max(maxSequence, extractEntitySequenceNumber(entityId));
      }
      return maxSequence;
    } catch {
      return 0;
    }
  };
  const entityIdStateLoader = async (projectId) => {
    try {
      const knowledgeGraph = await repository.getKnowledgeGraph(projectId);
      const entityIndex = knowledgeGraph && typeof knowledgeGraph.entity_index === "object" && !Array.isArray(knowledgeGraph.entity_index)
        ? knowledgeGraph.entity_index
        : {};
      const usedEntityIds = new Set();
      let maxSequence = 0;
      for (const entity of Object.values(entityIndex)) {
        const originalEntityId = asText(entity?.properties?.original_entity_id) || asText(entity?.id).split(":").pop();
        if (!originalEntityId) {
          continue;
        }
        usedEntityIds.add(originalEntityId);
        maxSequence = Math.max(maxSequence, extractEntitySequenceNumber(originalEntityId));
      }
      return {
        sequenceSeed: maxSequence,
        usedEntityIds,
      };
    } catch {
      return {
        sequenceSeed: 0,
        usedEntityIds: new Set(),
      };
    }
  };

  return {
    knowledgeBaseService: new KnowledgeBaseService(repository, {
      projectId: ontoGitProjectId,
      sourceCommitter: ({ projectId, filename, data, message, agentName, committerName, basevision, inferenceMessage, inferenceAgentName, inferenceCommitterName }) => (
        repository.writeWorkflowEntity({
          projectId,
          filename,
          data,
          message,
          agentName,
          committerName,
          basevision,
          inferenceMessage,
          inferenceAgentName,
          inferenceCommitterName,
        })
      ),
    }),
    assistantSessionStateService: new AssistantSessionStateService({
      runtimeRoot: workflowRuntimeRoot,
    }),
    conversationGraphStateService: new ConversationGraphStateService({
      runtimeRoot: workflowRuntimeRoot,
    }),
    localWorkspaceService: repository,
    workflowService: new LinearWorkflowService({
      runtimeRoot: workflowRuntimeRoot,
      gatewayBaseUrl,
      gatewayApiKey: gatewayApiKeyRaw,
      gatewayAuthUsername: authUsername,
      gatewayAuthPassword: authPassword,
      gatewayLoginInvoker: () => repository.ensureGatewayLogin(true),
      gatewayRequestInvoker: (pathname, options) => repository.requestGatewayJson(pathname, options),
      gatewayWriteInvoker: (pathname, payload, options) => repository.invokeGatewayJson(pathname, payload, options),
      baseVersionLoader: async (projectId) => {
        const timelines = await repository.getJsonFileTimelines(projectId);
        const map = new Map();
        for (const timeline of timelines) {
          const commits = Array.isArray(timeline?.commits) ? timeline.commits : [];
          const latest = commits.at(-1);
          const versionId = Number(latest?.versionId ?? latest?.version_id ?? 0);
          map.set(timeline.filename, Number.isFinite(versionId) && versionId > 0 ? versionId : 0);
        }
        return map;
      },
      entityIdSeedLoader,
      entityIdStateLoader,
      workflowTimeoutMs,
      workflowLlmBaseUrl,
      workflowLlmApiKey,
      workflowModelA: workflowModel,
      workflowModelB,
      workflowJudgeModel,
      workflowParallelCount,
      workflowDebateRounds,
      workflowEnvResolver,
    }),
    workflowV2Service: new WorkflowV2Service({
      runtimeRoot: workflowRuntimeRoot,
      gatewayBaseUrl,
      gatewayApiKey: gatewayApiKeyRaw,
      gatewayAuthUsername: authUsername,
      gatewayAuthPassword: authPassword,
      gatewayLoginInvoker: () => repository.ensureGatewayLogin(true),
      gatewayRequestInvoker: (pathname, options) => repository.requestGatewayJson(pathname, options),
      gatewayWriteInvoker: (pathname, payload, options) => repository.invokeGatewayJson(pathname, payload, options),
      workflowTimeoutMs,
      workflowLlmBaseUrl,
      workflowLlmApiKey,
      workflowModelA: workflowModel,
      workflowModelB,
      workflowJudgeModel,
      workflowEnvResolver,
    }),
    appRoot,
  };
}
