import assert from 'node:assert/strict';
import test from 'node:test';

import { extractWorkflowEnsembleView, extractWorkflowJudgeEnsembleItems } from './fileWorkflowEnsemble';

test('extractWorkflowEnsembleView 会提取双模型单次结果、judge、辩论轮次和最终结果', () => {
  const view = extractWorkflowEnsembleView({
    strategy: 'dual-model-cross-debate',
    parallel_count: 2,
    debate_rounds: 2,
    shared_items: [{ item_key: '实体A', value: { name: '实体A' } }],
    conflicts: [{ item_key: '实体B' }],
    models: {
      model_a: {
        model: 'model/A',
        single_result: {
          data: { entities: [{ name: '实体A' }] },
          raw_text: '{"entities":[{"name":"实体A"}]}',
        },
      },
      model_b: {
        model: 'model/B',
        single_result: {
          data: { entities: [{ name: '实体B' }] },
          raw_text: '{"entities":[{"name":"实体B"}]}',
        },
      },
    },
    cross_rounds: [
      {
        round: 1,
        reviewer_model: 'model/A',
        reviewer_model_key: 'model_a',
        data: {
          round_summary: '模型 A 认为实体B需要合并摘要',
          resolved_conflicts: [
            {
              item_key: '实体B',
              decision: '融合修改',
              summary: '保留实体B，但补齐摘要',
              final_value: { name: '实体B' },
              citations: [
                {
                  target_model: 'model_a',
                  stance: '同意',
                  reason: '实体名称与证据一致',
                  suggestion: '保留当前命名',
                },
              ],
            },
          ],
        },
        raw_text: '{"entities":[{"name":"实体A"}]}',
      },
    ],
    judge_result: {
      model: 'model/Judge',
      data: {
        resolved_conflicts: [
          {
            item_key: '实体B',
            selected_model: 'model_b',
            reason: '模型 B 更完整',
          },
        ],
      },
      raw_text: '{"resolved_conflicts":[{"item_key":"实体B"}]}',
      status: 'completed',
    },
    final_result: {
      source: 'cross_round',
      data: { entities: [{ name: '实体Final' }] },
      raw_text: '{"entities":[{"name":"实体Final"}]}',
    },
  });

  assert.equal(view?.modelA?.modelName, 'model/A');
  assert.equal(view?.modelB?.modelName, 'model/B');
  assert.equal(view?.modelA?.status, 'completed');
  assert.equal(view?.parallelCount, 2);
  assert.equal(view?.debateRounds, 2);
  assert.equal(view?.sharedCount, 1);
  assert.equal(view?.conflictCount, 1);
  assert.equal(view?.judgeResult?.modelName, 'model/Judge');
  assert.equal(view?.judgeResult?.status, 'completed');
  assert.equal(view?.rounds[0]?.reviewerModel, 'model/A');
  assert.equal(view?.rounds[0]?.status, 'completed');
  assert.equal(view?.rounds[0]?.resolvedConflicts[0]?.citations[0]?.stance, '同意');
  assert.deepEqual(view?.finalResult?.data, { entities: [{ name: '实体Final' }] });
  assert.equal(view?.finalResult?.status, 'completed');
});

test('extractWorkflowJudgeEnsembleItems 会提取小故保留/去除两条子过程', () => {
  const items = extractWorkflowJudgeEnsembleItems(
    {
      judge_results: [
        {
          entity_id: 'ent_entity_1',
          llm_ensemble: {
            keep_result: {
              models: {
                model_a: { model: 'model/A', single_result: { data: { probability: '81%' }, raw_text: '{"probability":"81%"}' } },
                model_b: { model: 'model/B', single_result: { data: { probability: '78%' }, raw_text: '{"probability":"78%"}' } },
              },
              final_result: { source: 'cross_round', data: { probability: '80%' }, raw_text: '{"probability":"80%"}' },
            },
            remove_result: {
              models: {
                model_a: { model: 'model/A', single_result: { data: { probability: '53%' }, raw_text: '{"probability":"53%"}' } },
                model_b: { model: 'model/B', single_result: { data: { probability: '58%' }, raw_text: '{"probability":"58%"}' } },
              },
              final_result: { source: 'cross_round', data: { probability: '55%' }, raw_text: '{"probability":"55%"}' },
            },
          },
        },
      ],
    },
    [
      {
        entity_id: 'ent_entity_1',
        entity_name: '实体A',
      },
    ],
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.entityName, '实体A');
  assert.equal(items[0]?.keep?.modelA?.modelName, 'model/A');
  assert.deepEqual(items[0]?.keep?.finalResult?.data, { probability: '80%' });
  assert.deepEqual(items[0]?.remove?.finalResult?.data, { probability: '55%' });
});

test('extractWorkflowEnsembleView 会保留流式中的 rawText 与 status', () => {
  const view = extractWorkflowEnsembleView({
    models: {
      model_a: {
        model: 'model/A',
        single_result: {
          data: null,
          raw_text: '{"entities":[{"name":"流式中"}',
          status: 'streaming',
        },
      },
    },
    final_result: {
      source: 'cross_round',
      data: null,
      raw_text: '{"entities":[{"name":"最终流式中"}',
      status: 'streaming',
    },
  });

  assert.equal(view?.modelA?.rawText, '{"entities":[{"name":"流式中"}');
  assert.equal(view?.modelA?.status, 'streaming');
  assert.equal(view?.finalResult?.rawText, '{"entities":[{"name":"最终流式中"}');
  assert.equal(view?.finalResult?.status, 'streaming');
});

test('extractWorkflowEnsembleView 在 single_result 缺失时会回退到最新 candidate', () => {
  const view = extractWorkflowEnsembleView({
    models: {
      model_a: {
        model: 'model/A',
        candidates: [
          {
            data: null,
            raw_text: '{"entities":[{"name":"候选A"}',
            status: 'streaming',
          },
        ],
        single_result: null,
      },
      model_b: {
        model: 'model/B',
        candidates: [
          {
            data: null,
            raw_text: '{"entities":[{"name":"候选B-1"}',
            status: 'streaming',
          },
          {
            data: null,
            raw_text: '{"entities":[{"name":"候选B-2"}',
            status: 'streaming',
          },
        ],
        single_result: null,
      },
    },
  });

  assert.equal(view?.modelA?.rawText, '{"entities":[{"name":"候选A"}');
  assert.equal(view?.modelB?.rawText, '{"entities":[{"name":"候选B-2"}');
  assert.equal(view?.modelB?.status, 'streaming');
});
