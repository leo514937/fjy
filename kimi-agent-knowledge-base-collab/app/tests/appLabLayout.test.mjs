import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolveAppPath } from "./testPaths.mjs";

test("本体实验室主容器保持满宽布局，不使用 inline-flex 收缩", async () => {
  const appSourcePath = resolveAppPath("src", "app", "pages", "LabPage.tsx");
  const source = await fs.readFile(appSourcePath, "utf8");

  assert.match(source, /className="[^"]*w-full[^"]*rounded-3xl[^"]*shadow-inner[^"]*"/);
  assert.doesNotMatch(source, /rounded-3xl border bg-slate-50 p-1 shadow-inner inline-flex/);
  assert.match(source, /className="[^"]*flex-col[^"]*lg:flex-row[^"]*lg:justify-between[^"]*"/);
});
