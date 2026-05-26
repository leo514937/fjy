import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGraphSlice,
  collectGraphShowRefs,
  extractGraphShowRefs,
} from './graphRefs.ts';
import type { CrossReference, Entity } from '@/types/ontology';

function createEntity(id: string, name: string): Entity {
  return {
    id,
    name,
    type: '实体',
    domain: 'kimi-demo',
    layer: 'common',
    source: 'ontogit',
    definition: `${name} 节点`,
    properties: {},
  };
}

test('extractGraphShowRefs 能识别 io show 命令', () => {
  assert.equal(
    extractGraphShowRefs('echo start && ./io.sh show common:kimi-demo/人工智能').at(0),
    'common:kimi-demo/人工智能',
  );

  assert.deepEqual(
    extractGraphShowRefs('```bash\n./io.sh show "common:kimi-demo/人工智能"\n./io.sh show domain:kimi-demo/机器学习 --json\n```'),
    ['common:kimi-demo/人工智能', 'domain:kimi-demo/机器学习'],
  );
});

test('collectGraphShowRefs 会从整段会话上下文中汇总已查看节点', () => {
  assert.deepEqual(
    collectGraphShowRefs([
      {
        id: 'msg-1',
        question: '先看看',
        answer: '执行 ./io.sh show common:kimi-demo/人工智能',
        relatedNames: [],
        executionStages: [],
        toolRuns: [],
        contentBlocks: [],
      },
      {
        id: 'msg-2',
        question: '再看看',
        answer: '',
        relatedNames: [],
        executionStages: [],
        toolRuns: [
          {
            callId: 'call-1',
            command: './io.sh show domain:kimi-demo/机器学习',
            status: 'success',
            stdout: '',
            stderr: '',
            exitCode: 0,
            cwd: null,
            durationMs: null,
            truncated: false,
            startedAt: null,
            finishedAt: null,
          },
        ],
        contentBlocks: [],
      },
    ]),
    ['common:kimi-demo/人工智能', 'domain:kimi-demo/机器学习'],
  );
});

test('buildGraphSlice 只保留已查看节点及其相互关系', () => {
  const entities = [
    createEntity('common:kimi-demo/人工智能', '人工智能'),
    createEntity('domain:kimi-demo/机器学习', '机器学习'),
    createEntity('domain:kimi-demo/深度学习', '深度学习'),
    createEntity('domain:kimi-demo/无关节点', '无关节点'),
  ];

  const crossReferences: CrossReference[] = [
    {
      source: 'common:kimi-demo/人工智能',
      target: 'domain:kimi-demo/机器学习',
      relation: '支撑',
      description: '人工智能 与 机器学习 有关',
    },
    {
      source: 'domain:kimi-demo/机器学习',
      target: 'domain:kimi-demo/深度学习',
      relation: '包含',
      description: '机器学习 与 深度学习 有关',
    },
    {
      source: 'domain:kimi-demo/无关节点',
      target: 'domain:kimi-demo/深度学习',
      relation: '无关',
      description: '不会出现在子图中',
    },
  ];

  const slice = buildGraphSlice(
    entities,
    crossReferences,
    ['common:kimi-demo/人工智能', 'domain:kimi-demo/机器学习'],
  );

  assert.ok(slice);
  assert.deepEqual(slice?.viewedRefs, ['common:kimi-demo/人工智能', 'domain:kimi-demo/机器学习']);
  assert.deepEqual(
    slice?.entities.map((entity) => entity.id).sort(),
    ['common:kimi-demo/人工智能', 'domain:kimi-demo/机器学习'],
  );
  assert.deepEqual(
    slice?.crossReferences.map((reference) => `${reference.source}->${reference.target}`).sort(),
    ['common:kimi-demo/人工智能->domain:kimi-demo/机器学习'],
  );
});

test('buildGraphSlice 支持中文层级前缀的模糊匹配', () => {
  const entities = [
    createEntity('domain:fish-home/鱼家-智能养鱼系统', '鱼家——智能养鱼系统'),
    createEntity('domain:fish-home/鱼家第一阶段', '鱼家第一阶段'),
  ];

  const slice = buildGraphSlice(
    entities,
    [],
    ['domain:鱼家-智能养鱼系统'],
  );

  assert.ok(slice);
  assert.deepEqual(slice?.viewedRefs, ['domain:鱼家-智能养鱼系统']);
  assert.deepEqual(slice?.entities.map((entity) => entity.id), ['domain:fish-home/鱼家-智能养鱼系统']);
});
