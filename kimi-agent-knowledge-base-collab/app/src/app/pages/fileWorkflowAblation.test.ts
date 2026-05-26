import assert from 'node:assert/strict';
import test from 'node:test';

import { extractAblationPanels } from './fileWorkflowAblation';

test('extractAblationPanels 会提取双卡片所需的精简字段', () => {
  const panels = extractAblationPanels({
    ablation_candidates: [
      {
        entity_id: 'entity_a',
        entity_name: '实体A',
        remove_target: '实体A',
        retain_target: '实体A',
        keep_role: '保留后负责维持主流程识别',
        remove_impact: '去除后核心路径丢失',
        observation: '保留版抽取更完整',
        evidence: '原文多次把实体A描述为核心模块',
      },
    ],
    ablation_judges: [
      {
        entity_id: 'entity_a',
        entity_name: '实体A',
        keep_probability: '81%',
        remove_probability: '49%',
        probability_gap: '32%',
        judge_reason: '差值超过 30%，且实体是必要条件',
        small_reason: true,
      },
    ],
  });

  assert.equal(panels.candidates.length, 1);
  assert.equal(panels.judges.length, 1);
  assert.equal(panels.candidates[0]?.fields.some((field) => field.label === '保留作用'), true);
  assert.equal(panels.candidates[0]?.fields.some((field) => field.label === '去除影响'), true);
  assert.equal(panels.judges[0]?.badge, '命中小故');
  assert.equal(panels.judges[0]?.fields.some((field) => field.label === '概率差'), true);
  assert.equal(panels.judges[0]?.fields.some((field) => field.label === '保留作用'), true);
  assert.equal(panels.judges[0]?.fields.some((field) => field.label === '去除影响'), true);
  assert.equal(panels.judges[0]?.fields.some((field) => field.label === '依据'), true);
});

test('extractAblationPanels 会自动隐藏未填充字段', () => {
  const panels = extractAblationPanels({
    ablation_candidates: [
      {
        entity_id: 'entity_a',
        entity_name: '实体A',
        remove_target: '实体A',
        retain_target: '实体A',
        keep_role: '',
        remove_impact: '去除后核心路径丢失',
        observation: '',
        evidence: '原文多次把实体A描述为核心模块',
      },
    ],
    ablation_judges: [
      {
        entity_id: 'entity_a',
        entity_name: '实体A',
        keep_probability: '65%',
        remove_probability: '50%',
        probability_gap: '15%',
        judge_reason: '差值不足 30%',
      },
    ],
  });

  assert.equal(panels.candidates[0]?.fields.some((field) => field.label === '保留作用'), false);
  assert.equal(panels.candidates[0]?.fields.some((field) => field.label === '观察点'), false);
  assert.equal(panels.judges[0]?.badge, '继续观察');
});

test('extractAblationPanels 会兼容旧版 ablation 合并结构', () => {
  const panels = extractAblationPanels({
    ablation: [
      {
        entity_id: 'ent_entity_1',
        entity_name: '鱼家——智能养鱼系统',
        impact_level: '高',
        impact_reason: '鱼家是整个系统的核心，缺失将导致整个项目无法进行。',
        system_risk: '高',
      },
    ],
  });

  assert.equal(panels.candidates.length, 1);
  assert.equal(panels.judges.length, 0);
  assert.equal(panels.candidates[0]?.title, '鱼家——智能养鱼系统');
  assert.equal(panels.candidates[0]?.fields.some((field) => field.label === '影响等级'), true);
  assert.equal(panels.candidates[0]?.fields.some((field) => field.label === '影响说明'), true);
  assert.equal(panels.candidates[0]?.fields.some((field) => field.label === '系统风险'), true);
});
