import test from "node:test";
import assert from "node:assert/strict";

const { buildOntologyAppState } = await import("../src/features/ontology/state.ts");

test("buildOntologyAppState 会基于层过滤自动选择首个可见实体并派生统计/关联实体", () => {
  const knowledgeGraph = {
    metadata: {
      title: "测试图谱",
      version: "1.0.0",
      description: "for test",
    },
    statistics: {
      total_entities: 4,
      total_relations: 3,
      domains: ["A", "B"],
      levels: [1, 2],
      sources: ["seed"],
      layers: ["common", "domain", "private"],
      layer_counts: {
        common: 1,
        domain: 2,
        private: 1,
      },
    },
    entity_index: {
      common_1: {
        id: "common_1",
        name: "公共概念",
        type: "topic",
        domain: "A",
        layer: "common",
        level: 1,
        source: "seed",
        definition: "公共",
        properties: {},
      },
      domain_1: {
        id: "domain_1",
        name: "领域概念 1",
        type: "topic",
        domain: "A",
        layer: "domain",
        level: 2,
        source: "seed",
        definition: "领域 1",
        properties: {},
      },
      domain_2: {
        id: "domain_2",
        name: "领域概念 2",
        type: "topic",
        domain: "B",
        layer: "domain",
        level: 2,
        source: "seed",
        definition: "领域 2",
        properties: {},
      },
      private_1: {
        id: "private_1",
        name: "私有概念",
        type: "topic",
        domain: "B",
        layer: "private",
        level: 2,
        source: "seed",
        definition: "私有",
        properties: {},
      },
    },
    cross_references: [
      { source: "common_1", target: "domain_1", relation: "ref", description: "" },
      { source: "domain_1", target: "domain_2", relation: "ref", description: "" },
      { source: "domain_2", target: "private_1", relation: "ref", description: "" },
    ],
  };

  const state = buildOntologyAppState({
    knowledgeGraph,
    selectedLayer: "domain",
    selectedEntityId: null,
  });

  assert.deepEqual(state.filteredEntities.map((entity) => entity.id), ["domain_1", "domain_2"]);
  assert.equal(state.selectedEntity?.id, "domain_1");
  assert.deepEqual(state.filteredCrossReferences, [
    { source: "domain_1", target: "domain_2", relation: "ref", description: "" },
  ]);
  assert.deepEqual(state.relatedEntities.map((entity) => entity.id), ["domain_2"]);
  assert.equal(state.filteredStatistics?.total_entities, 2);
  assert.equal(state.filteredStatistics?.total_relations, 1);
  assert.deepEqual(state.filteredStatistics?.domains, ["A", "B"]);
  assert.deepEqual(state.filteredStatistics?.levels, [2]);
  assert.deepEqual(state.filteredStatistics?.layers, ["domain"]);
  assert.deepEqual(state.filteredStatistics?.sources, ["seed"]);
});

test("buildOntologyAppState 会保持 selectedEntity 的回退规则和关联实体顺序", () => {
  const knowledgeGraph = {
    metadata: {
      title: "测试图谱",
      version: "1.0.0",
      description: "for test",
    },
    statistics: {
      total_entities: 3,
      total_relations: 3,
      domains: ["A"],
      levels: [1],
      sources: ["seed"],
      layers: ["common", "domain"],
      layer_counts: {
        common: 1,
        domain: 2,
      },
    },
    entity_index: {
      common_1: {
        id: "common_1",
        name: "公共概念",
        type: "topic",
        domain: "A",
        layer: "common",
        level: 1,
        source: "seed",
        definition: "公共",
        properties: {},
      },
      domain_1: {
        id: "domain_1",
        name: "领域概念 1",
        type: "topic",
        domain: "A",
        layer: "domain",
        level: 1,
        source: "seed",
        definition: "领域 1",
        properties: {},
      },
      domain_2: {
        id: "domain_2",
        name: "领域概念 2",
        type: "topic",
        domain: "A",
        layer: "domain",
        level: 1,
        source: "seed",
        definition: "领域 2",
        properties: {},
      },
    },
    cross_references: [
      { source: "domain_1", target: "domain_2", relation: "ref", description: "first" },
      { source: "common_1", target: "domain_1", relation: "ref", description: "filtered out" },
      { source: "domain_2", target: "domain_1", relation: "ref", description: "second" },
    ],
  };

  const state = buildOntologyAppState({
    knowledgeGraph,
    selectedLayer: "domain",
    selectedEntityId: "missing",
  });

  assert.equal(state.selectedEntity?.id, "domain_1");
  assert.deepEqual(state.filteredCrossReferences, [
    { source: "domain_1", target: "domain_2", relation: "ref", description: "first" },
    { source: "domain_2", target: "domain_1", relation: "ref", description: "second" },
  ]);
  assert.deepEqual(state.relatedEntities.map((entity) => entity.id), ["domain_2", "domain_2"]);
});
