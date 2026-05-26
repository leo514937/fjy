import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";

import { WorkflowV2Service, parseWorkflowV2JsonResponseText } from "../services/workflowV2Service.mjs";

function createService(overrides = {}) {
  return new WorkflowV2Service({
    runtimeRoot: overrides.runtimeRoot,
    workflowModelA: overrides.workflowModelA ?? "test-model",
    workflowModelB: overrides.workflowModelB ?? "test-model",
    workflowJudgeModel: overrides.workflowJudgeModel ?? "judge-model",
    workflowLlmApiKey: "test-key",
    workflowLlmBaseUrl: "http://127.0.0.1:9999",
    llmJsonInvoker: overrides.llmJsonInvoker,
    chunkMaxChars: overrides.chunkMaxChars ?? 40,
    chunkMinChars: overrides.chunkMinChars ?? 10,
    windowSize: overrides.windowSize ?? 2,
    windowStep: overrides.windowStep ?? 1,
    parallelWindows: overrides.parallelWindows ?? 2,
  });
}

test("parseWorkflowV2JsonResponseText 能解析代码围栏中的 JSON", () => {
  const parsed = parseWorkflowV2JsonResponseText("```json\n{\"ok\":true}\n```");
  assert.deepEqual(parsed, { ok: true });
});

test("WorkflowV2Service 在上游返回 HTML 页面时会给出可定位错误", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-html-response-"));
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => "<!DOCTYPE html><html><body>login page</body></html>",
  });

  try {
    const service = new WorkflowV2Service({
      runtimeRoot,
      workflowModelA: "test-model",
      workflowModelB: "test-model",
      workflowJudgeModel: "judge-model",
      workflowLlmApiKey: "test-key",
      workflowLlmBaseUrl: "https://example.com",
    });

    await assert.rejects(
      () => service.invokeWorkflowV2Json({
        stage: "window_extract",
        instruction: "提取对象",
        payload: { window_id: "w1", text: "电脑包含 CPU。" },
      }),
      (error) => {
        assert.match(error.message, /returned HTML instead of JSON/i);
        assert.match(error.message, /DMXAPI_BASE_URL/);
        assert.match(error.stageOutput?.llm_raw_text ?? "", /<!DOCTYPE html>/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WorkflowV2Service 手动设置的 V2 参数不会在刷新配置时被环境值覆盖", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-config-override-"));
  const service = new WorkflowV2Service({
    runtimeRoot,
    workflowModelA: "env-model-a",
    workflowModelB: "env-model-b",
    workflowJudgeModel: "env-judge-model",
    workflowEnvResolver: () => ({
      workflowModelA: "env-model-a",
      workflowModelB: "env-model-b",
      workflowLlmBaseUrl: "https://example.com/v1",
      workflowLlmApiKey: "env-key",
    }),
    workflowV2EnvResolver: () => ({
      workflowJudgeModel: "env-judge-model",
      chunkMaxChars: 600,
      chunkMinChars: 80,
      windowSize: 5,
      windowStep: 2,
      parallelWindows: 4,
    }),
  });

  service.setWorkflowConfig({
    workflowModelA: "manual-model-a",
    workflowModelB: "manual-model-b",
    workflowJudgeModel: "manual-judge-model",
    chunkMaxChars: 720,
    chunkMinChars: 96,
    windowSize: 6,
    windowStep: 3,
    parallelWindows: 2,
  });

  await service.refreshWorkflowConfigFromResolver();

  assert.deepEqual(service.getWorkflowConfig(), {
    workflowModel: "manual-model-a",
    workflowModelA: "manual-model-a",
    workflowModelB: "manual-model-b",
    workflowJudgeModel: "manual-judge-model",
    chunkMaxChars: 720,
    chunkMinChars: 96,
    windowSize: 6,
    windowStep: 3,
    parallelWindows: 2,
  });
});

test("WorkflowV2Service 能跑通 7 阶段并在 graph_build 移除弱环边", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-success-"));
  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, payload }) => {
      if (stage === "window_extract") {
        if (payload.window_id === "w1") {
          return {
            data: {
              objects: [
                {
                  object_name: "电脑",
                  normalized_name: "电脑",
                  citation: ["电脑包含 CPU 和 GPU。"],
                  confidence: 0.96,
                  reason: "窗口明确描述了电脑的组成关系。",
                },
                {
                  object_name: "CPU",
                  normalized_name: "cpu",
                  citation: ["电脑包含 CPU 和 GPU。"],
                  confidence: 0.92,
                  reason: "CPU 在窗口中被单独提及。",
                },
                {
                  object_name: "GPU",
                  normalized_name: "gpu",
                  citation: ["电脑包含 CPU 和 GPU。"],
                  confidence: 0.92,
                  reason: "GPU 在窗口中被单独提及。",
                },
              ],
              reason: "窗口 1 已完成对象抽取。",
            },
          };
        }
        return {
          data: {
            objects: [
              {
                object_name: "CPU",
                normalized_name: "cpu",
                citation: ["CPU 包含 ALU 和 REG。"],
                confidence: 0.9,
                reason: "CPU 在第二窗口被继续展开。",
              },
              {
                object_name: "GPU",
                normalized_name: "gpu",
                citation: ["GPU 包含 TENSOR_CORE。"],
                confidence: 0.9,
                reason: "GPU 在第二窗口被继续展开。",
              },
              {
                object_name: "ALU",
                normalized_name: "alu",
                citation: ["CPU 包含 ALU 和 REG。"],
                confidence: 0.85,
                reason: "ALU 作为 CPU 子对象出现。",
              },
              {
                object_name: "REG",
                normalized_name: "reg",
                citation: ["CPU 包含 ALU 和 REG。"],
                confidence: 0.85,
                reason: "REG 作为 CPU 子对象出现。",
              },
              {
                object_name: "TENSOR_CORE",
                normalized_name: "tensor_core",
                citation: ["GPU 包含 TENSOR_CORE。"],
                confidence: 0.84,
                reason: "TENSOR_CORE 作为 GPU 子对象出现。",
              },
            ],
            reason: "窗口 2 已完成对象抽取。",
          },
        };
      }

      if (stage === "function_analysis") {
        return {
          data: {
            core_function: payload.object.object_name === "电脑"
              ? "执行综合计算并协调主要硬件组件工作"
              : payload.object.object_name === "CPU"
                ? "执行核心计算与指令处理"
                : payload.object.object_name === "GPU"
                  ? "执行图形与并行计算处理"
                  : payload.object.object_name === "ALU"
                    ? "执行算术逻辑运算"
                    : payload.object.object_name === "REG"
                      ? "存储运行时寄存数据"
                      : "支撑所属对象的核心处理功能",
            citation: Array.isArray(payload.object.citations) ? payload.object.citations : [],
            confidence: 0.9,
            reason: `${payload.object.object_name} 的核心功能可由输入 citations 归纳。`,
          },
        };
      }

      if (stage === "object_decompose") {
        if (payload.object.object_name === "电脑") {
          return {
            data: {
              decompositions: [
                {
                  parent_object_name: "电脑",
                  child_object_name: "CPU",
                  relation: "contains",
                  citation: "电脑包含 CPU 和 GPU。",
                  confidence: 0.95,
                  reason: "文本明确表示 CPU 是电脑的组成部分。",
                },
                {
                  parent_object_name: "电脑",
                  child_object_name: "GPU",
                  relation: "contains",
                  citation: "电脑包含 CPU 和 GPU。",
                  confidence: 0.95,
                  reason: "文本明确表示 GPU 是电脑的组成部分。",
                },
              ],
              reason: "电脑的直接组成关系已提取。",
            },
          };
        }
        if (payload.object.object_name === "CPU") {
          return {
            data: {
              decompositions: [
                {
                  parent_object_name: "CPU",
                  child_object_name: "ALU",
                  relation: "contains",
                  citation: "CPU 包含 ALU 和 REG。",
                  confidence: 0.9,
                  reason: "ALU 是 CPU 的直接组成部分。",
                },
                {
                  parent_object_name: "CPU",
                  child_object_name: "REG",
                  relation: "contains",
                  citation: "CPU 包含 ALU 和 REG。",
                  confidence: 0.89,
                  reason: "REG 是 CPU 的直接组成部分。",
                },
              ],
              reason: "CPU 的直接组成关系已提取。",
            },
          };
        }
        if (payload.object.object_name === "GPU") {
          return {
            data: {
              decompositions: [
                {
                  parent_object_name: "GPU",
                  child_object_name: "TENSOR_CORE",
                  relation: "contains",
                  citation: "GPU 包含 TENSOR_CORE。",
                  confidence: 0.88,
                  reason: "TENSOR_CORE 是 GPU 的直接组成部分。",
                },
                {
                  parent_object_name: "GPU",
                  child_object_name: "电脑",
                  relation: "contains",
                  citation: "GPU 回指电脑。",
                  confidence: 0.05,
                  reason: "这是一条故意构造的弱边，用于测试 DAG 去环。",
                },
              ],
              reason: "GPU 的直接组成关系已提取。",
            },
          };
        }
        return {
          data: {
            decompositions: [],
            reason: "该对象没有可继续拆解的直接子对象。",
          },
        };
      }

      if (stage === "ablation_analysis" && Array.isArray(payload.siblings)) {
        return {
          data: {
            sibling_impacts: payload.siblings.map((sibling) => ({
              target_sibling_object_id: sibling.object_id,
              impact_level: "low",
              judgement: "兄弟节点基本可独立工作。",
              reason: "输入文本未显示强依赖关系。",
            })),
            reason: "兄弟影响分析已完成。",
          },
        };
      }

      if (stage === "ablation_analysis") {
        return {
          data: {
            impact_on_parent: {
              parent_object_id: payload.parent.object_id,
              importance_level: "high",
              judgement: "去掉该子节点会明显削弱父节点定义。",
              reason: "父节点的主能力依赖该直接子节点。",
            },
            reason: "父节点重要性分析已完成。",
          },
        };
      }

      return {
        data: {
          should_merge: false,
          object_name: "",
          normalized_name: "",
          aliases: [],
          reason: "默认不触发融合裁决。",
        },
      };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "computer.txt",
    mimeType: "text/plain",
    content: Buffer.from("电脑包含 CPU 和 GPU。\n\nCPU 包含 ALU 和 REG。\n\nGPU 包含 TENSOR_CORE。", "utf8"),
    conversationId: "workflow-v2-success",
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage_results.length, 7);
  assert.equal(result.result.objects.length, 6);
  assert.equal(result.result.edges.some((edge) => edge.source_object_id === edge.target_object_id), false);
  assert.equal(result.result.meta.is_dag, true);
  assert.equal(result.stage_results[0].stage, "chunk_parse");
  assert.equal(result.stage_results[6].stage, "ablation_analysis");
  assert.equal(result.stage_results[2].output.fused_objects.length, 6);
  assert.equal(result.stage_results[3].output.function_objects.length, 6);
  assert.equal(result.stage_results[5].output.removed_cycle_edges.length, 1);
  assert.equal(result.result.ablation.length >= 2, true);
  assert.equal(result.result.objects.every((item) => typeof item.core_function === "string" && item.core_function.length > 0), true);
  assert.equal(result.result.objects.some((item) => item.object_name === "电脑" && item.is_isolated === false), true);
  assert.equal(result.result.objects.some((item) => item.object_name === "ALU" && item.is_isolated === false), true);
});

test("WorkflowV2Service graph_build 会把未进入结构边的对象标记为孤立节点", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-isolated-"));
  const service = createService({ runtimeRoot });

  const output = await service.graphBuildStage(
    [
      { object_id: "obj-computer", object_name: "电脑" },
      { object_id: "obj-cpu", object_name: "CPU" },
      { object_id: "obj-note", object_name: "注释对象" },
    ],
    [
      {
        object_id: "obj-computer",
        decompositions: [
          {
            parent_object_name: "电脑",
            child_object_name: "CPU",
            relation: "contains",
            citation: "电脑包含 CPU。",
            confidence: 0.95,
            reason: "直接组成关系。",
          },
        ],
      },
      {
        object_id: "obj-note",
        decompositions: [],
      },
    ],
  );

  assert.equal(output.edges.length, 1);
  assert.equal(output.total_isolated_objects, 1);
  assert.equal(output.objects.find((item) => item.object_id === "obj-note")?.is_isolated, true);
  assert.equal(output.objects.find((item) => item.object_id === "obj-note")?.structure_status, "isolated");
  assert.match(output.objects.find((item) => item.object_id === "obj-note")?.structure_reason ?? "", /没有任何入边或出边/);
  assert.equal(output.objects.find((item) => item.object_id === "obj-computer")?.is_isolated, false);
});

test("WorkflowV2Service object_fusion 会对模糊候选发起裁决并合并", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-fusion-"));
  let judgeCalled = 0;
  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage === "object_fusion") {
        judgeCalled += 1;
        return {
          data: {
            should_merge: true,
            object_name: "电脑",
            normalized_name: "电脑",
            aliases: ["计算机"],
            reason: "两个候选在 citations 中指向同一设备对象。",
          },
        };
      }
      throw new Error(`unexpected stage: ${stage}`);
    },
  });

  const output = await service.objectFusionStage([
    {
      window_id: "w1",
      objects: [
        {
          object_name: "电脑",
          normalized_name: "电脑",
          citation: ["电脑包含 CPU 和 GPU。"],
          confidence: 0.9,
          reason: "第一窗口中直接提及。",
        },
      ],
    },
    {
      window_id: "w2",
      objects: [
        {
          object_name: "电脑系统",
          normalized_name: "电脑系统",
          citation: ["该电脑系统负责通用计算。"],
          confidence: 0.88,
          reason: "第二窗口中使用了名称包含关系的近义称呼。",
        },
      ],
    },
  ]);

  assert.equal(judgeCalled, 2);
  assert.equal(output.fused_objects.length, 1);
  assert.equal(output.fused_objects[0].aliases.includes("计算机"), true);
  assert.equal(output.fused_objects[0].citations.length, 2);
});

test("WorkflowV2Service chunk_parse 会将弱语义短标题并入后续正文", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-chunk-"));
  const service = createService({
    runtimeRoot,
    chunkMaxChars: 80,
    chunkMinChars: 10,
    llmJsonInvoker: async () => {
      throw new Error("llm should not be called in chunk_parse test");
    },
  });

  const output = await service.chunkParseStage({
    raw_text: "第一段介绍电脑的基本概念。\n\n词条热门讨论\n\n这里是关于该词条的详细讨论内容，覆盖争议点、背景和主要观点。",
  });

  assert.equal(output.total_chunks, 2);
  assert.equal(output.chunks.some((chunk) => chunk.text === "词条热门讨论"), false);
  assert.equal(output.chunks[1].text.includes("词条热门讨论"), true);
  assert.equal(output.chunks[1].text.includes("这里是关于该词条的详细讨论内容"), true);
  assert.match(output.chunks[1].reason, /短标题与后续正文合并/);
});

test("WorkflowV2Service window_extract 会上报滑动窗口执行进度", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-window-progress-"));
  const seenInstructions = [];
  const progressEvents = [];
  const service = createService({
    runtimeRoot,
    windowSize: 2,
    windowStep: 1,
    parallelWindows: 2,
    llmJsonInvoker: async ({ stage, payload, instruction }) => {
      assert.equal(stage, "window_extract");
      seenInstructions.push(instruction);
      return {
        data: {
          objects: [
            {
              object_name: payload.window_id,
              normalized_name: payload.window_id,
              citation: [payload.text],
              confidence: 0.8,
              reason: "测试用对象。",
            },
          ],
          reason: "窗口已完成对象抽取。",
        },
      };
    },
  });

  const output = await service.windowExtractStage(
    { raw_text: "示例文本" },
    [
      { chunk_id: "c1", order: 1, text: "第一段", reason: "", start_offset: 0, end_offset: 3, paragraph_index: 0 },
      { chunk_id: "c2", order: 2, text: "第二段", reason: "", start_offset: 4, end_offset: 7, paragraph_index: 1 },
      { chunk_id: "c3", order: 3, text: "第三段", reason: "", start_offset: 8, end_offset: 11, paragraph_index: 2 },
    ],
    {
      onProgress(payload) {
        progressEvents.push(payload);
      },
    },
  );

  assert.equal(output.progress.completed, 2);
  assert.equal(output.progress.total, 2);
  assert.equal(progressEvents.length, 3);
  assert.deepEqual(
    progressEvents.map((item) => item.completed),
    [0, 1, 2],
  );
  assert.equal(typeof progressEvents.at(-1).window_id, "string");
  assert.match(seenInstructions[0], /尽量详细地提取/);
  assert.match(seenInstructions[0], /不可再拆分的最小实体词/);
});

test("WorkflowV2Service object_decompose 会对失败对象重试三次并跳过继续执行", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-decompose-retry-"));
  const attemptCounter = new Map();
  const progressEvents = [];
  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, payload }) => {
      assert.equal(stage, "object_decompose");
      const objectName = payload.object.object_name;
      const count = (attemptCounter.get(objectName) ?? 0) + 1;
      attemptCounter.set(objectName, count);
      if (objectName === "坏对象") {
        const error = new Error("workflow V2 LLM returned invalid JSON");
        error.llm_raw_text = `attempt-${count}: not-json`;
        throw error;
      }
      return {
        data: {
          decompositions: [
            {
              parent_object_name: "好对象",
              child_object_name: "子对象",
              relation: "contains",
              citation: "好对象包含子对象。",
              confidence: 0.91,
              reason: "文本明确说明了直接组成关系。",
            },
          ],
          reason: "好对象拆解成功。",
        },
      };
    },
  });

  const output = await service.objectDecomposeStage(
    [
      {
        object_id: "obj-good",
        object_name: "好对象",
        citations: ["好对象包含子对象。"],
      },
      {
        object_id: "obj-bad",
        object_name: "坏对象",
        citations: ["坏对象的 citation 会导致模型输出坏 JSON。"],
      },
    ],
    {
      onProgress(payload) {
        progressEvents.push(payload);
      },
    },
  );

  assert.equal(attemptCounter.get("好对象"), 2);
  assert.equal(attemptCounter.get("坏对象"), 6);
  assert.equal(output.decomposition_results.length, 2);
  assert.equal(output.failed_objects.length, 1);
  assert.equal(output.failed_objects[0].object_name, "坏对象");
  assert.equal(output.failed_objects[0].attempts.length, 3);
  assert.equal(output.failed_objects[0].attempts[2].model_output, "attempt-5: not-json");
  assert.equal(output.progress.completed, 2);
  assert.equal(output.progress.failed, 1);
  assert.deepEqual(
    progressEvents.map((item) => item.completed),
    [0, 1, 2],
  );
});

test("WorkflowV2Service ablation_analysis 会上报父节点级进度", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-ablation-progress-"));
  const progressEvents = [];
  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, payload }) => {
      assert.equal(stage, "ablation_analysis");
      if (Array.isArray(payload.siblings)) {
        return {
          data: {
            sibling_impacts: payload.siblings.map((sibling) => ({
              target_sibling_object_id: sibling.object_id,
              impact_level: "low",
              judgement: "兄弟节点影响较低。",
              reason: "测试用兄弟消融结果。",
            })),
            reason: "兄弟消融分析完成。",
          },
        };
      }
      return {
        data: {
          impact_on_parent: {
            parent_object_id: payload.parent.object_id,
            importance_level: "high",
            judgement: "该子节点对父节点很重要。",
            reason: "测试用父级消融结果。",
          },
          reason: "父节点重要性分析完成。",
        },
      };
    },
  });

  const output = await service.ablationAnalysisStage(
    [
      { object_id: "obj-computer", object_name: "电脑" },
      { object_id: "obj-cpu", object_name: "CPU" },
      { object_id: "obj-gpu", object_name: "GPU" },
      { object_id: "obj-cpu-core", object_name: "CPU核心" },
    ],
    [
      { source_object_id: "obj-computer", target_object_id: "obj-cpu" },
      { source_object_id: "obj-computer", target_object_id: "obj-gpu" },
      { source_object_id: "obj-cpu", target_object_id: "obj-cpu-core" },
    ],
    {
      onProgress(payload) {
        progressEvents.push(payload);
      },
    },
  );

  assert.equal(output.parent_summaries.length, 2);
  assert.deepEqual(output.progress, { completed: 2, total: 2 });
  const completionEvents = progressEvents.filter((item) => typeof item.parent_object_name === "string" && item.parent_object_name);
  assert.deepEqual(
    completionEvents.map((item) => item.completed),
    [1, 2],
  );
  assert.deepEqual(
    completionEvents.map((item) => item.parent_object_name).sort(),
    ["CPU", "电脑"],
  );
  assert.equal(
    progressEvents.some((item) => item.current_parent_object_name === "电脑" && item.total_child_count === 2),
    true,
  );
});

test("WorkflowV2Service ablation_analysis 会并行执行多个父节点的消融分析", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-ablation-parallel-"));
  let inFlight = 0;
  let maxInFlight = 0;
  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, payload }) => {
      assert.equal(stage, "ablation_analysis");
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      if (Array.isArray(payload.siblings)) {
        return {
          data: {
            sibling_impacts: payload.siblings.map((sibling) => ({
              target_sibling_object_id: sibling.object_id,
              impact_level: "low",
              judgement: "兄弟节点影响较低。",
              reason: "并行测试用兄弟消融结果。",
            })),
            reason: "兄弟消融完成。",
          },
        };
      }
      return {
        data: {
          impact_on_parent: {
            parent_object_id: payload.parent.object_id,
            importance_level: "high",
            judgement: "该子节点对父节点重要。",
            reason: "并行测试用父级消融结果。",
          },
          reason: "父级消融完成。",
        },
      };
    },
  });

  const output = await service.ablationAnalysisStage(
    [
      { object_id: "obj-computer", object_name: "电脑" },
      { object_id: "obj-cpu", object_name: "CPU" },
      { object_id: "obj-gpu", object_name: "GPU" },
      { object_id: "obj-phone", object_name: "手机" },
      { object_id: "obj-screen", object_name: "屏幕" },
      { object_id: "obj-battery", object_name: "电池" },
    ],
    [
      { source_object_id: "obj-computer", target_object_id: "obj-cpu" },
      { source_object_id: "obj-computer", target_object_id: "obj-gpu" },
      { source_object_id: "obj-phone", target_object_id: "obj-screen" },
      { source_object_id: "obj-phone", target_object_id: "obj-battery" },
    ],
  );

  assert.equal(output.parent_summaries.length, 2);
  assert.equal(maxInFlight > 1, true);
});

test("WorkflowV2Service 能从失败阶段重试，并复用真实快照状态", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-retry-success-"));
  let ablationAttempt = 0;
  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage, payload }) => {
      if (stage === "window_extract") {
        return {
          data: {
            objects: [
              {
                object_name: "电脑",
                normalized_name: "电脑",
                citation: ["电脑包含 CPU。"],
                confidence: 0.95,
                reason: "窗口里明确给出了父对象。",
              },
              {
                object_name: "CPU",
                normalized_name: "cpu",
                citation: ["电脑包含 CPU。"],
                confidence: 0.92,
                reason: "窗口里明确给出了子对象。",
              },
            ],
            reason: "窗口抽取完成。",
          },
        };
      }
      if (stage === "function_analysis") {
        return {
          data: {
            core_function: "执行核心计算",
            citation: Array.isArray(payload.object.citations) ? payload.object.citations : [],
            confidence: 0.9,
            reason: "可从 citations 中归纳对象核心功能。",
          },
        };
      }
      if (stage === "object_decompose") {
        if (payload.object.object_name === "电脑") {
          return {
            data: {
              decompositions: [
                {
                  parent_object_name: "电脑",
                  child_object_name: "CPU",
                  relation: "contains",
                  citation: "电脑包含 CPU。",
                  confidence: 0.93,
                  reason: "文本直接说明了组成关系。",
                },
              ],
              reason: "电脑拆解完成。",
            },
          };
        }
        return {
          data: {
            decompositions: [],
            reason: "该对象没有可继续拆解的子对象。",
          },
        };
      }
      if (stage === "ablation_analysis") {
        ablationAttempt += 1;
        if (ablationAttempt <= 2) {
          throw new Error("ablation failed on first run");
        }
        if (Array.isArray(payload.siblings)) {
          return {
            data: {
              sibling_impacts: payload.siblings.map((sibling) => ({
                target_sibling_object_id: sibling.object_id,
                impact_level: "low",
                judgement: "兄弟节点受影响较低。",
                reason: "重试后的兄弟消融结果。",
              })),
              reason: "兄弟消融完成。",
            },
          };
        }
        return {
          data: {
            impact_on_parent: {
              parent_object_id: payload.parent.object_id,
              importance_level: "high",
              judgement: "该子节点对父节点重要。",
              reason: "重试后的父级消融结果。",
            },
            reason: "父级消融完成。",
          },
        };
      }
      return {
        data: {
          should_merge: false,
          object_name: "",
          normalized_name: "",
          aliases: [],
          reason: "默认不做融合裁决。",
        },
      };
    },
  });

  const firstRun = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "retry-success.txt",
    mimeType: "text/plain",
    content: Buffer.from("电脑包含 CPU。", "utf8"),
    conversationId: "workflow-v2-retry-success",
  });

  assert.equal(firstRun.ok, false);
  assert.equal(firstRun.stage_results.find((item) => item.stage === "graph_build")?.status, "success");
  assert.equal(firstRun.stage_results.find((item) => item.stage === "ablation_analysis")?.status, "failed");

  const snapshot = JSON.parse(await readFile(service.getWorkflowSnapshotPath("workflow-v2-retry-success"), "utf8"));
  assert.equal(snapshot.state.edges.length, 1);
  assert.equal(snapshot.stage_results.find((item) => item.stage === "graph_build")?.status, "success");
  assert.equal(snapshot.stage_results.find((item) => item.stage === "ablation_analysis")?.status, "failed");

  const retried = await service.retryFileWorkflowFromStage({
    projectId: "demo",
    conversationId: "workflow-v2-retry-success",
    startStage: "ablation_analysis",
  });

  assert.equal(retried.ok, true);
  assert.equal(retried.stage_results.find((item) => item.stage === "graph_build")?.status, "success");
  assert.equal(retried.stage_results.find((item) => item.stage === "ablation_analysis")?.status, "success");
  assert.equal(retried.result.edges.length, 1);
  assert.equal(retried.result.ablation.length, 1);
});

test("WorkflowV2Service 禁止从 pending 阶段重试，避免生成空成功结果", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-retry-invalid-"));
  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage === "window_extract") {
        return {
          data: {
            objects: [
              {
                object_name: "电脑",
                normalized_name: "电脑",
                citation: ["电脑系统负责计算。"],
                confidence: 0.91,
                reason: "窗口抽取到了对象。",
              },
              {
                object_name: "电脑系统",
                normalized_name: "电脑系统",
                citation: ["电脑系统负责计算。"],
                confidence: 0.9,
                reason: "窗口抽取到了近义候选。",
              },
            ],
            reason: "窗口抽取完成。",
          },
        };
      }
      if (stage === "object_fusion") {
        throw new Error("fusion failed");
      }
      throw new Error(`unexpected stage: ${stage}`);
    },
  });

  const firstRun = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "retry-invalid.txt",
    mimeType: "text/plain",
    content: Buffer.from("电脑系统负责计算。", "utf8"),
    conversationId: "workflow-v2-retry-invalid",
  });

  assert.equal(firstRun.ok, false);
  assert.equal(firstRun.stage_results[2].status, "failed");
  assert.equal(firstRun.stage_results.find((item) => item.stage === "function_analysis")?.status, "pending");

  const retried = await service.retryFileWorkflowFromStage({
    projectId: "demo",
    conversationId: "workflow-v2-retry-invalid",
    startStage: "graph_build",
  });

  assert.equal(retried.ok, false);
  assert.match(retried.errors[0].message, /not retryable|previous stage/);
  assert.equal(retried.stage_results[2].status, "failed");
  assert.equal(retried.stage_results.find((item) => item.stage === "function_analysis")?.status, "pending");
});

test("WorkflowV2Service getFileWorkflowSession 会从 snapshot 返回完整对象和运行状态", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-session-"));
  const service = createService({ runtimeRoot });
  const conversationId = "workflow-v2-session";
  const stageResults = service.buildInitialStageResults();

  stageResults[0] = {
    ...stageResults[0],
    status: "success",
    started_at: "2026-05-19T10:00:00.000Z",
    finished_at: "2026-05-19T10:00:01.000Z",
    output: {
      total_chunks: 2,
      chunks: [
        { chunk_id: "c1", order: 1, text: "电脑包含 CPU。", reason: "完整自然段。" },
        { chunk_id: "c2", order: 2, text: "CPU 包含 ALU。", reason: "完整自然段。" },
      ],
      reason: "chunk_parse 完成。",
    },
  };
  stageResults[1] = {
    ...stageResults[1],
    status: "running",
    started_at: "2026-05-19T10:00:02.000Z",
    finished_at: null,
    output: null,
  };

  await service.writeWorkflowSnapshot(conversationId, {
    input_file: {
      originalName: "demo.txt",
      storedName: "demo.txt",
      size: 12,
      path: path.join(runtimeRoot, conversationId),
      mimeType: "text/plain",
    },
    stage_results: stageResults,
    state: {
      document: {
        document_id: "doc-1",
        raw_text: "电脑包含 CPU。\n\nCPU 包含 ALU。",
      },
      chunks: [
        { chunk_id: "c1", order: 1, text: "电脑包含 CPU。", reason: "完整自然段。" },
        { chunk_id: "c2", order: 2, text: "CPU 包含 ALU。", reason: "完整自然段。" },
      ],
      windows: [
        { window_id: "w1", order: 1, chunk_ids: ["c1", "c2"], text: "电脑包含 CPU。\n\nCPU 包含 ALU。", reason: "覆盖连续 chunk。" },
      ],
      fused_objects: [
        { object_id: "obj-computer", object_name: "电脑", normalized_name: "电脑", aliases: ["电脑"], citations: ["电脑包含 CPU。"], confidence: 0.95, merge_reasons: ["直接抽取"], reason: "对象已融合。" },
        { object_id: "obj-cpu", object_name: "CPU", normalized_name: "cpu", aliases: ["CPU"], citations: ["电脑包含 CPU。", "CPU 包含 ALU。"], confidence: 0.93, merge_reasons: ["直接抽取"], reason: "对象已融合。" },
        { object_id: "obj-alu", object_name: "ALU", normalized_name: "alu", aliases: ["ALU"], citations: ["CPU 包含 ALU。"], confidence: 0.9, merge_reasons: ["直接抽取"], reason: "对象已融合。" },
      ],
      edges: [
        { edge_id: "edge-1", source_object_id: "obj-computer", target_object_id: "obj-cpu", relation: "contains", citation: "电脑包含 CPU。", confidence: 0.95, derived_from: "object_decompose", reason: "直接组成关系。" },
      ],
      parent_summaries: [],
    },
  });

  const output = await service.getFileWorkflowSession(conversationId);

  assert.equal(output.workflow.status, "running");
  assert.equal(output.ok, false);
  assert.equal(output.result.objects.length, 3);
  assert.equal(output.result.edges.length, 1);
  assert.equal(output.result.meta.total_objects, 3);
  assert.equal(output.started_at, "2026-05-19T10:00:00.000Z");
  assert.equal(output.finished_at, undefined);
});

test("WorkflowV2Service invokeStageJson 会放宽 shared 判别并合并 function_analysis 的补充字段", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-relaxed-shared-"));
  const calls = [];
  const service = createService({
    runtimeRoot,
    workflowModelA: "model-a",
    workflowModelB: "model-b",
    workflowJudgeModel: "model-judge",
    llmJsonInvoker: async ({ modelOverride, ensembleRole }) => {
      calls.push({ modelOverride, ensembleRole });
      if (modelOverride === "model-a") {
        return {
          data: {
            core_function: "执行核心计算",
            citation: ["机械狗依靠核心模块执行核心计算。"],
            confidence: 0.72,
            reason: "模型 A 给出较保守概括。",
          },
        };
      }
      return {
        data: {
          core_function: "执行核心计算",
          citation: ["机械狗依靠核心模块执行核心计算，并协调其他部件。"],
          confidence: 0.91,
          reason: "模型 B 补充了更完整的上下文。",
        },
      };
    },
  });

  const result = await service.invokeStageJson({
    stage: "function_analysis",
    instruction: "测试 shared 放宽。",
    payload: {
      object: {
        object_name: "核心模块",
        citations: ["机械狗依靠核心模块执行核心计算，并协调其他部件。"],
      },
    },
    responseSchema: {
      name: "workflow_v2_object_function",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          core_function: { type: "string" },
          citation: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["core_function", "citation", "confidence", "reason"],
      },
    },
  });

  assert.equal(result.data.core_function, "执行核心计算");
  assert.equal(result.data.citation.length, 2);
  assert.equal(result.data.confidence, 0.815);
  assert.equal(result.data.reason, "模型 A 给出较保守概括。\n模型 B 补充了更完整的上下文。");
  assert.equal(result.llm_ensemble?.shared_items?.length, 1);
  assert.equal(result.llm_ensemble?.conflicts?.length, 0);
  assert.equal(result.llm_ensemble?.cross_rounds?.length, 0);
  assert.equal(calls.some((item) => item.ensembleRole === "cross_round"), false);
  assert.equal(calls.some((item) => item.ensembleRole === "judge_pick"), false);
});

test("WorkflowV2Service invokeStageJson 会先让 A/B 互评 conflict 再交给 judge 二选一", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-v2-judge-pick-"));
  const calls = [];
  const service = createService({
    runtimeRoot,
    workflowModelA: "model-a",
    workflowModelB: "model-b",
    workflowJudgeModel: "model-judge",
    llmJsonInvoker: async ({ stage, modelOverride, ensembleRole, ensembleModelKey, payload }) => {
      calls.push({ stage, modelOverride, ensembleRole });
      if (ensembleRole === "cross_round") {
        return {
          data: {
            conflict_reviews: [
              {
                item_key: "__root__",
                preferred_model: ensembleModelKey === "model_a" ? "model_b" : "model_a",
                confidence: ensembleModelKey === "model_a" ? 0.62 : 0.58,
                reason: ensembleModelKey === "model_a"
                  ? "模型 B 的别名信息更完整。"
                  : "模型 A 的保守判断更贴近原定义。",
                suggestion: ensembleModelKey === "model_a"
                  ? "若需要保留别名，应优先选模型 B。"
                  : "若强调稳健性，可回退到模型 A。",
              },
            ],
            round_summary: `${ensembleModelKey} 已完成对冲突项的点评。`,
          },
        };
      }
      if (ensembleRole === "judge_pick") {
        assert.equal(payload.model_a_review.conflict_reviews.length, 1);
        assert.equal(payload.model_b_review.conflict_reviews.length, 1);
        return {
          data: {
            resolved_conflicts: [
              {
                item_key: "__root__",
                selected_model: "model_b",
                reason: "模型 B 的结果更符合当前判断要求。",
              },
            ],
            reason: "已完成二选一判决。",
          },
        };
      }
      if (modelOverride === "model-a") {
        return {
          data: {
            should_merge: false,
            object_name: "电脑",
            normalized_name: "电脑",
            aliases: [],
            reason: "模型 A 认为不应合并。",
          },
        };
      }
      return {
        data: {
          should_merge: true,
          object_name: "电脑",
          normalized_name: "电脑",
          aliases: ["计算机"],
          reason: "模型 B 认为应合并。",
        },
      };
    },
  });

  const result = await service.invokeStageJson({
    stage: "object_fusion",
    instruction: "测试双模型分歧判决。",
    payload: {
      existing_object: { object_name: "电脑", citations: ["电脑负责计算。"] },
      candidate_object: { object_name: "计算机", citations: ["计算机负责计算。"] },
    },
    responseSchema: {
      name: "workflow_v2_fusion_judge",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          should_merge: { type: "boolean" },
          object_name: { type: "string" },
          normalized_name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["should_merge", "object_name", "normalized_name", "aliases", "reason"],
      },
    },
  });

  assert.equal(result.data.should_merge, true);
  assert.equal(result.data.aliases.includes("计算机"), true);
  assert.deepEqual(
    calls.filter((item) => item.ensembleRole === "cross_round").map((item) => item.modelOverride).sort(),
    ["model-a", "model-b"],
  );
  assert.equal(calls.filter((item) => item.ensembleRole === "judge_pick").length, 1);
  assert.equal(result.llm_ensemble?.conflicts?.length, 1);
  assert.equal(result.llm_ensemble?.cross_rounds?.length, 2);
  assert.equal(result.llm_ensemble?.cross_rounds?.[0]?.data?.resolved_conflicts?.[0]?.citations?.[0]?.suggestion.includes("模型"), true);
  assert.equal(result.llm_ensemble?.judge_result?.model, "model-judge");
});
