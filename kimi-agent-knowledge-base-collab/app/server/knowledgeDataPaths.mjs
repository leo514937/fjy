import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WIKIMG_CONFIG_DIR = ".wikimg";
const WIKIMG_CONFIG_FILE = "config.json";
const WIKIMG_DOCS_DIR = "wiki";
const WIKIMG_LAYERS = ["common", "domain", "private"];

function resolveFrom(root, value) {
  if (!value) {
    return "";
  }
  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(root, value);
}

export function resolveKnowledgeDataPaths(options = {}) {
  const env = options.env || process.env;
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const defaultWikiMGCodeRoot = resolveFrom(
    workspaceRoot,
    options.defaultWikiMGCodeRoot || path.join(workspaceRoot, "Ontology_Factory"),
  );

  const knowledgeDataRoot = resolveFrom(
    workspaceRoot,
    env.KNOWLEDGE_DATA_ROOT || path.join(workspaceRoot, "knowledge-data"),
  );
  const wikimgWorkspaceRoot = knowledgeDataRoot;
  const wikiDocsRoot = path.join(wikimgWorkspaceRoot, WIKIMG_DOCS_DIR);
  const ontoGitStorageRoot = resolveFrom(
    workspaceRoot,
    env.ONTOGIT_STORAGE_ROOT || path.join(knowledgeDataRoot, "store"),
  );
  const wikimgCodeRoot = resolveFrom(
    workspaceRoot,
    env.WIKIMG_ROOT || defaultWikiMGCodeRoot,
  );
  const wikimgScriptPath = resolveFrom(
    workspaceRoot,
    env.WIKIMG_BIN || path.join(wikimgCodeRoot, "WIKI_MG", "src", "wikimg", "cli.py"),
  );

  return {
    workspaceRoot,
    knowledgeDataRoot,
    wikimgWorkspaceRoot,
    wikiDocsRoot,
    ontoGitStorageRoot,
    wikimgCodeRoot,
    wikimgScriptPath,
  };
}

export function ensureKnowledgeDataWorkspace(pathsOrRoot) {
  const knowledgeDataRoot = typeof pathsOrRoot === "string"
    ? path.resolve(pathsOrRoot)
    : path.resolve(pathsOrRoot?.knowledgeDataRoot || pathsOrRoot?.wikimgWorkspaceRoot || process.cwd());
  const wikiDocsRoot = path.join(knowledgeDataRoot, WIKIMG_DOCS_DIR);
  const configDir = path.join(knowledgeDataRoot, WIKIMG_CONFIG_DIR);
  const configPath = path.join(configDir, WIKIMG_CONFIG_FILE);
  const storeRoot = typeof pathsOrRoot === "object" && pathsOrRoot?.ontoGitStorageRoot
    ? path.resolve(pathsOrRoot.ontoGitStorageRoot)
    : path.join(knowledgeDataRoot, "store");

  mkdirSync(knowledgeDataRoot, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(wikiDocsRoot, { recursive: true });
  mkdirSync(storeRoot, { recursive: true });
  mkdirSync(path.join(storeRoot, ".xg_meta"), { recursive: true });

  for (const layer of WIKIMG_LAYERS) {
    mkdirSync(path.join(wikiDocsRoot, layer), { recursive: true });
  }

  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `${JSON.stringify({ version: 1, docs_dir: WIKIMG_DOCS_DIR, layers: WIKIMG_LAYERS }, null, 2)}\n`,
      "utf8",
    );
  } else {
    try {
      JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      writeFileSync(
        configPath,
        `${JSON.stringify({ version: 1, docs_dir: WIKIMG_DOCS_DIR, layers: WIKIMG_LAYERS }, null, 2)}\n`,
        "utf8",
      );
    }
  }

  return {
    knowledgeDataRoot,
    wikiDocsRoot,
    storeRoot,
    configPath,
  };
}
