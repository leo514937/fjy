import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { OntoGitKnowledgeBaseRepository } from "../repositories/ontoGitKnowledgeBaseRepository.mjs";

function createValidWorkflowSource() {
  return {
    source: "linear-workflow",
    ontology: {
      workflow_version: "v1-linear-file-workflow",
      generated_at: "2026-04-25T00:00:00Z",
      project_id: "demo",
      scope: "entity",
      entity_id: "entity_a",
      entity_name: "实体A",
      system_summary: {
        entity_count: 1,
        relation_count: 0,
        ablation_count: 0,
      },
      entity: {
        id: "entity_a",
        name: "实体A",
        summary: "摘要",
        type: "capability",
        level: 1,
        source: "linear-workflow",
        properties: {},
        abilities: [],
        citations: [],
      },
      relations: [],
      ablation: null,
    },
    entity: {
      id: "entity_a",
      name: "实体A",
      summary: "摘要",
      type: "capability",
      level: 1,
      source: "linear-workflow",
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
    probability: "95%",
  };
}

function createWorkflowEntitySource({
  projectId = "demo",
  entityId,
  entityName,
  relations = [],
  ablation = null,
  precheck = null,
}) {
  return {
    source: "linear-workflow",
    ontology: {
      workflow_version: "v1-linear-file-workflow",
      generated_at: "2026-04-25T00:00:00Z",
      project_id: projectId,
      scope: "entity",
      entity_id: entityId,
      entity_name: entityName,
      system_summary: {
        entity_count: 1,
        relation_count: relations.length,
        ablation_count: ablation ? 1 : 0,
      },
      entity: {
        id: entityId,
        name: entityName,
        summary: `${entityName} 概要`,
        type: "capability",
        level: 1,
        source: "linear-workflow",
        properties: {},
        abilities: [],
        citations: [],
      },
      relations,
      ablation: ablation ? [ablation] : [],
    },
    entity: {
      id: entityId,
      name: entityName,
      summary: `${entityName} 概要`,
      type: "capability",
      level: 1,
      source: "linear-workflow",
      properties: {},
      abilities: [],
      citations: [],
    },
    relations,
    ablation,
    precheck,
    ontology_summary: {
      entity_count: 1,
      relation_count: relations.length,
      ablation_count: ablation ? 1 : 0,
    },
    probability: "95%",
  };
}

async function withTempCacheDir(callback) {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "ontogit-knowledge-graph-cache-"));
  try {
    await callback(cacheDir);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

test("OntoGitKnowledgeBaseRepository writeWorkflowEntity 会先登录再写入", async () => {
  const calls = [];
  const repository = new OntoGitKnowledgeBaseRepository({
    gatewayBaseUrl: "http://127.0.0.1:8080",
    authUsername: "mogong",
    authPassword: "123456",
  });

  repository.ensureGatewayLogin = async () => {
    calls.push("auth");
  };
  repository.invokeGatewayJson = async (pathname, payload) => {
    calls.push(pathname);
    return { pathname, payload };
  };

  const result = await repository.writeWorkflowEntity({
    projectId: "demo",
    filename: "graph-source/domain/entity_a.json",
    data: createValidWorkflowSource(),
    message: "写入实体",
    basevision: 7,
  });

  assert.equal(result.pathname, "/xg/write-and-infer");
  assert.deepEqual(calls, ["auth", "/xg/write-and-infer"]);
});

test("OntoGitKnowledgeBaseRepository writeWorkflowEntity 在跳过推理时只写入", async () => {
  const calls = [];
  const repository = new OntoGitKnowledgeBaseRepository({
    gatewayBaseUrl: "http://127.0.0.1:8080",
    authUsername: "mogong",
    authPassword: "123456",
  });

  repository.ensureGatewayLogin = async () => {
    calls.push("auth");
  };
  repository.invokeGatewayJson = async (pathname, payload) => {
    calls.push(pathname);
    return { pathname, payload };
  };

  const result = await repository.writeWorkflowEntity({
    projectId: "demo",
    filename: "graph-source/domain/entity_a.json",
    data: createValidWorkflowSource(),
    message: "写入实体",
    basevision: 7,
    skipInference: true,
  });

  assert.equal(result.pathname, "/xg/write");
  assert.deepEqual(calls, ["auth", "/xg/write"]);
  assert.equal(Object.hasOwn(result.payload, "inference_message"), false);
  assert.equal(Object.hasOwn(result.payload, "inference_agent_name"), false);
  assert.equal(Object.hasOwn(result.payload, "inference_committer_name"), false);
});

test("OntoGitKnowledgeBaseRepository 已登录后只携带 Authorization", async () => {
  const headersSeen = [];
  const repository = new OntoGitKnowledgeBaseRepository({
    gatewayBaseUrl: "http://127.0.0.1:8080",
    gatewayApiKey: "service-key",
    authUsername: "mogong",
    authPassword: "123456",
  });

  repository.gatewayAccessToken = "login-token";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/xg/projects") {
      headersSeen.push(init.headers);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({ projects: [] });
        },
        async json() {
          return { projects: [] };
        },
      };
    }
    throw new Error(`unexpected fetch: ${pathname}`);
  };

  try {
    await repository.listProjects();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(headersSeen.length, 1);
  assert.equal(headersSeen[0].Authorization, "Bearer login-token");
  assert.equal("X-API-Key" in headersSeen[0], false);
});

test("OntoGitKnowledgeBaseRepository 仅扫描指定项目的工作流 JSON", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  const template = createValidWorkflowSource();

  repository.getJsonFileTimelines = async (projectId) => {
    if (projectId === "demo") {
      return [{ filename: "graph-source/domain/demo-entity.json" }];
    }
    if (projectId === "kimi") {
      return [{ filename: "graph-source/domain/kimi-entity.json" }];
    }
    return [];
  };

  repository.readProjectFile = async (projectId, filename) => {
    const entityId = filename.includes("kimi") ? "entity_kimi" : "entity_demo";
    const entityName = filename.includes("kimi") ? "实体Kimi" : "实体Demo";
    return {
      ...template,
      ontology: {
        ...template.ontology,
        project_id: projectId,
        entity_id: entityId,
        entity_name: entityName,
      },
      entity: {
        ...template.entity,
        id: entityId,
        name: entityName,
      },
    };
  };

  const demoGraph = await repository.getKnowledgeGraph("demo");
  const kimiGraph = await repository.getKnowledgeGraph("kimi");

  assert.deepEqual(Object.keys(demoGraph.entity_index), ["demo:entity_demo"]);
  assert.deepEqual(Object.keys(kimiGraph.entity_index), ["kimi:entity_kimi"]);
});

test("OntoGitKnowledgeBaseRepository 会保留首个实体并显式暴露重复 id 冲突", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  const first = createWorkflowEntitySource({
    entityId: "ent_entity_1",
    entityName: "鱼家——智能养鱼系统",
  });
  const second = createWorkflowEntitySource({
    entityId: "ent_entity_1",
    entityName: "微信小程序",
  });

  repository.getJsonFileTimelines = async () => ([
    { filename: "a.json" },
    { filename: "b.json" },
  ]);
  repository.readProjectFile = async (projectId, filename) => (filename === "a.json" ? first : second);

  const graph = await repository.getKnowledgeGraph("demo");

  assert.equal(graph.statistics.total_entities, 1);
  assert.equal(graph.statistics.duplicate_entity_groups, 1);
  assert.equal(graph.statistics.duplicate_entity_records, 1);
  assert.equal(graph.entity_index["demo:ent_entity_1"].name, "鱼家——智能养鱼系统");
  assert.deepEqual(graph.entity_id_conflicts[0].filenames, ["a.json", "b.json"]);
  assert.deepEqual(graph.entity_id_conflicts[0].entity_names, ["鱼家——智能养鱼系统", "微信小程序"]);
});

test("OntoGitKnowledgeBaseRepository 会把小故判定概率挂到图谱实体上", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();

  repository.getJsonFileTimelines = async () => ([
    { filename: "entity-a.json" },
  ]);
  repository.readProjectFile = async () => createWorkflowEntitySource({
    entityId: "ent_entity_1",
    entityName: "核心能力A",
    ablation: {
      entity_id: "ent_entity_1",
      entity_name: "核心能力A",
      keep_probability: "88%",
      remove_probability: "34%",
      probability_gap: "54%",
      judge_reason: "核心能力移除后系统明显失稳",
      small_reason: true,
    },
  });

  const graph = await repository.getKnowledgeGraph("demo");
  const entity = graph.entity_index["demo:ent_entity_1"];

  assert.equal(entity?.ablation?.keep_probability, "88%");
  assert.equal(entity?.ablation?.remove_probability, "34%");
  assert.equal(entity?.ablation?.probability_gap, "54%");
});

test("OntoGitKnowledgeBaseRepository 扫描工作流实体时会限流并重试瞬时失败", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  const attempts = new Map();
  let active = 0;
  let maxActive = 0;

  repository.getJsonFileTimelines = async () => ([
    { filename: "a.json" },
    { filename: "b.json" },
    { filename: "c.json" },
    { filename: "d.json" },
    { filename: "e.json" },
  ]);

  repository.readProjectFile = async (projectId, filename) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const count = attempts.get(filename) || 0;
      attempts.set(filename, count + 1);
      if ((filename === "b.json" || filename === "d.json") && count === 0) {
        throw new Error("transient fetch failed");
      }
      return createWorkflowEntitySource({
        projectId,
        entityId: `entity_${filename[0]}`,
        entityName: `实体${filename[0]}`,
      });
    } finally {
      active -= 1;
    }
  };

  const records = await repository.scanWorkflowEntityRecords("demo", null, {
    concurrency: 2,
    retryCount: 1,
    retryDelayMs: 0,
  });

  assert.equal(records.length, 5);
  assert.ok(maxActive <= 2);
  assert.equal(attempts.get("b.json"), 2);
  assert.equal(attempts.get("d.json"), 2);
});

test("OntoGitKnowledgeBaseRepository 会把不存在项目的 timelines 视为空列表", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  repository.fetchGatewayJson = async () => {
    const error = new Error("project not found");
    error.status = 404;
    throw error;
  };

  const timelines = await repository.getJsonFileTimelines("missing-project");
  assert.deepEqual(timelines, []);
});

test("OntoGitKnowledgeBaseRepository 会在版本签名变化时自动失效缓存", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  let revision = 1;
  let readCount = 0;

  repository.getJsonFileTimelines = async () => [
    {
      filename: "graph-source/domain/demo-entity.json",
      latest_commit_id: `commit-${revision}`,
      latest_version_id: revision,
      commits: [
        {
          commit_id: `commit-${revision}`,
          version_id: revision,
        },
      ],
    },
  ];

  repository.readProjectFile = async () => {
    readCount += 1;
    return {
      source: "linear-workflow",
      ontology: {
        workflow_version: "v1-linear-file-workflow",
        generated_at: "2026-04-25T00:00:00Z",
        project_id: "demo",
        scope: "entity",
        entity_id: "entity_a",
        entity_name: revision === 1 ? "实体A-旧版" : "实体A-新版",
        system_summary: {
          entity_count: 1,
          relation_count: 0,
          ablation_count: 0,
        },
        entity: {
          id: "entity_a",
          name: revision === 1 ? "实体A-旧版" : "实体A-新版",
          summary: "摘要",
          type: "capability",
          level: 1,
          source: "linear-workflow",
          properties: {},
          abilities: [],
          citations: [],
        },
        relations: [],
        ablation: null,
      },
      entity: {
        id: "entity_a",
        name: revision === 1 ? "实体A-旧版" : "实体A-新版",
        summary: "摘要",
        type: "capability",
        level: 1,
        source: "linear-workflow",
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
    };
  };

  const firstGraph = await repository.getKnowledgeGraph("demo");
  revision = 2;
  const secondGraph = await repository.getKnowledgeGraph("demo");

  assert.equal(readCount, 2);
  assert.equal(firstGraph.entity_index["demo:entity_a"].name, "实体A-旧版");
  assert.equal(secondGraph.entity_index["demo:entity_a"].name, "实体A-新版");
});

test("OntoGitKnowledgeBaseRepository 会复用同一项目同一版本签名的缓存", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  let readCount = 0;

  repository.getJsonFileTimelines = async () => [
    {
      filename: "graph-source/domain/demo-entity.json",
      latest_commit_id: "commit-1",
      latest_version_id: 1,
      commits: [
        {
          commit_id: "commit-1",
          version_id: 1,
        },
      ],
    },
  ];

  repository.readProjectFile = async () => {
    readCount += 1;
    return createWorkflowEntitySource({
      entityId: "entity_a",
      entityName: "实体A",
    });
  };

  const firstGraph = await repository.getKnowledgeGraph("demo");
  const secondGraph = await repository.getKnowledgeGraph("demo");

  assert.equal(readCount, 1);
  assert.equal(firstGraph.entity_index["demo:entity_a"].name, "实体A");
  assert.strictEqual(firstGraph, secondGraph);
});

test("OntoGitKnowledgeBaseRepository 会将知识图谱快照写入磁盘并在新实例中复用", async () => {
  await withTempCacheDir(async (cacheDir) => {
    let readCount = 0;
    const timelines = [
      {
        filename: "graph-source/domain/demo-entity.json",
        latest_commit_id: "commit-1",
        latest_version_id: 1,
        commits: [
          {
            commit_id: "commit-1",
            version_id: 1,
          },
        ],
      },
    ];

    const createRepository = () => new OntoGitKnowledgeBaseRepository({ cacheDir });

    const firstRepository = createRepository();
    firstRepository.getJsonFileTimelines = async () => timelines;
    firstRepository.readProjectFile = async () => {
      readCount += 1;
      return createWorkflowEntitySource({
        entityId: "entity_a",
        entityName: "实体A",
      });
    };

    const firstGraph = await firstRepository.getKnowledgeGraph("demo");

    assert.equal(readCount, 1);
    assert.equal(firstGraph.entity_index["demo:entity_a"].name, "实体A");

    const secondRepository = createRepository();
    secondRepository.getJsonFileTimelines = async () => timelines;
    secondRepository.readProjectFile = async () => {
      throw new Error("disk cache should avoid rescanning files");
    };

    const secondGraph = await secondRepository.getKnowledgeGraph("demo");

    assert.equal(secondGraph.entity_index["demo:entity_a"].name, "实体A");
    assert.equal(secondGraph.statistics.total_entities, 1);
  });
});

test("OntoGitKnowledgeBaseRepository 会在磁盘快照 fingerprint 变化时重新重建", async () => {
  await withTempCacheDir(async (cacheDir) => {
    let revision = 1;
    let readCount = 0;
    const createRepository = () => new OntoGitKnowledgeBaseRepository({ cacheDir });

    const createTimelines = () => ([
      {
        filename: "graph-source/domain/demo-entity.json",
        latest_commit_id: `commit-${revision}`,
        latest_version_id: revision,
        commits: [
          {
            commit_id: `commit-${revision}`,
            version_id: revision,
          },
        ],
      },
    ]);

    const firstRepository = createRepository();
    firstRepository.getJsonFileTimelines = async () => createTimelines();
    firstRepository.readProjectFile = async () => createWorkflowEntitySource({
      entityId: "entity_a",
      entityName: revision === 1 ? "实体A-旧版" : "实体A-新版",
    });

    const firstGraph = await firstRepository.getKnowledgeGraph("demo");
    assert.equal(firstGraph.entity_index["demo:entity_a"].name, "实体A-旧版");

    revision = 2;
    const secondRepository = createRepository();
    secondRepository.getJsonFileTimelines = async () => createTimelines();
    secondRepository.readProjectFile = async () => {
      readCount += 1;
      return createWorkflowEntitySource({
        entityId: "entity_a",
        entityName: "实体A-新版",
      });
    };

    const secondGraph = await secondRepository.getKnowledgeGraph("demo");

    assert.equal(readCount, 1);
    assert.equal(secondGraph.entity_index["demo:entity_a"].name, "实体A-新版");
  });
});

test("OntoGitKnowledgeBaseRepository 会缓存同一 project 和同一 refs 的切片结果", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  let readCount = 0;

  repository.getJsonFileTimelines = async () => [
    {
      filename: "graph-source/domain/demo-entity.json",
      latest_commit_id: "commit-1",
      latest_version_id: 1,
      commits: [
        {
          commit_id: "commit-1",
          version_id: 1,
        },
      ],
    },
  ];

  repository.readProjectFile = async (projectId) => {
    readCount += 1;
    return createWorkflowEntitySource({
      projectId,
      entityId: "entity_a",
      entityName: "实体A",
    });
  };

  const firstSlice = await repository.getKnowledgeGraphSlice(["demo:entity_a"], "demo");
  const secondSlice = await repository.getKnowledgeGraphSlice(["demo:entity_a"], "demo");

  assert.equal(readCount, 1);
  assert.strictEqual(firstSlice, secondSlice);
  assert.deepEqual(firstSlice.viewedRefs, ["demo:entity_a"]);
  assert.deepEqual(firstSlice.entities.map((entity) => entity.id), ["demo:entity_a"]);
});

test("OntoGitKnowledgeBaseRepository 会在 project fingerprint 变化时重新生成切片", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  let revision = 1;

  repository.getJsonFileTimelines = async () => [
    {
      filename: "graph-source/domain/demo-entity.json",
      latest_commit_id: `commit-${revision}`,
      latest_version_id: revision,
      commits: [
        {
          commit_id: `commit-${revision}`,
          version_id: revision,
        },
      ],
    },
  ];

  repository.readProjectFile = async () => createWorkflowEntitySource({
    entityId: "entity_a",
    entityName: revision === 1 ? "实体A-旧版" : "实体A-新版",
  });

  const firstSlice = await repository.getKnowledgeGraphSlice(["demo:entity_a"], "demo");
  revision = 2;
  const secondSlice = await repository.getKnowledgeGraphSlice(["demo:entity_a"], "demo");

  assert.equal(firstSlice.entities[0].name, "实体A-旧版");
  assert.equal(secondSlice.entities[0].name, "实体A-新版");
  assert.notStrictEqual(firstSlice, secondSlice);
});

test("OntoGitKnowledgeBaseRepository 会在无关 timeline 变化时复用磁盘快照并跳过重扫", async () => {
  await withTempCacheDir(async (cacheDir) => {
    let metaRevision = 1;
    const scannedFiles = [];
    const createRepository = () => new OntoGitKnowledgeBaseRepository({ cacheDir });

    const createTimelines = () => ([
      {
        filename: "graph-source/domain/demo-entity.json",
        latest_commit_id: "commit-entity-1",
        latest_version_id: 1,
        commits: [
          {
            commit_id: "commit-entity-1",
            version_id: 1,
          },
        ],
      },
      {
        filename: "project_meta.json",
        latest_commit_id: `commit-meta-${metaRevision}`,
        latest_version_id: metaRevision,
        commits: [
          {
            commit_id: `commit-meta-${metaRevision}`,
            version_id: metaRevision,
          },
        ],
      },
    ]);

    const firstRepository = createRepository();
    firstRepository.getJsonFileTimelines = async () => createTimelines();
    firstRepository.readProjectFile = async (projectId, filename) => {
      scannedFiles.push(filename);
      return createWorkflowEntitySource({
        projectId,
        entityId: "entity_a",
        entityName: "实体A",
      });
    };

    const firstGraph = await firstRepository.getKnowledgeGraph("demo");

    assert.deepEqual(scannedFiles, ["graph-source/domain/demo-entity.json"]);
    assert.equal(firstGraph.entity_index["demo:entity_a"].name, "实体A");

    metaRevision = 2;
    scannedFiles.length = 0;

    const secondRepository = createRepository();
    secondRepository.getJsonFileTimelines = async () => createTimelines();
    secondRepository.readProjectFile = async () => {
      throw new Error("无关 timeline 变化不应触发实体文件重扫");
    };

    const secondGraph = await secondRepository.getKnowledgeGraph("demo");

    assert.deepEqual(scannedFiles, []);
    assert.equal(secondGraph.entity_index["demo:entity_a"].name, "实体A");
    assert.equal(secondGraph.statistics.total_entities, 1);
  });
});

test("OntoGitKnowledgeBaseRepository 会在单个实体文件变化时仅重建变化文件", async () => {
  await withTempCacheDir(async (cacheDir) => {
    let bRevision = 1;
    const scannedFiles = [];
    const createRepository = () => new OntoGitKnowledgeBaseRepository({ cacheDir });

    const createTimelines = () => ([
      {
        filename: "graph-source/domain/a.json",
        latest_commit_id: "commit-a-1",
        latest_version_id: 1,
        commits: [
          {
            commit_id: "commit-a-1",
            version_id: 1,
          },
        ],
      },
      {
        filename: "graph-source/domain/b.json",
        latest_commit_id: `commit-b-${bRevision}`,
        latest_version_id: bRevision,
        commits: [
          {
            commit_id: `commit-b-${bRevision}`,
            version_id: bRevision,
          },
        ],
      },
    ]);

    const firstRepository = createRepository();
    firstRepository.getJsonFileTimelines = async () => createTimelines();
    firstRepository.readProjectFile = async (projectId, filename) => {
      scannedFiles.push(filename);
      if (filename.endsWith("/a.json")) {
        return createWorkflowEntitySource({
          projectId,
          entityId: "entity_a",
          entityName: "实体A",
        });
      }

      return createWorkflowEntitySource({
        projectId,
        entityId: "entity_b",
        entityName: "实体B-旧版",
      });
    };

    const firstGraph = await firstRepository.getKnowledgeGraph("demo");

    assert.deepEqual(scannedFiles, [
      "graph-source/domain/a.json",
      "graph-source/domain/b.json",
    ]);
    assert.equal(firstGraph.entity_index["demo:entity_a"].name, "实体A");
    assert.equal(firstGraph.entity_index["demo:entity_b"].name, "实体B-旧版");

    bRevision = 2;
    scannedFiles.length = 0;

    const secondRepository = createRepository();
    secondRepository.getJsonFileTimelines = async () => createTimelines();
    secondRepository.readProjectFile = async (projectId, filename) => {
      scannedFiles.push(filename);
      if (filename.endsWith("/a.json")) {
        throw new Error("未变化的实体文件应直接复用快照");
      }

      return createWorkflowEntitySource({
        projectId,
        entityId: "entity_b",
        entityName: "实体B-新版",
      });
    };

    const secondGraph = await secondRepository.getKnowledgeGraph("demo");

    assert.deepEqual(scannedFiles, ["graph-source/domain/b.json"]);
    assert.equal(secondGraph.entity_index["demo:entity_a"].name, "实体A");
    assert.equal(secondGraph.entity_index["demo:entity_b"].name, "实体B-新版");
    assert.equal(secondGraph.statistics.total_entities, 2);
  });
});

test("OntoGitKnowledgeBaseRepository 的 gateway 登录会在超时后失败并清理挂起的 Promise", async () => {
  const repository = new OntoGitKnowledgeBaseRepository({
    gatewayBaseUrl: "http://127.0.0.1:8080",
    authUsername: "mogong",
    authPassword: "123456",
  });
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.fetch = async (_url, init = {}) => {
    fetchCalls += 1;
    const signal = init.signal;

    return await new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
        return;
      }

      signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  };
  globalThis.setTimeout = (handler, timeout, ...args) => originalSetTimeout(handler, 0, ...args);
  globalThis.clearTimeout = originalClearTimeout;

  try {
    await assert.rejects(
      () => repository.ensureGatewayLogin(),
      /gateway 登录请求超时/,
    );
    assert.equal(repository.gatewayLoginPromise, null);

    await assert.rejects(
      () => repository.ensureGatewayLogin(),
      /gateway 登录请求超时/,
    );
    assert.equal(fetchCalls, 2);
    assert.equal(repository.gatewayLoginPromise, null);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("OntoGitKnowledgeBaseRepository 会按项目粒度失效缓存", () => {
  const repository = new OntoGitKnowledgeBaseRepository();

  repository.setCachedProjectDataset("project-a", { fingerprint: "a" });
  repository.setCachedProjectDataset("project-b", { fingerprint: "b" });
  repository.pendingDatasetLoads.set("project-a\u001fload-a", Promise.resolve({}));
  repository.pendingDatasetLoads.set("project-b\u001fload-b", Promise.resolve({}));

  repository.invalidateCache("project-a");

  assert.equal(repository.cacheByProject.has("project-a"), false);
  assert.equal(repository.cacheByProject.has("project-b"), true);
  assert.equal(repository.pendingDatasetLoads.has("project-a\u001fload-a"), false);
  assert.equal(repository.pendingDatasetLoads.has("project-b\u001fload-b"), true);
  assert.equal(repository.skipDiskCacheProjects.has("project-a"), true);
  assert.equal(repository.skipDiskCacheProjects.has("project-b"), false);
});

test("OntoGitKnowledgeBaseRepository 只保留最近使用的项目缓存", () => {
  const repository = new OntoGitKnowledgeBaseRepository();

  for (let index = 0; index < 6; index += 1) {
    repository.setCachedProjectDataset(`project-${index}`, { fingerprint: `${index}` });
  }

  assert.equal(repository.cacheByProject.size, 6);
  repository.getCachedProjectDataset("project-0");
  repository.setCachedProjectDataset("project-6", { fingerprint: "6" });

  assert.equal(repository.cacheByProject.size, 6);
  assert.equal(repository.cacheByProject.has("project-1"), false);
  assert.equal(repository.cacheByProject.has("project-0"), true);
  assert.equal(repository.cacheByProject.has("project-6"), true);
});
