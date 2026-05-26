import assert from "node:assert/strict";
import test from "node:test";

import { SystemAdapter } from "../services/systemAdapter.mjs";

test("SystemAdapter 生成的消融候选会被归一化并保留调用上下文", async () => {
  const calls = [];
  const adapter = new SystemAdapter({
    llmJsonInvoker: async (input) => {
      calls.push(input);
      return {
        ablation_candidates: [
          {
            entity_id: "ent-1",
            entity_name: "实体A",
            remove_target: "实体A",
            retain_target: "实体A",
            keep_role: "关键承接",
            remove_impact: "缺失后影响较大",
            observation: "观察到多处依赖",
            evidence: "证据片段",
          },
        ],
      };
    },
  });

  const result = await adapter.generateAblationCandidates({
    entities: [
      {
        id: "ent-1",
        name: "实体A",
        summary: "核心实体",
        citations: ["证据片段"],
      },
    ],
    relations: [],
  });

  assert.equal(result.candidate_count, 1);
  assert.equal(result.candidates[0].entity_id, "ent-1");
  assert.equal(result.candidates[0].entity_name, "实体A");
  assert.equal(result.candidates[0].keep_role, "关键承接");
  assert.equal(calls[0].stage, "节点3-消融候选");
  assert.equal(calls[0].payload.entities[0].name, "实体A");
  assert.equal(result.llm_ensemble, undefined);
});

test("SystemAdapter 会先抽取兄弟节点工作性，再发起保留与去除概率判断", async () => {
  const calls = [];
  const adapter = new SystemAdapter({
    llmJsonInvoker: async (input) => {
      calls.push(input);
      if (input.stage === "小故-依赖关系") {
        return {
          relations: [
            {
              source: "实体B",
              target: "实体A",
              relation_type: "depend_on",
              evidence: "实体B 依赖实体A",
            },
          ],
        };
      }
      if (input.stage === "小故-兄弟工作性") {
        return {
          summary: "移除实体A后，实体B 仍可工作，但依赖被削弱。",
          sibling_findings: [
            {
              entity_id: "ent-2",
              entity_name: "实体B",
              work_status: "degraded",
              depends_on_removed_entity: true,
              reason: "实体B 失去实体A的部分支撑。",
            },
          ],
        };
      }
      if (input.stage === "小故-保留概率") {
        return { probability: "84%", reason: "保留后结构完整" };
      }
      return { probability: "52%", reason: "去除后仍可维持" };
    },
  });

  const result = await adapter.judgeAblationCandidate({
    entity: {
      id: "ent-1",
      name: "实体A",
      summary: "核心实体",
      abilities: ["支撑"],
      citations: ["证据片段"],
    },
    candidate: {
      entity_id: "ent-1",
      entity_name: "实体A",
      remove_target: "实体A",
      retain_target: "实体A",
      keep_role: "关键承接",
      remove_impact: "缺失后影响较大",
      observation: "观察到多处依赖",
      evidence: "证据片段",
    },
    entities: [
      {
        id: "ent-1",
        name: "实体A",
        summary: "核心实体",
        abilities: ["支撑"],
        citations: ["证据片段"],
      },
      {
        id: "ent-2",
        name: "实体B",
        summary: "辅助实体",
        abilities: [],
        citations: ["补充证据"],
      },
    ],
    relations: [
      {
        source_entity_id: "ent-1",
        source_name: "实体A",
        target_entity_id: "ent-2",
        target_name: "实体B",
        relation_type: "part_of",
        evidence: "证据片段",
      },
    ],
    systemContext: {
      parentEntity: {
        id: "ent-parent",
        name: "父系统",
        summary: "父系统摘要",
      },
      removedEntityIds: ["ent-1"],
      siblingEntities: [
        {
          id: "ent-2",
          name: "实体B",
          summary: "辅助实体",
          citations: ["补充证据"],
        },
      ],
      siblingRelations: [
        {
          source_entity_id: "ent-2",
          source_name: "实体B",
          target_entity_id: "ent-1",
          target_name: "实体A",
          relation_type: "depend_on",
          evidence: "实体B 依赖实体A",
        },
      ],
      descendantJudges: [
        {
          entity_id: "ent-child",
          entity_name: "子模块",
          keep_probability: "90%",
          remove_probability: "40%",
        },
      ],
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].stage, "小故-依赖关系");
  assert.equal(calls[1].stage, "小故-兄弟工作性");
  assert.equal(calls[2].stage, "小故-保留概率");
  assert.equal(calls[3].stage, "小故-去除概率");
  assert.equal(calls[0].payload.parent_entity.name, "父系统");
  assert.equal(calls[1].payload.sibling_entities[0].name, "实体B");
  assert.equal(calls[2].payload.descendant_judges[0].entity_name, "子模块");
  assert.equal(calls[3].payload.removed_subtree_entities[0].name, "实体A");
  assert.equal(calls[3].payload.sibling_analysis.summary, "移除实体A后，实体B 仍可工作，但依赖被削弱。");
  assert.equal(result.keepDecision.probability, "84%");
  assert.equal(result.removeDecision.probability, "52%");
  assert.equal(result.keepDecision.entity_name, "实体A");
  assert.equal(result.removeDecision.entity_name, "实体A");
  assert.equal(result.dependencyRelations[0].relation_type, "depend_on");
  assert.equal(result.dependencyRelations[0].source_name, "实体B");
  assert.equal(result.siblingAnalysis.summary, "移除实体A后，实体B 仍可工作，但依赖被削弱。");
  assert.equal(result.siblingAnalysis.sibling_findings[0].work_status, "degraded");
  assert.deepEqual(result.llm_ensemble, {
    dependency_result: undefined,
    sibling_result: undefined,
    keep_result: undefined,
    remove_result: undefined,
  });
});
