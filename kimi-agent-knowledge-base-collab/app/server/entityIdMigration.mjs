import { validateWorkflowEntityFileData } from "./workflowEntityFormat.mjs";

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function compareStrings(left, right) {
  const a = asText(left);
  const b = asText(right);
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function normalizeText(value) {
  return asText(value).toLowerCase();
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSlug(value, fallback = "entity") {
  const normalized = asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function buildSequentialEntityId(name, sequence) {
  return `ent_${buildSlug(name, "entity")}_${sequence}`;
}

export function extractEntitySequenceNumber(entityId) {
  const normalized = asText(entityId);
  if (!normalized) {
    return 0;
  }

  const scoped = normalized.includes(":") ? normalized.split(":").pop() : normalized;
  const match = asText(scoped).match(/_(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function isCandidateEntityFile(filename) {
  const lower = asText(filename).toLowerCase();
  if (!lower.endsWith(".json")) {
    return false;
  }
  if (lower === "project_meta.json" || lower === "init.txt") {
    return false;
  }
  return true;
}

function normalizeWorkflowEntityFileRecord(file, projectId) {
  const filename = asText(file?.filename);
  if (!filename) {
    return {
      status: "unreadable",
      filename: "",
      error: "文件名为空",
    };
  }

  const rawData = file?.data;
  const validation = validateWorkflowEntityFileData(rawData);
  if (!validation.ok) {
    return {
      status: "invalid",
      filename,
      error: validation.error,
    };
  }

  const root = asObject(rawData) || {};
  const ontology = asObject(root.ontology) || {};
  const entity = asObject(root.entity) || {};

  return {
    status: "ok",
    project_id: asText(ontology.project_id) || asText(projectId) || "demo",
    filename,
    original_entity_id: asText(entity.id),
    original_entity_name: asText(entity.name),
    data: cloneJsonValue(root),
  };
}

function collectFileRecords(files, projectId) {
  return (Array.isArray(files) ? files : [])
    .map((file) => normalizeWorkflowEntityFileRecord(file, projectId))
    .sort((left, right) => compareStrings(left.filename, right.filename));
}

function buildLookupMaps(filePlans) {
  const recordsByOriginalId = new Map();
  const recordsByName = new Map();

  for (const filePlan of filePlans) {
    if (filePlan.status !== "ok") {
      continue;
    }

    const originalId = asText(filePlan.original_entity_id);
    const nameKey = normalizeText(filePlan.original_entity_name);
    const listById = recordsByOriginalId.get(originalId) || [];
    listById.push(filePlan);
    recordsByOriginalId.set(originalId, listById);

    const listByName = recordsByName.get(nameKey) || [];
    listByName.push(filePlan);
    recordsByName.set(nameKey, listByName);
  }

  return { recordsByOriginalId, recordsByName };
}

function createEntityIdAllocator({ usedEntityIds, sequenceSeed }) {
  const taken = usedEntityIds instanceof Set ? usedEntityIds : new Set();
  let sequence = Math.max(0, Math.floor(Number(sequenceSeed) || 0));

  return (name) => {
    let candidate = "";
    do {
      sequence += 1;
      candidate = buildSequentialEntityId(name, sequence);
    } while (taken.has(candidate));
    taken.add(candidate);
    return {
      entity_id: candidate,
      sequence,
    };
  };
}

function resolveEntityReference({
  referenceId,
  referenceName,
  contextFile,
  recordsByOriginalId,
  recordsByName,
}) {
  const normalizedReferenceId = asText(referenceId);
  const normalizedReferenceName = normalizeText(referenceName);
  const normalizedContextId = asText(contextFile.original_entity_id);
  const normalizedContextName = normalizeText(contextFile.original_entity_name);

  if (!normalizedReferenceId) {
    return {
      entity_id: "",
      status: "unresolved",
      reason: "reference_id 为空",
    };
  }

  if (normalizedReferenceId === normalizedContextId && (!normalizedReferenceName || normalizedReferenceName === normalizedContextName)) {
    return {
      entity_id: asText(contextFile.final_entity_id),
      status: "self",
      reason: "",
    };
  }

  const candidates = recordsByOriginalId.get(normalizedReferenceId) || [];
  if (candidates.length === 1) {
    return {
      entity_id: asText(candidates[0].final_entity_id),
      status: "exact",
      reason: "",
    };
  }

  if (candidates.length > 1 && normalizedReferenceName) {
    const nameMatches = candidates.filter((item) => normalizeText(item.original_entity_name) === normalizedReferenceName);
    if (nameMatches.length === 1) {
      return {
        entity_id: asText(nameMatches[0].final_entity_id),
        status: "name",
        reason: "",
      };
    }
  }

  if (!candidates.length && normalizedReferenceName) {
    const byName = recordsByName.get(normalizedReferenceName) || [];
    if (byName.length === 1) {
      return {
        entity_id: asText(byName[0].final_entity_id),
        status: "name-only",
        reason: "",
      };
    }
  }

  return {
    entity_id: "",
    status: "unresolved",
    reason: candidates.length > 1
      ? `entity_id ${normalizedReferenceId} 存在多个候选项，且无法根据名称唯一确定`
      : `entity_id ${normalizedReferenceId} 无法映射到任何实体`,
    reference_name: normalizedReferenceName,
  };
}

function rewriteRelationRecord(relation, contextFile, lookup, pathPrefix) {
  const root = asObject(relation);
  if (!root) {
    return {
      value: relation,
      changed: false,
      unresolved: [
        {
          filename: contextFile.filename,
          path: pathPrefix,
          reference_id: "",
          reference_name: "",
          reason: "relation 必须是对象",
        },
      ],
    };
  }

  const next = { ...root };
  const unresolved = [];
  let changed = false;

  const source = resolveEntityReference({
    referenceId: next.source_entity_id,
    referenceName: next.source_name,
    contextFile,
    ...lookup,
  });
  if (source.entity_id) {
    if (next.source_entity_id !== source.entity_id) {
      next.source_entity_id = source.entity_id;
      changed = true;
    }
  } else {
    unresolved.push({
      filename: contextFile.filename,
      path: `${pathPrefix}.source_entity_id`,
      reference_id: asText(next.source_entity_id),
      reference_name: asText(next.source_name),
      reason: source.reason,
    });
  }

  const target = resolveEntityReference({
    referenceId: next.target_entity_id,
    referenceName: next.target_name,
    contextFile,
    ...lookup,
  });
  if (target.entity_id) {
    if (next.target_entity_id !== target.entity_id) {
      next.target_entity_id = target.entity_id;
      changed = true;
    }
  } else {
    unresolved.push({
      filename: contextFile.filename,
      path: `${pathPrefix}.target_entity_id`,
      reference_id: asText(next.target_entity_id),
      reference_name: asText(next.target_name),
      reason: target.reason,
    });
  }

  return {
    value: next,
    changed,
    unresolved,
  };
}

function rewriteRelationArray(relations, contextFile, lookup, pathPrefix) {
  if (!Array.isArray(relations)) {
    return {
      value: relations,
      changed: false,
      unresolved: [],
    };
  }

  let changed = false;
  const unresolved = [];
  const next = relations.map((relation, index) => {
    const result = rewriteRelationRecord(relation, contextFile, lookup, `${pathPrefix}[${index}]`);
    changed = changed || result.changed;
    unresolved.push(...result.unresolved);
    return result.value;
  });

  return {
    value: next,
    changed,
    unresolved,
  };
}

function rewriteEntityScopedRecord(record, contextFile, lookup) {
  const root = cloneJsonValue(record);
  const unresolved = [];
  let changed = false;

  if (root.entity && typeof root.entity === "object" && !Array.isArray(root.entity)) {
    if (asText(root.entity.id) !== asText(contextFile.final_entity_id)) {
      root.entity.id = asText(contextFile.final_entity_id);
      changed = true;
    }
  }

  if (root.ontology && typeof root.ontology === "object" && !Array.isArray(root.ontology)) {
    if (asText(root.ontology.entity_id) !== asText(contextFile.final_entity_id)) {
      root.ontology.entity_id = asText(contextFile.final_entity_id);
      changed = true;
    }
    if (root.ontology.entity && typeof root.ontology.entity === "object" && !Array.isArray(root.ontology.entity)) {
      if (asText(root.ontology.entity.id) !== asText(contextFile.final_entity_id)) {
        root.ontology.entity.id = asText(contextFile.final_entity_id);
        changed = true;
      }
    }

    const ontologyRelations = rewriteRelationArray(root.ontology.relations, contextFile, lookup, "ontology.relations");
    if (ontologyRelations.changed) {
      changed = true;
      root.ontology.relations = ontologyRelations.value;
    }
    unresolved.push(...ontologyRelations.unresolved);

    if (Array.isArray(root.ontology.ablation)) {
      const nextOntologyAblation = root.ontology.ablation.map((item, index) => {
        const ablation = asObject(item);
        if (!ablation) {
          unresolved.push({
            filename: contextFile.filename,
            path: `ontology.ablation[${index}]`,
            reference_id: "",
            reference_name: "",
            reason: "ontology.ablation 项必须是对象",
          });
          return item;
        }
        if (!asText(ablation.entity_id) && !asText(ablation.entity_name)) {
          return ablation;
        }
        const next = { ...ablation };
        const reference = resolveEntityReference({
          referenceId: next.entity_id,
          referenceName: next.entity_name,
          contextFile,
          ...lookup,
        });
        if (reference.entity_id) {
          if (next.entity_id !== reference.entity_id) {
            next.entity_id = reference.entity_id;
            changed = true;
          }
        } else {
          unresolved.push({
            filename: contextFile.filename,
            path: `ontology.ablation[${index}].entity_id`,
            reference_id: asText(next.entity_id),
            reference_name: asText(next.entity_name),
            reason: reference.reason,
          });
        }
        return next;
      });
      if (nextOntologyAblation !== root.ontology.ablation) {
        root.ontology.ablation = nextOntologyAblation;
      }
    }
  }

  const topLevelRelations = rewriteRelationArray(root.relations, contextFile, lookup, "relations");
  if (topLevelRelations.changed) {
    changed = true;
    root.relations = topLevelRelations.value;
  }
  unresolved.push(...topLevelRelations.unresolved);

  if (root.ablation !== null && root.ablation !== undefined) {
    const ablation = asObject(root.ablation);
    if (!ablation) {
      unresolved.push({
        filename: contextFile.filename,
        path: "ablation",
        reference_id: "",
        reference_name: "",
        reason: "ablation 必须是对象或 null",
      });
    } else {
      if (!asText(ablation.entity_id) && !asText(ablation.entity_name)) {
        root.ablation = ablation;
      } else {
        const next = { ...ablation };
        const reference = resolveEntityReference({
          referenceId: next.entity_id,
          referenceName: next.entity_name,
          contextFile,
          ...lookup,
        });
        if (reference.entity_id) {
          if (next.entity_id !== reference.entity_id) {
            next.entity_id = reference.entity_id;
            changed = true;
          }
        } else {
          unresolved.push({
            filename: contextFile.filename,
            path: "ablation.entity_id",
            reference_id: asText(next.entity_id),
            reference_name: asText(next.entity_name),
            reason: reference.reason,
          });
        }
        root.ablation = next;
      }
    }
  }

  if (root.precheck !== null && root.precheck !== undefined) {
    const precheck = asObject(root.precheck);
    if (!precheck) {
      unresolved.push({
        filename: contextFile.filename,
        path: "precheck",
        reference_id: "",
        reference_name: "",
        reason: "precheck 必须是对象或 null",
      });
    } else {
      const next = { ...precheck };
      const reference = resolveEntityReference({
        referenceId: next.entity_id,
        referenceName: next.entity_name,
        contextFile,
        ...lookup,
      });
      if (reference.entity_id) {
        if (next.entity_id !== reference.entity_id) {
          next.entity_id = reference.entity_id;
          changed = true;
        }
      } else {
        unresolved.push({
          filename: contextFile.filename,
          path: "precheck.entity_id",
          reference_id: asText(next.entity_id),
          reference_name: asText(next.entity_name),
          reason: reference.reason,
        });
      }
      root.precheck = next;
    }
  }

  const validation = validateWorkflowEntityFileData(root);
  if (!validation.ok) {
    unresolved.push({
      filename: contextFile.filename,
      path: "validation",
      reference_id: "",
      reference_name: "",
      reason: validation.error,
    });
  }

  return {
    data: root,
    changed: changed || contextFile.original_entity_id !== contextFile.final_entity_id,
    unresolved,
  };
}

function buildDuplicateGroups(filePlans) {
  const groups = new Map();
  for (const filePlan of filePlans) {
    if (filePlan.status !== "ok") {
      continue;
    }
    const list = groups.get(filePlan.original_entity_id) || [];
    list.push(filePlan);
    groups.set(filePlan.original_entity_id, list);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .sort((left, right) => compareStrings(left[1][0].filename, right[1][0].filename))
    .map(([entityId, group]) => ({
      original_entity_id: entityId,
      canonical_filename: group[0].filename,
      canonical_entity_name: group[0].original_entity_name,
      duplicate_files: group.slice(1).map((item) => ({
        filename: item.filename,
        entity_name: item.original_entity_name,
        planned_entity_id: item.final_entity_id,
      })),
    }));
}

export function buildEntityIdMigrationPlan({ projectId, files }) {
  const normalizedProjectId = asText(projectId) || "demo";
  const filePlans = collectFileRecords(files, normalizedProjectId);
  const validFiles = filePlans.filter((file) => file.status === "ok");
  const invalidFiles = filePlans.filter((file) => file.status === "invalid");
  const unreadableFiles = filePlans.filter((file) => file.status === "unreadable");
  const usedEntityIds = new Set(validFiles.map((file) => asText(file.original_entity_id)).filter(Boolean));
  let maxSequence = 0;
  for (const entityId of usedEntityIds) {
    maxSequence = Math.max(maxSequence, extractEntitySequenceNumber(entityId));
  }

  const groupedFiles = new Map();
  for (const file of validFiles) {
    const list = groupedFiles.get(file.original_entity_id) || [];
    list.push(file);
    groupedFiles.set(file.original_entity_id, list);
  }

  const allocateEntityId = createEntityIdAllocator({
    usedEntityIds,
    sequenceSeed: maxSequence,
  });

  for (const group of [...groupedFiles.values()].sort((left, right) => compareStrings(left[0].filename, right[0].filename))) {
    group.sort((left, right) => compareStrings(left.filename, right.filename));
    group[0].final_entity_id = group[0].original_entity_id;
    group[0].final_sequence = extractEntitySequenceNumber(group[0].final_entity_id);
    group[0].is_duplicate = false;

    for (let index = 1; index < group.length; index += 1) {
      const file = group[index];
      const allocated = allocateEntityId(file.original_entity_name);
      file.final_entity_id = allocated.entity_id;
      file.final_sequence = allocated.sequence;
      file.is_duplicate = true;
    }
  }

  const lookup = buildLookupMaps(validFiles);
  const remaps = [];
  const unresolvedReferences = [];
  let changedFiles = 0;

  for (const file of validFiles) {
    const preview = rewriteEntityScopedRecord(file.data, file, lookup);
    unresolvedReferences.push(...preview.unresolved);
    if (preview.changed) {
      changedFiles += 1;
    }
    remaps.push({
      filename: file.filename,
      status: file.is_duplicate ? "renamed" : "kept",
      original_entity_id: file.original_entity_id,
      original_entity_name: file.original_entity_name,
      final_entity_id: file.final_entity_id,
      final_sequence: file.final_sequence,
      changed: preview.changed,
      duplicate: Boolean(file.is_duplicate),
      unresolved_reference_count: preview.unresolved.length,
    });
  }

  const duplicateGroups = buildDuplicateGroups(validFiles);

  return {
    project_id: normalizedProjectId,
    summary: {
      total_files: filePlans.length,
      valid_files: validFiles.length,
      invalid_files: invalidFiles.length,
      unreadable_files: unreadableFiles.length,
      duplicate_entity_groups: duplicateGroups.length,
      duplicate_entity_records: duplicateGroups.reduce((sum, group) => sum + group.duplicate_files.length, 0),
      changed_files: changedFiles,
      unchanged_files: validFiles.length - changedFiles,
      unresolved_references: unresolvedReferences.length,
    },
    remaps,
    duplicate_groups: duplicateGroups,
    invalid_files: invalidFiles.map((item) => ({
      filename: item.filename,
      error: item.error,
    })),
    unreadable_files: unreadableFiles.map((item) => ({
      filename: item.filename,
      error: item.error,
    })),
    unresolved_references: unresolvedReferences,
    file_plans: filePlans.map((item) => {
      const { data: _data, ...rest } = item;
      return rest;
    }),
  };
}

export async function collectWorkflowEntityFiles(repository, projectId) {
  const normalizedProjectId = asText(projectId) || "demo";
  const timelines = await repository.getJsonFileTimelines(normalizedProjectId);
  const filenames = [...new Set((Array.isArray(timelines) ? timelines : [])
    .map((timeline) => asText(timeline?.filename))
    .filter((filename) => isCandidateEntityFile(filename)))]
    .sort(compareStrings);

  const files = [];
  for (const filename of filenames) {
    try {
      const data = await repository.readProjectFile(normalizedProjectId, filename);
      files.push({
        filename,
        data,
      });
    } catch (error) {
      files.push({
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return files;
}

function buildRewriteLookupFromPlan(plan) {
  const filePlans = Array.isArray(plan?.remaps) ? plan.remaps : [];
  const recordsByOriginalId = new Map();
  const recordsByName = new Map();

  for (const filePlan of filePlans) {
    if (filePlan.status !== "kept" && filePlan.status !== "renamed") {
      continue;
    }
    const current = {
      filename: filePlan.filename,
      original_entity_id: filePlan.original_entity_id,
      original_entity_name: filePlan.original_entity_name,
      final_entity_id: filePlan.final_entity_id,
    };
    const originalId = asText(filePlan.original_entity_id);
    const nameKey = normalizeText(filePlan.original_entity_name);
    const listById = recordsByOriginalId.get(originalId) || [];
    listById.push(current);
    recordsByOriginalId.set(originalId, listById);

    const listByName = recordsByName.get(nameKey) || [];
    listByName.push(current);
    recordsByName.set(nameKey, listByName);
  }

  return { recordsByOriginalId, recordsByName };
}

function normalizeMigrationBatchSize(batchSize, remainingFileCount) {
  const parsed = Math.floor(Number(batchSize) || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, Math.max(0, Math.floor(Number(remainingFileCount) || 0)));
}

function buildMigrationBatches(filePlans, batchSize = 0, startIndex = 0) {
  const safeFilePlans = Array.isArray(filePlans) ? filePlans : [];
  const normalizedStartIndex = Math.max(0, Math.min(safeFilePlans.length, Math.floor(Number(startIndex) || 0)));
  const remainingFilePlans = safeFilePlans.slice(normalizedStartIndex);
  if (remainingFilePlans.length === 0) {
    return [];
  }

  const normalizedBatchSize = normalizeMigrationBatchSize(batchSize, remainingFilePlans.length) || remainingFilePlans.length;
  const batches = [];

  for (let index = 0; index < remainingFilePlans.length; index += normalizedBatchSize) {
    const batchFilePlans = remainingFilePlans.slice(index, index + normalizedBatchSize);
    batches.push({
      batch_index: batches.length + 1,
      start_index: normalizedStartIndex + index,
      end_index: normalizedStartIndex + index + batchFilePlans.length,
      file_plans: batchFilePlans,
    });
  }

  return batches;
}

function summarizeMigrationBatchResults(fileResults) {
  const results = Array.isArray(fileResults) ? fileResults : [];
  return results.reduce((summary, item) => {
    summary.processed_files += 1;
    if (item.status === "success") {
      summary.success_count += 1;
    } else if (item.status === "skipped") {
      summary.skipped_count += 1;
    } else {
      summary.failed_count += 1;
    }
    if (item.changed) {
      summary.changed_count += 1;
    }
    return summary;
  }, {
    processed_files: 0,
    success_count: 0,
    skipped_count: 0,
    failed_count: 0,
    changed_count: 0,
  });
}

function createMigrationCheckpointState({
  projectId,
  plan,
  batchSize,
  startIndex,
  nextIndex,
  batchReports,
  writeResults,
  status,
  lastBatch,
}) {
  return {
    status: status || "in_progress",
    project_id: asText(projectId) || "demo",
    batch_size: Math.max(0, Math.floor(Number(batchSize) || 0)),
    start_index: Math.max(0, Math.floor(Number(startIndex) || 0)),
    next_index: Math.max(0, Math.floor(Number(nextIndex) || 0)),
    batch_reports: Array.isArray(batchReports) ? batchReports : [],
    write_results: Array.isArray(writeResults) ? writeResults : [],
    plan,
    last_batch: lastBatch || null,
    updated_at: new Date().toISOString(),
  };
}

async function applySingleMigrationFilePlan(repository, normalizedProjectId, filePlan, lookup, strict, options = {}) {
  const {
    batchLabel = null,
    basevision = 0,
    skipInference = false,
  } = options;
  const rawData = await repository.readProjectFile(normalizedProjectId, filePlan.filename);
  const validation = validateWorkflowEntityFileData(rawData);
  if (!validation.ok) {
    throw new Error(`迁移前读取到无效文件 ${filePlan.filename}: ${validation.error}`);
  }

  const currentEntityId = asText(rawData?.entity?.id);
  if (currentEntityId !== asText(filePlan.original_entity_id) && currentEntityId !== asText(filePlan.final_entity_id)) {
    throw new Error(`迁移前状态不符合预期：${filePlan.filename} 当前 entity.id=${currentEntityId}，计划原始值=${filePlan.original_entity_id}`);
  }

  const rewritten = rewriteWorkflowEntityData(rawData, filePlan, lookup);
  if (strict && rewritten.unresolved.length > 0) {
    const first = rewritten.unresolved[0];
    throw new Error(`迁移过程中发现无法解析的引用：${first.filename} ${first.path} -> ${first.reason}`);
  }

  if (!rewritten.changed) {
    return {
      file_result: {
        filename: filePlan.filename,
        status: "skipped",
        reason: "already-up-to-date",
        changed: false,
      },
      write_result: null,
    };
  }

  const phasePrefix = batchLabel
    ? `Migration batch ${batchLabel.batch_index}/${batchLabel.batch_total}: `
    : "Migration: ";
  const result = await repository.writeWorkflowEntity({
    projectId: normalizedProjectId,
    filename: filePlan.filename,
    data: rewritten.data,
    message: `${phasePrefix}resolve duplicate entity ids for ${filePlan.filename}`,
    agentName: "entity-id-migration",
    committerName: "entity-id-migration",
    basevision: Number(basevision || 0),
    skipInference,
  });
  return {
    file_result: {
      filename: filePlan.filename,
      status: "success",
      version_id: result?.write_result?.version_id ?? result?.version_id ?? null,
      commit_id: result?.write_result?.commit_id ?? result?.commit_id ?? null,
      changed: true,
    },
    write_result: result,
  };
}

export function rewriteWorkflowEntityData(record, contextFile, lookup) {
  const root = cloneJsonValue(record);
  const unresolved = [];
  let changed = false;

  if (root.entity && typeof root.entity === "object" && !Array.isArray(root.entity)) {
    if (asText(root.entity.id) !== asText(contextFile.final_entity_id)) {
      root.entity.id = asText(contextFile.final_entity_id);
      changed = true;
    }
  }

  if (root.ontology && typeof root.ontology === "object" && !Array.isArray(root.ontology)) {
    if (asText(root.ontology.entity_id) !== asText(contextFile.final_entity_id)) {
      root.ontology.entity_id = asText(contextFile.final_entity_id);
      changed = true;
    }
    if (root.ontology.entity && typeof root.ontology.entity === "object" && !Array.isArray(root.ontology.entity)) {
      if (asText(root.ontology.entity.id) !== asText(contextFile.final_entity_id)) {
        root.ontology.entity.id = asText(contextFile.final_entity_id);
        changed = true;
      }
    }

    const ontologyRelations = rewriteRelationArray(root.ontology.relations, contextFile, lookup, "ontology.relations");
    if (ontologyRelations.changed) {
      root.ontology.relations = ontologyRelations.value;
      changed = true;
    }
    unresolved.push(...ontologyRelations.unresolved);

    if (Array.isArray(root.ontology.ablation)) {
      const nextOntologyAblation = root.ontology.ablation.map((item, index) => {
        const ablation = asObject(item);
        if (!ablation) {
          unresolved.push({
            filename: contextFile.filename,
            path: `ontology.ablation[${index}]`,
            reference_id: "",
            reference_name: "",
            reason: "ontology.ablation 项必须是对象",
          });
          return item;
        }
        if (!asText(ablation.entity_id) && !asText(ablation.entity_name)) {
          return ablation;
        }
        const next = { ...ablation };
        const reference = resolveEntityReference({
          referenceId: next.entity_id,
          referenceName: next.entity_name,
          contextFile,
          ...lookup,
        });
        if (reference.entity_id) {
          if (next.entity_id !== reference.entity_id) {
            next.entity_id = reference.entity_id;
            changed = true;
          }
        } else {
          unresolved.push({
            filename: contextFile.filename,
            path: `ontology.ablation[${index}].entity_id`,
            reference_id: asText(next.entity_id),
            reference_name: asText(next.entity_name),
            reason: reference.reason,
          });
        }
        return next;
      });
      root.ontology.ablation = nextOntologyAblation;
    }
  }

  const topLevelRelations = rewriteRelationArray(root.relations, contextFile, lookup, "relations");
  if (topLevelRelations.changed) {
    root.relations = topLevelRelations.value;
    changed = true;
  }
  unresolved.push(...topLevelRelations.unresolved);

  if (root.ablation !== null && root.ablation !== undefined) {
    const ablation = asObject(root.ablation);
    if (!ablation) {
      unresolved.push({
        filename: contextFile.filename,
        path: "ablation",
        reference_id: "",
        reference_name: "",
        reason: "ablation 必须是对象或 null",
      });
    } else {
      if (!asText(ablation.entity_id) && !asText(ablation.entity_name)) {
        root.ablation = ablation;
      } else {
        const next = { ...ablation };
        const reference = resolveEntityReference({
          referenceId: next.entity_id,
          referenceName: next.entity_name,
          contextFile,
          ...lookup,
        });
        if (reference.entity_id) {
          if (next.entity_id !== reference.entity_id) {
            next.entity_id = reference.entity_id;
            changed = true;
          }
        } else {
          unresolved.push({
            filename: contextFile.filename,
            path: "ablation.entity_id",
            reference_id: asText(next.entity_id),
            reference_name: asText(next.entity_name),
            reason: reference.reason,
          });
        }
        root.ablation = next;
      }
    }
  }

  if (root.precheck !== null && root.precheck !== undefined) {
    const precheck = asObject(root.precheck);
    if (!precheck) {
      unresolved.push({
        filename: contextFile.filename,
        path: "precheck",
        reference_id: "",
        reference_name: "",
        reason: "precheck 必须是对象或 null",
      });
    } else {
      const next = { ...precheck };
      const reference = resolveEntityReference({
        referenceId: next.entity_id,
        referenceName: next.entity_name,
        contextFile,
        ...lookup,
      });
      if (reference.entity_id) {
        if (next.entity_id !== reference.entity_id) {
          next.entity_id = reference.entity_id;
          changed = true;
        }
      } else {
        unresolved.push({
          filename: contextFile.filename,
          path: "precheck.entity_id",
          reference_id: asText(next.entity_id),
          reference_name: asText(next.entity_name),
          reason: reference.reason,
        });
      }
      root.precheck = next;
    }
  }

  return {
    data: root,
    changed,
    unresolved,
  };
}

export function buildEntityIdMigrationPlanFromFiles({ projectId, files }) {
  return buildEntityIdMigrationPlan({ projectId, files });
}

export async function createEntityIdMigrationPlan(repository, projectId) {
  const files = await collectWorkflowEntityFiles(repository, projectId);
  return buildEntityIdMigrationPlan({ projectId, files });
}

export async function applyEntityIdMigrationPlan(repository, plan, options = {}) {
  const strict = options.strict !== false;
  const normalizedProjectId = asText(plan?.project_id) || "demo";
  const lookup = buildRewriteLookupFromPlan(plan);
  const filePlans = Array.isArray(plan?.remaps) ? plan.remaps : [];
  const startIndex = Math.max(0, Math.min(filePlans.length, Math.floor(Number(options.startIndex) || 0)));
  const batchSize = normalizeMigrationBatchSize(options.batchSize, filePlans.length - startIndex);
  const batches = buildMigrationBatches(filePlans, batchSize, startIndex);
  const writeResults = [];
  const batchReports = [];
  const checkpointWriter = typeof options.checkpointWriter === "function" ? options.checkpointWriter : null;
  const latestVersionIdMap = typeof repository.loadLatestVersionIdMap === "function"
    ? await repository.loadLatestVersionIdMap(normalizedProjectId)
    : new Map();
  const basevisionByFilename = latestVersionIdMap instanceof Map
    ? new Map(latestVersionIdMap)
    : new Map();

  if (strict && Array.isArray(plan?.invalid_files) && plan.invalid_files.length > 0) {
    throw new Error(`存在无法迁移的无效文件：${plan.invalid_files.map((item) => item.filename).join(", ")}`);
  }
  if (strict && Array.isArray(plan?.unreadable_files) && plan.unreadable_files.length > 0) {
    throw new Error(`存在无法读取的文件：${plan.unreadable_files.map((item) => item.filename).join(", ")}`);
  }
  if (strict && Array.isArray(plan?.unresolved_references) && plan.unresolved_references.length > 0) {
    const first = plan.unresolved_references[0];
    throw new Error(`存在无法唯一映射的引用：${first.filename} ${first.path} -> ${first.reason}`);
  }

  const totalBatches = batches.length;
  for (const batch of batches) {
    const startedAt = Date.now();
    const batchFileResults = [];
    const batchWriteResults = [];
    for (const filePlan of batch.file_plans) {
      if (filePlan.status !== "kept" && filePlan.status !== "renamed") {
        continue;
      }

      const { file_result, write_result } = await applySingleMigrationFilePlan(
        repository,
        normalizedProjectId,
        filePlan,
        lookup,
        strict,
        {
          batch_index: batch.batch_index,
          batch_total: totalBatches,
          basevision: Number(basevisionByFilename.get(filePlan.filename) || 0),
          skipInference: true,
        },
      );

      batchFileResults.push(file_result);
      writeResults.push(file_result);
      if (write_result) {
        batchWriteResults.push(write_result);
        const nextVersionId = Number(write_result?.write_result?.version_id ?? write_result?.version_id ?? 0);
        if (Number.isFinite(nextVersionId) && nextVersionId > 0) {
          basevisionByFilename.set(filePlan.filename, nextVersionId);
        }
      }
    }

    const batchReport = {
      batch_index: batch.batch_index,
      batch_total: totalBatches,
      start_index: batch.start_index,
      end_index: batch.end_index,
      file_count: batch.file_plans.length,
      file_results: batchFileResults,
      summary: summarizeMigrationBatchResults(batchFileResults),
      duration_ms: Date.now() - startedAt,
    };
    batchReports.push(batchReport);

    if (checkpointWriter) {
      await checkpointWriter(createMigrationCheckpointState({
        projectId: normalizedProjectId,
        plan,
        batchSize: batchSize || batch.file_plans.length,
        startIndex,
        nextIndex: batch.end_index,
        batchReports,
        writeResults,
        status: "in_progress",
        lastBatch: batchReport,
      }));
    }
  }

  if (checkpointWriter) {
    await checkpointWriter(createMigrationCheckpointState({
      projectId: normalizedProjectId,
      plan,
      batchSize: batchSize || filePlans.length,
      startIndex,
      nextIndex: filePlans.length,
      batchReports,
      writeResults,
      status: "success",
      lastBatch: batchReports.at(-1) || null,
    }));
  }

  return {
    status: "success",
    project_id: normalizedProjectId,
    plan,
    write_results: writeResults,
    batch_reports: batchReports,
    checkpoint: createMigrationCheckpointState({
      projectId: normalizedProjectId,
      plan,
      batchSize: batchSize || filePlans.length,
      startIndex,
      nextIndex: filePlans.length,
      batchReports,
      writeResults,
      status: "success",
      lastBatch: batchReports.at(-1) || null,
    }),
  };
}

export async function migrateDuplicateEntityIds(repository, options = {}) {
  const projectId = asText(options.projectId) || "demo";
  const dryRun = options.dryRun !== false;
  const plan = options.plan || await createEntityIdMigrationPlan(repository, projectId);
  if (dryRun) {
    const dryBatches = buildMigrationBatches(plan.remaps, options.batchSize || 0, Math.max(0, Math.floor(Number(options.startIndex) || 0)));
    return {
      status: "dry-run",
      ...plan,
      batch_reports: dryBatches.map((batch) => ({
        batch_index: batch.batch_index,
        batch_total: dryBatches.length,
        start_index: batch.start_index,
        end_index: batch.end_index,
        file_count: batch.file_plans.length,
        file_results: batch.file_plans.map((filePlan) => ({
          filename: filePlan.filename,
          status: filePlan.status === "renamed" ? "renamed" : "kept",
          changed: Boolean(filePlan.changed),
          duplicate: Boolean(filePlan.is_duplicate),
        })),
        summary: {
          processed_files: batch.file_plans.length,
          success_count: 0,
          skipped_count: 0,
          failed_count: 0,
          changed_count: batch.file_plans.filter((filePlan) => Boolean(filePlan.changed)).length,
        },
        duration_ms: 0,
      })),
    };
  }
  return applyEntityIdMigrationPlan(repository, plan, options);
}
