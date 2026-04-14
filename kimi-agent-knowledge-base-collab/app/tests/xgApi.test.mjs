import test from "node:test";
import assert from "node:assert/strict";

const {
  normalizeXgProjectsResponse,
  normalizeXgTimelinesResponse,
  normalizeXgReadResponse,
  normalizeXgWriteResult,
} = await import("../src/lib/xgApi.ts");

test("normalizeXgProjectsResponse 能兼容 gateway 返回的 projects 包装结构", () => {
  const projects = normalizeXgProjectsResponse({
    projects: [
      {
        project_id: "demo-project",
        name: "演示项目",
        description: "用于验证列表刷新",
        status: "开发中",
        updated_at: "2026-04-14 15:41:45",
      },
    ],
  });

  assert.deepEqual(projects, [
    {
      id: "demo-project",
      projectId: "demo-project",
      name: "演示项目",
      description: "用于验证列表刷新",
      status: "开发中",
      updatedAt: "2026-04-14 15:41:45",
    },
  ]);
});

test("normalizeXgTimelinesResponse 能把 history 转成前端 commits 结构", () => {
  const timelines = normalizeXgTimelinesResponse({
    timelines: [
      {
        filename: "engine_ontology.json",
        history: [
          {
            id: "abc123",
            msg: "初始化发动机本体",
            committer: "Web UI",
            time: "2026-04-14T15:41:45+08:00",
            version_id: 1,
          },
        ],
      },
    ],
  });

  assert.deepEqual(timelines, [
    {
      filename: "engine_ontology.json",
      commits: [
        {
          id: "abc123",
          message: "初始化发动机本体",
          author: "Web UI",
          timestamp: "2026-04-14T15:41:45+08:00",
          versionId: 1,
        },
      ],
    },
  ]);
});

test("normalizeXgReadResponse 能提取 data 包装字段", () => {
  const content = normalizeXgReadResponse({
    data: {
      name: "发动机",
      type: "component",
    },
  });

  assert.deepEqual(content, {
    name: "发动机",
    type: "component",
  });
});

test("normalizeXgWriteResult 能兼容 write-and-infer 的嵌套返回结构", () => {
  const result = normalizeXgWriteResult({
    status: "success",
    write_result: {
      commit_id: "deadbeef",
      version_id: 2,
    },
    inference_result: {
      probability: 0.86,
      reason: "结构完整",
    },
  });

  assert.deepEqual(result, {
    status: "success",
    commit_id: "deadbeef",
    version_id: 2,
    inference: {
      probability: 0.86,
      reason: "结构完整",
    },
  });
});
