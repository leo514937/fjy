import assert from 'node:assert/strict';
import test from 'node:test';

import type { CrossReference, Entity } from '@/types/ontology';

import { buildSystemRelationshipMap } from './systemRelationshipMap';

const entities: Entity[] = [
  {
    id: 'system',
    name: '电脑',
    type: '系统',
    domain: '硬件',
    layer: 'domain',
    level: 1,
    source: 'test',
    definition: '电脑系统',
    properties: {
      components: ['机箱'],
    },
  },
  {
    id: 'cpu',
    name: 'CPU',
    type: '部件',
    domain: '硬件',
    layer: 'domain',
    level: 2,
    source: 'test',
    definition: '处理器',
    properties: {},
  },
  {
    id: 'memory',
    name: '内存',
    type: '部件',
    domain: '硬件',
    layer: 'domain',
    level: 2,
    source: 'test',
    definition: '随机存取存储器',
    properties: {},
  },
  {
    id: 'gpu',
    name: 'GPU',
    type: '部件',
    domain: '硬件',
    layer: 'domain',
    level: 2,
    source: 'test',
    definition: '图形处理器',
    properties: {},
  },
];

const edges: CrossReference[] = [
  {
    source: 'system',
    target: 'cpu',
    relation: '包含',
    description: '电脑包含 CPU',
  },
  {
    source: 'system',
    target: 'memory',
    relation: '包含',
    description: '电脑包含 内存',
  },
  {
    source: 'system',
    target: 'gpu',
    relation: '包含',
    description: '电脑包含 GPU',
  },
  {
    source: 'memory',
    target: 'gpu',
    relation: '支撑',
    description: '内存支撑 GPU 运行',
  },
];

test('buildSystemRelationshipMap 能从包含和依赖关系中生成结构图', () => {
  const map = buildSystemRelationshipMap(entities[0], entities, edges);

  assert.ok(map);
  assert.equal(map?.root.name, '电脑');
  assert.deepEqual(
    map?.root.children.map((child) => child.name).sort(),
    ['CPU', 'GPU', '内存', '机箱'].sort(),
  );
  assert.equal(map?.dependencyClusters.length, 1);
  assert.deepEqual(map?.dependencyClusters[0].edges.map((edge) => edge.relation), ['支撑']);
  assert.equal(map?.containmentCount, 4);
  assert.equal(map?.dependencyCount, 1);
});

test('buildSystemRelationshipMap 能识别 part_of 方向并还原整体到部分结构', () => {
  const map = buildSystemRelationshipMap(entities[0], entities, [
    {
      source: 'cpu',
      target: 'system',
      relation: 'part_of',
      description: 'CPU part_of 电脑',
    },
  ]);

  assert.ok(map);
  assert.deepEqual(map?.root.children.map((child) => child.name), ['CPU', '机箱']);
  assert.equal(map?.containmentCount, 2);
});
