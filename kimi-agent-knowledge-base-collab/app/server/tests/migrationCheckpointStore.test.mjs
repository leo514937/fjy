import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadMigrationCheckpoint,
  saveMigrationCheckpoint,
} from "../migrationCheckpointStore.mjs";

test("迁移 checkpoint 可以保存和恢复", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "fjy-migration-checkpoint-"));
  const checkpointFile = path.join(tmpDir, "checkpoint.json");
  const checkpoint = {
    status: "in_progress",
    project_id: "demo",
    batch_size: 2,
    next_index: 4,
    batch_reports: [
      {
        batch_index: 1,
        summary: {
          processed_files: 2,
        },
      },
    ],
    plan: {
      project_id: "demo",
      summary: {
        total_files: 6,
      },
    },
  };

  try {
    await saveMigrationCheckpoint(checkpointFile, checkpoint);
    const raw = await readFile(checkpointFile, "utf8");
    const loaded = await loadMigrationCheckpoint(checkpointFile);

    assert.match(raw, /"project_id": "demo"/);
    assert.equal(loaded.project_id, "demo");
    assert.equal(loaded.batch_size, 2);
    assert.equal(loaded.next_index, 4);
    assert.equal(loaded.batch_reports[0].batch_index, 1);
    assert.equal(loaded.plan.summary.total_files, 6);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

