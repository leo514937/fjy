import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { JsonKnowledgeBaseRepository } from "./repositories/jsonKnowledgeBaseRepository.mjs";
import { DatabaseKnowledgeBaseRepository } from "./repositories/databaseKnowledgeBaseRepository.mjs";
import { WikiMGKnowledgeBaseRepository } from "./repositories/wikiMGKnowledgeBaseRepository.mjs";
import { KnowledgeBaseService } from "./services/knowledgeBaseService.mjs";
import { AssistantSessionStateService } from "./services/assistantSessionStateService.mjs";
import { ConversationGraphStateService } from "./services/conversationGraphStateService.mjs";
import { OntoGitLocalCommitService } from "./services/ontoGitLocalCommitService.mjs";
import { QAgentService } from "./services/qagentService.mjs";
import { WikiWorkspaceWriterService } from "./services/wikiWorkspaceWriterService.mjs";
import { ensureKnowledgeDataWorkspace, resolveKnowledgeDataPaths } from "./knowledgeDataPaths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const qagentRuntimeRoot = path.join(projectRoot, ".qagent-web-runtime");
const defaultWikiMGRoot = path.resolve(workspaceRoot, "Ontology_Factory");

function resolveQAgentRoot() {
  const candidates = [
    process.env.QAGENT_ROOT,
    path.resolve(projectRoot, "../QAgent"),
    path.resolve(projectRoot, "../QAgent-master"),
  ].filter(Boolean);

  return (
    candidates.find((candidate) => existsSync(path.join(candidate, "package.json")))
    || candidates[0]
  );
}

function resolveQAgentCommand(qagentRoot) {
  if (process.env.QAGENT_BIN) {
    return [process.execPath, process.env.QAGENT_BIN];
  }

  const builtBin = path.join(qagentRoot, "bin", "qagent.js");
  const builtDist = path.join(qagentRoot, "dist", "cli", "index.js");
  if (existsSync(builtBin) && existsSync(builtDist)) {
    return [process.execPath, builtBin];
  }

  const tsxBin = path.join(
    qagentRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  const sourceEntry = path.join(qagentRoot, "src", "cli", "index.ts");
  if (existsSync(tsxBin) && existsSync(sourceEntry)) {
    return [tsxBin, sourceEntry];
  }

  return [process.execPath, builtBin];
}

export function createAppServices() {
  const repositoryMode = process.env.KNOWLEDGE_BASE_PROVIDER || "json";
  const qagentRoot = resolveQAgentRoot();
  const knowledgeDataPaths = resolveKnowledgeDataPaths({
    workspaceRoot,
    env: process.env,
    defaultWikiMGCodeRoot: defaultWikiMGRoot,
  });
  ensureKnowledgeDataWorkspace(knowledgeDataPaths);

  let repository;

  if (repositoryMode === "database") {
    repository = new DatabaseKnowledgeBaseRepository({
      databaseUrl: process.env.DATABASE_URL,
    });
  } else if (repositoryMode === "wikimg") {
    repository = new WikiMGKnowledgeBaseRepository({
      workspaceRoot: knowledgeDataPaths.wikimgWorkspaceRoot,
      sourceWorkspaceRoot: knowledgeDataPaths.wikimgCodeRoot,
      profile: process.env.WIKIMG_PROFILE || "kimi",
      wikimgScriptPath: knowledgeDataPaths.wikimgScriptPath,
      pythonBin: process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"),
      ontoGitStorageRoot: knowledgeDataPaths.ontoGitStorageRoot,
    });
  } else {
    repository = new JsonKnowledgeBaseRepository({
      dataRoot: path.join(appRoot, "public", "data"),
      dbFilePath: path.join(appRoot, "data", "knowledge-base-db.json"),
    });
  }

  const ontoGitCommitService = new OntoGitLocalCommitService({
    storageRoot: knowledgeDataPaths.ontoGitStorageRoot,
  });
  const wikiWorkspaceWriter = new WikiWorkspaceWriterService({
    docsRoot: knowledgeDataPaths.wikiDocsRoot,
  });

  return {
    knowledgeBaseService: new KnowledgeBaseService(repository, {
      projectId: process.env.ONTOGIT_PROJECT_ID || "demo",
      sourceCommitter: ({ projectId, filename, data, message, agentName, committerName }) => (
        ontoGitCommitService.writeVersion({
          projectId,
          filename,
          data,
          message,
          agentName,
          committerName,
        })
      ),
      wikiWriter: ({ layer, slug, markdown }) => (
        wikiWorkspaceWriter.writeDocument({ layer, slug, markdown })
      ),
    }),
    assistantSessionStateService: new AssistantSessionStateService({
      runtimeRoot: qagentRuntimeRoot,
    }),
    conversationGraphStateService: new ConversationGraphStateService({
      runtimeRoot: qagentRuntimeRoot,
    }),
    localWorkspaceService: ontoGitCommitService,
    qagentService: new QAgentService({
      qagentCommand: resolveQAgentCommand(qagentRoot),
      qagentRoot,
      projectRoot,
      runtimeRoot: qagentRuntimeRoot,
    }),
    appRoot,
  };
}
