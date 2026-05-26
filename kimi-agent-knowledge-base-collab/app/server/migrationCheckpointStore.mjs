import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadMigrationCheckpoint(checkpointFile) {
  const filePath = asText(checkpointFile);
  if (!filePath) {
    return null;
  }

  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function saveMigrationCheckpoint(checkpointFile, checkpoint) {
  const filePath = asText(checkpointFile);
  if (!filePath) {
    throw new Error("迁移 checkpoint 文件路径不能为空。");
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  return checkpoint;
}

