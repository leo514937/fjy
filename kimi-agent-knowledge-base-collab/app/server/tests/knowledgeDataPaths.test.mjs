import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveKnowledgeDataPaths } from "../knowledgeDataPaths.mjs";

test("resolveKnowledgeDataPaths defaults to knowledge-data root and split wiki/store directories", () => {
  const paths = resolveKnowledgeDataPaths({
    workspaceRoot: "D:/code/FJY",
    env: {},
    defaultWikiMGCodeRoot: "D:/code/FJY/Ontology_Factory",
  });

  const expectedKnowledgeRoot = path.resolve("D:/code/FJY/knowledge-data");
  assert.equal(paths.knowledgeDataRoot, expectedKnowledgeRoot);
  assert.equal(paths.wikimgWorkspaceRoot, expectedKnowledgeRoot);
  assert.equal(paths.wikiDocsRoot, path.join(expectedKnowledgeRoot, "wiki"));
  assert.equal(paths.ontoGitStorageRoot, path.join(expectedKnowledgeRoot, "store"));
  assert.equal(paths.wikimgCodeRoot, path.resolve("D:/code/FJY/Ontology_Factory"));
  assert.equal(
    paths.wikimgScriptPath,
    path.join(path.resolve("D:/code/FJY/Ontology_Factory"), "WIKI_MG", "src", "wikimg", "cli.py"),
  );
});

test("resolveKnowledgeDataPaths respects KNOWLEDGE_DATA_ROOT first and explicit storage overrides second", () => {
  const paths = resolveKnowledgeDataPaths({
    workspaceRoot: "D:/code/FJY",
    env: {
      KNOWLEDGE_DATA_ROOT: "E:/shared/knowledge-root",
      ONTOGIT_STORAGE_ROOT: "F:/custom-store",
      WIKIMG_ROOT: "G:/wikimg-code",
      WIKIMG_BIN: "G:/wikimg-code/custom-cli.py",
    },
    defaultWikiMGCodeRoot: "D:/code/FJY/Ontology_Factory",
  });

  assert.equal(paths.knowledgeDataRoot, path.resolve("E:/shared/knowledge-root"));
  assert.equal(paths.wikimgWorkspaceRoot, path.resolve("E:/shared/knowledge-root"));
  assert.equal(paths.wikiDocsRoot, path.join(path.resolve("E:/shared/knowledge-root"), "wiki"));
  assert.equal(paths.ontoGitStorageRoot, path.resolve("F:/custom-store"));
  assert.equal(paths.wikimgCodeRoot, path.resolve("G:/wikimg-code"));
  assert.equal(paths.wikimgScriptPath, path.resolve("G:/wikimg-code/custom-cli.py"));
});
