import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { migrateKnowledgeIo } from "../ioMigration.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../../..");

try {
  const result = await migrateKnowledgeIo({ workspaceRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}
