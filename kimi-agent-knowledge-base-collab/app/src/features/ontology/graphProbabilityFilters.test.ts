import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GRAPH_PROBABILITY_FILTERS,
  filterGraphCrossReferencesByProbability,
  filterGraphEntitiesByProbability,
  getEntityProbabilityMetrics,
  parseProbabilityPercent,
} from '@/features/ontology/graphProbabilityFilters';
import type { Entity } from '@/types/ontology';

function createEntity(
  id: string,
  ablation?: Entity['ablation'],
): Entity {
  return {
    id,
    name: id,
    type: 'workflow-entity',
    domain: 'demo',
    layer: 'domain',
    level: 1,
    source: 'linear-workflow',
    definition: `${id} 定义`,
    properties: {},
    ablation: ablation ?? null,
  };
}

test('parseProbabilityPercent 支持百分号、纯数字和小数', () => {
  assert.equal(parseProbabilityPercent('82%'), 82);
  assert.equal(parseProbabilityPercent('0.45'), 45);
  assert.equal(parseProbabilityPercent(0.31), 31);
  assert.equal(parseProbabilityPercent(77), 77);
  assert.equal(parseProbabilityPercent('-35%'), -35);
  assert.equal(parseProbabilityPercent('-0.4'), -40);
  assert.equal(parseProbabilityPercent(''), null);
});

test('getEntityProbabilityMetrics 会从实体 ablation 中提取三项概率', () => {
  const metrics = getEntityProbabilityMetrics(createEntity('entity-a', {
    keep_probability: '90%',
    remove_probability: '35%',
    probability_gap: '55%',
  }));

  assert.deepEqual(metrics, {
    keepProbability: 90,
    removeProbability: 35,
    probabilityGap: 55,
  });
});

test('filterGraphEntitiesByProbability 会按三项阈值过滤图谱实体', () => {
  const entities = [
    createEntity('entity-a', {
      keep_probability: '91%',
      remove_probability: '28%',
      probability_gap: '63%',
    }),
    createEntity('entity-b', {
      keep_probability: '72%',
      remove_probability: '48%',
      probability_gap: '-24%',
    }),
    createEntity('entity-c'),
  ];

  assert.deepEqual(
    filterGraphEntitiesByProbability(entities, DEFAULT_GRAPH_PROBABILITY_FILTERS).map((entity) => entity.id),
    ['entity-a', 'entity-b', 'entity-c'],
  );

  assert.deepEqual(
    filterGraphEntitiesByProbability(entities, {
      keepProbabilityMin: 80,
      removeProbabilityMax: 40,
      probabilityGapMin: 40,
    }).map((entity) => entity.id),
    ['entity-a', 'entity-c'],
  );

  assert.deepEqual(
    filterGraphEntitiesByProbability(entities, {
      keepProbabilityMin: 0,
      removeProbabilityMax: 100,
      probabilityGapMin: -20,
    }).map((entity) => entity.id),
    ['entity-a', 'entity-c'],
  );
});

test('filterGraphCrossReferencesByProbability 仅保留可见实体之间的边', () => {
  const visibleEntities = [
    createEntity('entity-a'),
    createEntity('entity-c'),
  ];

  const crossReferences = [
    { source: 'entity-a', target: 'entity-b', relation: '依赖', description: '' },
    { source: 'entity-a', target: 'entity-c', relation: '支撑', description: '' },
    { source: 'entity-c', target: 'entity-d', relation: '关联', description: '' },
  ];

  assert.deepEqual(filterGraphCrossReferencesByProbability(crossReferences, visibleEntities), [
    { source: 'entity-a', target: 'entity-c', relation: '支撑', description: '' },
  ]);
});
