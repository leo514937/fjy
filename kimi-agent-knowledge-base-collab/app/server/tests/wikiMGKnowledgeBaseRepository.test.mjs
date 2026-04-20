import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WikiMGKnowledgeBaseRepository } from "../repositories/wikiMGKnowledgeBaseRepository.mjs";
import { KnowledgeBaseService } from "../services/knowledgeBaseService.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../../../knowledge-data");
const wikimgCodeRoot = path.resolve(__dirname, "../../../../Ontology_Factory");
const wikimgScriptPath = path.join(wikimgCodeRoot, "WIKI_MG", "wikimg");
const ontoGitStorageRoot = await mkdtemp(path.join(os.tmpdir(), "wikimg-store-test-"));

function createRepository() {
  return new WikiMGKnowledgeBaseRepository({
    workspaceRoot,
    profile: "kimi",
    wikimgScriptPath,
    pythonBin: process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"),
    ontoGitStorageRoot,
  });
}

test("WikiMG repository exports kimi-compatible knowledge graph", async () => {
  const repository = createRepository();

  const knowledgeGraph = await repository.getKnowledgeGraph();
  assert.ok(knowledgeGraph.statistics.total_entities >= 10);
  assert.ok(knowledgeGraph.statistics.total_relations >= 10);
  assert.deepEqual(knowledgeGraph.statistics.layers, ["common", "domain", "private"]);
  assert.ok(knowledgeGraph.statistics.layer_counts.private >= 1);
  assert.ok(knowledgeGraph.entity_index["domain:kimi-demo/智能养鱼系统概览"]);
  assert.ok(knowledgeGraph.entity_index["domain:kimi-demo/光照监测"]);
  assert.equal(knowledgeGraph.entity_index["domain:kimi-demo/光照监测"].layer, "domain");
  assert.ok(Array.isArray(knowledgeGraph.entity_index["common:kimi-demo/遥测字段规范"].formatted_sections));
  assert.ok(
    knowledgeGraph.entity_index["common:kimi-demo/遥测字段规范"].formatted_sections.some(
      (section) => section.title === "字段模板"
    )
  );

  const searchHits = await repository.searchEntities("光照");
  assert.ok(searchHits.some((item) => item.name === "光照监测"));

  const privateHits = await repository.searchEntities("private");
  assert.ok(privateHits.some((item) => item.layer === "private"));

  const related = await repository.getRelatedEntities("domain:kimi-demo/智能养鱼系统概览");
  assert.ok(related.length >= 3);

  const about = await repository.getAboutContent();
  assert.equal(about.platform.name, "WiKiMG 文件真源知识平台");

  const education = await repository.getEducationContent();
  assert.equal(education.featured_topic.title, "怎样把 Markdown 文档变成可检索的知识工作台？");
});

test("WikiMG repository can build a markdown graph slice without export cache", async () => {
  const repository = createRepository();

  const slice = await repository.getKnowledgeGraphSlice([
    "common:kimi-demo/控制安全规则",
    "common:kimi-demo/遥测字段规范",
  ]);

  assert.deepEqual(slice.viewedRefs, [
    "common:kimi-demo/控制安全规则",
    "common:kimi-demo/遥测字段规范",
  ]);
  assert.deepEqual(slice.missingRefs, []);
  assert.ok(slice.entities.some((entity) => entity.id === "common:kimi-demo/控制安全规则"));
  assert.ok(slice.entities.some((entity) => entity.id === "common:kimi-demo/遥测字段规范"));
  assert.ok(
    slice.crossReferences.some(
      (edge) =>
        edge.source === "common:kimi-demo/控制安全规则"
        && edge.target === "common:kimi-demo/遥测字段规范",
    )
  );
});

test("KnowledgeBaseService keeps existing response shapes on top of wikimg provider", async () => {
  const repository = createRepository();
  const service = new KnowledgeBaseService(repository);
  const previousProvider = process.env.KNOWLEDGE_BASE_PROVIDER;
  process.env.KNOWLEDGE_BASE_PROVIDER = "wikimg";

  try {
    const analysis = await service.getAnalysis("光照监测", "domain:kimi-demo/光照监测");
    assert.equal(analysis.entity_name, "光照监测");
    assert.ok(Array.isArray(analysis.ontology_breakdown.relations));
    assert.ok(analysis.ontology_breakdown.formalization.RDF.includes("光照监测"));

    const system = await service.getSystemAnalysis("自动投喂", "domain:kimi-demo/自动投喂");
    assert.equal(system.entity, "自动投喂");
    assert.ok(Array.isArray(system.hierarchy.subsystems));

    const workspace = await service.getEditorWorkspace("domain:kimi-demo/onenet接入");
    assert.equal(workspace.name, "Onenet 接入");
    assert.ok(Array.isArray(workspace.suggestions.suggested_relations));

    const context = await service.collectChatContext("请解释光照监测和系统之间的关系", "domain:kimi-demo/光照监测");
    assert.equal(context.entity?.name, "光照监测");
    assert.ok(Array.isArray(context.relatedDocuments));

    const about = await service.getAboutContent();
    assert.equal(about.metrics.provider, "wikimg");
    assert.ok(about.metrics.entities >= 10);
    assert.equal(about.metrics.layers, 3);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.KNOWLEDGE_BASE_PROVIDER;
    } else {
      process.env.KNOWLEDGE_BASE_PROVIDER = previousProvider;
    }
  }
});

test("WikiMG repository can normalize JSON drafts through ingest", async () => {
  const repository = createRepository();

  const payload = await repository.ingestSource({
    mode: "json",
    layer: "domain",
    slug: "kimi-demo/salinity-monitoring",
    source: {
      title: "盐度监测",
      page_kind: "entity",
      type: "监测能力",
      domain: "智能养鱼",
      level: 2,
      source: "unit-test",
      summary: "用于持续跟踪水体盐度变化。",
      properties: {
        指标: ["salinity"],
      },
      relations: [
        {
          target: "domain:kimi-demo/智能养鱼系统概览",
          type: "组成部分",
          description: "盐度监测属于系统环境感知的一部分。",
        },
      ],
      sections: {
        定义与定位: "用于持续跟踪水体盐度变化，并为告警提供依据。",
        属性: ["指标: salinity"],
        证据来源: ["单元测试样例。"],
        关联主题: ["智能养鱼系统概览"],
      },
    },
  });

  assert.equal(payload.ref, "domain:kimi-demo/salinity-monitoring");
  assert.equal(payload.title, "盐度监测");
  assert.match(payload.markdown, /## 定义与定位/);
  assert.deepEqual(payload.warnings, []);
});

test("WikiMG repository lets wikimg infer layer when omitted", async () => {
  const repository = createRepository();

  const payload = await repository.ingestSource({
    mode: "json",
    slug: "kimi-demo/control-safety-rules",
    source: {
      title: "控制安全规则",
      page_kind: "entity",
      type: "共享规则",
      domain: "远程控制",
      level: 1,
      source: "unit-test",
      summary: "远程控制命令需要确认、授权和回滚流程。",
      properties: {
        职责: "约束远程控制命令的授权流程",
      },
      sections: {
        定义与定位: "用于定义远程控制命令的安全边界。",
        证据来源: ["单元测试样例。"],
      },
    },
  });

  assert.equal(payload.ref, "common:kimi-demo/control-safety-rules");
  assert.equal(payload.layer, "common");
  assert.match(payload.warnings.join("\n"), /common/);
});

test("WikiMG repository can normalize batch JSON items into multiple layers", async () => {
  const repository = createRepository();

  const payload = await repository.ingestSource({
    mode: "json",
    slug: "kimi-demo",
    source: {
      items: [
        {
          title: "遥测字段规范",
          layer: "common",
          page_kind: "entity",
          type: "共享规范",
          domain: "平台接入",
          level: 1,
          source: "unit-test",
          sections: {
            定义与定位: "统一遥测字段命名。",
            证据来源: ["单元测试样例。"],
          },
        },
        {
          title: "远程控制规则",
          page_kind: "entity",
          type: "控制规则",
          domain: "远程控制",
          level: 2,
          source: "unit-test",
          sections: {
            定义与定位: "约束远程控制命令。",
            证据来源: ["单元测试样例。"],
          },
        },
        {
          title: "内部演练记录",
          visibility: "private",
          page_kind: "entity",
          type: "实验记录",
          domain: "远程控制",
          level: 3,
          source: "unit-test",
          sections: {
            定义与定位: "记录内部演练过程。",
            证据来源: ["单元测试样例。"],
          },
        },
      ],
    },
  });

  assert.equal(payload.batch, true);
  assert.deepEqual(payload.layer_counts, { common: 1, domain: 1, private: 1 });
  assert.deepEqual(
    payload.items.map((item) => item.ref),
    [
      "common:kimi-demo/遥测字段规范",
      "domain:kimi-demo/远程控制规则",
      "private:kimi-demo/内部演练记录",
    ],
  );
});
