export class KnowledgeBaseService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.projectId = options.projectId || "demo";
    this.sourceCommitter = options.sourceCommitter || null;
    this.wikiWriter = options.wikiWriter || null;
  }

  async getKnowledgeGraph() {
    return this.repository.getKnowledgeGraph();
  }

  async getKnowledgeGraphSlice(refs) {
    if (typeof this.repository.getKnowledgeGraphSlice === "function") {
      return this.repository.getKnowledgeGraphSlice(refs);
    }

    return {
      viewedRefs: [],
      missingRefs: Array.isArray(refs) ? refs : [],
      entities: [],
      crossReferences: [],
    };
  }

  async getOntologies() {
    return this.repository.getOntologies();
  }

  async listEntities() {
    return this.repository.listEntities();
  }

  async getEntityDetail(entityId) {
    const entity = await this.repository.getEntityById(entityId);
    if (!entity) {
      return null;
    }

    const relatedEntities = await this.repository.getRelatedEntities(entityId);
    return { entity, relatedEntities };
  }

  async searchEntities(query) {
    return this.repository.searchEntities(query);
  }

  async collectChatContext(question, entityId) {
    if (typeof this.repository.getChatContext === "function") {
      const specializedContext = await this.repository.getChatContext(question, entityId);
      if (specializedContext) {
        return specializedContext;
      }
    }

    const knowledgeGraph = await this.repository.getKnowledgeGraph();
    const entity = entityId ? knowledgeGraph.entity_index[entityId] : null;
    const related = entity ? (await this.repository.getRelatedEntities(entityId)).slice(0, 6) : [];
    const searchHits = (await this.repository.searchEntities(question)).slice(0, 8);

    return { entity, related, searchHits };
  }

  async getAnalysis(query, entityId) {
    const entityName = await this.resolveEntityName(query, entityId);
    return (await this.repository.getAnalysisRecord(entityName))
      || this.buildGenericAnalysisRecord(entityName);
  }

  async getSystemAnalysis(query, entityId) {
    const entityName = await this.resolveEntityName(query, entityId);
    return (await this.repository.getSystemRecord(entityName))
      || this.buildGenericSystemRecord(entityName);
  }

  async getEducationContent(entityId) {
    const entity = entityId ? await this.repository.getEntityById(entityId) : null;
    const content = await this.repository.getEducationContent();

    return {
      ...content,
      selected_entity_guide: entity
        ? {
          entity: entity.name,
          why_it_matters: `${entity.name} 是理解 ${entity.domain} 领域的一个高频入口，适合拿来建立整体框架。`,
          beginner_angle: `先把 ${entity.name} 当作一个“${entity.type}”来理解，再结合它的定义和相关实体去定位上下文。`,
          connected_concepts: (await this.repository.getRelatedEntities(entity.id))
            .slice(0, 4)
            .map((item) => item.name),
        }
        : content.selected_entity_guide ?? null,
    };
  }

  async getAboutContent() {
    const knowledgeGraph = await this.repository.getKnowledgeGraph();
    const baseContent = await this.repository.getAboutContent();

    return {
      ...baseContent,
      metrics: {
        provider: process.env.KNOWLEDGE_BASE_PROVIDER || "json",
        entities: knowledgeGraph.statistics.total_entities,
        relations: knowledgeGraph.statistics.total_relations,
        domains: knowledgeGraph.statistics.domains.length,
        levels: knowledgeGraph.statistics.levels.length,
        layers: Array.isArray(knowledgeGraph.statistics.layers) ? knowledgeGraph.statistics.layers.length : 0,
      },
    };
  }

  async getEditorWorkspace(entityId) {
    const entity = entityId ? await this.repository.getEntityById(entityId) : null;
    const template = await this.repository.getEditorTemplate();
    const fallbackEntity = entity || (await this.repository.listEntities())[0] || null;
    const related = fallbackEntity
      ? (await this.repository.getRelatedEntities(fallbackEntity.id)).slice(0, 4)
      : [];
    const reference = deriveEditorReference(fallbackEntity?.id, fallbackEntity?.name || template.defaults.name);
    const jsonDraft = buildJsonDraft({
      entity: fallbackEntity,
      template,
      related,
    });
    const markdownDraft = typeof this.repository.ingestSource === "function"
      ? (await this.repository.ingestSource({
          mode: "json",
          layer: reference.layer,
          slug: reference.slug,
          source: jsonDraft,
        })).markdown
      : buildFallbackMarkdownDraft(jsonDraft);

    return {
      project_id: this.projectId,
      entity_id: fallbackEntity?.id,
      name: fallbackEntity?.name || template.defaults.name,
      type: fallbackEntity?.type || template.defaults.type,
      domain: fallbackEntity?.domain || template.defaults.domain,
      source: fallbackEntity?.source || template.defaults.source,
      definition: fallbackEntity?.definition || template.defaults.definition,
      properties_text: JSON.stringify(fallbackEntity?.properties || template.defaults.properties, null, 2),
      layer: reference.layer,
      slug: reference.slug,
      json_draft: jsonDraft,
      markdown_draft: markdownDraft,
      source_filenames: {
        json: `graph-source/${reference.layer}/${reference.slug}.json`,
        markdown: `graph-source/${reference.layer}/${reference.slug}.md`,
      },
      suggestions: {
        recommended_type: fallbackEntity?.type || template.suggestions.recommended_type,
        suggested_relations: related.length > 0
          ? related.map((item) => item.name)
          : template.suggestions.suggested_relations,
        rdf_preview: `<${fallbackEntity?.name || template.defaults.name}> rdf:type <${fallbackEntity?.type || template.defaults.type}> .`,
        owl_preview: `Class: ${fallbackEntity?.name || template.defaults.name} SubClassOf: ${fallbackEntity?.domain || template.defaults.domain}`,
      },
    };
  }

  async previewEditorDraft(input) {
    if (typeof this.repository.ingestSource !== "function") {
      throw new Error("当前知识库 provider 不支持图谱入库预览");
    }

    const normalized = await this.repository.ingestSource({
      mode: input.mode,
      layer: input.layer,
      slug: input.slug,
      source: input.source,
    });
    if (normalized.batch) {
      const layerCounts = normalized.layer_counts || buildLayerCounts(normalized.items || []);
      return {
        summary: `本次将入库 ${normalized.total || 0} 条：common ${layerCounts.common || 0}、domain ${layerCounts.domain || 0}、private ${layerCounts.private || 0}。`,
        rdf: "",
        owl: "",
        warnings: normalized.warnings || [],
        normalized_markdown: (normalized.items || []).map((item) => item.markdown).join("\n---\n"),
        target_ref: `batch:${normalized.slug || input.slug || "batch-ingest"}`,
      };
    }
    const safeTitle = normalized.title?.trim() || "未命名概念";

    return {
      summary: `${safeTitle} 将写入 ${normalized.ref}，提交成功后会进入当前 WiKiMG 图谱与问答上下文。`,
      rdf: `<${safeTitle}> rdf:type <待定义类型> .`,
      owl: `Class: ${safeTitle}`,
      warnings: normalized.warnings || [],
      normalized_markdown: normalized.markdown,
      target_ref: normalized.ref,
    };
  }

  async commitEditorDraft(input) {
    if (typeof this.repository.ingestSource !== "function") {
      throw new Error("当前知识库 provider 不支持图谱入库");
    }
    if (!this.sourceCommitter || !this.wikiWriter) {
      throw new Error("图谱入库依赖未配置完整");
    }

    const normalized = await this.repository.ingestSource({
      mode: input.mode,
      layer: input.layer,
      slug: input.slug,
      source: input.source,
    });
    if (normalized.batch) {
      return this.commitBatchEditorDraft(input, normalized);
    }

    const resolvedLayer = normalized.layer || input.layer;
    const resolvedSlug = normalized.slug || input.slug;
    const resolvedRef = normalized.ref || `${resolvedLayer}:${resolvedSlug}`;
    const sourceFilename = `graph-source/${resolvedLayer}/${resolvedSlug}.${input.mode === "json" ? "json" : "md"}`;
    const sourceWrite = await this.sourceCommitter({
      projectId: input.projectId || this.projectId,
      filename: sourceFilename,
      data: input.source,
      message: input.message || `Graph editor update: ${normalized.title}`,
      agentName: "ontology-editor",
      committerName: "ontology-editor",
    });

    let wikiWrite = null;
    try {
      wikiWrite = await this.wikiWriter({
        layer: resolvedLayer,
        slug: resolvedSlug,
        markdown: normalized.markdown,
      });

      if (typeof this.repository.invalidateCache === "function") {
        this.repository.invalidateCache();
      }
      const dataset = await this.repository.loadDataset();

      return {
        status: "success",
        sourceWrite,
        wikiWrite,
        exportSummary: {
          totalEntities: dataset?.knowledgeGraph?.statistics?.total_entities || 0,
          totalRelations: dataset?.knowledgeGraph?.statistics?.total_relations || 0,
          documentCount: Array.isArray(dataset?.documents) ? dataset.documents.length : 0,
        },
        updatedEntityId: resolvedRef,
        layer: resolvedLayer,
        slug: resolvedSlug,
        ref: resolvedRef,
        warnings: normalized.warnings || [],
      };
    } catch (error) {
      return {
        status: "partial",
        sourceWrite,
        wikiWrite,
        updatedEntityId: resolvedRef,
        layer: resolvedLayer,
        slug: resolvedSlug,
        ref: resolvedRef,
        warnings: normalized.warnings || [],
        error: error instanceof Error ? error.message : "未知错误",
      };
    }
  }

  async commitBatchEditorDraft(input, normalized) {
    const batchSlug = normalized.slug || input.slug || "batch-ingest";
    const sourceFilename = `graph-source/batch/${batchSlug}.${input.mode === "json" ? "json" : "md"}`;
    const sourceWrite = await this.sourceCommitter({
      projectId: input.projectId || this.projectId,
      filename: sourceFilename,
      data: input.source,
      message: input.message || `Graph editor batch update: ${normalized.total || normalized.items?.length || 0} items`,
      agentName: "ontology-editor",
      committerName: "ontology-editor",
    });

    const wikiWrites = [];
    const failedWrites = [];
    const items = Array.isArray(normalized.items) ? normalized.items : [];

    for (const item of items) {
      try {
        const wikiWrite = await this.wikiWriter({
          layer: item.layer,
          slug: item.slug,
          markdown: item.markdown,
        });
        wikiWrites.push({
          ref: item.ref,
          layer: item.layer,
          slug: item.slug,
          title: item.title,
          wikiWrite,
          warnings: item.warnings || [],
        });
      } catch (error) {
        failedWrites.push({
          ref: item.ref,
          layer: item.layer,
          slug: item.slug,
          title: item.title,
          warnings: item.warnings || [],
          error: error instanceof Error ? error.message : "未知错误",
        });
      }
    }

    if (typeof this.repository.invalidateCache === "function") {
      this.repository.invalidateCache();
    }
    const dataset = await this.repository.loadDataset();
    const firstRef = wikiWrites[0]?.ref || failedWrites[0]?.ref || items[0]?.ref;
    const layerCounts = normalized.layer_counts || buildLayerCounts(items);
    const status = failedWrites.length > 0 ? "partial" : "success";

    return {
      status,
      batch: true,
      total: items.length,
      layerCounts,
      sourceWrite,
      wikiWrites,
      failedWrites,
      updatedEntityId: firstRef,
      ref: firstRef,
      warnings: normalized.warnings || [],
      exportSummary: {
        totalEntities: dataset?.knowledgeGraph?.statistics?.total_entities || 0,
        totalRelations: dataset?.knowledgeGraph?.statistics?.total_relations || 0,
        documentCount: Array.isArray(dataset?.documents) ? dataset.documents.length : 0,
      },
      error: failedWrites.length > 0
        ? `${failedWrites.length} 个条目写入失败`
        : undefined,
    };
  }

  async resolveEntityName(query, entityId) {
    if (entityId) {
      const entity = await this.repository.getEntityById(entityId);
      if (entity) {
        return entity.name;
      }
    }

    const matches = await this.repository.searchEntities(query);
    const exactMatch = matches.find((entity) => entity.name === query.trim());
    return exactMatch?.name || query.trim();
  }

  async buildGenericAnalysisRecord(entityName) {
    const matches = await this.repository.searchEntities(entityName);
    const entity = matches.find((item) => item.name === entityName) || null;
    const related = entity ? (await this.repository.getRelatedEntities(entity.id)).slice(0, 4) : [];

    return {
      entity_name: entityName,
      primary_level: entity?.domain || "待分析",
      secondary_levels: related
        .map((item) => item.domain)
        .filter((value, index, array) => value && array.indexOf(value) === index)
        .slice(0, 3),
      ontology_breakdown: {
        entity_level: {
          main_level: entity?.type || "待识别概念",
          physical_basis: entity?.definition || "需要进一步补充实体定义和物质基础",
          social_dimension: related.length > 0
            ? `当前知识库中与其相连的概念包括：${related.map((item) => item.name).join("、")}`
            : "当前知识库尚未记录足够的社会或系统语境",
        },
        essential_attributes: [
          {
            attribute: "核心定义",
            description: entity?.definition || "需要从知识库或外部资料补充定义",
            necessity: "必要",
          },
        ],
        accidental_attributes: [
          {
            attribute: "关联领域",
            examples: [entity?.domain || "未知领域"],
          },
        ],
        components: related.map((item) => ({
          part: item.name,
          function: item.definition,
          ontology_relation: "知识图谱关联",
        })),
        relations: related.map((item) => ({
          relation: "相关概念",
          target: item.name,
          description: item.definition,
        })),
        ontological_questions: [
          {
            question: `${entityName}在当前知识库中属于什么本体层级？`,
            discussion: entity
              ? `可先从 ${entity.domain} / ${entity.type} 角度定位，再扩展到更高层级。`
              : "当前知识库尚未直接命中该对象，需要补充数据。",
          },
        ],
        formalization: {
          RDF: `<${entityName}> rdf:type <${entity?.type || "待定义类"}> .`,
          OWL: `Class: ${entityName} SubClassOf: ${entity?.domain || "待定义"}`,
        },
      },
    };
  }

  async buildGenericSystemRecord(entityName) {
    const matches = await this.repository.searchEntities(entityName);
    const entity = matches.find((item) => item.name === entityName) || null;
    const related = entity ? (await this.repository.getRelatedEntities(entity.id)).slice(0, 4) : [];

    return {
      entity: entityName,
      holistic_properties: [
        `${entityName}作为概念节点的整体性来源于其与其他概念的关联网络`,
        "系统属性需要结合环境、边界和反馈回路一起理解",
      ],
      boundary: {
        physical: entity?.definition || "当前知识库未记录明确的物理边界",
        functional: entity ? `以 ${entity.domain} 领域中的角色与作用来界定` : "需要补充功能描述",
        cognitive: "观察者的分类方式会影响该对象被如何识别",
        dynamic: "在不同上下文中，其系统边界可能发生伸缩",
      },
      environment: {
        description: entity ? `${entityName} 当前被放置在 ${entity.domain} 领域中理解` : "当前知识库中没有足够的环境描述",
        inputs: related.length > 0 ? related.map((item) => item.name) : ["待补充输入条件"],
        outputs: ["概念解释", "系统角色", "关系定位"],
      },
      feedback: {
        negative: ["知识库定义会约束过度泛化的理解"],
        positive: ["新增关联和语境会放大该对象的系统意义"],
      },
      hierarchy: {
        subsystems: related.map((item) => item.name),
        supersystems: entity ? [entity.domain, entity.type] : ["待补充上位系统"],
      },
      emergence_examples: [
        "节点关系增多会带来更清晰的系统位置",
        "上下文丰富后会出现新的解释能力",
      ],
      systems_questions: [
        {
          question: `${entityName}的系统边界如何界定？`,
          analysis: "可以先从定义、关系和使用场景三个维度来判断。",
        },
      ],
    };
  }
}

function buildLayerCounts(items) {
  const counts = { common: 0, domain: 0, private: 0 };
  for (const item of items) {
    if (item?.layer && Object.prototype.hasOwnProperty.call(counts, item.layer)) {
      counts[item.layer] += 1;
    }
  }
  return counts;
}

function deriveEditorReference(entityId, fallbackName) {
  const rawId = String(entityId || "").trim();
  if (rawId.includes(":")) {
    const [layer, ...rest] = rawId.split(":");
    const slug = rest.join(":");
    if (layer && slug) {
      return { layer, slug };
    }
  }

  const seed = String(fallbackName || "untitled")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return {
    layer: "domain",
    slug: `draft/${seed || "untitled"}`,
  };
}

function buildJsonDraft({ entity, template, related }) {
  const properties = entity?.properties || template.defaults.properties || {};
  return {
    title: entity?.name || template.defaults.name,
    page_kind: entity?.page_kind || "entity",
    type: entity?.type || template.defaults.type,
    domain: entity?.domain || template.defaults.domain,
    level: entity?.level || 2,
    source: entity?.source || template.defaults.source,
    summary: entity?.summary || entity?.definition || template.defaults.definition,
    properties,
    relations: related.map((item) => ({
      target: item.id || item.name,
      type: "相关",
      description: item.definition || `${item.name} 与当前概念存在图谱关联。`,
    })),
    sections: {
      定义与定位: entity?.definition || template.defaults.definition,
      属性: Object.entries(properties).map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: ${value.join(", ")}`;
        }
        if (value && typeof value === "object") {
          return `${key}: ${JSON.stringify(value)}`;
        }
        return `${key}: ${String(value)}`;
      }),
      证据来源: [entity?.source || template.defaults.source],
      关联主题: related.map((item) => item.name),
    },
  };
}

function buildFallbackMarkdownDraft(jsonDraft) {
  const sections = jsonDraft.sections || {};
  return [
    "---",
    JSON.stringify({
      profile: "kimi",
      page_kind: jsonDraft.page_kind,
      title: jsonDraft.title,
      type: jsonDraft.type,
      domain: jsonDraft.domain,
      level: jsonDraft.level,
      source: jsonDraft.source,
      properties: jsonDraft.properties || {},
      relations: jsonDraft.relations || [],
    }, null, 2),
    "---",
    `# ${jsonDraft.title}`,
    "",
    `> ${jsonDraft.summary || ""}`,
    "",
    "## 定义与定位",
    sections["定义与定位"] || "",
    "",
    "## 属性",
    ...(Array.isArray(sections["属性"]) ? sections["属性"].map((item) => `- ${item}`) : []),
    "",
    "## 证据来源",
    ...(Array.isArray(sections["证据来源"]) ? sections["证据来源"].map((item) => `- ${item}`) : []),
    "",
    "## 关联主题",
    ...(Array.isArray(sections["关联主题"]) ? sections["关联主题"].map((item) => `- ${item}`) : []),
    "",
  ].join("\n");
}
