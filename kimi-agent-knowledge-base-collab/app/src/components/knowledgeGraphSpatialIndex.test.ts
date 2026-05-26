import assert from 'node:assert/strict';
import test from 'node:test';

import type { Entity } from '../types/ontology';
import type { KnowledgeGraphNode } from './knowledgeGraphLayout';
import {
  KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE,
  KNOWLEDGE_GRAPH_SPATIAL_EXACT_THRESHOLD,
  KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN,
  buildKnowledgeGraphSpatialIndex,
  forEachKnowledgeGraphNeighborPair,
  getKnowledgeGraphRepulsionStrategy,
} from './knowledgeGraphSpatialIndex';

function createEntity(id: string, name: string): Entity {
  return {
    id,
    name,
    type: 'capability',
    domain: 'demo-domain',
    layer: 'domain',
    level: 2,
    source: 'linear-workflow',
    definition: `${name} 定义`,
    properties: {},
  };
}

function createNode(id: string, x: number, y: number): KnowledgeGraphNode {
  return {
    id,
    name: id,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 20,
    color: '#111111',
    entity: createEntity(id, id),
  };
}

test('getKnowledgeGraphRepulsionStrategy 在 64 节点及以下保持 exact', () => {
  assert.deepEqual(getKnowledgeGraphRepulsionStrategy(KNOWLEDGE_GRAPH_SPATIAL_EXACT_THRESHOLD), {
    mode: 'exact',
    cellSize: 0,
    neighborSpan: 0,
  });
  assert.deepEqual(getKnowledgeGraphRepulsionStrategy(0), {
    mode: 'exact',
    cellSize: 0,
    neighborSpan: 0,
  });
});

test('getKnowledgeGraphRepulsionStrategy 在阈值以上切换到 spatial', () => {
  assert.deepEqual(getKnowledgeGraphRepulsionStrategy(KNOWLEDGE_GRAPH_SPATIAL_EXACT_THRESHOLD + 1), {
    mode: 'spatial',
    cellSize: KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE,
    neighborSpan: KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN,
  });
});

test('buildKnowledgeGraphSpatialIndex 和邻域遍历会稳定输出应该命中的 pair', () => {
  const nodes = [
    createNode('a', 10, 10),
    createNode('b', 20, 20),
    createNode('c', 250, 10),
    createNode('d', 490, 10),
  ];

  const index = buildKnowledgeGraphSpatialIndex(nodes, KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE);

  assert.equal(index.cellSize, KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE);
  assert.ok(index.buckets instanceof Map);
  assert.deepEqual([...index.buckets.values()].flat().sort((left, right) => left - right), [0, 1, 2, 3]);

  const collectPairs = () => {
    const pairs: Array<[string, string]> = [];
    forEachKnowledgeGraphNeighborPair(nodes, index, KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN, (source, target) => {
      pairs.push([source.id, target.id]);
    });
    return pairs;
  };

  const pairs = collectPairs();
  const repeatedPairs = collectPairs();
  const normalizedPairs = pairs.map(([source, target]) => `${source}--${target}`).sort();
  const normalizedRepeatedPairs = repeatedPairs.map(([source, target]) => `${source}--${target}`).sort();

  assert.deepEqual(pairs, repeatedPairs);
  assert.deepEqual(normalizedRepeatedPairs, normalizedPairs);
  assert.equal(new Set(normalizedPairs).size, normalizedPairs.length);
  assert.equal(normalizedPairs.length, 4);
  assert.ok(normalizedPairs.includes('a--b'));
  assert.ok(normalizedPairs.includes('a--c'));
  assert.ok(normalizedPairs.includes('b--c'));
  assert.ok(normalizedPairs.includes('c--d'));
});

test('120 个节点时候选 pair 数量明显少于全量 pairwise', () => {
  const nodes = Array.from({ length: 120 }, (_, index) =>
    createNode(`n${index}`, index * KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE + 10, 10),
  );
  const index = buildKnowledgeGraphSpatialIndex(nodes, KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE);
  const pairs: Array<[number, number]> = [];

  forEachKnowledgeGraphNeighborPair(nodes, index, KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN, (_source, _target, sourceIndex, targetIndex) => {
    pairs.push([sourceIndex, targetIndex]);
  });

  const fullPairCount = (nodes.length * (nodes.length - 1)) / 2;
  const expectedPairs = Array.from({ length: 119 }, (_, index) => `${index}--${index + 1}`).sort();
  const normalizedPairs = pairs.map(([source, target]) => `${source}--${target}`).sort();

  assert.equal(pairs.length, 119);
  assert.equal(new Set(normalizedPairs).size, normalizedPairs.length);
  assert.deepEqual(normalizedPairs, expectedPairs);
  assert.ok(pairs.length < fullPairCount / 10);
  assert.ok(pairs.length > 0);
});
