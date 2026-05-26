import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";

import { LinearWorkflowService } from "../services/linearWorkflowService.mjs";

function createService(overrides = {}) {
  return new LinearWorkflowService({
    runtimeRoot: overrides.runtimeRoot,
    gatewayBaseUrl: "http://127.0.0.1:8080",
    llmJsonInvoker: overrides.llmJsonInvoker,
    workflowModelA: overrides.workflowModelA,
    workflowModelB: overrides.workflowModelB,
    workflowParallelCount: overrides.workflowParallelCount,
    workflowDebateRounds: overrides.workflowDebateRounds,
    probabilityInvoker: overrides.probabilityInvoker,
    baseVersionLoader: overrides.baseVersionLoader,
    entityIdSeedLoader: overrides.entityIdSeedLoader,
    entityIdStateLoader: overrides.entityIdStateLoader,
    ingestInvoker: overrides.ingestInvoker,
    workflowTimeoutMs: 5_000,
  });
}

test("LinearWorkflowService executes 8-stage workflow and generates unique filenames", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-success-"));
  const ingestPayloads = [];

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "火车",
              summary: "管理设备信息",
              properties: { kind: "module" },
              abilities: ["注册", "查询"],
              citations: ["火车负责设备台账维护"],
            },
            {
              name: "火车",
              summary: "重复名实体用于测试冲突命名",
              properties: { kind: "module" },
              abilities: ["变更"],
              citations: ["火车还负责变更"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return { relations: [] };
      }
      if (stage.includes("小故-")) {
        return { probability: "86%", reason: "默认小故判断" };
      }
      return {
        ablation: [
          {
            entity_id: "ent_-1", // intentionally invalid, service should normalize by map filter
            impact_level: "high",
            impact_reason: "缺失后会导致流程中断",
            system_risk: "high",
          },
          {
            entity_id: "ent_entity_1",
            impact_level: "medium",
            impact_reason: "影响部分能力",
            system_risk: "medium",
          },
          {
            entity_id: "ent_entity_2",
            impact_level: "low",
            impact_reason: "可降级运行",
            system_risk: "low",
          },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "86%", reason: "结构完整，风险可控" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async (payload) => {
      ingestPayloads.push(payload);
      return {
        status: "success",
        write_result: {
          commit_id: `commit-${ingestPayloads.length}`,
          version_id: ingestPayloads.length,
        },
      };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 设备管理\n设备管理负责设备台账维护\n", "utf8"),
    conversationId: "case-success",
  });

  assert.equal(result.ok, true);
  assert.equal(result.workflow.status, "success");
  assert.equal(result.stage_results.length, 8);
  assert.equal(result.errors.length, 0);
  assert.equal(result.ingest_results.length, 2);
  assert.equal(result.entity_files[0].filename, "火车.json");
  assert.equal(result.entity_files[1].filename, "火车-2.json");
  assert.equal(result.stage_results[0].stage, "auth_precheck");
  assert.equal(result.stage_results[1].stage, "observe");
});

test("LinearWorkflowService 会从当前最大实体序号继续分配 id", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-seed-"));
  const ingestPayloads = [];

  const service = createService({
    runtimeRoot,
    entityIdSeedLoader: async () => 22,
    llmJsonInvoker: async ({ stage, payload }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "火车",
              summary: "管理设备信息",
              properties: { kind: "module" },
              abilities: ["注册", "查询"],
              citations: ["火车负责设备台账维护"],
            },
            {
              name: "车辆台账",
              summary: "记录车辆状态",
              properties: { kind: "module" },
              abilities: ["维护"],
              citations: ["车辆台账用于记录车辆状态"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return {
          relations: [
            {
              source: "车辆台账",
              target: "火车",
              relation_type: "part_of",
              evidence: "车辆台账是火车系统的一部分",
            },
          ],
        };
      }
      if (stage.includes("节点3-消融候选")) {
        return {
          ablation_candidates: Array.isArray(payload?.entities)
            ? payload.entities.map((entity) => ({
              entity_id: entity.id,
              entity_name: entity.name,
              remove_target: entity.name,
              retain_target: entity.name,
              keep_role: `保留 ${entity.name} 后维持能力`,
              remove_impact: `去除 ${entity.name} 后会降低能力`,
              observation: `${entity.name} 是关键实体`,
              evidence: entity.citations?.[0] || entity.summary,
            }))
            : [],
        };
      }
      if (stage.includes("小故-保留概率")) {
        return {
          entity_id: payload?.focus_entity?.entity_id,
          entity_name: payload?.focus_entity?.entity_name,
          probability: payload?.focus_entity?.entity_id === "ent_entity_23" ? "81%" : "72%",
          reason: "保留后影响可控",
        };
      }
      if (stage.includes("小故-去除概率")) {
        return {
          entity_id: payload?.focus_entity?.entity_id,
          entity_name: payload?.focus_entity?.entity_name,
          probability: payload?.focus_entity?.entity_id === "ent_entity_23" ? "55%" : "63%",
          reason: "去除后影响有限",
        };
      }
      return {};
    },
    probabilityInvoker: async () => ({ probability: "90%", reason: "结构完整" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async (payload) => {
      ingestPayloads.push(payload);
      return {
        status: "success",
        write_result: {
          commit_id: `commit-${ingestPayloads.length}`,
          version_id: ingestPayloads.length,
        },
      };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 火车\n火车依赖车辆台账记录\n", "utf8"),
    conversationId: "case-seed",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.stage_results.find((item) => item.stage === "observe")?.output?.entities?.map((entity) => entity.id),
    ["ent_entity_23", "ent_entity_24"],
  );
  assert.deepEqual(
    result.entity_files.map((item) => item.entity_id),
    ["ent_entity_23", "ent_entity_24"],
  );
  assert.deepEqual(
    ingestPayloads.map((item) => item.data.entity.id),
    ["ent_entity_23", "ent_entity_24"],
  );
});

test("LinearWorkflowService 会避开项目内已存在的 entity id", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-entity-state-"));
  const ingestPayloads = [];

  const service = createService({
    runtimeRoot,
    entityIdStateLoader: async () => ({
      sequenceSeed: 2,
      usedEntityIds: new Set([
        "ent_entity_1",
        "ent_entity_2",
        "ent_entity_3",
      ]),
    }),
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "甲实体",
              summary: "A",
              properties: { kind: "module" },
              abilities: ["识别"],
              citations: ["甲实体负责核心识别链路"],
            },
            {
              name: "乙实体",
              summary: "B",
              properties: { kind: "module" },
              abilities: ["补充"],
              citations: ["乙实体用于补充说明"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return { relations: [] };
      }
      if (stage.includes("节点3-消融候选")) {
        return {
          ablation_candidates: [
            {
              entity_id: "ent_entity_4",
              entity_name: "甲实体",
              remove_target: "甲实体",
              retain_target: "甲实体",
              keep_role: "保留后维持核心识别链路",
              remove_impact: "去除后识别准确率明显下降",
              observation: "保留版信息完整，去除版关键字段缺失",
              evidence: "甲实体负责核心识别链路",
            },
            {
              entity_id: "ent_entity_5",
              entity_name: "乙实体",
              remove_target: "乙实体",
              retain_target: "乙实体",
              keep_role: "提供补充说明",
              remove_impact: "去除后影响较小",
              observation: "主体结果基本一致",
              evidence: "乙实体用于补充说明",
            },
          ],
        };
      }
      if (stage.includes("小故-")) {
        return { probability: "70%", reason: "默认小故判断" };
      }
      return {
        ablation: [
          {
            entity_id: "ent_entity_4",
            impact_level: "medium",
            impact_reason: "示例",
            system_risk: "low",
          },
          {
            entity_id: "ent_entity_5",
            impact_level: "medium",
            impact_reason: "示例",
            system_risk: "low",
          },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async (payload) => {
      ingestPayloads.push(payload);
      return {
        status: "success",
        write_result: {
          commit_id: `commit-${ingestPayloads.length}`,
          version_id: ingestPayloads.length,
        },
      };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 实体\n甲实体负责核心识别链路\n乙实体用于补充说明\n", "utf8"),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.stage_results.find((item) => item.stage === "observe")?.output?.entities?.map((entity) => entity.id),
    ["ent_entity_4", "ent_entity_5"],
  );
  assert.deepEqual(
    result.entity_files.map((item) => item.entity_id),
    ["ent_entity_4", "ent_entity_5"],
  );
  assert.deepEqual(
    ingestPayloads.map((item) => item.data.entity.id),
    ["ent_entity_4", "ent_entity_5"],
  );
});

test("LinearWorkflowService retries invalid JSON with higher temperatures", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-retry-json-"));
  const observedTemperatures = [];
  let stage1Calls = 0;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, temperature }) => {
      observedTemperatures.push({ stage, temperature });
      if (stage.includes("节点1")) {
        stage1Calls += 1;
        if (stage1Calls < 3) {
          throw new Error("workflow LLM returned invalid JSON");
        }
        return {
          entities: [
            {
              name: "火车",
              summary: "核心实体",
              properties: { kind: "module" },
              abilities: ["运输"],
              citations: ["火车是核心对象"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return { relations: [] };
      }
      if (stage.includes("小故-")) {
        return { probability: "70%", reason: "默认小故判断" };
      }
        return {
          ablation: [
            {
              entity_id: "ent_entity_1",
              impact_level: "medium",
              impact_reason: "示例",
              system_risk: "low",
            },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: {
        commit_id: "commit-1",
        version_id: 1,
      },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 火车\n火车是重要对象\n", "utf8"),
  });

  assert.equal(result.ok, true);
  assert.equal(stage1Calls, 4);
  assert.deepEqual(
    observedTemperatures.filter((item) => item.stage.includes("节点1")).map((item) => item.temperature),
    [0, 0, 0.3, 0.3],
  );
});

test("LinearWorkflowService 会将完全相同的 JSON 直接保留为最终结果", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-ensemble-"));
  const service = createService({
    runtimeRoot,
    workflowModelA: "model/A",
    workflowModelB: "model/B",
    workflowParallelCount: 1,
    workflowDebateRounds: 1,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "火车",
              summary: "核心实体",
              properties: { kind: "module" },
              abilities: ["运输"],
              citations: ["火车是核心对象"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return { relations: [] };
      }
      if (stage.includes("小故-")) {
        return { probability: "70%", reason: "默认小故判断" };
      }
      return {
        ablation_candidates: [
          {
            entity_id: "ent_entity_1",
            entity_name: "火车",
            remove_target: "火车",
            retain_target: "火车",
            keep_role: "维持运输能力",
            remove_impact: "去除后运输能力下降",
            observation: "火车是核心对象",
            evidence: "火车是核心对象",
          },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: {
        commit_id: "commit-1",
        version_id: 1,
      },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 火车\n火车是重要对象\n", "utf8"),
  });

  const observeStage = result.stage_results.find((item) => item.stage === "observe");
  assert.equal(result.ok, true);
  assert.equal(observeStage?.output?.llm_ensemble?.models?.model_a?.model, "model/A");
  assert.equal(observeStage?.output?.llm_ensemble?.models?.model_b?.model, "model/B");
  assert.equal(observeStage?.output?.llm_ensemble?.models?.model_a?.single_result?.data?.entities?.[0]?.name, "火车");
  assert.equal(observeStage?.output?.llm_ensemble?.models?.model_b?.single_result?.data?.entities?.[0]?.name, "火车");
  assert.equal(observeStage?.output?.llm_ensemble?.shared_items?.length, 1);
  assert.equal(observeStage?.output?.llm_ensemble?.conflicts?.length, 0);
  assert.equal(observeStage?.output?.llm_ensemble?.cross_rounds?.length, 0);
  assert.equal(observeStage?.output?.llm_ensemble?.final_result?.source, "shared_consensus");
});

test("LinearWorkflowService 会并行执行模型A和模型B，并将冲突项改为串行 citation", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-model-parallel-"));
  const observeAttempts = [];
  const crossRounds = [];

  const service = createService({
    runtimeRoot,
    workflowModelA: "model/A",
    workflowModelB: "model/B",
    workflowParallelCount: 1,
    workflowDebateRounds: 2,
    llmJsonInvoker: async ({ stage, ensembleRole, ensembleModelKey, attempt }) => {
      if (stage.includes("节点1")) {
        if (ensembleRole === "single_run") {
          observeAttempts.push({
            modelKey: ensembleModelKey,
            attempt,
          });
          if (attempt === 1) {
            throw new Error("workflow LLM returned invalid JSON");
          }
          return {
            entities: [
              {
                name: "共享实体",
                summary: "两个模型都认可",
                properties: { kind: "module" },
                abilities: ["运输"],
                citations: ["共享实体是核心对象"],
              },
              {
                name: "冲突实体",
                summary: ensembleModelKey === "model_a" ? "模型A版本摘要" : "模型B版本摘要",
                properties: { kind: "module" },
                abilities: ensembleModelKey === "model_a" ? ["运输"] : ["调度"],
                citations: [ensembleModelKey === "model_a" ? "模型A证据" : "模型B证据"],
              },
            ],
          };
        }

        if (ensembleRole === "cross_round") {
          crossRounds.push(ensembleModelKey);
          return {
            resolved_conflicts: [
              {
                item_key: "冲突实体",
                decision: "融合修改",
                summary: `第 ${crossRounds.length} 轮完成摘要融合`,
                final_value: {
                  name: "冲突实体",
                  summary: crossRounds.length === 1 ? "融合中的摘要" : "最终融合摘要",
                  properties: { kind: "module" },
                  abilities: ["运输", "调度"],
                  citations: ["模型A证据", "模型B证据"],
                },
                citations: [
                  {
                    target_model: "model_a",
                    stance: "同意",
                    reason: "模型A保留了主体实体",
                    suggestion: "保留其核心定位",
                  },
                  {
                    target_model: "model_b",
                    stance: "修改",
                    reason: "模型B补充了调度能力",
                    suggestion: "把调度能力并入最终结果",
                  },
                ],
              },
            ],
            remaining_conflicts: crossRounds.length === 1 ? ["冲突实体"] : [],
            round_summary: `第 ${crossRounds.length} 轮 citation`,
          };
        }
      }
      if (stage.includes("节点2")) {
        return { relations: [] };
      }
      if (stage.includes("小故-")) {
        return { probability: "70%", reason: "默认小故判断" };
      }
      return {
        ablation_candidates: [
          {
            entity_id: "ent_entity_1",
            entity_name: "火车",
            remove_target: "火车",
            retain_target: "火车",
            keep_role: "维持运输能力",
            remove_impact: "去除后运输能力下降",
            observation: "火车是核心对象",
            evidence: "火车是核心对象",
          },
        ],
      };
    },
  });

  const result = await service.invokeWorkflowLlmJsonWithRetry({
    stage: "节点1-观察",
    instruction: "提取 entities 数组。",
    payload: {
      document_text: "# 火车\n火车是重要对象\n",
    },
  });

  assert.equal(Array.isArray(result?.data?.entities), true);
  assert.deepEqual(
    observeAttempts.slice(0, 2).map((item) => item.attempt),
    [1, 1],
  );
  assert.deepEqual(
    new Set(observeAttempts.slice(0, 2).map((item) => item.modelKey)),
    new Set(["model_a", "model_b"]),
  );
  assert.deepEqual(crossRounds, ["model_a", "model_b"]);
  assert.equal(result?.llm_ensemble?.cross_rounds?.length, 2);
  assert.equal(result?.llm_ensemble?.shared_items?.length, 1);
  assert.equal(result?.llm_ensemble?.conflicts?.length, 1);
  assert.equal(result?.llm_ensemble?.cross_rounds?.[0]?.data?.resolved_conflicts?.[0]?.citations?.[0]?.stance, "同意");
  assert.equal(result?.data?.entities?.[1]?.summary, "最终融合摘要");
});

test("LinearWorkflowService 会在阶段执行中流式推送双模型过程", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-streaming-ensemble-"));
  const updates = [];
  const service = createService({
    runtimeRoot,
    workflowModelA: "model/A",
    workflowModelB: "model/B",
    workflowParallelCount: 1,
    workflowDebateRounds: 1,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "火车",
              summary: "核心实体",
              properties: { kind: "module" },
              abilities: ["运输"],
              citations: ["火车是核心对象"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return { relations: [] };
      }
      if (stage.includes("小故-")) {
        return { probability: "70%", reason: "默认小故判断" };
      }
      return {
        ablation_candidates: [
          {
            entity_id: "ent_entity_1",
            entity_name: "火车",
            remove_target: "火车",
            retain_target: "火车",
            keep_role: "维持运输能力",
            remove_impact: "去除后运输能力下降",
            observation: "火车是核心对象",
            evidence: "火车是核心对象",
          },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: {
        commit_id: "commit-1",
        version_id: 1,
      },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 火车\n火车是重要对象\n", "utf8"),
    handlers: {
      onStageUpdate(stageResult) {
        updates.push(stageResult);
      },
    },
  });

  const streamingObserveUpdates = updates.filter((item) => (
    item.stage === "observe"
    && item.status === "running"
    && item.output?.llm_ensemble
  ));

  assert.equal(result.ok, true);
  assert.equal(streamingObserveUpdates.length > 0, true);
  assert.equal(streamingObserveUpdates.at(-1)?.output?.llm_ensemble?.final_result?.source, "shared_consensus");
});

test("LinearWorkflowService 会把关系抽取阶段统一归一为 source part_of target", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-rel-array-"));

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "电脑",
              summary: "整机系统",
              properties: { kind: "system" },
              abilities: ["运行"],
              citations: ["电脑包含 CPU"],
            },
            {
              name: "CPU",
              summary: "核心部件",
              properties: { kind: "part" },
              abilities: ["计算"],
              citations: ["CPU 是电脑的一部分"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return [
          {
            source: "电脑",
            target: "CPU",
            relation_type: "包含",
            evidence: "电脑包含 CPU",
          },
        ];
      }
      if (stage.includes("小故-")) {
        return { probability: "70%", reason: "默认小故判断" };
      }
      return {
        ablation: [
          {
            entity_id: "ent_entity_1",
            impact_level: "medium",
            impact_reason: "示例",
            system_risk: "low",
          },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: { commit_id: "commit-1", version_id: 1 },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 电脑\n电脑包含 CPU\n", "utf8"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage_results.find((item) => item.stage === "relations")?.output?.relation_count, 1);
  assert.equal(result.stage_results.find((item) => item.stage === "relations")?.output?.relations?.[0]?.relation_type, "part_of");
  assert.equal(result.stage_results.find((item) => item.stage === "relations")?.output?.relations?.[0]?.source_name, "CPU");
  assert.equal(result.stage_results.find((item) => item.stage === "relations")?.output?.relations?.[0]?.target_name, "电脑");
});

test("LinearWorkflowService accepts stage-1 entity arrays directly", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-entity-array-"));

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return [
          {
            name: "测试",
            summary: "这是一个测试活动",
            properties: {},
            abilities: [],
            citations: ["这是一个测试"],
          },
          {
            name: "测试人员",
            summary: "参与测试的人员",
            properties: {},
            abilities: [],
            citations: ["测试人员和运营人员有协作关系"],
          },
        ];
      }
      if (stage.includes("节点2")) {
        return [];
      }
      if (stage.includes("节点3")) {
        return [
          {
            entity_id: "ent_-1",
            impact_level: "medium",
            impact_reason: "无效 id",
            system_risk: "low",
          },
          {
            entity_id: "ent_entity_1",
            impact_level: "high",
            impact_reason: "测试影响",
            system_risk: "medium",
          },
        ];
      }
      if (stage.includes("小故-")) {
        return { probability: "70%", reason: "默认小故判断" };
      }
      return {};
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: { commit_id: "commit-1", version_id: 1 },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 测试\n测试人员和运营人员有协作关系\n", "utf8"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage_results.find((item) => item.stage === "observe")?.output?.entity_count, 2);
  assert.equal(result.stage_results.find((item) => item.stage === "observe")?.output?.entities?.[0]?.name, "测试");
});

test("LinearWorkflowService 会从 part_of 树构造消融候选", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-ablation-array-"));

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "本体工厂",
              summary: "系统方案",
              properties: { kind: "system" },
              abilities: ["转化资料"],
              citations: ["本体工厂系统方案"],
            },
            {
              name: "资料解析器",
              summary: "核心组件",
              properties: { kind: "module" },
              abilities: ["解析资料"],
              citations: ["资料解析器属于本体工厂"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return [
          {
            source: "资料解析器",
            target: "本体工厂",
            relation_type: "part_of",
            evidence: "资料解析器属于本体工厂",
          },
        ];
      }
      if (stage.includes("小故-")) {
        return { probability: "70%", reason: "默认小故判断" };
      }
      return { };
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: { commit_id: "commit-1", version_id: 1 },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 本体工厂\n", "utf8"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage_results.find((item) => item.stage === "ablation_judge")?.output?.ablation_count, 1);
  assert.equal(result.stage_results.find((item) => item.stage === "ablation_candidate")?.output?.candidates?.[0]?.entity_name, "资料解析器");
  assert.equal(result.stage_results.find((item) => item.stage === "ablation_candidate")?.output?.candidates?.[0]?.retain_target, "本体工厂");
  assert.equal(result.stage_results.find((item) => item.stage === "ablation_judge")?.output?.ablation?.[0]?.entity_name, "资料解析器");
});

test("LinearWorkflowService 会按 part_of 树自下向上评估子节点对父节点的重要性", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-ablation-panels-"));
  const llmCalls = [];

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, payload }) => {
      llmCalls.push({ stage, payload });
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "实体A",
              summary: "根系统",
              properties: { kind: "system" },
              abilities: ["总控"],
              citations: ["实体A 是顶层系统"],
            },
            {
              name: "实体B",
              summary: "中间模块",
              properties: { kind: "module" },
              abilities: ["识别"],
              citations: ["实体B 属于实体A"],
            },
            {
              name: "实体C",
              summary: "叶子模块",
              properties: { kind: "module" },
              abilities: ["补充"],
              citations: ["实体C 属于实体B"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return {
          relations: [
            {
              source: "实体B",
              target: "实体A",
              relation_type: "part_of",
              evidence: "实体B 属于实体A",
            },
            {
              source: "实体C",
              target: "实体B",
              relation_type: "part_of",
              evidence: "实体C 属于实体B",
            },
          ],
        };
      }
      if (stage.includes("小故-保留概率")) {
        if (payload?.focus_entity?.entity_name === "实体B") {
          return {
            entity_id: "ent_entity_2",
            entity_name: "实体B",
            probability: "84%",
            reason: "保留实体B后，实体A 的核心链路完整",
          };
        }
        return {
          entity_id: "ent_entity_3",
          entity_name: "实体C",
          probability: "68%",
          reason: "保留实体C后，实体B 的补充能力完整",
        };
      }
      if (stage.includes("小故-去除概率")) {
        if (payload?.focus_entity?.entity_name === "实体B") {
          return {
            entity_id: "ent_entity_2",
            entity_name: "实体B",
            probability: "52%",
            reason: "去除实体B后，实体A 缺少关键中间模块",
          };
        }
        return {
          entity_id: "ent_entity_3",
          entity_name: "实体C",
          probability: "58%",
          reason: "去除实体C后，实体B 主体仍可维持",
        };
      }
      return {};
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: { commit_id: "commit-1", version_id: 1 },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 实体A\n实体A负责核心识别链路\n实体B用于补充说明\n", "utf8"),
  });

  const ablationStage = result.stage_results.find((item) => item.stage === "ablation_judge");
  assert.equal(result.ok, true);
  assert.equal(result.stage_results.length, 8);
  assert.equal(ablationStage?.output?.ablation_count, 2);
  assert.equal(ablationStage?.output?.ablation_candidates?.length, 2);
  assert.equal(ablationStage?.output?.ablation_judges?.length, 2);
  assert.equal(ablationStage?.output?.ablation_candidates?.[0]?.entity_name, "实体C");
  assert.equal(ablationStage?.output?.ablation_candidates?.[1]?.entity_name, "实体B");
  assert.equal(ablationStage?.output?.ablation_judges?.[0]?.entity_name, "实体C");
  assert.equal(ablationStage?.output?.ablation_judges?.[1]?.entity_name, "实体B");
  assert.equal(ablationStage?.output?.ablation_judges?.[0]?.keep_probability, "68%");
  assert.equal(ablationStage?.output?.ablation_judges?.[0]?.remove_probability, "58%");
  assert.equal(ablationStage?.output?.ablation_judges?.[0]?.probability_gap, "10%");
  assert.equal(ablationStage?.output?.ablation_judges?.[0]?.small_reason, true);
  assert.equal(ablationStage?.output?.ablation_judges?.[1]?.keep_probability, "84%");
  assert.equal(ablationStage?.output?.ablation_judges?.[1]?.remove_probability, "52%");
  assert.equal(ablationStage?.output?.ablation_judges?.[1]?.probability_gap, "32%");
  assert.equal(ablationStage?.output?.ablation_judges?.[1]?.small_reason, true);
  const entityBFile = result.entity_files.find((item) => item.entity_name === "实体B");
  const entityCFile = result.entity_files.find((item) => item.entity_name === "实体C");
  assert.deepEqual(Object.keys(entityBFile?.data?.ablation || {}).sort(), [
    "judge_reason",
    "keep_probability",
    "probability_gap",
    "remove_probability",
  ]);
  assert.deepEqual(Object.keys(entityCFile?.data?.ablation || {}).sort(), [
    "judge_reason",
    "keep_probability",
    "probability_gap",
    "remove_probability",
  ]);
  assert.equal(
    llmCalls.filter((item) => item.stage.includes("节点3-消融候选")).length,
    0,
  );
  assert.equal(
    llmCalls.filter((item) => item.stage.includes("小故-保留概率")).length,
    4,
  );
  assert.equal(
    llmCalls.filter((item) => item.stage.includes("小故-去除概率")).length,
    4,
  );
  const entityBKeepPayload = llmCalls.find((item) => item.stage === "小故-保留概率" && item.payload?.focus_entity?.entity_name === "实体B")?.payload;
  assert.equal(entityBKeepPayload?.descendant_judges?.[0]?.entity_name, "实体C");
  assert.equal(entityBKeepPayload?.parent_entity?.name, "实体A");
  assert.equal(ablationStage?.output?.llm_ensemble?.judge_results?.length, 2);
});

test("LinearWorkflowService 会把兄弟节点可工作性并入父系统小故判定", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-sibling-workability-"));
  const llmCalls = [];

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, payload }) => {
      llmCalls.push({ stage, payload });
      if (stage.includes("节点1")) {
        return {
          entities: [
            { name: "实体A", summary: "父系统", properties: { kind: "system" }, abilities: ["总控"], citations: ["实体A 包含多个子模块"] },
            { name: "实体B", summary: "关键桥接模块", properties: { kind: "module" }, abilities: ["桥接"], citations: ["实体B 负责桥接"] },
            { name: "实体C", summary: "执行模块 C", properties: { kind: "module" }, abilities: ["执行"], citations: ["实体C 需要桥接"] },
            { name: "实体D", summary: "执行模块 D", properties: { kind: "module" }, abilities: ["执行"], citations: ["实体D 需要桥接"] },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return {
          relations: [
            { source: "实体B", target: "实体A", relation_type: "part_of", evidence: "实体B 属于实体A" },
            { source: "实体C", target: "实体A", relation_type: "part_of", evidence: "实体C 属于实体A" },
            { source: "实体D", target: "实体A", relation_type: "part_of", evidence: "实体D 属于实体A" },
          ],
        };
      }
      if (stage === "小故-依赖关系") {
        if (payload?.removed_entity?.entity_name === "实体B") {
          return {
            relations: [
              { source: "实体C", target: "实体B", relation_type: "depend_on", evidence: "实体C 依赖实体B 的桥接能力" },
              { source: "实体D", target: "实体B", relation_type: "depend_on", evidence: "实体D 依赖实体B 的桥接能力" },
            ],
          };
        }
        return { relations: [] };
      }
      if (stage === "小故-兄弟工作性") {
        if (payload?.removed_entity?.entity_name === "实体B") {
          return {
            summary: "移除实体B后，实体C 与实体D 都无法独立维持原有流程，兄弟节点工作性明显下降。",
            sibling_findings: [
              {
                entity_id: "ent_entity_3",
                entity_name: "实体C",
                work_status: "blocked",
                depends_on_removed_entity: true,
                reason: "实体C 依赖实体B的桥接能力。",
              },
              {
                entity_id: "ent_entity_4",
                entity_name: "实体D",
                work_status: "blocked",
                depends_on_removed_entity: true,
                reason: "实体D 依赖实体B的桥接能力。",
              },
            ],
          };
        }
        return {
          summary: "移除当前节点后，其余兄弟节点仍可继续工作。",
          sibling_findings: [],
        };
      }
      if (stage.includes("小故-保留概率")) {
        if (payload?.focus_entity?.entity_name === "实体B") {
          return { probability: "92%", reason: "保留实体B后父系统主链路完整" };
        }
        return { probability: "74%", reason: "保留当前节点后局部系统仍稳定" };
      }
      if (stage.includes("小故-去除概率")) {
        if (payload?.focus_entity?.entity_name === "实体B") {
          return { probability: "38%", reason: "去除实体B后父系统核心流程断裂" };
        }
        return { probability: "68%", reason: "去除当前节点后父系统略受影响" };
      }
      return {};
    },
    probabilityInvoker: async () => ({ probability: "70%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: { commit_id: "commit-sibling", version_id: 1 },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 实体A\n实体A 包含 B C D 三个模块\n", "utf8"),
  });

  assert.equal(result.ok, true);
  const ablationStage = result.stage_results.find((item) => item.stage === "ablation_judge");
  const entityBJudge = ablationStage?.output?.ablation_judges?.find((item) => item.entity_name === "实体B");
  assert.equal(entityBJudge?.small_reason, true);
  assert.equal(entityBJudge?.sibling_summary, "移除实体B后，实体C 与实体D 都无法独立维持原有流程，兄弟节点工作性明显下降。");
  assert.match(entityBJudge?.judge_reason || "", /兄弟节点：移除实体B后，实体C 与实体D 都无法独立维持原有流程/);
  const siblingStageCall = llmCalls.find((item) => item.stage === "小故-兄弟工作性" && item.payload?.removed_entity?.entity_name === "实体B");
  assert.deepEqual(
    siblingStageCall?.payload?.sibling_entities?.map((item) => item.name).sort(),
    ["实体C", "实体D"],
  );
  const dependencyCall = llmCalls.find((item) => item.stage === "小故-依赖关系" && item.payload?.removed_entity?.entity_name === "实体B");
  assert.deepEqual(
    dependencyCall?.payload?.sibling_entities?.map((item) => item.name).sort(),
    ["实体C", "实体D"],
  );
  const removeCall = llmCalls.find((item) => item.stage === "小故-去除概率" && item.payload?.focus_entity?.entity_name === "实体B");
  assert.equal(
    removeCall?.payload?.sibling_analysis?.summary,
    "移除实体B后，实体C 与实体D 都无法独立维持原有流程，兄弟节点工作性明显下降。",
  );
  const finalRelations = result.stage_results.find((item) => item.stage === "ablation_judge")?.output?.relations || [];
  assert.equal(finalRelations.some((item) => item.relation_type === "depend_on" && item.source_name === "实体C" && item.target_name === "实体B"), true);
  assert.equal(finalRelations.some((item) => item.relation_type === "depend_on" && item.source_name === "实体D" && item.target_name === "实体B"), true);
  const entityBFile = result.entity_files.find((item) => item.entity_name === "实体B");
  assert.equal(entityBFile?.data?.relations?.some((item) => item.relation_type === "depend_on" && item.source_name === "实体C" && item.target_name === "实体B"), true);
});

test("LinearWorkflowService 仅入库命中小故的最小四字段", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-min-ablation-"));

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, payload }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "实体A",
              summary: "根系统",
              properties: { kind: "system" },
              abilities: ["总控"],
              citations: ["实体A 是顶层系统"],
            },
            {
              name: "实体B",
              summary: "中间模块",
              properties: { kind: "module" },
              abilities: ["识别"],
              citations: ["实体B 属于实体A"],
            },
            {
              name: "实体C",
              summary: "叶子模块",
              properties: { kind: "module" },
              abilities: ["补充"],
              citations: ["实体C 属于实体B"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return {
          relations: [
            {
              source: "实体B",
              target: "实体A",
              relation_type: "part_of",
              evidence: "实体B 属于实体A",
            },
            {
              source: "实体C",
              target: "实体B",
              relation_type: "part_of",
              evidence: "实体C 属于实体B",
            },
          ],
        };
      }
      if (stage.includes("小故-保留概率")) {
        if (payload?.focus_entity?.entity_name === "实体B") {
          return { probability: "82%", reason: "保留实体B后主链路完整" };
        }
        return { probability: "66%", reason: "保留实体C后补充能力仍在" };
      }
      if (stage.includes("小故-去除概率")) {
        if (payload?.focus_entity?.entity_name === "实体B") {
          return { probability: "54%", reason: "去除实体B后父系统失去关键中间层" };
        }
        return { probability: "61%", reason: "去除实体C后父系统仍可维持" };
      }
      return {};
    },
    probabilityInvoker: async () => ({ probability: "72%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: { commit_id: "commit-min", version_id: 1 },
    }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 实体A\n实体B 和 实体C 构成局部系统\n", "utf8"),
  });

  assert.equal(result.ok, true);
  const entityAFile = result.entity_files.find((item) => item.entity_name === "实体A");
  const entityBFile = result.entity_files.find((item) => item.entity_name === "实体B");
  const entityCFile = result.entity_files.find((item) => item.entity_name === "实体C");

  assert.equal(entityAFile?.data?.ablation, null);
  assert.equal(entityCFile?.data?.ablation, null);
  assert.deepEqual(Object.keys(entityBFile?.data?.ablation || {}).sort(), [
    "judge_reason",
    "keep_probability",
    "probability_gap",
    "remove_probability",
  ]);
  assert.equal(entityBFile?.data?.ablation?.probability_gap, "28%");
  assert.equal(entityBFile?.data?.ontology?.system_summary?.ablation_count, 1);
  assert.equal(entityBFile?.data?.ontology?.ablation?.length, 1);
  assert.deepEqual(Object.keys(entityBFile?.data?.ontology?.ablation?.[0] || {}).sort(), [
    "judge_reason",
    "keep_probability",
    "probability_gap",
    "remove_probability",
  ]);
  assert.equal(entityCFile?.data?.ontology?.ablation?.length, 0);
});

test("LinearWorkflowService stops when stage-1 returns empty entities", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-empty-"));
  let calledProbability = false;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return { entities: [] };
      }
      return {};
    },
    probabilityInvoker: async () => {
      calledProbability = true;
      return { probability: "99%", reason: "unused" };
    },
    ingestInvoker: async () => ({ status: "success", write_result: { commit_id: "c", version_id: 1 } }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("文档内容", "utf8"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage_results[1].status, "failed");
  assert.equal(result.stage_results[2].status, "pending");
  assert.equal(calledProbability, false);
  assert.deepEqual(result.stage_results[1].output?.llm_raw, { entities: [] });
});

test("LinearWorkflowService fails fast when stage-1 LLM is unavailable", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-llm-down-"));
  let calledProbability = false;
  let calledIngest = false;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        throw new Error("workflow LLM is not configured");
      }
      return {};
    },
    probabilityInvoker: async () => {
      calledProbability = true;
      return { probability: "88%", reason: "unused" };
    },
    ingestInvoker: async () => {
      calledIngest = true;
      return { status: "success", write_result: { commit_id: "c", version_id: 1 } };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("文档内容", "utf8"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage_results[1].status, "failed");
  assert.equal(result.stage_results[2].status, "pending");
  assert.equal(result.stage_results[3].status, "pending");
  assert.equal(calledProbability, false);
  assert.equal(calledIngest, false);
  assert.equal(result.errors.some((item) => item.stage === "observe"), true);
});

test("LinearWorkflowService keeps raw LLM text when response is invalid JSON", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-invalid-json-debug-"));
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: "不是合法 JSON，但这是原始回复",
          },
        },
      ],
    }),
  });

  try {
    const service = new LinearWorkflowService({
      runtimeRoot,
      workflowLlmApiKey: "test-key",
      workflowLlmBaseUrl: "http://127.0.0.1:9999",
      probabilityInvoker: async () => ({ probability: "88%", reason: "unused" }),
      ingestInvoker: async () => ({ status: "success", write_result: { commit_id: "c", version_id: 1 } }),
      workflowTimeoutMs: 5_000,
    });

    const result = await service.runFileWorkflow({
      projectId: "demo",
      fileName: "doc.md",
      mimeType: "text/markdown",
      content: Buffer.from("文档内容", "utf8"),
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage_results[1].status, "failed");
    assert.equal(result.stage_results[1].output?.llm_raw_text, "不是合法 JSON，但这是原始回复");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LinearWorkflowService 会在调用前刷新 workflow LLM 配置", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-refresh-config-"));
  const originalFetch = globalThis.fetch;
  const observed = {
    url: "",
    authorization: "",
    model: "",
  };

  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    observed.url = url;
    observed.authorization = options.headers.Authorization;
    observed.model = body.model;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "{\"entities\":[]}",
            },
          },
        ],
      }),
    };
  };

  try {
    const service = new LinearWorkflowService({
      runtimeRoot,
      workflowTimeoutMs: 5_000,
      workflowEnvResolver: () => ({
        workflowLlmApiKey: "dynamic-key",
        workflowLlmBaseUrl: "https://example.com/api/v1",
        workflowModel: "openai/gpt-4.1-mini",
      }),
    });

    const result = await service.invokeWorkflowLlmJson({
      stage: "节点1-观察",
      instruction: "提取实体",
      payload: { documentText: "文档内容" },
    });

    assert.deepEqual(result.data, { entities: [] });
    assert.equal(service.workflowLlmApiKey, "dynamic-key");
    assert.equal(service.workflowLlmBaseUrl, "https://example.com/api/v1");
    assert.equal(service.workflowModel, "openai/gpt-4.1-mini");
    assert.equal(observed.url, "https://example.com/api/v1/chat/completions");
    assert.equal(observed.authorization, "Bearer dynamic-key");
    assert.equal(observed.model, "openai/gpt-4.1-mini");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LinearWorkflowService invokeWorkflowLlmJson 支持通过 json_schema 约束输出结构", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-schema-"));
  const originalFetch = globalThis.fetch;
  let observedResponseFormat = null;

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    observedResponseFormat = body.response_format;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "{\"probability\":\"84%\",\"reason\":\"结构完整\"}",
            },
          },
        ],
      }),
    };
  };

  try {
    const service = new LinearWorkflowService({
      runtimeRoot,
      workflowLlmApiKey: "test-key",
      workflowLlmBaseUrl: "http://127.0.0.1:9999",
      workflowTimeoutMs: 5_000,
    });

    const result = await service.invokeWorkflowLlmJson({
      stage: "小故-保留概率",
      instruction: "判断保留概率",
      payload: { entity_id: "ent_entity_1" },
      responseSchema: {
        name: "probability_decision",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            probability: { type: "string" },
            reason: { type: "string" },
          },
          required: ["probability", "reason"],
        },
      },
    });

    assert.deepEqual(result.data, { probability: "84%", reason: "结构完整" });
    assert.deepEqual(observedResponseFormat, {
      type: "json_schema",
      json_schema: {
        name: "probability_decision",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            probability: { type: "string" },
            reason: { type: "string" },
          },
          required: ["probability", "reason"],
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LinearWorkflowService fails before observe when auth precheck fails", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-auth-precheck-"));
  let calledObserve = false;
  let calledIngest = false;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async () => {
      calledObserve = true;
      return {};
    },
    probabilityInvoker: async () => ({ probability: "88%", reason: "unused" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => {
      calledIngest = true;
      return { status: "success", write_result: { commit_id: "ok", version_id: 1 } };
    },
  });

  service.gatewayLoginInvoker = async () => {
    throw new Error("auth failed");
  };

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("实体A\n", "utf8"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage_results[0].stage, "auth_precheck");
  assert.equal(result.stage_results[0].status, "failed");
  assert.equal(result.stage_results[1].status, "pending");
  assert.equal(calledObserve, false);
  assert.equal(calledIngest, false);
  assert.equal(result.errors.some((item) => item.stage === "auth_precheck"), true);
});

test("LinearWorkflowService marks stage-6 as failed when ingest fails", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-ingest-fail-"));
  let ingestCount = 0;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "实体A",
              summary: "A",
              properties: {},
              abilities: [],
              citations: ["A 引用"],
            },
            {
              name: "实体B",
              summary: "B",
              properties: {},
              abilities: [],
              citations: ["B 引用"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return { relations: [] };
      }
      if (stage.includes("小故-")) {
        return { probability: "75%", reason: "默认小故判断" };
      }
      return {
        ablation: [
          { entity_id: "ent_a_1", impact_level: "high", impact_reason: "A", system_risk: "high" },
          { entity_id: "ent_b_2", impact_level: "low", impact_reason: "B", system_risk: "low" },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "75%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => {
      ingestCount += 1;
      if (ingestCount === 2) {
        throw new Error("mock ingest failure");
      }
      return { status: "success", write_result: { commit_id: "ok", version_id: 1 } };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("实体A\n实体B\n", "utf8"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage_results[7].status, "failed");
  assert.equal(result.errors.some((item) => item.stage === "ingest"), true);
  assert.equal(result.ingest_results.length >= 1, true);
});

test("LinearWorkflowService can retry from failed stage with saved snapshot", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-retry-stage-"));
  let judgeCalls = 0;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "实体A",
              summary: "A",
              properties: {},
              abilities: [],
              citations: ["A 引用"],
            },
            {
              name: "实体B",
              summary: "B",
              properties: {},
              abilities: [],
              citations: ["B 引用"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return {
          relations: [
            {
              source: "实体B",
              target: "实体A",
              relation_type: "part_of",
              evidence: "实体B 属于实体A",
            },
          ],
        };
      }
      if (stage.includes("小故-保留概率")) {
        judgeCalls += 1;
        if (judgeCalls === 1) {
          throw new Error("节点4模拟失败");
        }
        return { probability: "75%", reason: "默认小故判断" };
      }
      if (stage.includes("小故-去除概率")) {
        return { probability: "55%", reason: "默认小故判断" };
      }
      return {};
    },
    probabilityInvoker: async () => ({ probability: "75%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => ({
      status: "success",
      write_result: { commit_id: "ok", version_id: 1 },
    }),
  });

  const failed = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("实体A\n", "utf8"),
    conversationId: "retry-from-ablation",
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.stage_results[4].status, "failed");
  assert.equal(failed.stage_results[1].status, "success");
  assert.equal(failed.stage_results[2].status, "success");
  assert.equal(failed.stage_results[3].status, "success");

  const retried = await service.retryFileWorkflowFromStage({
    projectId: "demo",
    conversationId: "retry-from-ablation",
    startStage: "ablation_judge",
  });

  assert.equal(retried.ok, true);
  assert.equal(judgeCalls >= 2, true);
  assert.equal(retried.stage_results[1].status, "success");
  assert.equal(retried.stage_results[2].status, "success");
  assert.equal(retried.stage_results[3].status, "success");
  assert.equal(retried.stage_results[4].status, "success");
  assert.equal(retried.stage_results[4].output?.ablation_candidates?.length, 1);
  assert.equal(retried.stage_results[4].output?.ablation_count, 1);
  assert.equal(retried.stage_results[7].status, "success");
});

test("LinearWorkflowService invokeWriteAndInfer 会先登录再写入", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-auth-"));
  const calls = [];
  const service = createService({ runtimeRoot });

  service.gatewayLoginInvoker = async () => {
    calls.push("auth");
  };
  service.gatewayWriteInvoker = async (pathname) => {
    calls.push(pathname);
    return { status: "success" };
  };

  const result = await service.invokeWriteAndInfer({ project_id: "demo", basevision: 3 });
  assert.deepEqual(result, { status: "success" });
  assert.deepEqual(calls, ["auth", "/xg/write-and-infer"]);
});

test("LinearWorkflowService invokeWrite 会先登录再写入", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-write-"));
  const calls = [];
  const service = createService({ runtimeRoot });

  service.gatewayLoginInvoker = async () => {
    calls.push("auth");
  };
  service.gatewayWriteInvoker = async (pathname) => {
    calls.push(pathname);
    return { status: "success", commit_id: "ok", version_id: 1 };
  };

  const result = await service.invokeWrite({ project_id: "demo", basevision: 3 });
  assert.deepEqual(result, { status: "success", commit_id: "ok", version_id: 1 });
  assert.deepEqual(calls, ["auth", "/xg/write"]);
});

test("LinearWorkflowService invokeWrite 缺少 basevision 时会拒绝", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-write-missing-"));
  const service = createService({ runtimeRoot });

  await assert.rejects(
    () => service.invokeWrite({ project_id: "demo" }),
    /missing basevision/,
  );
});

test("LinearWorkflowService invokeWriteAndInfer 缺少 basevision 时会拒绝", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-auth-missing-"));
  const service = createService({ runtimeRoot });

  await assert.rejects(
    () => service.invokeWriteAndInfer({ project_id: "demo" }),
    /missing basevision/,
  );
});

test("LinearWorkflowService 会串行化同项目工作流锁", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-lock-"));
  const service = createService({ runtimeRoot });

  const releaseFirst = await service.acquireProjectWorkflowLock("demo");
  let secondAcquired = false;
  const secondPromise = service.acquireProjectWorkflowLock("demo").then(async (releaseSecond) => {
    secondAcquired = true;
    await releaseSecond();
  });

  await Promise.resolve();
  assert.equal(secondAcquired, false);

  await releaseFirst();
  await secondPromise;
  assert.equal(secondAcquired, true);
});

test("LinearWorkflowService loadBaseVersionMap 会使用已认证的网关请求", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-baseversion-"));
  const calls = [];
  const service = createService({ runtimeRoot });

  service.gatewayRequestInvoker = async (pathname, options) => {
    calls.push({ pathname, options });
    return {
      timelines: [
        {
          filename: "graph-source/domain/entity_a.json",
          commits: [{ versionId: 7 }, { versionId: 8 }],
        },
      ],
    };
  };

  const map = await service.loadBaseVersionMap("demo");

  assert.equal(map.get("graph-source/domain/entity_a.json"), 8);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/xg/timelines/demo");
  assert.equal(calls[0].options.method, "GET");
});
