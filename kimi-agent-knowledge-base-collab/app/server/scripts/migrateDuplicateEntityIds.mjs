import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAppServices } from "../createAppServices.mjs";
import { migrateDuplicateEntityIds } from "../entityIdMigration.mjs";
import { loadMigrationCheckpoint, saveMigrationCheckpoint } from "../migrationCheckpointStore.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "../..");

function splitProjectList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    projectIds: [],
    dryRun: true,
    strict: true,
    batchSize: 0,
    checkpointFile: "",
    resume: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--non-strict") {
      options.strict = false;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--resume") {
      options.resume = true;
      continue;
    }
    if (arg === "--batch-size") {
      const next = argv[index + 1] || "";
      if (next) {
        options.batchSize = Math.max(0, Number(next) || 0);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      options.batchSize = Math.max(0, Number(arg.slice("--batch-size=".length)) || 0);
      continue;
    }
    if (arg === "--checkpoint-file") {
      const next = argv[index + 1] || "";
      if (next) {
        options.checkpointFile = next.trim();
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--checkpoint-file=")) {
      options.checkpointFile = arg.slice("--checkpoint-file=".length).trim();
      continue;
    }
    if (arg === "--project" || arg === "-p") {
      const next = argv[index + 1] || "";
      if (next) {
        options.projectIds.push(...splitProjectList(next));
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--project=")) {
      options.projectIds.push(...splitProjectList(arg.slice("--project=".length)));
      continue;
    }
  }

  return options;
}

function buildDefaultCheckpointFile(projectId) {
  return path.join(appRoot, ".workflow-runtime", `entity-id-migration-${projectId}.json`);
}

function isBatchMode(options) {
  return Number(options.batchSize) > 0 || Boolean(options.checkpointFile) || Boolean(options.resume);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const services = createAppServices({});
  const repository = services.localWorkspaceService;
  const projectIds = options.projectIds.length > 0
    ? options.projectIds
    : [process.env.ONTOGIT_PROJECT_ID || "demo"];

  const reports = [];
  for (const projectId of projectIds) {
    const checkpointFile = options.checkpointFile || (isBatchMode(options) && !options.dryRun ? buildDefaultCheckpointFile(projectId) : "");
    const loadedCheckpoint = !options.dryRun && checkpointFile && options.resume
      ? await loadMigrationCheckpoint(checkpointFile)
      : null;
    if (options.resume && checkpointFile && !loadedCheckpoint) {
      throw new Error(`找不到可继续的迁移 checkpoint：${checkpointFile}`);
    }

    const plan = loadedCheckpoint?.plan || undefined;
    const startIndex = Number(loadedCheckpoint?.next_index || 0);
    const batchSize = Number(loadedCheckpoint?.batch_size || options.batchSize || 0);
    const checkpointWriter = !options.dryRun && checkpointFile
      ? async (state) => {
        await saveMigrationCheckpoint(checkpointFile, state);
        process.stderr.write(`${JSON.stringify({
          event: "migration-batch",
          project_id: state.project_id,
          status: state.status,
          batch_size: state.batch_size,
          next_index: state.next_index,
          batch_count: Array.isArray(state.batch_reports) ? state.batch_reports.length : 0,
          updated_at: state.updated_at,
          checkpoint_file: checkpointFile,
        })}\n`);
      }
      : null;

    const report = await migrateDuplicateEntityIds(repository, {
      projectId,
      dryRun: options.dryRun,
      strict: options.strict,
      batchSize,
      startIndex: loadedCheckpoint ? startIndex : 0,
      checkpointWriter,
      plan,
    });

    if (!options.dryRun && checkpointFile) {
      await saveMigrationCheckpoint(checkpointFile, report.checkpoint || {
        status: report.status,
        project_id: projectId,
        batch_size: batchSize,
        start_index: loadedCheckpoint ? startIndex : 0,
        next_index: loadedCheckpoint ? startIndex : 0,
        plan: report.plan,
        batch_reports: report.batch_reports || [],
        write_results: report.write_results || [],
        updated_at: new Date().toISOString(),
      });
    }

    report.checkpoint_file = checkpointFile || null;
    report.resumed_from_checkpoint = Boolean(loadedCheckpoint);
    reports.push(report);
  }

  process.stdout.write(`${JSON.stringify({
    status: "success",
    mode: options.dryRun ? "dry-run" : "apply",
    batch_size: Number(options.batchSize || 0),
    reports,
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}
