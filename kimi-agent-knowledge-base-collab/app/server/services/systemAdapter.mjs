const PROBABILITY_DECISION_RESPONSE_SCHEMA = {
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
};

const SIBLING_WORKABILITY_RESPONSE_SCHEMA = {
  name: "sibling_workability",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      sibling_findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            entity_id: { type: "string" },
            entity_name: { type: "string" },
            work_status: {
              type: "string",
              enum: ["normal", "degraded", "blocked", "unknown"],
            },
            depends_on_removed_entity: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["entity_id", "entity_name", "work_status", "depends_on_removed_entity", "reason"],
        },
      },
    },
    required: ["summary", "sibling_findings"],
  },
};

const DEPEND_ON_RELATIONS_RESPONSE_SCHEMA = {
  name: "depend_on_relations",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      relations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source: { type: "string" },
            target: { type: "string" },
            relation_type: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["source", "target", "relation_type", "evidence"],
        },
      },
    },
    required: ["relations"],
  },
};

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function attachStageDebug(error, debug = {}) {
  const baseError = error instanceof Error ? error : new Error(String(error));
  const stageOutput = {};
  if (debug.llm_raw !== undefined) {
    stageOutput.llm_raw = debug.llm_raw;
  }
  if (typeof debug.llm_raw_text === "string" && debug.llm_raw_text.trim()) {
    stageOutput.llm_raw_text = debug.llm_raw_text;
  }
  if (debug.llm_response !== undefined) {
    stageOutput.llm_response = debug.llm_response;
  }
  if (debug.llm_ensemble !== undefined) {
    stageOutput.llm_ensemble = debug.llm_ensemble;
  }
  if (typeof debug.debug_error === "string" && debug.debug_error.trim()) {
    stageOutput.debug_error = debug.debug_error;
  }
  if (Object.keys(stageOutput).length > 0) {
    baseError.stageOutput = {
      ...(baseError.stageOutput && typeof baseError.stageOutput === "object" ? baseError.stageOutput : {}),
      ...stageOutput,
    };
  }
  return baseError;
}

function extractAblationCandidates(llmResult) {
  if (Array.isArray(llmResult)) {
    return llmResult;
  }
  if (Array.isArray(llmResult?.ablation_candidates)) {
    return llmResult.ablation_candidates;
  }
  if (Array.isArray(llmResult?.candidates)) {
    return llmResult.candidates;
  }
  if (Array.isArray(llmResult?.ablation)) {
    return llmResult.ablation;
  }
  return [];
}

function resolveAblationEntity(item, entityById, entityByName) {
  const entityId = asText(item.entity_id);
  const entityName = asText(item.entity_name);
  return entityById.get(entityId) || entityByName.get(entityName) || null;
}

function normalizeAblationCandidate(raw, entityById, entityByName = new Map()) {
  const item = asRecord(raw);
  const entity = resolveAblationEntity(item, entityById, entityByName);
  if (!entity) {
    return null;
  }

  const fallbackEvidence = Array.isArray(entity.citations) && entity.citations.length > 0
    ? asText(entity.citations[0])
    : asText(entity.summary);

  return {
    entity_id: entity.id,
    entity_name: entity.name,
    remove_target: asText(item.remove_target) || entity.name,
    retain_target: asText(item.retain_target) || entity.name,
    keep_role: asText(item.keep_role) || asText(entity.summary) || `${entity.name} 负责关键能力承接`,
    remove_impact: asText(item.remove_impact) || `${entity.name} 被去除后会影响关键能力稳定性`,
    observation: asText(item.observation),
    evidence: asText(item.evidence) || fallbackEvidence,
  };
}

function normalizeDependOnRelation(raw, entityById, entityByName = new Map()) {
  const item = asRecord(raw);
  const source = asText(item.source) || asText(item.source_name) || asText(item.source_id);
  const target = asText(item.target) || asText(item.target_name) || asText(item.target_id);
  if (!source || !target || source === target) {
    return null;
  }

  const relationType = asText(item.relation_type).toLowerCase();
  if (relationType && relationType !== "depend_on" && relationType !== "depends_on" && relationType !== "依赖") {
    return null;
  }

  const sourceEntity = entityByName.get(source) || entityById.get(asText(item.source_id));
  const targetEntity = entityByName.get(target) || entityById.get(asText(item.target_id));
  if (!sourceEntity || !targetEntity) {
    return null;
  }

  return {
    source_entity_id: sourceEntity.id,
    source_name: sourceEntity.name,
    target_entity_id: targetEntity.id,
    target_name: targetEntity.name,
    relation_type: "depend_on",
    evidence: asText(item.evidence),
  };
}

function parseProbabilityValue(value) {
  const text = asText(value);
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (!matched) {
    return null;
  }
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProbabilityDecision(raw, entity, label) {
  const item = asRecord(raw);
  const probability = asText(item.probability);
  const probabilityValue = parseProbabilityValue(probability);
  if (probabilityValue === null) {
    throw new Error(`${label} 未返回可解析的 probability`);
  }

  return {
    entity_id: entity.id,
    entity_name: entity.name,
    probability,
    reason: asText(item.reason),
    probability_value: probabilityValue,
  };
}

function normalizeSiblingAnalysis(raw, siblingEntities) {
  const item = asRecord(raw);
  const siblingById = new Map(siblingEntities.map((entity) => [asText(entity.id), entity]));
  const siblingByName = new Map(siblingEntities.map((entity) => [asText(entity.name), entity]));
  const siblingFindings = Array.isArray(item.sibling_findings)
    ? item.sibling_findings
      .map((entry) => {
        const record = asRecord(entry);
        const sibling = siblingById.get(asText(record.entity_id)) || siblingByName.get(asText(record.entity_name));
        if (!sibling) {
          return null;
        }
        return {
          entity_id: asText(sibling.id),
          entity_name: asText(sibling.name),
          work_status: asText(record.work_status) || "unknown",
          depends_on_removed_entity: record.depends_on_removed_entity === true,
          reason: asText(record.reason),
        };
      })
      .filter(Boolean)
    : [];

  return {
    summary: asText(item.summary),
    sibling_findings: siblingFindings,
  };
}

export class SystemAdapter {
  constructor(options = {}) {
    this.llmJsonInvoker = typeof options.llmJsonInvoker === "function" ? options.llmJsonInvoker : null;
  }

  async generateAblationCandidates(input = {}) {
    if (!this.llmJsonInvoker) {
      throw new Error("system adapter is not configured");
    }

    const entities = Array.isArray(input.entities) ? input.entities : [];
    const relations = Array.isArray(input.relations) ? input.relations : [];
    const progressReporter = typeof input.progressReporter === "function" ? input.progressReporter : null;
    const normalizedEntities = entities.map((entity) => ({
      id: asText(entity.id),
      name: asText(entity.name),
      summary: asText(entity.summary),
      citations: Array.isArray(entity.citations) ? entity.citations.map((citation) => asText(citation)).filter(Boolean) : [],
    })).filter((entity) => entity.id && entity.name);

    try {
      const llmResult = await this.llmJsonInvoker({
        stage: "节点3-消融候选",
        instruction: [
          "你现在只负责生成消融候选 ablation_candidates，不负责计算保留概率、去除概率和概率差。",
          "ablation_candidates 的每项必须包含：entity_id、entity_name、remove_target、retain_target、keep_role、remove_impact、observation、evidence。",
          "依据与结论都要简短，以控制响应时间。",
        ].join("\n"),
        payload: {
          entities: normalizedEntities,
          relations: relations.map((relation) => ({
            source_name: asText(relation.source_name),
            target_name: asText(relation.target_name),
            relation_type: asText(relation.relation_type),
            evidence: asText(relation.evidence),
          })),
        },
        progressReporter,
      });

      const llmPayload = llmResult?.data ?? llmResult;
      const entityById = new Map(normalizedEntities.map((entity) => [entity.id, entity]));
      const entityByName = new Map(normalizedEntities.map((entity) => [entity.name, entity]));
      const candidates = extractAblationCandidates(llmPayload)
        .map((item) => normalizeAblationCandidate(item, entityById, entityByName))
        .filter(Boolean);

      return {
        candidate_count: candidates.length,
        candidates,
        llm_raw: llmResult?.llm_raw ?? llmPayload,
        llm_raw_text: asText(llmResult?.llm_raw_text),
        llm_response: llmResult?.llm_response,
        llm_ensemble: llmResult?.llm_ensemble,
      };
    } catch (error) {
      throw attachStageDebug(error, {
        llm_raw_text: asText(error?.stageOutput?.llm_raw_text),
        llm_raw: error?.stageOutput?.llm_raw,
        llm_response: error?.stageOutput?.llm_response,
        llm_ensemble: error?.stageOutput?.llm_ensemble,
        debug_error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async judgeAblationCandidate(input = {}) {
    if (!this.llmJsonInvoker) {
      throw new Error("system adapter is not configured");
    }

    const entity = asRecord(input.entity);
    const candidate = asRecord(input.candidate);
    const entities = Array.isArray(input.entities) ? input.entities : [];
    const relations = Array.isArray(input.relations) ? input.relations : [];
    const systemContext = asRecord(input.systemContext);
    const progressReporter = typeof input.progressReporter === "function" ? input.progressReporter : null;

    if (!asText(entity.id) || !asText(entity.name)) {
      throw new Error("system adapter requires a valid entity context");
    }

    const parentEntity = asRecord(systemContext.parentEntity);
    const scopedEntities = Array.isArray(systemContext.systemEntities) ? systemContext.systemEntities : entities;
    const scopedRelations = Array.isArray(systemContext.systemRelations) ? systemContext.systemRelations : relations;
    const removedEntityIds = new Set(
      Array.isArray(systemContext.removedEntityIds)
        ? systemContext.removedEntityIds.map((item) => asText(item)).filter(Boolean)
        : [asText(entity.id)],
    );
    const descendantJudges = Array.isArray(systemContext.descendantJudges)
      ? systemContext.descendantJudges.map((item) => asRecord(item)).filter((item) => asText(item.entity_id))
      : [];
    const siblingEntities = Array.isArray(systemContext.siblingEntities)
      ? systemContext.siblingEntities
        .map((item) => asRecord(item))
        .filter((item) => asText(item.id) && asText(item.name))
      : [];
    const siblingRelations = Array.isArray(systemContext.siblingRelations)
      ? systemContext.siblingRelations
        .map((relation) => asRecord(relation))
        .filter((relation) => asText(relation.source_name) && asText(relation.target_name) && asText(relation.relation_type))
      : [];
    const dependencyEntitySet = [
      entity,
      ...siblingEntities,
    ].map((item) => asRecord(item)).filter((item) => asText(item.id) && asText(item.name));
    const dependencyEntityById = new Map(dependencyEntitySet.map((item) => [asText(item.id), item]));
    const dependencyEntityByName = new Map(dependencyEntitySet.map((item) => [asText(item.name), item]));

    const focusEntity = {
      entity_id: asText(entity.id),
      entity_name: asText(entity.name),
      summary: asText(entity.summary),
      abilities: Array.isArray(entity.abilities) ? entity.abilities.map((item) => asText(item)).filter(Boolean) : [],
      citations: Array.isArray(entity.citations) ? entity.citations.map((item) => asText(item)).filter(Boolean).slice(0, 2) : [],
      keep_role: asText(candidate.keep_role),
      remove_impact: asText(candidate.remove_impact),
      observation: asText(candidate.observation),
      evidence: asText(candidate.evidence),
      parent_entity_id: asText(parentEntity.id) || asText(candidate.parent_entity_id),
      parent_entity_name: asText(parentEntity.name) || asText(candidate.parent_entity_name),
    };

    const relatedRelations = scopedRelations
      .filter((relation) => removedEntityIds.has(asText(relation.source_entity_id)) || removedEntityIds.has(asText(relation.target_entity_id)))
      .map((relation) => ({
        source_name: asText(relation.source_name),
        target_name: asText(relation.target_name),
        relation_type: asText(relation.relation_type),
        evidence: asText(relation.evidence),
      }));

    const removedSubtreeEntities = scopedEntities
      .filter((item) => removedEntityIds.has(asText(item.id)))
      .map((item) => ({
        id: asText(item.id),
        name: asText(item.name),
        summary: asText(item.summary),
        citations: Array.isArray(item.citations) ? item.citations.map((citation) => asText(citation)).filter(Boolean).slice(0, 2) : [],
      }));

    const remainingEntities = scopedEntities
      .filter((item) => asText(item.id) && !removedEntityIds.has(asText(item.id)))
      .map((item) => ({
        id: asText(item.id),
        name: asText(item.name),
        summary: asText(item.summary),
        citations: Array.isArray(item.citations) ? item.citations.map((citation) => asText(citation)).filter(Boolean).slice(0, 2) : [],
      }));

    const remainingRelations = scopedRelations
      .filter((relation) => !removedEntityIds.has(asText(relation.source_entity_id)) && !removedEntityIds.has(asText(relation.target_entity_id)))
      .map((relation) => ({
        source_name: asText(relation.source_name),
        target_name: asText(relation.target_name),
        relation_type: asText(relation.relation_type),
        evidence: asText(relation.evidence),
      }));

    let dependencyRelations = [];
    let siblingAnalysis = {
      summary: siblingEntities.length > 0 ? "" : "当前父系统没有其他兄弟节点需要评估。",
      sibling_findings: [],
    };
    let keepResult = null;
    let removeResult = null;

    try {
      if (siblingEntities.length > 0) {
        const dependencyResult = await this.llmJsonInvoker({
          stage: "小故-依赖关系",
          instruction: [
            "你是一个专业、准确的系统依赖分析专家。",
            "请围绕当前父系统的兄弟节点与被移除节点，抽取影响系统运转的 depend_on 关系。",
            "关系接口与普通 relations 相同，但 relation_type 必须统一写成 depend_on。",
            "source depend_on target 表示 source 的正常工作依赖 target。",
            "只抽取当前被移除节点与其兄弟节点之间，或兄弟节点彼此之间，对父系统成立有影响的依赖关系。",
            "输出必须严格符合 schema，只返回 JSON。",
          ].join("\n"),
          payload: {
            parent_entity: {
              id: asText(parentEntity.id) || asText(candidate.parent_entity_id),
              name: asText(parentEntity.name) || asText(candidate.parent_entity_name),
              summary: asText(parentEntity.summary),
            },
            removed_entity: {
              entity_id: focusEntity.entity_id,
              entity_name: focusEntity.entity_name,
              summary: focusEntity.summary,
            },
            sibling_entities: siblingEntities.map((item) => ({
              id: asText(item.id),
              name: asText(item.name),
              summary: asText(item.summary),
              citations: Array.isArray(item.citations) ? item.citations.map((citation) => asText(citation)).filter(Boolean).slice(0, 2) : [],
            })),
            system_entities: scopedEntities.map((item) => ({
              id: asText(item.id),
              name: asText(item.name),
              summary: asText(item.summary),
            })),
            system_relations: scopedRelations.map((relation) => ({
              source_name: asText(relation.source_name),
              target_name: asText(relation.target_name),
              relation_type: asText(relation.relation_type),
              evidence: asText(relation.evidence),
            })),
          },
          responseSchema: DEPEND_ON_RELATIONS_RESPONSE_SCHEMA,
          progressReporter: progressReporter
            ? (partialOutput) => progressReporter({
              dependency_result: partialOutput?.llm_ensemble ?? null,
              sibling_result: siblingAnalysis?.llm_ensemble ?? null,
              keep_result: keepResult?.llm_ensemble ?? null,
              remove_result: removeResult?.llm_ensemble ?? null,
            })
            : null,
        });

        const dependencyPayload = dependencyResult?.data ?? dependencyResult;
        dependencyRelations = Array.isArray(dependencyPayload?.relations)
          ? dependencyPayload.relations
            .map((item) => normalizeDependOnRelation(item, dependencyEntityById, dependencyEntityByName))
            .filter(Boolean)
          : [];
        dependencyRelations.llm_raw = dependencyResult?.llm_raw ?? dependencyResult?.data ?? dependencyResult;
        dependencyRelations.llm_raw_text = asText(dependencyResult?.llm_raw_text);
        dependencyRelations.llm_response = dependencyResult?.llm_response;
        dependencyRelations.llm_ensemble = dependencyResult?.llm_ensemble;
      }

      if (siblingEntities.length > 0) {
        const siblingResult = await this.llmJsonInvoker({
          stage: "小故-兄弟工作性",
          instruction: [
            "你是一个专业、准确的系统依赖分析专家。",
            "你现在评估的是父系统中的兄弟节点在移除当前节点/子树后的可工作性。",
            "主目标仍然是父系统是否成立，但你必须先逐个判断剩余兄弟节点是否还能正常工作，并总结这对父系统的影响。",
            "请优先识别兄弟节点之间、兄弟节点与被移除节点之间的 depend_on / 依赖 / 前置支撑关系，即使输入关系里没有显式 depend_on，也可以结合摘要和证据进行谨慎推断。",
            "输出必须严格符合 schema，只返回 JSON。",
          ].join("\n"),
          payload: {
            parent_entity: {
              id: asText(parentEntity.id) || asText(candidate.parent_entity_id),
              name: asText(parentEntity.name) || asText(candidate.parent_entity_name),
              summary: asText(parentEntity.summary),
            },
            removed_entity: {
              entity_id: focusEntity.entity_id,
              entity_name: focusEntity.entity_name,
              summary: focusEntity.summary,
            },
            removed_subtree_entities: removedSubtreeEntities,
            sibling_entities: siblingEntities.map((item) => ({
              id: asText(item.id),
              name: asText(item.name),
              summary: asText(item.summary),
              citations: Array.isArray(item.citations) ? item.citations.map((citation) => asText(citation)).filter(Boolean).slice(0, 2) : [],
            })),
            sibling_relations: [...siblingRelations, ...dependencyRelations].map((relation) => ({
              source_name: asText(relation.source_name),
              target_name: asText(relation.target_name),
              relation_type: asText(relation.relation_type),
              evidence: asText(relation.evidence),
            })),
            remaining_entities: remainingEntities,
            remaining_relations: remainingRelations,
          },
          responseSchema: SIBLING_WORKABILITY_RESPONSE_SCHEMA,
          progressReporter: progressReporter
            ? (partialOutput) => progressReporter({
              dependency_result: dependencyRelations?.llm_ensemble ?? null,
              sibling_result: partialOutput?.llm_ensemble ?? null,
              keep_result: keepResult?.llm_ensemble ?? null,
              remove_result: removeResult?.llm_ensemble ?? null,
            })
            : null,
        });
        siblingAnalysis = normalizeSiblingAnalysis(
          siblingResult?.data ?? siblingResult,
          siblingEntities,
        );
        siblingAnalysis.llm_raw = siblingResult?.llm_raw ?? siblingResult?.data ?? siblingResult;
        siblingAnalysis.llm_raw_text = asText(siblingResult?.llm_raw_text);
        siblingAnalysis.llm_response = siblingResult?.llm_response;
        siblingAnalysis.llm_ensemble = siblingResult?.llm_ensemble;
      }

      keepResult = await this.llmJsonInvoker({
        stage: "小故-保留概率",
        instruction: [
          "你是一个专业、准确的本体概率判断专家。",
          "你现在评估的是一个 part_of 系统里的子节点对父节点的重要性，而不是全局图谱。",
          "父节点和它的全部后代构成当前局部系统。",
          "你现在只判断：在保留当前子节点及其子树的情况下，父系统保持完整、可成立的概率。",
          "虽然父系统成立是主目标，但你仍需参考 sibling_analysis 中的兄弟节点可工作性抽取结果。",
          "你必须根据输入中的 focus_entity、parent_entity、system_entities、system_relations、removed_subtree_entities、descendant_judges 和 sibling_analysis 综合判断后，返回最终百分比。",
          "你必须严格遵守以下规则：",
          "1. 必须返回符合 schema 的 JSON 对象，禁止输出 Markdown、代码块、额外说明或任何非 JSON 内容。",
          '2. 输出结构必须严格为 {"probability":"97%","reason":"中文原因"}，且只能包含这两个字段。',
          "3. probability 必须是百分比字符串，例如 97%、2%、100%，不得使用小数。",
          "4. reason 必须使用简短中文说明保留该子节点/子树后，父系统为何仍完整或关键。",
          "5. 即使输入信息不足、含糊、异常，也必须严格按上述 JSON 结构输出。",
        ].join("\n"),
        payload: {
          focus_entity: focusEntity,
          parent_entity: {
            id: asText(parentEntity.id) || asText(candidate.parent_entity_id),
            name: asText(parentEntity.name) || asText(candidate.parent_entity_name),
            summary: asText(parentEntity.summary),
          },
          entities: scopedEntities.map((item) => ({
            id: asText(item.id),
            name: asText(item.name),
            summary: asText(item.summary),
            citations: Array.isArray(item.citations) ? item.citations.map((citation) => asText(citation)).filter(Boolean).slice(0, 2) : [],
          })),
          relations: scopedRelations.map((relation) => ({
            source_name: asText(relation.source_name),
            target_name: asText(relation.target_name),
            relation_type: asText(relation.relation_type),
            evidence: asText(relation.evidence),
          })),
          system_entities: scopedEntities.map((item) => ({
            id: asText(item.id),
            name: asText(item.name),
            summary: asText(item.summary),
          })),
          system_relations: scopedRelations.map((relation) => ({
            source_name: asText(relation.source_name),
            target_name: asText(relation.target_name),
            relation_type: asText(relation.relation_type),
            evidence: asText(relation.evidence),
          })),
          removed_subtree_entities: removedSubtreeEntities,
          descendant_judges: descendantJudges,
          related_relations: relatedRelations,
          sibling_analysis: {
            summary: asText(siblingAnalysis.summary),
            sibling_findings: Array.isArray(siblingAnalysis.sibling_findings) ? siblingAnalysis.sibling_findings : [],
          },
        },
        responseSchema: PROBABILITY_DECISION_RESPONSE_SCHEMA,
        progressReporter: progressReporter
          ? (partialOutput) => progressReporter({
            sibling_result: siblingAnalysis?.llm_ensemble ?? null,
            keep_result: partialOutput?.llm_ensemble ?? null,
            remove_result: removeResult?.llm_ensemble ?? null,
          })
          : null,
      });

      removeResult = await this.llmJsonInvoker({
        stage: "小故-去除概率",
        instruction: [
          "你是一个专业、准确的本体概率判断专家。",
          "你现在评估的是一个 part_of 系统里的子节点对父节点的重要性，而不是全局图谱。",
          "父节点和它的全部后代构成当前局部系统。",
          "你现在只判断：在去除当前子节点及其整棵子树后，父系统仍保持完整、可成立的概率。",
          "父系统成立仍是最终目标，但必须显式参考 sibling_analysis 中的兄弟节点可工作性抽取结果。",
          "你必须根据输入中的 focus_entity、parent_entity、remaining_entities、remaining_relations、removed_subtree_entities、descendant_judges 和 sibling_analysis 综合判断后，返回最终百分比。",
          "你必须严格遵守以下规则：",
          "1. 必须返回符合 schema 的 JSON 对象，禁止输出 Markdown、代码块、额外说明或任何非 JSON 内容。",
          '2. 输出结构必须严格为 {"probability":"97%","reason":"中文原因"}，且只能包含这两个字段。',
          "3. probability 必须是百分比字符串，例如 97%、2%、100%，不得使用小数。",
          "4. reason 必须使用简短中文说明去除该子节点/子树后，父系统会失去什么。",
          "5. 即使输入信息不足、含糊、异常，也必须严格按上述 JSON 结构输出。",
        ].join("\n"),
        payload: {
          focus_entity: focusEntity,
          parent_entity: {
            id: asText(parentEntity.id) || asText(candidate.parent_entity_id),
            name: asText(parentEntity.name) || asText(candidate.parent_entity_name),
            summary: asText(parentEntity.summary),
          },
          removed_entity: {
            entity_id: focusEntity.entity_id,
            entity_name: focusEntity.entity_name,
          },
          removed_subtree_entities: removedSubtreeEntities,
          remaining_entities: remainingEntities,
          remaining_relations: remainingRelations,
          descendant_judges: descendantJudges,
          related_relations: relatedRelations,
          sibling_analysis: {
            summary: asText(siblingAnalysis.summary),
            sibling_findings: Array.isArray(siblingAnalysis.sibling_findings) ? siblingAnalysis.sibling_findings : [],
          },
        },
        responseSchema: PROBABILITY_DECISION_RESPONSE_SCHEMA,
        progressReporter: progressReporter
          ? (partialOutput) => progressReporter({
            sibling_result: siblingAnalysis?.llm_ensemble ?? null,
            keep_result: keepResult?.llm_ensemble ?? null,
            remove_result: partialOutput?.llm_ensemble ?? null,
          })
          : null,
      });
    } catch (error) {
      throw attachStageDebug(error, {
        llm_raw: {
          candidate,
          dependency_result: dependencyRelations?.llm_raw,
          sibling_result: siblingAnalysis?.llm_raw,
          keep_result: keepResult?.llm_raw ?? keepResult?.data ?? keepResult,
          remove_result: removeResult?.llm_raw ?? removeResult?.data ?? removeResult,
        },
        llm_raw_text: `${asText(dependencyRelations?.llm_raw_text)}\n${asText(siblingAnalysis?.llm_raw_text)}\n${asText(keepResult?.llm_raw_text)}\n${asText(removeResult?.llm_raw_text)}`.trim(),
        llm_response: {
          dependency_result: dependencyRelations?.llm_response,
          sibling_result: siblingAnalysis?.llm_response,
          keep_result: keepResult?.llm_response,
          remove_result: removeResult?.llm_response,
        },
        llm_ensemble: {
          dependency_result: dependencyRelations?.llm_ensemble,
          sibling_result: siblingAnalysis?.llm_ensemble,
          keep_result: keepResult?.llm_ensemble,
          remove_result: removeResult?.llm_ensemble,
        },
        debug_error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const keepDecision = normalizeProbabilityDecision(
        keepResult?.data ?? keepResult,
        entity,
        `${focusEntity.entity_name} 保留概率判断`,
      );
      const removeDecision = normalizeProbabilityDecision(
        removeResult?.data ?? removeResult,
        entity,
        `${focusEntity.entity_name} 去除概率判断`,
      );

      return {
        keepDecision,
        removeDecision,
        dependencyRelations,
        siblingAnalysis,
        focusEntity,
        relatedRelations,
        remainingEntities,
        remainingRelations,
        llm_raw: {
          dependency_result: dependencyRelations?.llm_raw,
          sibling_result: siblingAnalysis?.llm_raw,
          keep_result: keepResult?.llm_raw ?? keepResult?.data ?? keepResult,
          remove_result: removeResult?.llm_raw ?? removeResult?.data ?? removeResult,
        },
        llm_raw_text: `${asText(dependencyRelations?.llm_raw_text)}\n${asText(siblingAnalysis?.llm_raw_text)}\n${asText(keepResult?.llm_raw_text)}\n${asText(removeResult?.llm_raw_text)}`.trim(),
        llm_response: {
          dependency_result: dependencyRelations?.llm_response,
          sibling_result: siblingAnalysis?.llm_response,
          keep_result: keepResult?.llm_response,
          remove_result: removeResult?.llm_response,
        },
        llm_ensemble: {
          dependency_result: dependencyRelations?.llm_ensemble,
          sibling_result: siblingAnalysis?.llm_ensemble,
          keep_result: keepResult?.llm_ensemble,
          remove_result: removeResult?.llm_ensemble,
        },
      };
    } catch (error) {
      throw attachStageDebug(error, {
        llm_raw: {
          candidate,
          dependency_result: dependencyRelations?.llm_raw,
          sibling_result: siblingAnalysis?.llm_raw,
          keep_result: keepResult?.llm_raw ?? keepResult?.data ?? keepResult,
          remove_result: removeResult?.llm_raw ?? removeResult?.data ?? removeResult,
        },
        llm_raw_text: `${asText(dependencyRelations?.llm_raw_text)}\n${asText(siblingAnalysis?.llm_raw_text)}\n${asText(keepResult?.llm_raw_text)}\n${asText(removeResult?.llm_raw_text)}`.trim(),
        llm_response: {
          dependency_result: dependencyRelations?.llm_response,
          sibling_result: siblingAnalysis?.llm_response,
          keep_result: keepResult?.llm_response,
          remove_result: removeResult?.llm_response,
        },
        llm_ensemble: {
          dependency_result: dependencyRelations?.llm_ensemble,
          sibling_result: siblingAnalysis?.llm_ensemble,
          keep_result: keepResult?.llm_ensemble,
          remove_result: removeResult?.llm_ensemble,
        },
        debug_error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
