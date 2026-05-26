import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolveAppPath } from "./testPaths.mjs";

test("App.tsx 退化为应用壳入口，不再直接承载业务派生逻辑", async () => {
  const source = await fs.readFile(resolveAppPath("src", "App.tsx"), "utf8");

  assert.match(source, /import\s+\{\s*AppShell\s*\}\s+from\s+'\.\/app\/AppShell'/);
  assert.match(source, /return\s+<AppShell\s*\/>/);
  assert.doesNotMatch(source, /buildFilteredStatistics/);
  assert.doesNotMatch(source, /useOntologyAssistantState/);
  assert.doesNotMatch(source, /useOntologyData/);
});
