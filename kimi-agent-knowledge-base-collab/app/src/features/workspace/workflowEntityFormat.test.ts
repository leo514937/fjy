import assert from 'node:assert/strict';
import test from 'node:test';

import { validateWorkflowEntityFileData } from '@/features/workspace/workflowEntityFormat';

function createValidWorkflowSource(overrides: Record<string, unknown> = {}) {
  return {
    source: 'linear-workflow',
    ontology: {
      workflow_version: 'v1-linear-file-workflow',
      generated_at: '2026-04-25T00:00:00Z',
      project_id: 'demo',
      scope: 'entity',
      entity_id: 'entity_a',
      entity_name: '实体A',
      system_summary: {
        entity_count: 1,
        relation_count: 0,
        ablation_count: 0,
      },
      entity: {
        id: 'entity_a',
        name: '实体A',
        summary: '摘要',
        type: 'capability',
        level: 1,
        source: 'linear-workflow',
        properties: {},
        abilities: [],
        citations: [],
      },
      relations: [],
      ablation: null,
    },
    entity: {
      id: 'entity_a',
      name: '实体A',
      summary: '摘要',
      type: 'capability',
      level: 1,
      source: 'linear-workflow',
      properties: {},
      abilities: [],
      citations: [],
    },
    relations: [],
    ablation: null,
    precheck: null,
    ontology_summary: {
      entity_count: 1,
      relation_count: 0,
      ablation_count: 0,
    },
    ...overrides,
  };
}

test('validateWorkflowEntityFileData 允许可选 probability 字段', () => {
  const result = validateWorkflowEntityFileData(createValidWorkflowSource({
    probability: '97%',
  }));

  assert.deepEqual(result, { ok: true });
});

test('validateWorkflowEntityFileData 拒绝空 probability', () => {
  const result = validateWorkflowEntityFileData(createValidWorkflowSource({
    probability: '',
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error, 'data.probability 必须是非空字符串');
});

test('validateWorkflowEntityFileData 允许新的消融候选与小故判定字段', () => {
  const result = validateWorkflowEntityFileData(createValidWorkflowSource({
    ablation: {
      entity_id: 'entity_a',
      entity_name: '实体A',
      remove_target: '实体A',
      retain_target: '实体A',
      keep_role: '保留后可维持主流程识别',
      remove_impact: '去除后主流程判定明显退化',
      observation: '保留版与去除版在核心能力上出现明显差异',
      evidence: '证据来自原文和关系抽取结果',
      keep_probability: '82%',
      remove_probability: '51%',
      probability_gap: '31%',
      judge_reason: '概率差超过 30%，且实体属于必要条件',
      small_reason: true,
    },
  }));

  assert.deepEqual(result, { ok: true });
});

test('validateWorkflowEntityFileData 拒绝显式写入非小故标记', () => {
  const result = validateWorkflowEntityFileData(createValidWorkflowSource({
    ablation: {
      entity_id: 'entity_a',
      entity_name: '实体A',
      remove_target: '实体A',
      retain_target: '实体A',
      keep_role: '保留后可维持主流程识别',
      remove_impact: '去除后主流程判定明显退化',
      observation: '保留版与去除版在核心能力上出现明显差异',
      evidence: '证据来自原文和关系抽取结果',
      keep_probability: '82%',
      remove_probability: '62%',
      probability_gap: '20%',
      judge_reason: '差值不足 30%',
      small_reason: false,
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error, 'data.ablation.small_reason 只能在命中时写入 true');
});
