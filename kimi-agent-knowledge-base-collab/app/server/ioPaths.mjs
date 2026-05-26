import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const IO_CONFIG_DIR = ".io";
const IO_CONFIG_FILE = "config.json";
const IO_DOCS_DIR = "json";
const IO_LAYERS = ["common", "domain", "private"];

function resolveFrom(root, value) {
  if (!value) {
    return "";
  }
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(value);
  return path.isAbsolute(value) || isWindowsAbsolute
    ? path.resolve(value)
    : path.resolve(root, value);
}

export function resolveKnowledgeIoPaths(options = {}) {
  const env = options.env || process.env;
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const defaultIoCodeRoot = resolveFrom(
    workspaceRoot,
    options.defaultIoCodeRoot || path.join(workspaceRoot, "Ontology_Factory"),
  );

  const knowledgeIoRoot = resolveFrom(
    workspaceRoot,
    env.KNOWLEDGE_IO_ROOT || path.join(workspaceRoot, "knowledge-data"),
  );
  const ioDocsRoot = path.join(knowledgeIoRoot, IO_DOCS_DIR);
  const ioStorageRoot = resolveFrom(
    workspaceRoot,
    env.ONTOGIT_STORAGE_ROOT || path.join(knowledgeIoRoot, "store"),
  );
  const ioCodeRoot = resolveFrom(
    workspaceRoot,
    env.IO_CODE_ROOT || defaultIoCodeRoot,
  );

  return {
    workspaceRoot,
    knowledgeIoRoot,
    ioDocsRoot,
    ioStorageRoot,
    ioCodeRoot,
  };
}

export function ensureKnowledgeIoWorkspace(pathsOrRoot) {
  const knowledgeIoRoot = typeof pathsOrRoot === "string"
    ? path.resolve(pathsOrRoot)
    : path.resolve(pathsOrRoot?.knowledgeIoRoot || process.cwd());
  const ioDocsRoot = path.join(knowledgeIoRoot, IO_DOCS_DIR);
  const configDir = path.join(knowledgeIoRoot, IO_CONFIG_DIR);
  const configPath = path.join(configDir, IO_CONFIG_FILE);
  const storeRoot = typeof pathsOrRoot === "object" && pathsOrRoot?.ioStorageRoot
    ? path.resolve(pathsOrRoot.ioStorageRoot)
    : path.join(knowledgeIoRoot, "store");

  mkdirSync(knowledgeIoRoot, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(ioDocsRoot, { recursive: true });
  mkdirSync(storeRoot, { recursive: true });
  mkdirSync(path.join(storeRoot, ".xg_meta"), { recursive: true });

  for (const layer of IO_LAYERS) {
    mkdirSync(path.join(ioDocsRoot, layer), { recursive: true });
  }

  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `${JSON.stringify({ version: 1, docs_dir: IO_DOCS_DIR, layers: IO_LAYERS }, null, 2)}\n`,
      "utf8",
    );
  } else {
    try {
      JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      writeFileSync(
        configPath,
        `${JSON.stringify({ version: 1, docs_dir: IO_DOCS_DIR, layers: IO_LAYERS }, null, 2)}\n`,
        "utf8",
      );
    }
  }

  return {
    knowledgeIoRoot,
    ioDocsRoot,
    storeRoot,
    configPath,
  };
}
