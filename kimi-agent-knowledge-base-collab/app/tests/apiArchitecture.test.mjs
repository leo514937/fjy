import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { appRoot, resolveAppPath } from "./testPaths.mjs";

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }
      return [fullPath];
    }),
  );

  return files.flat();
}

test("前端 API 已按 shared/ontology/assistant/workspace 分域拆分", async () => {
  const requiredFiles = [
    "src/shared/api/http.ts",
    "src/features/ontology/api.ts",
    "src/features/assistant/api.ts",
    "src/features/workspace/api.ts",
  ];

  for (const relativePath of requiredFiles) {
    const filePath = resolveAppPath(relativePath);
    await assert.doesNotReject(() => fs.access(filePath), `${relativePath} 应存在`);
  }
});

test("业务代码不再从 '@/lib/api' 读取全站 API 入口", async () => {
  const sourceFiles = (await collectFiles(path.join(appRoot, "src")))
    .filter((filePath) => /\.(ts|tsx)$/.test(filePath));

  for (const filePath of sourceFiles) {
    const source = await fs.readFile(filePath, "utf8");
    assert.doesNotMatch(
      source,
      /@\/lib\/api/,
      `${path.relative(appRoot, filePath)} 不应再依赖 @/lib/api`,
    );
  }
});
