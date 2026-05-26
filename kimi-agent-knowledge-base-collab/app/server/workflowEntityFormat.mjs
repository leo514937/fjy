function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasOnlyKeys(record, allowedKeys) {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

function validateStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    return `${fieldName} 必须是数组`;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!asText(value[index])) {
      return `${fieldName}[${index}] 必须是非空字符串`;
    }
  }
  return "";
}

function validateRelation(item, index) {
  const relation = asObject(item);
  if (!relation) {
    return `relations[${index}] 必须是对象`;
  }

  const required = [
    "source_entity_id",
    "target_entity_id",
    "source_name",
    "target_name",
    "relation_type",
  ];
  for (const field of required) {
    if (!asText(relation[field])) {
      return `relations[${index}].${field} 必须是非空字符串`;
    }
  }
  return "";
}

export function validateWorkflowEntityFileData(data) {
  const root = asObject(data);
  if (!root) {
    return { ok: false, error: "data 必须是 JSON 对象" };
  }

  const topLevelKeys = [
    "source",
    "ontology",
    "entity",
    "relations",
    "ablation",
    "precheck",
    "ontology_summary",
    "probability",
  ];
  if (!hasOnlyKeys(root, topLevelKeys)) {
    return { ok: false, error: "data 只能包含 source、ontology、entity、relations、ablation、precheck、ontology_summary、probability" };
  }

  if (!asText(root.source)) {
    return { ok: false, error: "data.source 必须是非空字符串" };
  }

  const ontology = asObject(root.ontology);
  if (!ontology) {
    return { ok: false, error: "data.ontology 必须是对象" };
  }

  const ontologyKeys = [
    "workflow_version",
    "generated_at",
    "project_id",
    "scope",
    "entity_id",
    "entity_name",
    "system_summary",
    "entity",
    "relations",
    "ablation",
  ];
  if (!hasOnlyKeys(ontology, ontologyKeys)) {
    return { ok: false, error: "data.ontology 只能包含 workflow_version、generated_at、project_id、scope、entity_id、entity_name、system_summary、entity、relations、ablation" };
  }

  if (asText(ontology.scope) !== "entity") {
    return { ok: false, error: "data.ontology.scope 必须是 entity" };
  }

  const ontologyRequired = [
    "workflow_version",
    "generated_at",
    "project_id",
    "entity_id",
    "entity_name",
  ];
  for (const field of ontologyRequired) {
    if (!asText(ontology[field])) {
      return { ok: false, error: `data.ontology.${field} 必须是非空字符串` };
    }
  }

  const entity = asObject(root.entity);
  if (!entity) {
    return { ok: false, error: "data.entity 必须是对象" };
  }

  const entityKeys = ["id", "name", "summary", "type", "level", "source", "properties", "abilities", "citations"];
  if (!hasOnlyKeys(entity, entityKeys)) {
    return { ok: false, error: "data.entity 只能包含 id、name、summary、type、level、source、properties、abilities、citations" };
  }

  if (!asText(entity.id) || !asText(entity.name)) {
    return { ok: false, error: "data.entity.id 和 data.entity.name 必须是非空字符串" };
  }

  if (!asText(entity.summary)) {
    return { ok: false, error: "data.entity.summary 必须是非空字符串" };
  }
  if (!asText(entity.type)) {
    return { ok: false, error: "data.entity.type 必须是非空字符串" };
  }
  if (!Number.isFinite(Number(entity.level))) {
    return { ok: false, error: "data.entity.level 必须是数字" };
  }
  if (!asText(entity.source)) {
    return { ok: false, error: "data.entity.source 必须是非空字符串" };
  }
  if (!asObject(entity.properties)) {
    return { ok: false, error: "data.entity.properties 必须是对象" };
  }
  const abilitiesError = validateStringArray(entity.abilities, "data.entity.abilities");
  if (abilitiesError) {
    return { ok: false, error: abilitiesError };
  }
  const citationsError = validateStringArray(entity.citations, "data.entity.citations");
  if (citationsError) {
    return { ok: false, error: citationsError };
  }

  if (asText(ontology.entity_id) !== asText(entity.id)) {
    return { ok: false, error: "data.ontology.entity_id 必须与 data.entity.id 一致" };
  }
  if (asText(ontology.entity_name) !== asText(entity.name)) {
    return { ok: false, error: "data.ontology.entity_name 必须与 data.entity.name 一致" };
  }

  if (!Array.isArray(root.relations)) {
    return { ok: false, error: "data.relations 必须是数组" };
  }

  const relationKeys = [
    "source_entity_id",
    "target_entity_id",
    "source_name",
    "target_name",
    "relation_type",
    "evidence",
  ];
  for (let i = 0; i < root.relations.length; i += 1) {
    const relation = asObject(root.relations[i]);
    if (!relation) {
      return { ok: false, error: `relations[${i}] 必须是对象` };
    }
    if (!hasOnlyKeys(relation, relationKeys)) {
      return { ok: false, error: `relations[${i}] 只能包含 source_entity_id、target_entity_id、source_name、target_name、relation_type、evidence` };
    }
  }

  for (let i = 0; i < root.relations.length; i += 1) {
    const err = validateRelation(root.relations[i], i);
    if (err) {
      return { ok: false, error: err };
    }
  }

  if (root.ablation !== null) {
    const ablation = asObject(root.ablation);
    if (!ablation) {
      return { ok: false, error: "data.ablation 必须是对象或 null" };
    }
    const ablationKeys = [
      "keep_probability",
      "remove_probability",
      "probability_gap",
      "judge_reason",
      "entity_id",
      "entity_name",
      "impact_level",
      "impact_reason",
      "system_risk",
      "remove_target",
      "retain_target",
      "keep_role",
      "remove_impact",
      "observation",
      "evidence",
      "small_reason",
    ];
    if (!hasOnlyKeys(ablation, ablationKeys)) {
      return { ok: false, error: "data.ablation 包含未支持字段" };
    }
    const hasLegacyIdentity = asText(ablation.entity_id) || asText(ablation.entity_name);
    const ablationRequired = hasLegacyIdentity
      ? ["entity_id", "entity_name"]
      : ["keep_probability", "remove_probability", "probability_gap", "judge_reason"];
    for (const field of ablationRequired) {
      if (!asText(ablation[field])) {
        return { ok: false, error: `data.ablation.${field} 必须是非空字符串` };
      }
    }
    if (ablation.small_reason !== undefined && ablation.small_reason !== true) {
      return { ok: false, error: "data.ablation.small_reason 只能在命中时写入 true" };
    }
  }

  if (root.precheck !== null) {
    const precheck = asObject(root.precheck);
    if (!precheck) {
      return { ok: false, error: "data.precheck 必须是对象或 null" };
    }
    const precheckKeys = ["entity_id", "entity_name", "precheck_probability", "precheck_reason", "raw"];
    if (!hasOnlyKeys(precheck, precheckKeys)) {
      return { ok: false, error: "data.precheck 只能包含 entity_id、entity_name、precheck_probability、precheck_reason、raw" };
    }
  }

  const ontologySummary = asObject(root.ontology_summary);
  if (!ontologySummary) {
    return { ok: false, error: "data.ontology_summary 必须是对象" };
  }

  if (root.probability !== undefined && !asText(root.probability)) {
    return { ok: false, error: "data.probability 必须是非空字符串" };
  }

  return { ok: true };
}
