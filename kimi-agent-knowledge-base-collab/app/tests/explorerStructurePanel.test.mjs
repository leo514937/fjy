import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolveAppPath } from "./testPaths.mjs";

test("本体图谱侧栏提供系统结构面板并默认聚焦节点结构", async () => {
  const source = await fs.readFile(resolveAppPath("src", "app", "pages", "ExplorerPage.tsx"), "utf8");

  assert.match(source, /SystemRelationshipPanel/);
  assert.match(source, /useState<\s*'details'\s*\|\s*'structure'\s*\|\s*'selector'\s*>\('structure'\)/);
  assert.match(source, /value="structure"/);
  assert.match(source, /maxDepth=\{1\}/);
  assert.match(source, /系统结构/);
});
