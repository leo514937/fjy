import assert from 'node:assert/strict';
import test from 'node:test';

import type { Entity, CrossReference } from '../types/ontology';
import {
  createKnowledgeGraphNodeIndex,
  getKnowledgeGraphRenderBudget,
  mergeKnowledgeGraphLinks,
} from './knowledgeGraphLayout';

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

test('mergeKnowledgeGraphLinks 会合并同一对节点的重复关系', () => {
  const links = mergeKnowledgeGraphLinks([
    { source: 'b', target: 'a', relation: '依赖' },
    { source: 'a', target: 'b', relation: '依赖' },
    { source: 'a', target: 'b', relation: '约束' },
    { source: 'a', target: 'c', relation: '关联' },
  ] satisfies CrossReference[]);

  assert.deepEqual(links, [
    { source: 'b', target: 'a', relation: '依赖 | 约束' },
    { source: 'a', target: 'c', relation: '关联' },
  ]);
});

test('createKnowledgeGraphNodeIndex 会返回稳定的节点映射', () => {
  const nodes = [
    { id: 'a', name: '节点A', x: 10, y: 20, vx: 0, vy: 0, radius: 20, color: '#111111', entity: createEntity('a', '节点A') },
    { id: 'b', name: '节点B', x: 30, y: 40, vx: 0, vy: 0, radius: 18, color: '#222222', entity: createEntity('b', '节点B') },
  ];

  const index = createKnowledgeGraphNodeIndex(nodes);

  assert.strictEqual(index.get('a'), nodes[0]);
  assert.strictEqual(index.get('b'), nodes[1]);
  assert.equal(index.get('missing'), undefined);
});

test('getKnowledgeGraphRenderBudget 会在小图谱上保持 full', () => {
  const budget = getKnowledgeGraphRenderBudget(32, { width: 1400, height: 900 });

  assert.deepEqual(budget, {
    mode: 'full',
    maxInitialNodes: 32,
    allowPairwiseRepulsion: true,
  });
});

test('getKnowledgeGraphRenderBudget 会在大图谱上降级为 reduced', () => {
  const budget = getKnowledgeGraphRenderBudget(96, { width: 1400, height: 900 });

  assert.deepEqual(budget, {
    mode: 'reduced',
    maxInitialNodes: 32,
    allowPairwiseRepulsion: false,
  });
});

test('getKnowledgeGraphRenderBudget 会在紧凑视口下更早降级', () => {
  const largeViewportBudget = getKnowledgeGraphRenderBudget(41, { width: 1400, height: 900 });
  const compactViewportBudget = getKnowledgeGraphRenderBudget(41, { width: 820, height: 620 });

  assert.deepEqual(largeViewportBudget, {
    mode: 'full',
    maxInitialNodes: 41,
    allowPairwiseRepulsion: true,
  });
  assert.deepEqual(compactViewportBudget, {
    mode: 'reduced',
    maxInitialNodes: 24,
    allowPairwiseRepulsion: false,
  });
});
