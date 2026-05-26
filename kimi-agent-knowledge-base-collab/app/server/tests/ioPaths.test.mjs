import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveKnowledgeIoPaths } from "../ioPaths.mjs";

test("resolveKnowledgeIoPaths defaults to knowledge-data root and split io/store directories", () => {
  const paths = resolveKnowledgeIoPaths({
    workspaceRoot: "D:/code/FJY",
    env: {},
    defaultIoCodeRoot: "D:/code/FJY/Ontology_Factory",
  });

  const expectedKnowledgeRoot = path.resolve("D:/code/FJY/knowledge-data");
  assert.equal(paths.knowledgeIoRoot, expectedKnowledgeRoot);
  assert.equal(paths.ioDocsRoot, path.join(expectedKnowledgeRoot, "json"));
  assert.equal(paths.ioStorageRoot, path.join(expectedKnowledgeRoot, "store"));
  assert.equal(paths.ioCodeRoot, path.resolve("D:/code/FJY/Ontology_Factory"));
});

test("resolveKnowledgeIoPaths respects KNOWLEDGE_IO_ROOT first and explicit storage overrides second", () => {
  const paths = resolveKnowledgeIoPaths({
    workspaceRoot: "D:/code/FJY",
    env: {
      KNOWLEDGE_IO_ROOT: "E:/shared/knowledge-root",
      ONTOGIT_STORAGE_ROOT: "F:/custom-store",
      IO_CODE_ROOT: "G:/io-code",
    },
    defaultIoCodeRoot: "D:/code/FJY/Ontology_Factory",
  });

  assert.equal(paths.knowledgeIoRoot, path.resolve("E:/shared/knowledge-root"));
  assert.equal(paths.ioDocsRoot, path.join(path.resolve("E:/shared/knowledge-root"), "json"));
  assert.equal(paths.ioStorageRoot, path.resolve("F:/custom-store"));
  assert.equal(paths.ioCodeRoot, path.resolve("G:/io-code"));
});
