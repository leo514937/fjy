import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeBaseService } from "../services/knowledgeBaseService.mjs";

function createValidWorkflowSource(overrides = {}) {
  const entityId = "entity_salinity_monitoring";
  const entityName = "盐度监测";
  const entity = {
    id: entityId,
    name: entityName,
    summary: "用于持续跟踪盐度变化。",
    type: "capability",
    level: 2,
    source: "linear-workflow",
    properties: {
      domain: "ocean",
    },
    abilities: ["monitor"],
    citations: ["spec-1"],
  };
  const relation = {
    source_entity_id: entityId,
    target_entity_id: "entity_ocean_sensor",
    source_name: entityName,
    target_name: "海洋传感器",
    relation_type: "相关",
    evidence: "共享同一观测域。",
  };
  return {
    source: "linear-workflow",
    ontology: {
      scope: "entity",
      workflow_version: "v1-linear-file-workflow",
      project_id: "demo",
      entity_id: entityId,
      entity_name: entityName,
      generated_at: "2026-04-25T00:00:00Z",
      system_summary: {
        entity_count: 1,
        relation_count: 1,
        ablation_count: 0,
      },
      entity,
      relations: [relation],
      ablation: null,
    },
    entity,
    relations: [relation],
    ablation: null,
    precheck: null,
    ontology_summary: {
      entity_count: 1,
      relation_count: 1,
      ablation_count: 0,
    },
    ...overrides,
  };
}

function createRepository() {
  let invalidated = 0;
  let invalidatedProjectId = null;
  let loadedProjectId = null;
  return {
    invalidated: () => invalidated,
    invalidatedProjectId: () => invalidatedProjectId,
    loadedProjectId: () => loadedProjectId,
    invalidateCache(projectId) {
      invalidated += 1;
      invalidatedProjectId = projectId ?? null;
    },
    async loadDataset(projectId) {
      loadedProjectId = projectId ?? null;
      return {
        knowledgeGraph: {
          statistics: {
            total_entities: 12,
            total_relations: 28,
          },
        },
      };
    },
    async getEditorTemplate() {
      return {
        defaults: {
          name: "新概念",
          type: "workflow-entity",
          domain: "demo",
          source: "linear-workflow",
          definition: "请填写定义。",
          properties: {},
        },
        suggestions: {
          recommended_type: "workflow-entity",
          suggested_relations: [],
          rdf_preview: "",
          owl_preview: "",
        },
      };
    },
    async listEntities() {
      return [];
    },
    async getRelatedEntities() {
      return [];
    },
  };
}

test("KnowledgeBaseService commitEditorDraft writes only the JSON source", async () => {
  const repository = createRepository();
  const calls = [];
  const service = new KnowledgeBaseService(repository, {
    sourceCommitter: async (input) => {
      calls.push(input);
      return {
        filename: input.filename,
        version_id: 3,
        commit_id: "abc123",
      };
    },
  });

  const result = await service.commitEditorDraft({
    mode: "json",
    projectId: "demo",
    entityId: "entity_salinity_monitoring",
    slug: "entity_salinity_monitoring",
    message: "新增盐度监测",
    source: createValidWorkflowSource(),
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filename, "graph-source/domain/entity_salinity_monitoring.json");
  assert.equal(calls[0].data.entity.name, "盐度监测");
  assert.equal(calls[0].message, "新增盐度监测");
  assert.equal(calls[0].basevision, 0);
  assert.equal(repository.invalidated(), 1);
  assert.equal(repository.invalidatedProjectId(), "demo");
  assert.equal(repository.loadedProjectId(), "demo");
  assert.equal(result.updatedEntityId, "domain:entity_salinity_monitoring");
  assert.equal(result.layer, "domain");
  assert.equal(result.slug, "entity_salinity_monitoring");
  assert.equal(result.ref, "domain:entity_salinity_monitoring");
  assert.equal(result.exportSummary.totalEntities, 12);
  assert.equal(result.exportSummary.totalRelations, 28);
  assert.equal("wikiWrite" in result, false);
});

test("KnowledgeBaseService commitEditorDraft reports partial when JSON write refresh fails", async () => {
  const repository = createRepository();
  const service = new KnowledgeBaseService(repository, {
    sourceCommitter: async () => ({
      filename: "graph-source/domain/entity_salinity_monitoring.json",
      version_id: 4,
      commit_id: "def456",
    }),
  });
  repository.loadDataset = async () => {
    throw new Error("gateway offline");
  };

  const result = await service.commitEditorDraft({
    mode: "json",
    projectId: "demo",
    source: createValidWorkflowSource(),
  });

  assert.equal(result.status, "partial");
  assert.equal(result.sourceWrite.version_id, 4);
  assert.match(result.error, /gateway offline/);
});
