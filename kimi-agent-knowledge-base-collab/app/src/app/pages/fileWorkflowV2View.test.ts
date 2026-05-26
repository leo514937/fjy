import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWorkflowV2GraphLayout, extractWorkflowV2SiblingImpactEdges, extractWorkflowV2Summary, getWorkflowV2ImpactEdgeStyle } from './fileWorkflowV2View';

test('extractWorkflowV2Summary 会读取 meta 统计信息', () => {
  const summary = extractWorkflowV2Summary({
    document: null,
    chunks: [],
    windows: [],
    objects: [],
    edges: [],
    ablation: [],
    meta: {
      total_chunks: 3,
      total_windows: 2,
      total_objects: 5,
      total_edges: 4,
      is_dag: true,
    },
  });

  assert.deepEqual(summary, {
    chunkCount: 3,
    windowCount: 2,
    objectCount: 5,
    edgeCount: 4,
    isDag: true,
  });
});

test('buildWorkflowV2GraphLayout 会按拓扑深度生成简单 DAG 布局', () => {
  const layout = buildWorkflowV2GraphLayout({
    document: null,
    chunks: [],
    windows: [],
    objects: [
      { object_id: 'obj-computer', object_name: '电脑' },
      { object_id: 'obj-cpu', object_name: 'CPU' },
      { object_id: 'obj-gpu', object_name: 'GPU' },
      { object_id: 'obj-alu', object_name: 'ALU' },
    ],
    edges: [
      { edge_id: 'edge-1', source_object_id: 'obj-computer', target_object_id: 'obj-cpu' },
      { edge_id: 'edge-2', source_object_id: 'obj-computer', target_object_id: 'obj-gpu' },
      { edge_id: 'edge-3', source_object_id: 'obj-cpu', target_object_id: 'obj-alu' },
    ],
    ablation: [],
    meta: {},
  });

  const computer = layout.nodes.find((node) => node.id === 'obj-computer');
  const cpu = layout.nodes.find((node) => node.id === 'obj-cpu');
  const alu = layout.nodes.find((node) => node.id === 'obj-alu');

  assert.equal(layout.edges.length, 3);
  assert.equal(computer?.depth, 0);
  assert.equal(cpu?.depth, 1);
  assert.equal(alu?.depth, 2);
});

test('buildWorkflowV2GraphLayout 默认不会把孤立节点放进 DAG 布局', () => {
  const layout = buildWorkflowV2GraphLayout({
    document: null,
    chunks: [],
    windows: [],
    objects: [
      { object_id: 'obj-computer', object_name: '电脑', is_isolated: false, structure_status: 'structured' },
      { object_id: 'obj-cpu', object_name: 'CPU', is_isolated: false, structure_status: 'structured' },
      {
        object_id: 'obj-note',
        object_name: '注释对象',
        is_isolated: true,
        structure_status: 'isolated',
        structure_reason: '没有进入任何结构边。',
      },
    ],
    edges: [
      { edge_id: 'edge-1', source_object_id: 'obj-computer', target_object_id: 'obj-cpu' },
    ],
    ablation: [],
    meta: {},
  });

  const isolated = layout.nodes.find((node) => node.id === 'obj-note');
  assert.equal(isolated, undefined);
});

test('buildWorkflowV2GraphLayout 在关闭隐藏开关后会显示孤立节点', () => {
  const layout = buildWorkflowV2GraphLayout({
    document: null,
    chunks: [],
    windows: [],
    objects: [
      { object_id: 'obj-computer', object_name: '电脑', is_isolated: false, structure_status: 'structured' },
      { object_id: 'obj-cpu', object_name: 'CPU', is_isolated: false, structure_status: 'structured' },
      {
        object_id: 'obj-note',
        object_name: '注释对象',
        is_isolated: true,
        structure_status: 'isolated',
        structure_reason: '没有进入任何结构边。',
      },
    ],
    edges: [
      { edge_id: 'edge-1', source_object_id: 'obj-computer', target_object_id: 'obj-cpu' },
    ],
    ablation: [],
    meta: {},
  }, {
    hideIsolatedNodes: false,
  });

  const isolated = layout.nodes.find((node) => node.id === 'obj-note');
  assert.equal(isolated?.isIsolated, true);
  assert.equal(isolated?.structureStatus, 'isolated');
  assert.equal(isolated?.structureReason, '没有进入任何结构边。');
});

test('buildWorkflowV2GraphLayout 会隐藏所有无边节点', () => {
  const layout = buildWorkflowV2GraphLayout({
    document: null,
    chunks: [],
    windows: [],
    objects: [
      { object_id: 'obj-computer', object_name: '电脑' },
      { object_id: 'obj-cpu', object_name: 'CPU' },
      { object_id: 'obj-note', object_name: '注释对象', is_isolated: true },
    ],
    edges: [
      { edge_id: 'edge-1', source_object_id: 'obj-computer', target_object_id: 'obj-cpu' },
    ],
    ablation: [],
    meta: {},
  });

  assert.deepEqual(layout.nodes.map((node) => node.id), ['obj-computer', 'obj-cpu']);
  assert.equal(layout.nodes.some((node) => node.id === 'obj-note'), false);
});

test('extractWorkflowV2SiblingImpactEdges 会提取兄弟消融边并保留更高 impact_level', () => {
  const edges = extractWorkflowV2SiblingImpactEdges([
    {
      parent_object_id: 'obj-computer',
      sibling_dependency_table: [
        {
          ablated_child_object_id: 'obj-cpu',
          target_sibling_object_id: 'obj-gpu',
          impact_level: 'low',
        },
        {
          ablated_child_object_id: 'obj-cpu',
          target_sibling_object_id: 'obj-gpu',
          impact_level: 'high',
        },
        {
          ablated_child_object_id: 'obj-gpu',
          target_sibling_object_id: 'obj-cpu',
          impact_level: 'medium',
        },
      ],
    },
  ]);

  assert.deepEqual(edges, [
    {
      id: 'obj-computer:obj-cpu->obj-gpu',
      sourceId: 'obj-cpu',
      targetId: 'obj-gpu',
      parentId: 'obj-computer',
      impactLevel: 'high',
    },
    {
      id: 'obj-computer:obj-gpu->obj-cpu',
      sourceId: 'obj-gpu',
      targetId: 'obj-cpu',
      parentId: 'obj-computer',
      impactLevel: 'medium',
    },
  ]);
});

test('getWorkflowV2ImpactEdgeStyle 会按 impact_level 返回不同边样式', () => {
  assert.deepEqual(getWorkflowV2ImpactEdgeStyle('high'), {
    stroke: 'rgba(239,68,68,0.8)',
    strokeWidth: 4,
  });
  assert.deepEqual(getWorkflowV2ImpactEdgeStyle('medium'), {
    stroke: 'rgba(245,158,11,0.78)',
    strokeWidth: 3.25,
  });
  assert.deepEqual(getWorkflowV2ImpactEdgeStyle('low'), {
    stroke: 'rgba(14,165,233,0.72)',
    strokeWidth: 2.5,
    strokeDasharray: '8 6',
  });
  assert.deepEqual(getWorkflowV2ImpactEdgeStyle('unknown'), {
    stroke: 'rgba(148,163,184,0.58)',
    strokeWidth: 1.75,
    strokeDasharray: '4 8',
  });
});
