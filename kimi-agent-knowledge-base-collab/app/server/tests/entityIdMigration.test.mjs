import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEntityIdMigrationPlanFromFiles,
  migrateDuplicateEntityIds,
} from "../entityIdMigration.mjs";

function createWorkflowEntitySource({
  projectId = "demo",
  entityId,
  entityName,
  relations = [],
  ablation = null,
  precheck = null,
}) {
  return {
    source: "linear-workflow",
    ontology: {
      workflow_version: "v1-linear-file-workflow",
      generated_at: "2026-04-25T00:00:00Z",
      project_id: projectId,
      scope: "entity",
      entity_id: entityId,
      entity_name: entityName,
      system_summary: {
        entity_count: 1,
        relation_count: relations.length,
        ablation_count: ablation ? 1 : 0,
      },
      entity: {
        id: entityId,
        name: entityName,
        summary: `${entityName} 概要`,
        type: "capability",
        level: 1,
        source: "linear-workflow",
        properties: {},
        abilities: [],
        citations: [],
      },
      relations,
      ablation: ablation ? [ablation] : [],
    },
    entity: {
      id: entityId,
      name: entityName,
      summary: `${entityName} 概要`,
      type: "capability",
      level: 1,
      source: "linear-workflow",
      properties: {},
      abilities: [],
      citations: [],
    },
    relations,
    ablation,
    precheck,
    ontology_summary: {
      entity_count: 1,
      relation_count: relations.length,
      ablation_count: ablation ? 1 : 0,
    },
    probability: "95%",
  };
}

function createDuplicateDataset() {
  const files = [
    {
      filename: "a.json",
      data: createWorkflowEntitySource({
        entityId: "ent_entity_1",
        entityName: "鱼家——智能养鱼系统",
        relations: [
          {
            source_entity_id: "ent_entity_1",
            source_name: "鱼家——智能养鱼系统",
            target_entity_id: "ent_entity_1",
            target_name: "微信小程序",
            relation_type: "包含",
            evidence: "系统包含小程序入口",
          },
        ],
      }),
    },
    {
      filename: "b.json",
      data: createWorkflowEntitySource({
        entityId: "ent_entity_1",
        entityName: "微信小程序",
        relations: [
          {
            source_entity_id: "ent_entity_1",
            source_name: "微信小程序",
            target_entity_id: "ent_entity_2",
            target_name: "网站页面",
            relation_type: "依赖",
            evidence: "小程序依赖网站页面",
          },
        ],
        ablation: {
          entity_id: "ent_entity_1",
          entity_name: "微信小程序",
          impact_level: "medium",
          impact_reason: "去除后会影响访问入口",
          system_risk: "medium",
        },
        precheck: {
          entity_id: "ent_entity_1",
          entity_name: "微信小程序",
          precheck_probability: "95%",
          precheck_reason: "入口清晰",
          raw: { probability: "95%" },
        },
      }),
    },
    {
      filename: "c.json",
      data: createWorkflowEntitySource({
        entityId: "ent_entity_2",
        entityName: "网站页面",
        relations: [
          {
            source_entity_id: "ent_entity_2",
            source_name: "网站页面",
            target_entity_id: "ent_entity_1",
            target_name: "鱼家——智能养鱼系统",
            relation_type: "包含",
            evidence: "网站页面承载系统入口",
          },
        ],
      }),
    },
    {
      filename: "d.json",
      data: createWorkflowEntitySource({
        entityId: "ent_entity_3",
        entityName: "Operate（运作）",
      }),
    },
    {
      filename: "e.json",
      data: createWorkflowEntitySource({
        entityId: "ent_entity_4",
        entityName: "Implement（实现）",
      }),
    },
    {
      filename: "f.json",
      data: createWorkflowEntitySource({
        entityId: "ent_entity_5",
        entityName: "Design（设计）",
      }),
    },
  ];

  return files;
}

test("buildEntityIdMigrationPlanFromFiles 会把重复 id 迁移到最大序号之后", () => {
  const plan = buildEntityIdMigrationPlanFromFiles({
    projectId: "demo",
    files: createDuplicateDataset(),
  });

  assert.equal(plan.summary.duplicate_entity_groups, 1);
  assert.equal(plan.summary.duplicate_entity_records, 1);
  assert.equal(plan.summary.changed_files, 2);
  assert.equal(plan.summary.unresolved_references, 0);
  assert.equal(plan.remaps.find((item) => item.filename === "b.json")?.final_entity_id, "ent_entity_6");
  assert.equal(plan.remaps.find((item) => item.filename === "a.json")?.changed, true);
  assert.equal(plan.remaps.find((item) => item.filename === "b.json")?.changed, true);
  assert.equal(plan.remaps.find((item) => item.filename === "c.json")?.changed, false);
  assert.equal(plan.duplicate_groups[0].duplicate_files[0].planned_entity_id, "ent_entity_6");
});

test("migrateDuplicateEntityIds 会同步改写实体、自引用和关系引用", async () => {
  const writes = [];
  const versionMapCalls = [];
  const originalFiles = new Map(createDuplicateDataset().map((item) => [item.filename, item.data]));
  const repository = {
    async getJsonFileTimelines() {
      return [...originalFiles.keys()].map((filename) => ({ filename }));
    },
    async loadLatestVersionIdMap(projectId) {
      versionMapCalls.push(projectId);
      return new Map([...originalFiles.keys()].map((filename) => [filename, 5]));
    },
    async readProjectFile(projectId, filename) {
      const record = originalFiles.get(filename);
      if (!record) {
        throw new Error(`missing file: ${filename}`);
      }
      return JSON.parse(JSON.stringify(record));
    },
    async writeWorkflowEntity(payload) {
      assert.equal(payload.skipInference, true);
      writes.push(payload);
      return {
        write_result: {
          version_id: writes.length,
          commit_id: `commit-${writes.length}`,
        },
      };
    },
  };

  const result = await migrateDuplicateEntityIds(repository, {
    projectId: "demo",
    dryRun: false,
    strict: true,
  });

  assert.equal(result.status, "success");
  assert.equal(writes.length, 2);
  assert.equal(versionMapCalls.length, 1);
  assert.deepEqual(
    result.write_results.filter((item) => item.status === "success").map((item) => item.filename),
    ["a.json", "b.json"],
  );

  const writtenA = writes.find((item) => item.filename === "a.json");
  const writtenB = writes.find((item) => item.filename === "b.json");

  assert.equal(writtenA.data.entity.id, "ent_entity_1");
  assert.equal(writtenA.data.relations[0].target_entity_id, "ent_entity_6");
  assert.equal(writtenA.data.ontology.relations[0].target_entity_id, "ent_entity_6");

  assert.equal(writtenB.data.entity.id, "ent_entity_6");
  assert.equal(writtenB.data.ontology.entity_id, "ent_entity_6");
  assert.equal(writtenB.data.ontology.entity.id, "ent_entity_6");
  assert.equal(writtenB.data.relations[0].source_entity_id, "ent_entity_6");
  assert.equal(writtenB.data.ontology.relations[0].source_entity_id, "ent_entity_6");
  assert.equal(writtenB.data.ablation.entity_id, "ent_entity_6");
  assert.equal(writtenB.data.precheck.entity_id, "ent_entity_6");
  assert.equal(writtenB.data.ontology.ablation[0].entity_id, "ent_entity_6");
});

test("migrateDuplicateEntityIds 兼容仅保留最小四字段的 ablation", async () => {
  const writes = [];
  const originalFiles = new Map([
    ["a.json", createWorkflowEntitySource({
      entityId: "ent_entity_1",
      entityName: "实体A",
      ablation: {
        keep_probability: "81%",
        remove_probability: "52%",
        probability_gap: "29%",
        judge_reason: "去除后主链路不完整",
      },
    })],
  ]);
  const repository = {
    async getJsonFileTimelines() {
      return [{ filename: "a.json" }];
    },
    async loadLatestVersionIdMap() {
      return new Map([["a.json", 5]]);
    },
    async readProjectFile(projectId, filename) {
      return JSON.parse(JSON.stringify(originalFiles.get(filename)));
    },
    async writeWorkflowEntity(payload) {
      writes.push(payload);
      return {
        write_result: {
          version_id: 6,
          commit_id: "commit-1",
        },
      };
    },
  };

  const result = await migrateDuplicateEntityIds(repository, {
    projectId: "demo",
    dryRun: false,
    strict: true,
  });

  assert.equal(result.status, "success");
  assert.equal(writes.length, 0);
  assert.equal(result.plan.summary.unresolved_references, 0);
});

test("migrateDuplicateEntityIds 支持分批执行并返回阶段记录", async () => {
  const writes = [];
  const checkpointSnapshots = [];
  const versionMapCalls = [];
  const originalFiles = new Map(createDuplicateDataset().map((item) => [item.filename, item.data]));
  const repository = {
    async getJsonFileTimelines() {
      return [...originalFiles.keys()].map((filename) => ({ filename }));
    },
    async loadLatestVersionIdMap(projectId) {
      versionMapCalls.push(projectId);
      return new Map([...originalFiles.keys()].map((filename) => [filename, 5]));
    },
    async readProjectFile(projectId, filename) {
      const record = originalFiles.get(filename);
      if (!record) {
        throw new Error(`missing file: ${filename}`);
      }
      return JSON.parse(JSON.stringify(record));
    },
    async writeWorkflowEntity(payload) {
      assert.equal(payload.skipInference, true);
      writes.push(payload);
      return {
        write_result: {
          version_id: writes.length,
          commit_id: `commit-${writes.length}`,
        },
      };
    },
  };

  const result = await migrateDuplicateEntityIds(repository, {
    projectId: "demo",
    dryRun: false,
    strict: true,
    batchSize: 2,
    checkpointWriter: async (state) => {
      checkpointSnapshots.push(JSON.parse(JSON.stringify(state)));
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.batch_reports.length, 3);
  assert.equal(result.batch_reports[0].summary.processed_files, 2);
  assert.equal(result.batch_reports[1].summary.processed_files, 2);
  assert.equal(result.batch_reports[2].summary.processed_files, 2);
  assert.equal(versionMapCalls.length, 1);
  assert.ok(checkpointSnapshots.length >= 4);
  assert.equal(checkpointSnapshots[0].status, "in_progress");
  assert.equal(checkpointSnapshots.at(-1).status, "success");
  assert.equal(checkpointSnapshots.at(-1).next_index, 6);
  assert.equal(writes.length, 2);
});
