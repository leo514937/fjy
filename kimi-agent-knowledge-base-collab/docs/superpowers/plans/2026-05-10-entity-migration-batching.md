# Entity Migration Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `demo`/`sjfx` 的实体 ID 迁移改成可分批执行、可断点续跑、每批有清晰记录的流程，避免单次长任务超时。

**Architecture:** 复用现有迁移核心，不重写业务规则，只在 CLI 层增加批次划分、状态记录和阶段性输出。每次只处理有限数量的文件，落盘保存 checkpoint 和阶段报告，下一次运行从 checkpoint 继续。迁移本身仍然遵循“保留首个、重复顺延、同步更新引用”的现有规则。

**Tech Stack:** Node.js, existing migration repository helpers, JSON checkpoint files, existing test runner.

---

### Task 1: Add batch-aware migration execution

**Files:**
- Modify: `D:/code/FJY/kimi-agent-knowledge-base-collab/app/server/entityIdMigration.mjs`
- Modify: `D:/code/FJY/kimi-agent-knowledge-base-collab/app/server/scripts/migrateDuplicateEntityIds.mjs`

- [ ] **Step 1: Write the failing test**

```js
test("batched migration returns phase records and checkpoint progress", async () => {
  // 先断言返回值包含 batch_reports / checkpoint / completed_files
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ./server/tests/entityIdMigration.test.mjs`
Expected: fail because batch API does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
// CLI 支持 --batch-size / --checkpoint-file / --resume
// 每个批次写一条阶段记录，包含 processed_files / succeeded / skipped / failed
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ./server/tests/entityIdMigration.test.mjs`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/entityIdMigration.mjs app/server/scripts/migrateDuplicateEntityIds.mjs app/server/tests/entityIdMigration.test.mjs
git commit -m "feat: add batched entity migration"
```

### Task 2: Persist migration checkpoints and reports

**Files:**
- Modify: `D:/code/FJY/kimi-agent-knowledge-base-collab/app/server/scripts/migrateDuplicateEntityIds.mjs`
- Create: `D:/code/FJY/kimi-agent-knowledge-base-collab/app/server/migrationCheckpointStore.mjs`
- Create: `D:/code/FJY/kimi-agent-knowledge-base-collab/app/server/tests/migrationCheckpointStore.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test("checkpoint store saves and resumes migration state", async () => {
  // 断言 save/load 一致，且支持覆盖更新
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ./server/tests/migrationCheckpointStore.test.mjs`
Expected: fail because store is missing.

- [ ] **Step 3: Write minimal implementation**

```js
// 使用 JSON 文件保存 project_id / last_completed_filename / batch reports
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ./server/tests/migrationCheckpointStore.test.mjs`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/migrationCheckpointStore.mjs app/server/scripts/migrateDuplicateEntityIds.mjs app/server/tests/migrationCheckpointStore.test.mjs
git commit -m "feat: persist migration checkpoints"
```

### Task 3: Add stage-by-stage operator output

**Files:**
- Modify: `D:/code/FJY/kimi-agent-knowledge-base-collab/app/server/scripts/migrateDuplicateEntityIds.mjs`
- Modify: `D:/code/FJY/kimi-agent-knowledge-base-collab/app/server/tests/entityIdMigration.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test("CLI prints batch stage summary", async () => {
  // 断言输出包含 stage、batch_index、processed_count、checkpoint_path
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ./server/tests/entityIdMigration.test.mjs`
Expected: fail until CLI output is updated.

- [ ] **Step 3: Write minimal implementation**

```js
// 输出 JSON，顶层带 overall_summary / batch_reports / checkpoint
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ./server/tests/entityIdMigration.test.mjs`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/scripts/migrateDuplicateEntityIds.mjs app/server/tests/entityIdMigration.test.mjs
git commit -m "feat: add staged migration reporting"
```

### Task 4: Verify against real demo project in batches

**Files:**
- No code changes expected

- [ ] **Step 1: Run dry-run with batching**

Run: `node ./server/scripts/migrateDuplicateEntityIds.mjs --project demo --dry-run --batch-size 20`
Expected: output includes multiple batch reports and a checkpoint preview.

- [ ] **Step 2: Run apply with resume**

Run: `node ./server/scripts/migrateDuplicateEntityIds.mjs --project demo --apply --non-strict --batch-size 20 --checkpoint-file C:\tmp\demo-migration.json`
Expected: first run writes the first batch and persists progress.

- [ ] **Step 3: Resume until completion**

Run: `node ./server/scripts/migrateDuplicateEntityIds.mjs --project demo --apply --non-strict --resume --checkpoint-file C:\tmp\demo-migration.json`
Expected: remaining batches are processed, and final report shows completion.

- [ ] **Step 4: Validate entity counts**

Run: `Invoke-WebRequest http://localhost:8787/api/xg/projects`
Expected: `demo` file count remains 181, and knowledge graph entity count increases after cache refresh.

