import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildWorkflowStagePreview, WorkflowInsightCard } from './fileWorkflowPanels';

test('buildWorkflowStagePreview 会为消融候选阶段输出紧凑摘要', () => {
  const preview = buildWorkflowStagePreview(
    'ablation_candidate',
    {
      candidates: [
        {
          entity_id: 'entity_a',
          entity_name: '实体A',
        },
      ],
    },
    {
      candidates: [
        {
          id: 'entity_a',
          title: '实体A',
          fields: [
            { label: '保留作用', value: '保留后可维持主流程识别' },
            { label: '去除影响', value: '去除后主流程判定明显退化' },
            { label: '依据', value: '原文多次将实体A描述为核心模块' },
          ],
        },
      ],
      judges: [],
    },
  );

  assert.deepEqual(preview, {
    candidate_count: 1,
    sample: [
      {
        entity_name: '实体A',
        保留作用: '保留后可维持主流程识别',
        去除影响: '去除后主流程判定明显退化',
      },
    ],
  });
});

test('buildWorkflowStagePreview 会为小故判定阶段输出紧凑摘要', () => {
  const preview = buildWorkflowStagePreview(
    'ablation_judge',
    {
      ablation_judges: [
        {
          entity_id: 'entity_a',
          entity_name: '实体A',
        },
      ],
    },
    {
      candidates: [],
      judges: [
        {
          id: 'entity_a',
          title: '实体A',
          badge: '命中小故',
          fields: [
            { label: '概率差', value: '32%' },
            { label: '判定依据', value: '差值超过 30%，且实体属于必要条件' },
            { label: '保留作用', value: '保留后可维持主流程识别' },
          ],
        },
      ],
    },
  );

  assert.deepEqual(preview, {
    judge_count: 1,
    hit_count: 1,
    sample: [
      {
        entity_name: '实体A',
        判定: '命中小故',
        概率差: '32%',
        判定依据: '差值超过 30%，且实体属于必要条件',
      },
    ],
  });
});

test('WorkflowInsightCard 会使用统一的流程卡外壳样式', () => {
  const markup = renderToStaticMarkup(
    React.createElement(WorkflowInsightCard, {
      card: {
        id: 'entity_a',
        title: '实体A',
        badge: '命中小故',
        fields: [
          { label: '概率差', value: '32%' },
          { label: '判定依据', value: '差值超过 30%，且实体属于必要条件' },
        ],
      },
    }),
  );

  assert.match(markup, /rounded-3xl/);
  assert.match(markup, /bg-background\/80/);
  assert.match(markup, /hover:-translate-y-0\.5/);
  assert.match(markup, /概率差/);
  assert.match(markup, /判定依据/);
});
