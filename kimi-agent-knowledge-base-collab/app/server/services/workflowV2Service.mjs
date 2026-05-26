import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { LinearWorkflowService } from "./linearWorkflowService.mjs";
import { WORKFLOW_V2_STAGE_KEYS } from "../../src/shared/workflowV2Stages.js";

const WORKFLOW_V2_SNAPSHOT_FILE = "latest-v2-run.json";
const DEFAULT_CHUNK_MAX_CHARS = 600;
const DEFAULT_CHUNK_MIN_CHARS = 80;
const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_WINDOW_STEP = 2;
const DEFAULT_PARALLEL_WINDOWS = 4;
const DEFAULT_WORKFLOW_LLM_TIMEOUT_MS = 120000;
const DEFAULT_ABLATION_PARENT_CONCURRENCY = 2;
const DEFAULT_ABLATION_CHILD_CONCURRENCY = 1;

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, parsed);
}

function asInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(parsed));
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikeHtmlDocument(value) {
  const text = asText(value);
  return /^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text) || /^<body[\s>]/i.test(text);
}

function buildNonJsonResponseErrorMessage(scope, baseUrl, rawText) {
  const normalizedBaseUrl = asText(baseUrl);
  if (looksLikeHtmlDocument(rawText)) {
    return `${scope} endpoint returned HTML instead of JSON. 请检查 WORKFLOW_LLM_BASE_URL / DMXAPI_BASE_URL 是否配置成 OpenAI 兼容接口根路径（通常应以 /v1 结尾），当前为 ${normalizedBaseUrl || "未配置"}`;
  }
  return `${scope} endpoint returned non-JSON response. 请检查 WORKFLOW_LLM_BASE_URL / DMXAPI_BASE_URL 与上游服务兼容性，当前为 ${normalizedBaseUrl || "未配置"}`;
}

function normalizeWhitespace(value) {
  return asText(value).replace(/\s+/g, " ");
}

function normalizeObjectName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/^[\s"'`“”‘’()[\]{}<>,.:;!?，。；：！？、]+|[\s"'`“”‘’()[\]{}<>,.:;!?，。；：！？、]+$/g, "");
}

function buildSlug(value, fallback = "item") {
  const normalized = asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function clampConfidence(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function getErrorMessage(error, fallback = "unknown error") {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getErrorRawText(error) {
  if (error && typeof error === "object" && typeof error.llm_raw_text === "string") {
    return error.llm_raw_text;
  }
  return "";
}

function averageConfidence(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0.5;
  }
  const normalized = values.map((item) => clampConfidence(item, 0.5));
  return Number((normalized.reduce((sum, item) => sum + item, 0) / normalized.length).toFixed(4));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => asText(item)).filter(Boolean))];
}

function cloneJsonValue(value, fallback = null) {
  if (value === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function stableJsonStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = asRecord(value);
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createV2StageDebugOutput(debug = {}) {
  const output = {};
  if (debug.llm_raw !== undefined) {
    output.llm_raw = debug.llm_raw;
  }
  if (typeof debug.llm_raw_text === "string" && debug.llm_raw_text.trim()) {
    output.llm_raw_text = debug.llm_raw_text;
  }
  if (debug.llm_response !== undefined) {
    output.llm_response = debug.llm_response;
  }
  if (debug.llm_ensemble !== undefined) {
    output.llm_ensemble = debug.llm_ensemble;
  }
  if (typeof debug.debug_error === "string" && debug.debug_error.trim()) {
    output.debug_error = debug.debug_error;
  }
  return output;
}

function attachV2StageDebug(error, debug = {}) {
  const baseError = error instanceof Error ? error : new Error(String(error));
  const stageOutput = createV2StageDebugOutput(debug);
  if (Object.keys(stageOutput).length > 0) {
    baseError.stageOutput = {
      ...(baseError.stageOutput && typeof baseError.stageOutput === "object" ? baseError.stageOutput : {}),
      ...stageOutput,
    };
  }
  return baseError;
}

function compactV2EnsembleEntry(result, extra = {}) {
  if (!result || typeof result !== "object") {
    return {
      ...extra,
      data: null,
      raw_text: "",
    };
  }
  return {
    ...extra,
    data: result.data ?? result.llm_raw ?? null,
    raw_text: asText(result.llm_raw_text),
  };
}

function joinSymmetricText(left, right) {
  const values = [asText(left), asText(right)].filter(Boolean);
  return uniqueStrings(values).join("\n");
}

function mergeWorkflowV2SharedValue(left, right, fieldName = "") {
  if (left === undefined) {
    return cloneJsonValue(right, null);
  }
  if (right === undefined) {
    return cloneJsonValue(left, null);
  }
  if (stableJsonStringify(left) === stableJsonStringify(right)) {
    return cloneJsonValue(left, null);
  }

  if (typeof left === "string" || typeof right === "string") {
    return joinSymmetricText(left, right);
  }

  if (fieldName === "confidence" && Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return averageConfidence([left, right]);
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.every((item) => typeof item === "string") && right.every((item) => typeof item === "string")) {
      return uniqueStrings([...left, ...right]);
    }
    return cloneJsonValue([...left, ...right], []);
  }

  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (Object.keys(leftRecord).length > 0 || Object.keys(rightRecord).length > 0) {
    const merged = {};
    for (const key of uniqueStrings([...Object.keys(leftRecord), ...Object.keys(rightRecord)])) {
      merged[key] = mergeWorkflowV2SharedValue(leftRecord[key], rightRecord[key], key);
    }
    return merged;
  }

  if (Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return averageConfidence([left, right]);
  }

  return cloneJsonValue([left, right], []);
}

function buildResponseFormat(responseSchema) {
  if (!responseSchema || typeof responseSchema !== "object") {
    return null;
  }
  const name = asText(responseSchema.name);
  const schema = responseSchema.schema;
  if (!name || !schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: responseSchema.strict !== false,
      schema,
    },
  };
}

function extractFirstJsonValueText(text) {
  const input = asText(text);
  if (!input) {
    return "";
  }

  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = (() => {
    const objectIndex = input.indexOf("{");
    const arrayIndex = input.indexOf("[");
    if (objectIndex === -1) return arrayIndex;
    if (arrayIndex === -1) return objectIndex;
    return Math.min(objectIndex, arrayIndex);
  })();
  if (start === -1) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let opening = "";
  let closing = "";

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (!opening) {
      if (char === "{") {
        opening = "{";
        closing = "}";
        depth = 1;
      } else if (char === "[") {
        opening = "[";
        closing = "]";
        depth = 1;
      } else {
        continue;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1).trim();
      }
    }
  }

  return "";
}

export function parseWorkflowV2JsonResponseText(text) {
  const direct = safeJsonParse(text);
  if (direct) {
    return direct;
  }
  const candidate = extractFirstJsonValueText(text);
  if (!candidate) {
    return null;
  }
  return safeJsonParse(candidate);
}

function splitLongParagraph(paragraph, maxChars, paragraphIndex) {
  const parts = [];
  const sentences = paragraph.text.match(/[^。！？；;\n]+[。！？；;]?\s*/g) ?? [paragraph.text];
  let cursor = paragraph.start_offset;
  let sentenceIndex = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) {
      cursor += sentence.length;
      continue;
    }
    parts.push({
      text: trimmed,
      start_offset: cursor + sentence.indexOf(trimmed),
      end_offset: cursor + sentence.indexOf(trimmed) + trimmed.length,
      paragraph_index: paragraphIndex,
      sentence_index: sentenceIndex,
    });
    cursor += sentence.length;
    sentenceIndex += 1;
  }

  const chunks = [];
  let current = null;
  for (const part of parts) {
    if (!current) {
      current = { ...part };
      continue;
    }
    if ((current.text.length + 1 + part.text.length) <= maxChars) {
      current = {
        ...current,
        text: `${current.text} ${part.text}`.trim(),
        end_offset: part.end_offset,
      };
      continue;
    }
    chunks.push(current);
    current = { ...part };
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function isWeakStandaloneParagraph(text, chunkMinChars = DEFAULT_CHUNK_MIN_CHARS) {
  const normalized = asText(text);
  if (!normalized) {
    return false;
  }
  const compact = normalized.replace(/\s+/g, "");
  const shortThreshold = Math.min(24, Math.max(8, Math.floor(chunkMinChars / 2)));
  if (compact.length > shortThreshold) {
    return false;
  }
  if (/[。！？.!?；;]/.test(compact)) {
    return false;
  }
  if (/[:：]$/.test(compact)) {
    return true;
  }
  if (/^[第\d一二三四五六七八九十百千万0-9]+[章节部分篇节条项]/.test(compact)) {
    return true;
  }
  if (/^(导语|摘要|简介|概述|背景|定义|功能|用途|结构|组成|流程|步骤|案例|讨论|热门讨论|常见问题|FAQ|问答|总结|结论|引言|说明|备注|附录|参考资料)$/.test(compact)) {
    return true;
  }
  return compact.length <= 8 && !/[，,、]/.test(compact);
}

function mergePreChunkItems(left, right, sourceType) {
  const separator = left.paragraph_index === right.paragraph_index ? " " : "\n\n";
  return {
    ...right,
    text: `${left.text}${separator}${right.text}`.trim(),
    start_offset: Math.min(left.start_offset, right.start_offset),
    end_offset: Math.max(left.end_offset, right.end_offset),
    paragraph_index: Math.min(left.paragraph_index, right.paragraph_index),
    source_type: sourceType,
  };
}

function buildChunkReason(sourceType, chunkText) {
  if (sourceType === "paragraph") {
    return "该 chunk 由完整自然段直接生成，语义自洽且便于后续引用。";
  }
  if (sourceType === "heading-merged") {
    return "该 chunk 由弱语义短标题与后续正文合并生成，用于避免栏目名或小标题单独成块。";
  }
  if (sourceType === "neighbor-merged") {
    return "该 chunk 因长度低于最小阈值，与相邻自然段合并生成，以提升后续抽取稳定性。";
  }
  if (sourceType === "short-merged") {
    return "该 chunk 由过短片段归并生成，用于避免引用信息过短导致抽取不稳定。";
  }
  if (chunkText.length < DEFAULT_CHUNK_MIN_CHARS) {
    return "该 chunk 由相邻短句归并生成，用于避免引用信息过短导致抽取不稳定。";
  }
  return "该 chunk 由超长自然段按句界细分生成，便于保持局部语义完整并控制窗口大小。";
}

function buildWindowReason(chunkIds) {
  return `该窗口覆盖 ${chunkIds.length} 个连续 chunk，用于保留局部上下文并支持并行对象抽取。`;
}

function makeStageResult(stage, order, status, output = null, error = null, previous = null) {
  const startedAt = status === "running"
    ? new Date().toISOString()
    : previous?.started_at ?? null;
  const finishedAt = status === "success" || status === "failed"
    ? new Date().toISOString()
    : null;
  return {
    stage,
    order,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    output,
    error,
  };
}

function createV2ResponseEnvelope({ ok, stageResults, errors, runtimeRoot, inputFile, result, startedAt, finishedAt }) {
  return {
    ok,
    workflow: {
      mode: "analysis-v2",
      status: ok ? "success" : "failed",
      steps: [...WORKFLOW_V2_STAGE_KEYS],
    },
    input_file: inputFile,
    stage_results: stageResults,
    errors,
    runtime_root: runtimeRoot,
    result,
    started_at: startedAt,
    finished_at: finishedAt,
  };
}

function deriveWorkflowV2SnapshotStatus(stageResults) {
  const items = Array.isArray(stageResults) ? stageResults : [];
  if (items.some((item) => asText(item?.status) === "failed")) {
    return "failed";
  }
  if (items.some((item) => asText(item?.status) === "running")) {
    return "running";
  }
  const startedCount = items.filter((item) => ["success", "failed"].includes(asText(item?.status))).length;
  if (startedCount === 0) {
    return "idle";
  }
  if (items.every((item) => asText(item?.status) === "success")) {
    return "success";
  }
  return "running";
}

function deriveWorkflowV2Errors(stageResults) {
  return (Array.isArray(stageResults) ? stageResults : [])
    .filter((item) => asText(item?.status) === "failed" && asText(item?.error))
    .map((item) => ({
      stage: asText(item?.stage) || "unknown",
      message: asText(item?.error),
    }));
}

function deriveWorkflowV2StartedAt(stageResults) {
  return (Array.isArray(stageResults) ? stageResults : [])
    .map((item) => asText(item?.started_at))
    .filter(Boolean)[0] || undefined;
}

function deriveWorkflowV2FinishedAt(stageResults, workflowStatus) {
  if (!["success", "failed"].includes(workflowStatus)) {
    return undefined;
  }
  const finishedAtValues = (Array.isArray(stageResults) ? stageResults : [])
    .map((item) => asText(item?.finished_at))
    .filter(Boolean)
    .sort();
  return finishedAtValues.at(-1) || undefined;
}

function emptyWorkflowV2Result(document = null) {
  return {
    document,
    chunks: [],
    windows: [],
    objects: [],
    edges: [],
    ablation: [],
    meta: {
      total_chunks: 0,
      total_windows: 0,
      total_objects: 0,
      total_edges: 0,
      total_isolated_objects: 0,
      is_dag: true,
    },
  };
}

function isStructuredObjectIsolated(object, connectedNodeIds) {
  const objectId = asText(object?.object_id);
  return Boolean(objectId) && !connectedNodeIds.has(objectId);
}

function annotateStructuredObjects(objects, edges) {
  const connectedNodeIds = new Set();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const sourceId = asText(edge?.source_object_id);
    const targetId = asText(edge?.target_object_id);
    if (sourceId) {
      connectedNodeIds.add(sourceId);
    }
    if (targetId) {
      connectedNodeIds.add(targetId);
    }
  }

  return (Array.isArray(objects) ? objects : []).map((object) => {
    const isolated = isStructuredObjectIsolated(object, connectedNodeIds);
    return {
      ...object,
      is_isolated: isolated,
      structure_status: isolated ? "isolated" : "structured",
      structure_reason: isolated
        ? "该对象在对象拆解后的结构图中没有任何入边或出边，说明当前未识别到可支撑结构的组成关系。"
        : "该对象已进入至少一条组成结构边，可参与 DAG 结构分析。",
    };
  });
}

function buildWorkflowV2ResultFromState(state) {
  const safeState = asRecord(state);
  const objects = Array.isArray(safeState.fused_objects) ? safeState.fused_objects : [];
  const edges = Array.isArray(safeState.edges) ? safeState.edges : [];
  const nodeIds = objects.map((item) => asText(item?.object_id)).filter(Boolean);
  return {
    document: safeState.document ?? null,
    chunks: Array.isArray(safeState.chunks) ? safeState.chunks : [],
    windows: Array.isArray(safeState.windows) ? safeState.windows : [],
    objects,
    edges,
    ablation: Array.isArray(safeState.parent_summaries) ? safeState.parent_summaries : [],
    meta: {
      total_chunks: Array.isArray(safeState.chunks) ? safeState.chunks.length : 0,
      total_windows: Array.isArray(safeState.windows) ? safeState.windows.length : 0,
      total_objects: objects.length,
      total_edges: edges.length,
      total_isolated_objects: objects.filter((item) => item?.is_isolated === true).length,
      is_dag: computeTopologicalOrder(edges, nodeIds).cyclicNodeIds.length === 0,
    },
  };
}

function validateWorkflowV2RetrySnapshot(snapshot, startStage) {
  const stageIndex = WORKFLOW_V2_STAGE_KEYS.indexOf(startStage);
  if (stageIndex === -1) {
    return {
      ok: false,
      stageIndex,
      message: "startStage is invalid",
    };
  }

  const stageResults = Array.isArray(snapshot?.stage_results) ? snapshot.stage_results : [];
  const targetStage = asRecord(stageResults[stageIndex]);
  const targetStatus = asText(targetStage.status);
  if (!["success", "failed"].includes(targetStatus)) {
    return {
      ok: false,
      stageIndex,
      message: `startStage ${startStage} is not retryable because its current status is ${targetStatus || "missing"}`,
    };
  }

  for (let index = 0; index < stageIndex; index += 1) {
    const previous = asRecord(stageResults[index]);
    if (asText(previous.status) !== "success") {
      return {
        ok: false,
        stageIndex,
        message: `startStage ${startStage} is invalid because previous stage ${WORKFLOW_V2_STAGE_KEYS[index]} is ${asText(previous.status) || "missing"}`,
      };
    }
  }

  return {
    ok: true,
    stageIndex,
    message: "",
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const safeConcurrency = Math.max(1, Math.min(items.length || 1, concurrency));
  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

function computeTopologicalOrder(edges, nodeIds) {
  const indegree = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]));
  for (const edge of edges) {
    if (!indegree.has(edge.source_object_id) || !indegree.has(edge.target_object_id)) {
      continue;
    }
    indegree.set(edge.target_object_id, (indegree.get(edge.target_object_id) ?? 0) + 1);
    adjacency.get(edge.source_object_id).push(edge.target_object_id);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId);
  const visited = [];

  while (queue.length > 0) {
    const current = queue.shift();
    visited.push(current);
    for (const target of adjacency.get(current) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  return {
    orderedNodeIds: visited,
    cyclicNodeIds: nodeIds.filter((nodeId) => !visited.includes(nodeId)),
  };
}

function buildWindowExtractPrompt(window) {
  return {
    instruction: [
      "你是一个严格的信息抽取器。",
      "你的任务是从给定文本窗口中抽取 object。",
      "只根据输入文本抽取，不允许使用任何外部知识。",
      "请尽量详细地提取窗口中明确出现的实体，不要因为它们层级较细或数量较多而省略。",
      "object_name 必须是文本中不可再拆分的最小实体词。",
      "如果一个短语还能自然拆成多个独立实体词，则不要把该短语整体当成 object_name 返回，而应分别返回更小的实体。",
      "只有当一个词组在原文中作为固定概念、专有名词或不可再分的整体出现时，才允许把它作为单个 object_name。",
      "优先抽取名词性实体、组成项、部件名、概念名、对象名，不要把完整句子、描述性短语或关系短语当成实体。",
      "每个 object 必须包含 object_name、normalized_name、citation、confidence、reason。",
      "citation 必须直接来自窗口原文，并尽量完整包含与该对象有关的全部原文内容。",
      "不要只截取对象名称本身或过短片段；如果同一窗口中有多处原文共同描述该对象，请尽量都收录到 citation 数组。",
      "citation 应优先保留完整句子、完整分句或必要的相邻上下文，避免截断导致语义缺失。",
      "confidence 必须是 0 到 1 之间的小数。",
      "如果没有合适对象，返回空数组。",
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_window_extract",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          objects: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                object_name: { type: "string" },
                normalized_name: { type: "string" },
                citation: { type: "array", items: { type: "string" } },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: ["object_name", "normalized_name", "citation", "confidence", "reason"],
            },
          },
          reason: { type: "string" },
        },
        required: ["objects", "reason"],
      },
    },
    payload: {
      window_id: window.window_id,
      chunk_ids: window.chunk_ids,
      window_text: window.text,
    },
  };
}

function buildFusionJudgePrompt(existingObject, candidate) {
  return {
    instruction: [
      "你是一个对象融合裁决器。",
      "只根据给定名称、别名和 citations 判断两个候选对象是否应视为同一对象。",
      "如果语义一致则 should_merge=true，否则 false。",
      "不要引入外部知识。",
    ].join("\n"),
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
    payload: {
      existing_object: existingObject,
      candidate_object: candidate,
    },
  };
}

function buildObjectFunctionPrompt(object) {
  return {
    instruction: [
      "你是一个核心功能分析器。",
      "请基于对象自身的 citations，提取该对象的核心功能。",
      "core_function 必须概括该对象最核心、最本质的能力、用途或成立目标。",
      "如果有多个功能，只保留最能代表该对象本体的核心功能，不要罗列次要功能。",
      "允许结合 citation 上下文做必要归纳，但不要脱离 citation 任意发挥。",
      "citation 必须包含支撑该核心功能的原文，尽量保留完整句子、完整分句或必要上下文。",
      "如果核心功能不清晰，也要给出最稳妥的单一核心功能判断，并在 reason 中说明依据。",
    ].join("\n"),
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
    payload: {
      object,
    },
  };
}

function buildObjectDecomposePrompt(object) {
  return {
    instruction: [
      "你是一个结构拆解器。",
      "请基于对象自身的 citations，提取它直接包含的子对象。",
      "只提取能够由 citation 支持或判断出的组成/包含关系。",
      "允许结合 citation 上下文和必要的常识或领域知识，辅助判断最合理的组成关系。",
      "允许根据 citation 中的结构表达进行等价归纳，例如“由…组成”“包括…”“分为…部分”“包含…”都可以视为 contains。",
      "如果输出 A contains B、A contains C 等多个子对象，这些子对象必须处于同一拆解视角下，并且按合理的组织方案组合后能够共同表征 A。",
      "不要混合不同拆解维度的子对象；不要一部分是组成部件，另一部分是功能、流程、用途、角色或结果。",
      "如果若干子对象合在一起仍不足以表现 A，或者只是 A 的零散片段、示例项、相关项，而不是构成 A 的组成部分，则不要输出这些 contains。",
      "只提取直接子对象，不要跨层级推断孙节点或更深层结构。",
      "如果 citation 主要描述的是功能、用途、流程、依赖、因果、时序或交互关系，不要提取为 contains。",
      "relation 只能写 contains。",
      "可以使用必要知识辅助判断，但不要脱离 citation 主题随意补充无依据的子对象。",
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_object_decompose",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decompositions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                parent_object_name: { type: "string" },
                child_object_name: { type: "string" },
                relation: { type: "string" },
                citation: { type: "string" },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: ["parent_object_name", "child_object_name", "relation", "citation", "confidence", "reason"],
            },
          },
          reason: { type: "string" },
        },
        required: ["decompositions", "reason"],
      },
    },
    payload: {
      object,
    },
  };
}

function buildObjectDecomposeRetryHint(attempt) {
  if (attempt === 2) {
    return "上次输出不是合法 JSON，这次只返回 JSON，不要包裹代码围栏。";
  }
  if (attempt >= 3) {
    return [
      "上次输出仍不是合法 JSON。",
      "这次严格只返回一个 JSON 对象。",
      "字段只能包含 decompositions 和 reason。",
      "如果没有直接组成关系，请返回 {\"decompositions\":[],\"reason\":\"未发现直接组成关系\"}。",
    ].join(" ");
  }
  return "";
}

function buildCycleResolvePrompt(cycleEdges) {
  return {
    instruction: [
      "你是一个有向无环图裁决器。",
      "请在构成环的边中删除最弱的一条。",
      "优先保留证据更强、citation 更明确、confidence 更高的边。",
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_cycle_resolve",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          remove_edge_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["remove_edge_id", "reason"],
      },
    },
    payload: {
      cycle_edges: cycleEdges,
    },
  };
}

function buildSiblingAblationPrompt(parent, ablatedChild, siblings, localEdges) {
  return {
    instruction: [
      "你是一个局部结构消融分析器。",
      "请分析去除某个子节点后，对其兄弟节点的影响。",
      "只能基于输入对象、edges 和 citations 判断。",
      "impact_level 只能是 none、low、medium、high。",
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_sibling_ablation",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sibling_impacts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                target_sibling_object_id: { type: "string" },
                impact_level: { type: "string" },
                judgement: { type: "string" },
                reason: { type: "string" },
              },
              required: ["target_sibling_object_id", "impact_level", "judgement", "reason"],
            },
          },
          reason: { type: "string" },
        },
        required: ["sibling_impacts", "reason"],
      },
    },
    payload: {
      parent,
      ablated_child: ablatedChild,
      siblings,
      local_edges: localEdges,
    },
  };
}

function buildParentAblationPrompt(parent, ablatedChild, children, localEdges) {
  return {
    instruction: [
      "你是一个父节点重要性分析器。",
      "请分析去掉一个直接子节点后，父节点是否仍可以完成其核心功能。",
      "parent 对象中的 core_function 字段就是父节点核心功能的判定基准。",
      "判定标准以“去除某子后父是否可以完成其核心功能”为准，而不是只看定义是否略有变化。",
      "如果去掉该子节点后父节点仍可完成核心功能，则 importance_level 倾向 none 或 low；若明显削弱但仍可部分完成，则倾向 medium；若无法完成或基本失去核心功能，则倾向 high 或 critical。",
      "只能基于输入数据判断。",
      "importance_level 只能是 none、low、medium、high、critical。",
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_parent_ablation",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          impact_on_parent: {
            type: "object",
            additionalProperties: false,
            properties: {
              parent_object_id: { type: "string" },
              importance_level: { type: "string" },
              judgement: { type: "string" },
              reason: { type: "string" },
            },
            required: ["parent_object_id", "importance_level", "judgement", "reason"],
          },
          reason: { type: "string" },
        },
        required: ["impact_on_parent", "reason"],
      },
    },
    payload: {
      parent,
      ablated_child: ablatedChild,
      children,
      local_edges: localEdges,
    },
  };
}

const WORKFLOW_V2_PICK_CONFLICT_RESPONSE_SCHEMA = {
  name: "workflow_v2_pick_conflicts",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      resolved_conflicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_key: { type: "string" },
            selected_model: { type: "string" },
            reason: { type: "string" },
          },
          required: ["item_key", "selected_model", "reason"],
        },
      },
      reason: { type: "string" },
    },
    required: ["resolved_conflicts", "reason"],
  },
};

const WORKFLOW_V2_CONFLICT_REVIEW_RESPONSE_SCHEMA = {
  name: "workflow_v2_review_conflicts",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      conflict_reviews: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_key: { type: "string" },
            preferred_model: { type: "string" },
            confidence: { type: "number" },
            reason: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["item_key", "preferred_model", "confidence", "reason", "suggestion"],
        },
      },
      round_summary: { type: "string" },
    },
    required: ["conflict_reviews", "round_summary"],
  },
};

function buildWorkflowV2EnsembleShape(stage, responseSchema) {
  const schemaName = asText(responseSchema?.name);
  if (stage === "window_extract" || schemaName === "workflow_v2_window_extract") {
    return {
      kind: "array",
      containerKey: "objects",
      extractItems(value) {
        return Array.isArray(asRecord(value).objects) ? asRecord(value).objects : [];
      },
      getItemKey(item, index) {
        return normalizeObjectName(item?.normalized_name || item?.object_name) || `objects:${index + 1}`;
      },
      buildComparableValue(item) {
        return {
          object_name: normalizeObjectName(item?.object_name),
          normalized_name: normalizeObjectName(item?.normalized_name || item?.object_name),
        };
      },
      pickShell(value) {
        const record = asRecord(value);
        return {
          reason: asText(record.reason),
        };
      },
      wrap(items, shell) {
        return {
          ...shell,
          objects: items,
        };
      },
    };
  }

  if (stage === "object_decompose" || schemaName === "workflow_v2_object_decompose") {
    return {
      kind: "array",
      containerKey: "decompositions",
      extractItems(value) {
        return Array.isArray(asRecord(value).decompositions) ? asRecord(value).decompositions : [];
      },
      getItemKey(item, index) {
        return [
          normalizeObjectName(item?.parent_object_name),
          normalizeObjectName(item?.child_object_name),
          normalizeObjectName(item?.relation),
        ].filter(Boolean).join("::") || `decompositions:${index + 1}`;
      },
      buildComparableValue(item) {
        return {
          parent_object_name: normalizeObjectName(item?.parent_object_name),
          child_object_name: normalizeObjectName(item?.child_object_name),
          relation: normalizeObjectName(item?.relation),
        };
      },
      pickShell(value) {
        const record = asRecord(value);
        return {
          reason: asText(record.reason),
        };
      },
      wrap(items, shell) {
        return {
          ...shell,
          decompositions: items,
        };
      },
    };
  }

  if (schemaName === "workflow_v2_sibling_ablation") {
    return {
      kind: "array",
      containerKey: "sibling_impacts",
      extractItems(value) {
        return Array.isArray(asRecord(value).sibling_impacts) ? asRecord(value).sibling_impacts : [];
      },
      getItemKey(item, index) {
        return asText(item?.target_sibling_object_id) || `sibling_impacts:${index + 1}`;
      },
      buildComparableValue(item) {
        return {
          target_sibling_object_id: asText(item?.target_sibling_object_id),
          impact_level: asText(item?.impact_level),
        };
      },
      pickShell(value) {
        const record = asRecord(value);
        return {
          reason: asText(record.reason),
        };
      },
      wrap(items, shell) {
        return {
          ...shell,
          sibling_impacts: items,
        };
      },
    };
  }

  return {
    kind: "single_object",
    containerKey: "root",
    extractItems(value) {
      const record = asRecord(value);
      return Object.keys(record).length > 0 ? [record] : [];
    },
    getItemKey() {
      return "__root__";
    },
    buildComparableValue(value) {
      const record = asRecord(value);
      const schemaName = asText(responseSchema?.name);
      if (schemaName === "workflow_v2_object_function") {
        return {
          core_function: normalizeWhitespace(record.core_function),
        };
      }
      if (schemaName === "workflow_v2_fusion_judge") {
        return {
          should_merge: record.should_merge === true,
          object_name: normalizeObjectName(record.object_name),
          normalized_name: normalizeObjectName(record.normalized_name || record.object_name),
          aliases: uniqueStrings(record.aliases).map((item) => normalizeObjectName(item)).sort(),
        };
      }
      if (schemaName === "workflow_v2_cycle_resolve") {
        return {
          remove_edge_id: asText(record.remove_edge_id),
        };
      }
      if (schemaName === "workflow_v2_parent_ablation") {
        const impact = asRecord(record.impact_on_parent);
        return {
          parent_object_id: asText(impact.parent_object_id),
          importance_level: asText(impact.importance_level),
        };
      }
      return {
        ...record,
        reason: undefined,
        citation: undefined,
        citations: undefined,
        confidence: undefined,
        judgement: undefined,
      };
    },
    pickShell() {
      return {};
    },
    wrap(items) {
      return asRecord(items[0]);
    },
  };
}

function buildWorkflowV2SharedAndConflictItems(stage, responseSchema, modelAData, modelBData) {
  const shape = buildWorkflowV2EnsembleShape(stage, responseSchema);

  if (shape.kind === "single_object") {
    const aValue = asRecord(modelAData);
    const bValue = asRecord(modelBData);
    const hasA = Object.keys(aValue).length > 0;
    const hasB = Object.keys(bValue).length > 0;
    const aComparable = shape.buildComparableValue(aValue);
    const bComparable = shape.buildComparableValue(bValue);

    if (!hasA && !hasB) {
      return {
        shape,
        shell: {},
        shared_items: [],
        conflicts: [],
      };
    }

    if (stableJsonStringify(aComparable) === stableJsonStringify(bComparable)) {
      return {
        shape,
        shell: {},
        shared_items: [{
          item_key: "__root__",
          order: 0,
          value: cloneJsonValue(hasA && hasB ? mergeWorkflowV2SharedValue(aValue, bValue) : (hasA ? aValue : bValue), {}),
        }],
        conflicts: [],
      };
    }

    return {
      shape,
      shell: {},
      shared_items: [],
      conflicts: [{
        item_key: "__root__",
        order: 0,
        model_a_value: hasA ? cloneJsonValue(aValue, {}) : null,
        model_b_value: hasB ? cloneJsonValue(bValue, {}) : null,
      }],
    };
  }

  const modelAItems = shape.extractItems(modelAData).map((item, index) => ({
    order: index,
    item_key: shape.getItemKey(item, index),
    item,
  }));
  const modelBItems = shape.extractItems(modelBData).map((item, index) => ({
    order: index,
    item_key: shape.getItemKey(item, index),
    item,
  }));
  const modelAMap = new Map(modelAItems.map((item) => [item.item_key, item]));
  const modelBMap = new Map(modelBItems.map((item) => [item.item_key, item]));
  const allKeys = uniqueStrings([
    ...modelAItems.map((item) => item.item_key),
    ...modelBItems.map((item) => item.item_key),
  ]);
  const sharedItems = [];
  const conflicts = [];

  for (const [index, itemKey] of allKeys.entries()) {
    const left = modelAMap.get(itemKey) || null;
    const right = modelBMap.get(itemKey) || null;
    const leftValue = left ? cloneJsonValue(left.item, null) : null;
    const rightValue = right ? cloneJsonValue(right.item, null) : null;
    const leftComparable = left ? shape.buildComparableValue(left.item) : null;
    const rightComparable = right ? shape.buildComparableValue(right.item) : null;
    if (leftValue !== null && rightValue !== null && stableJsonStringify(leftComparable) === stableJsonStringify(rightComparable)) {
      sharedItems.push({
        item_key: itemKey,
        order: Math.min(left.order, right.order),
        value: mergeWorkflowV2SharedValue(leftValue, rightValue),
      });
      continue;
    }
    conflicts.push({
      item_key: itemKey || `${shape.containerKey}:${index + 1}`,
      order: Math.min(left?.order ?? Number.MAX_SAFE_INTEGER, right?.order ?? Number.MAX_SAFE_INTEGER, index),
      model_a_value: leftValue,
      model_b_value: rightValue,
    });
  }

  const shell = (() => {
    const leftShell = shape.pickShell(modelAData);
    if (Object.keys(leftShell).length > 0) {
      return leftShell;
    }
    return shape.pickShell(modelBData);
  })();

  return {
    shape,
    shell,
    shared_items: sharedItems.sort((left, right) => left.order - right.order),
    conflicts: conflicts.sort((left, right) => left.order - right.order),
  };
}

function buildWorkflowV2ConflictJudgePrompt({
  stage,
  instruction,
  retryHint,
  payload,
  conflicts,
  sharedItems,
  modelRuns,
  reviewRounds = [],
}) {
  return {
    instruction: [
      "你是文件工作流 V2 的分歧判决器。",
      `当前阶段：${stage}`,
      "模型 A 与模型 B 已各自完成一次结构化输出。",
      "请保留双方完全一致的 shared_items，只对 conflicts 做判决。",
      "对每个 conflict，你只能二选一，selected_model 只能写 model_a 或 model_b。",
      "不要融合答案，不要改写成第三种结果，不要混合两边字段。",
      "你必须参考 model_a_review 和 model_b_review 中的点评意见，再做最终选择。",
      "优先选择更符合原任务约束、citation 更完整、字段更自洽、结构更稳定的一侧。",
      retryHint ? `补充要求：${retryHint}` : "",
      "原始任务要求如下：",
      instruction,
    ].filter(Boolean).join("\n"),
    responseSchema: WORKFLOW_V2_PICK_CONFLICT_RESPONSE_SCHEMA,
    payload: {
      original_payload: payload,
      shared_items: sharedItems.map((item) => ({
        item_key: item.item_key,
        value: item.value,
      })),
      conflicts: conflicts.map((item) => ({
        item_key: item.item_key,
        model_a_value: item.model_a_value,
        model_b_value: item.model_b_value,
      })),
      model_reviews: reviewRounds,
      model_a_review: reviewRounds.find((item) => item?.reviewer_model_key === "model_a")?.data ?? null,
      model_b_review: reviewRounds.find((item) => item?.reviewer_model_key === "model_b")?.data ?? null,
      model_a_name: modelRuns[0]?.model || "model_a",
      model_b_name: modelRuns[1]?.model || "model_b",
    },
  };
}

function buildWorkflowV2ConflictReviewPrompt({
  stage,
  instruction,
  retryHint,
  payload,
  conflicts,
  sharedItems,
  reviewer,
}) {
  const targetModel = reviewer.key === "model_a" ? "model_b" : "model_a";
  return {
    instruction: [
      "你是文件工作流 V2 的冲突点评者。",
      `当前阶段：${stage}`,
      `你当前代表 ${reviewer.key}，请逐条点评 unresolved conflicts，并判断你更支持 model_a 还是 model_b。`,
      `请重点指出 ${targetModel} 的问题、可取之处，以及你建议 judge 最终如何取舍。`,
      "preferred_model 只能写 model_a、model_b 或 tie。",
      "suggestion 要写给 judge 的简短取舍建议，而不是重写结果。",
      retryHint ? `补充要求：${retryHint}` : "",
      "原始任务要求如下：",
      instruction,
    ].filter(Boolean).join("\n"),
    responseSchema: WORKFLOW_V2_CONFLICT_REVIEW_RESPONSE_SCHEMA,
    payload: {
      original_payload: payload,
      shared_items: sharedItems.map((item) => ({
        item_key: item.item_key,
        value: item.value,
      })),
      unresolved_conflicts: conflicts.map((item) => ({
        item_key: item.item_key,
        model_a_value: item.model_a_value,
        model_b_value: item.model_b_value,
      })),
      reviewer_model_key: reviewer.key,
      reviewer_model_name: reviewer.model,
    },
  };
}

function normalizeWorkflowV2JudgeResult(data, conflicts) {
  const conflictMap = new Map((Array.isArray(conflicts) ? conflicts : []).map((item) => [item.item_key, item]));
  const record = asRecord(data);
  const resolved = Array.isArray(record.resolved_conflicts)
    ? record.resolved_conflicts.map((item) => asRecord(item)).map((item) => {
      const itemKey = asText(item.item_key);
      if (!itemKey || !conflictMap.has(itemKey)) {
        return null;
      }
      const selectedModel = asText(item.selected_model) === "model_b" ? "model_b" : "model_a";
      return {
        item_key: itemKey,
        selected_model: selectedModel,
        reason: asText(item.reason) || "判决模型认为该侧更符合原始任务要求。",
      };
    }).filter(Boolean)
    : [];

  return {
    resolved_conflicts: resolved,
    reason: asText(record.reason),
  };
}

function normalizeWorkflowV2ReviewResult(data, conflicts) {
  const conflictMap = new Map((Array.isArray(conflicts) ? conflicts : []).map((item) => [item.item_key, item]));
  const record = asRecord(data);
  const reviews = Array.isArray(record.conflict_reviews)
    ? record.conflict_reviews.map((item) => asRecord(item)).map((item) => {
      const itemKey = asText(item.item_key);
      if (!itemKey || !conflictMap.has(itemKey)) {
        return null;
      }
      const preferredModel = (() => {
        const value = asText(item.preferred_model);
        if (value === "model_a" || value === "model_b" || value === "tie") {
          return value;
        }
        return "tie";
      })();
      return {
        item_key: itemKey,
        preferred_model: preferredModel,
        confidence: clampConfidence(item.confidence, 0.5),
        reason: asText(item.reason) || "该点评解释了 reviewer 的取舍倾向。",
        suggestion: asText(item.suggestion) || "请综合双方证据后再做最终选择。",
      };
    }).filter(Boolean)
    : [];
  return {
    conflict_reviews: reviews,
    round_summary: asText(record.round_summary),
  };
}

function buildWorkflowV2ReviewRoundData(conflicts, normalizedReview, reviewer) {
  const reviewMap = new Map(
    (Array.isArray(normalizedReview?.conflict_reviews) ? normalizedReview.conflict_reviews : [])
      .map((item) => [item.item_key, item]),
  );

  const resolvedConflicts = (Array.isArray(conflicts) ? conflicts : []).map((conflict) => {
    const review = reviewMap.get(conflict.item_key);
    if (!review) {
      return null;
    }

    const preferredModel = review.preferred_model;
    const pickedValue = preferredModel === "model_b"
      ? (conflict.model_b_value ?? conflict.model_a_value ?? null)
      : preferredModel === "model_a"
        ? (conflict.model_a_value ?? conflict.model_b_value ?? null)
        : mergeWorkflowV2SharedValue(conflict.model_a_value, conflict.model_b_value);

    return {
      item_key: conflict.item_key,
      decision: preferredModel === "tie" ? "建议继续裁决" : `建议保留 ${preferredModel}`,
      summary: review.reason,
      final_value: cloneJsonValue(pickedValue, {}),
      citations: [
        {
          target_model: preferredModel === "tie" ? reviewer.key : preferredModel,
          stance: preferredModel === "tie" ? "修改" : "同意",
          reason: review.reason,
          suggestion: review.suggestion,
        },
      ],
    };
  }).filter(Boolean);

  const remainingConflicts = resolvedConflicts
    .filter((item) => item.decision === "建议继续裁决")
    .map((item) => item.item_key);

  return {
    resolved_conflicts: resolvedConflicts,
    remaining_conflicts: remainingConflicts,
    conflict_reviews: cloneJsonValue(normalizedReview?.conflict_reviews, []),
    round_summary: asText(normalizedReview?.round_summary) || `${reviewer.key} 已完成冲突点评。`,
  };
}

function buildWorkflowV2FinalEnsembleData(comparison, judgeSelections) {
  const selectionMap = new Map((judgeSelections?.resolved_conflicts ?? []).map((item) => [item.item_key, item]));
  const shape = comparison.shape;
  const pickConflictValue = (conflict) => {
    const selection = selectionMap.get(conflict?.item_key || "");
    if (selection?.selected_model === "model_b") {
      return cloneJsonValue(conflict?.model_b_value, null);
    }
    if (selection?.selected_model === "model_a") {
      return cloneJsonValue(conflict?.model_a_value, null);
    }
    return cloneJsonValue(conflict?.model_a_value ?? conflict?.model_b_value, null);
  };
  const pickFinalShell = (mergedItems) => {
    const modelAShell = asRecord(comparison.model_a_shell);
    const modelBShell = asRecord(comparison.model_b_shell);
    const selectedModels = comparison.conflicts
      .map((item) => asText(selectionMap.get(item.item_key)?.selected_model))
      .filter(Boolean);

    if (mergedItems.length === 0 && comparison.shared_items.length === 0) {
      if (selectedModels.length > 0 && selectedModels.every((item) => item === "model_b")) {
        return modelBShell;
      }
      if (selectedModels.length > 0 && selectedModels.every((item) => item === "model_a")) {
        return modelAShell;
      }
    }

    if (Object.keys(modelAShell).length > 0) {
      return modelAShell;
    }
    return modelBShell;
  };

  if (shape.kind === "single_object") {
    const shared = comparison.shared_items[0]?.value;
    if (shared && typeof shared === "object" && !Array.isArray(shared)) {
      return cloneJsonValue(shared, {});
    }
    const conflict = comparison.conflicts[0] || null;
    const selection = selectionMap.get(conflict?.item_key || "__root__");
    if (!conflict) {
      return {};
    }
    if (selection?.selected_model === "model_b") {
      return cloneJsonValue(conflict.model_b_value, {});
    }
    if (selection?.selected_model === "model_a") {
      return cloneJsonValue(conflict.model_a_value, {});
    }
    return cloneJsonValue(conflict.model_a_value ?? conflict.model_b_value, {});
  }

  const mergedItems = [
    ...comparison.shared_items.map((item) => ({
      order: item.order,
      value: cloneJsonValue(item.value, null),
    })),
    ...comparison.conflicts.map((item) => {
      return {
        order: item.order,
        value: pickConflictValue(item),
      };
    }),
  ].filter((item) => item.value !== null)
    .sort((left, right) => left.order - right.order)
    .map((item) => item.value);

  return shape.wrap(mergedItems, pickFinalShell(mergedItems));
}

function createDocumentRecord({ conversationId, fileName, projectId, rawText }) {
  const normalizedText = typeof rawText === "string" ? rawText.replace(/\r\n/g, "\n") : "";
  return {
    document_id: `doc-${buildSlug(conversationId || fileName || projectId, "workflow-v2")}`,
    file_name: fileName || "upload.txt",
    project_id: projectId || "demo",
    raw_text: normalizedText,
    language: /[A-Za-z]/.test(normalizedText) && /[\u4e00-\u9fff]/.test(normalizedText)
      ? "mixed"
      : /[A-Za-z]/.test(normalizedText) ? "en" : "zh",
    reason: "该记录保存了本次 V2 工作流的原始文档文本，供后续所有阶段引用。",
  };
}

export class WorkflowV2Service extends LinearWorkflowService {
  constructor(options = {}) {
    super(options);
    this.chunkMaxChars = asInteger(options.chunkMaxChars, DEFAULT_CHUNK_MAX_CHARS, 120);
    this.chunkMinChars = asInteger(options.chunkMinChars, DEFAULT_CHUNK_MIN_CHARS, 20);
    this.windowSize = asInteger(options.windowSize, DEFAULT_WINDOW_SIZE, 2);
    this.windowStep = asInteger(options.windowStep, DEFAULT_WINDOW_STEP, 1);
    this.parallelWindows = asInteger(options.parallelWindows, DEFAULT_PARALLEL_WINDOWS, 1);
    this.workflowLlmTimeoutMs = asInteger(options.workflowLlmTimeoutMs, DEFAULT_WORKFLOW_LLM_TIMEOUT_MS, 1000);
    this.ablationParentConcurrency = asInteger(options.ablationParentConcurrency, DEFAULT_ABLATION_PARENT_CONCURRENCY, 1);
    this.ablationChildConcurrency = asInteger(options.ablationChildConcurrency, DEFAULT_ABLATION_CHILD_CONCURRENCY, 1);
    this.workflowJudgeModel = asText(options.workflowJudgeModel) || this.workflowModelA;
    this.workflowV2EnvResolver = typeof options.workflowV2EnvResolver === "function"
      ? options.workflowV2EnvResolver
      : this.workflowEnvResolver;
    this.llmJsonInvokerBase = typeof options.llmJsonInvoker === "function"
      ? options.llmJsonInvoker
      : ((input) => this.invokeWorkflowV2Json(input));
  }

  getWorkflowConfig() {
    return {
      workflowModel: this.workflowModelA,
      workflowModelA: this.workflowModelA,
      workflowModelB: this.workflowModelB,
      workflowJudgeModel: this.workflowJudgeModel,
      chunkMaxChars: this.chunkMaxChars,
      chunkMinChars: this.chunkMinChars,
      windowSize: this.windowSize,
      windowStep: this.windowStep,
      parallelWindows: this.parallelWindows,
    };
  }

  setWorkflowConfig(input = {}) {
    const nextPrimary = asText(input.workflowModelA) || asText(input.workflowModel);
    const nextSecondary = asText(input.workflowModelB);
    const nextJudgeModel = asText(input.workflowJudgeModel);
    if (input.workflowModel !== undefined && !nextPrimary) {
      throw new Error("workflow model cannot be empty");
    }
    if (input.workflowModelA !== undefined && !nextPrimary) {
      throw new Error("workflow model A cannot be empty");
    }
    if (input.workflowModelB !== undefined && !nextSecondary) {
      throw new Error("workflow model B cannot be empty");
    }
    if (input.workflowJudgeModel !== undefined && !nextJudgeModel) {
      throw new Error("workflow judge model cannot be empty");
    }
    if (nextPrimary) {
      this.workflowModel = nextPrimary;
      this.workflowModelA = nextPrimary;
      this.manualWorkflowConfig.workflowModel = nextPrimary;
      this.manualWorkflowConfig.workflowModelA = nextPrimary;
      if (input.workflowModel !== undefined && input.workflowModelB === undefined) {
        this.workflowModelB = nextPrimary;
        this.manualWorkflowConfig.workflowModelB = nextPrimary;
      }
      if (input.workflowModel !== undefined && input.workflowJudgeModel === undefined) {
        this.workflowJudgeModel = nextPrimary;
        this.manualWorkflowConfig.workflowJudgeModel = nextPrimary;
      }
    }
    if (nextSecondary) {
      this.workflowModelB = nextSecondary;
      this.manualWorkflowConfig.workflowModelB = nextSecondary;
    }
    if (nextJudgeModel) {
      this.workflowJudgeModel = nextJudgeModel;
      this.manualWorkflowConfig.workflowJudgeModel = nextJudgeModel;
    }
    if (input.chunkMaxChars !== undefined) {
      this.chunkMaxChars = asInteger(input.chunkMaxChars, this.chunkMaxChars, 120);
      this.manualWorkflowConfig.chunkMaxChars = this.chunkMaxChars;
    }
    if (input.chunkMinChars !== undefined) {
      this.chunkMinChars = asInteger(input.chunkMinChars, this.chunkMinChars, 20);
      this.manualWorkflowConfig.chunkMinChars = this.chunkMinChars;
    }
    if (input.windowSize !== undefined) {
      this.windowSize = asInteger(input.windowSize, this.windowSize, 2);
      this.manualWorkflowConfig.windowSize = this.windowSize;
    }
    if (input.windowStep !== undefined) {
      this.windowStep = asInteger(input.windowStep, this.windowStep, 1);
      this.manualWorkflowConfig.windowStep = this.windowStep;
    }
    if (input.parallelWindows !== undefined) {
      this.parallelWindows = asInteger(input.parallelWindows, this.parallelWindows, 1);
      this.manualWorkflowConfig.parallelWindows = this.parallelWindows;
    }
    return this.getWorkflowConfig();
  }

  async refreshWorkflowConfigFromResolver() {
    await super.refreshWorkflowConfigFromResolver();
    if (!this.workflowV2EnvResolver) {
      return;
    }
    const resolved = await this.workflowV2EnvResolver();
    const config = asRecord(resolved);
    if (config.chunkMaxChars !== undefined) {
      this.chunkMaxChars = asInteger(config.chunkMaxChars, this.chunkMaxChars, 120);
    }
    if (config.chunkMinChars !== undefined) {
      this.chunkMinChars = asInteger(config.chunkMinChars, this.chunkMinChars, 20);
    }
    if (config.windowSize !== undefined) {
      this.windowSize = asInteger(config.windowSize, this.windowSize, 2);
    }
    if (config.windowStep !== undefined) {
      this.windowStep = asInteger(config.windowStep, this.windowStep, 1);
    }
    if (config.parallelWindows !== undefined) {
      this.parallelWindows = asInteger(config.parallelWindows, this.parallelWindows, 1);
    }
    if (config.workflowJudgeModel !== undefined) {
      const nextJudgeModel = asText(config.workflowJudgeModel);
      if (nextJudgeModel) {
        this.workflowJudgeModel = nextJudgeModel;
      }
    }

    const manualConfig = asRecord(this.manualWorkflowConfig);
    const manualJudgeModel = asText(manualConfig.workflowJudgeModel);
    if (manualJudgeModel) {
      this.workflowJudgeModel = manualJudgeModel;
    }
    if (manualConfig.chunkMaxChars !== undefined) {
      this.chunkMaxChars = asInteger(manualConfig.chunkMaxChars, this.chunkMaxChars, 120);
    }
    if (manualConfig.chunkMinChars !== undefined) {
      this.chunkMinChars = asInteger(manualConfig.chunkMinChars, this.chunkMinChars, 20);
    }
    if (manualConfig.windowSize !== undefined) {
      this.windowSize = asInteger(manualConfig.windowSize, this.windowSize, 2);
    }
    if (manualConfig.windowStep !== undefined) {
      this.windowStep = asInteger(manualConfig.windowStep, this.windowStep, 1);
    }
    if (manualConfig.parallelWindows !== undefined) {
      this.parallelWindows = asInteger(manualConfig.parallelWindows, this.parallelWindows, 1);
    }
  }

  getWorkflowSnapshotPath(conversationId) {
    return path.join(this.getConversationRuntimeRoot(conversationId || "session"), WORKFLOW_V2_SNAPSHOT_FILE);
  }

  async writeWorkflowSnapshot(conversationId, snapshot) {
    const runtimeRoot = await this.ensureConversationRuntime(conversationId || "session");
    const snapshotPath = path.join(runtimeRoot, WORKFLOW_V2_SNAPSHOT_FILE);
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  }

  async readWorkflowSnapshot(conversationId) {
    const snapshotPath = this.getWorkflowSnapshotPath(conversationId || "session");
    const content = await readFile(snapshotPath, "utf8");
    const parsed = safeJsonParse(content);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("workflow v2 snapshot is invalid");
    }
    return parsed;
  }

  async invokeWorkflowV2Json({
    stage,
    instruction,
    payload,
    responseSchema = null,
    retryHint = "",
    modelOverride = "",
    temperature = 0,
  }) {
    if (!this.workflowLlmApiKey || !this.workflowLlmBaseUrl) {
      await this.refreshWorkflowConfigFromResolver();
    }
    if (!this.workflowLlmApiKey || !this.workflowLlmBaseUrl) {
      throw new Error("workflow LLM is not configured");
    }

    const requestBody = {
      model: asText(modelOverride) || this.workflowModelA,
      temperature,
      stream: false,
      messages: [
        {
          role: "system",
          content: [
            "你是文件工作流 V2 的结构化分析助手。",
            "你只能根据输入内容回答。",
            "你必须只输出合法 JSON，不能输出 Markdown 或解释。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `当前阶段：${stage}`,
            instruction,
            retryHint ? `补充要求：${retryHint}` : "",
            "输入如下：",
            JSON.stringify(payload, null, 2),
          ].filter(Boolean).join("\n\n"),
        },
      ],
    };
    const responseFormat = buildResponseFormat(responseSchema);
    if (responseFormat) {
      requestBody.response_format = responseFormat;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error(`workflow V2 LLM request timed out after ${this.workflowLlmTimeoutMs}ms`)), this.workflowLlmTimeoutMs);
    let response;
    try {
      response = await fetch(`${this.workflowLlmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.workflowLlmApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`workflow V2 LLM request timed out after ${this.workflowLlmTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`workflow V2 LLM request failed: ${response.status} ${text}`);
    }

    const responseText = await response.text();
    const json = safeJsonParse(responseText);
    if (!json) {
      throw attachV2StageDebug(new Error(buildNonJsonResponseErrorMessage("workflow V2 LLM", this.workflowLlmBaseUrl, responseText)), {
        llm_raw_text: responseText,
        llm_response: null,
        debug_error: "workflow V2 LLM endpoint returned non-JSON response",
      });
    }
    const content = asText(json?.choices?.[0]?.message?.content);
    const parsed = parseWorkflowV2JsonResponseText(content);
    if (!parsed) {
      throw attachV2StageDebug(new Error("workflow V2 LLM returned invalid JSON"), {
        llm_raw_text: content,
        llm_response: json,
        debug_error: "workflow V2 LLM returned invalid JSON",
      });
    }
    return {
      llm_raw: parsed,
      llm_raw_text: content,
      llm_response: json,
      data: parsed,
    };
  }

  async invokeStageJson(input) {
    const stage = asText(input?.stage) || "unknown";
    const instruction = asText(input?.instruction);
    const payload = input?.payload;
    const responseSchema = input?.responseSchema ?? null;
    const retryHint = asText(input?.retryHint);
    const modelRuns = [
      { key: "model_a", model: this.workflowModelA || this.workflowModel },
      { key: "model_b", model: this.workflowModelB || this.workflowModelA || this.workflowModel },
    ];
    const llmEnsemble = {
      strategy: "shared-review-judge-pick",
      stage,
      parallel_count: 1,
      debate_rounds: 2,
      judge_model: this.workflowJudgeModel || this.workflowModelA,
      models: {
        model_a: {
          model: modelRuns[0].model,
          single_result: null,
        },
        model_b: {
          model: modelRuns[1].model,
          single_result: null,
        },
      },
      shared_items: [],
      conflicts: [],
      cross_rounds: [],
      judge_result: null,
      final_result: null,
    };

    const modelResults = await Promise.all(modelRuns.map(async (modelRun) => {
      try {
        const result = await this.llmJsonInvokerBase({
          stage,
          instruction,
          payload,
          responseSchema,
          retryHint,
          temperature: 0,
          modelOverride: modelRun.model,
          ensembleRole: "dual_run",
          ensembleModelKey: modelRun.key,
        });
        const normalizedResult = {
          llm_raw: result?.llm_raw ?? result?.data ?? result,
          llm_raw_text: asText(result?.llm_raw_text),
          llm_response: result?.llm_response,
          data: result?.data ?? result?.llm_raw ?? result,
        };
        llmEnsemble.models[modelRun.key].single_result = compactV2EnsembleEntry(normalizedResult, {
          model: modelRun.model,
          status: "completed",
        });
        return {
          ok: true,
          modelRun,
          result: normalizedResult,
        };
      } catch (error) {
        llmEnsemble.models[modelRun.key].single_result = {
          model: modelRun.model,
          data: null,
          raw_text: getErrorRawText(error),
          status: "failed",
          error: getErrorMessage(error, "workflow V2 LLM request failed"),
        };
        return {
          ok: false,
          modelRun,
          error,
        };
      }
    }));

    const successfulResults = modelResults.filter((item) => item.ok);
    if (successfulResults.length === 0) {
      const firstError = modelResults.find((item) => !item.ok)?.error || new Error("workflow V2 stage invocation failed");
      throw attachV2StageDebug(firstError, {
        llm_ensemble: llmEnsemble,
      });
    }

    if (successfulResults.length === 1) {
      const winner = successfulResults[0];
      llmEnsemble.final_result = compactV2EnsembleEntry(winner.result, {
        source: winner.modelRun.key,
        status: "completed",
      });
      return {
        llm_raw: winner.result.llm_raw,
        llm_raw_text: winner.result.llm_raw_text,
        llm_response: winner.result.llm_response,
        llm_ensemble: llmEnsemble,
        data: winner.result.data,
      };
    }

    const modelAResult = successfulResults.find((item) => item.modelRun.key === "model_a")?.result ?? successfulResults[0].result;
    const modelBResult = successfulResults.find((item) => item.modelRun.key === "model_b")?.result ?? successfulResults[1].result;
    const comparison = buildWorkflowV2SharedAndConflictItems(
      stage,
      responseSchema,
      modelAResult.data ?? modelAResult.llm_raw ?? null,
      modelBResult.data ?? modelBResult.llm_raw ?? null,
    );
    llmEnsemble.shared_items = comparison.shared_items.map((item) => ({
      item_key: item.item_key,
      order: item.order,
      value: cloneJsonValue(item.value, null),
    }));
    llmEnsemble.conflicts = comparison.conflicts.map((item) => ({
      item_key: item.item_key,
      order: item.order,
      model_a_value: cloneJsonValue(item.model_a_value, null),
      model_b_value: cloneJsonValue(item.model_b_value, null),
    }));

    let judgeResult = null;
    let finalData = null;
    if (comparison.conflicts.length > 0) {
      const reviewResults = await Promise.all(modelRuns.map(async (reviewer, index) => {
        const reviewPrompt = buildWorkflowV2ConflictReviewPrompt({
          stage,
          instruction,
          retryHint,
          payload,
          conflicts: comparison.conflicts,
          sharedItems: comparison.shared_items,
          reviewer,
        });

        try {
          const reviewResult = await this.llmJsonInvokerBase({
            stage,
            instruction: reviewPrompt.instruction,
            payload: reviewPrompt.payload,
            responseSchema: reviewPrompt.responseSchema,
            retryHint: "",
            temperature: 0,
            modelOverride: reviewer.model,
            ensembleRole: "cross_round",
            ensembleModelKey: reviewer.key,
          });
          const normalizedReviewResult = {
            llm_raw: reviewResult?.llm_raw ?? reviewResult?.data ?? reviewResult,
            llm_raw_text: asText(reviewResult?.llm_raw_text),
            llm_response: reviewResult?.llm_response,
            data: reviewResult?.data ?? reviewResult?.llm_raw ?? reviewResult,
          };
          const normalizedReview = normalizeWorkflowV2ReviewResult(normalizedReviewResult.data, comparison.conflicts);
          const roundData = buildWorkflowV2ReviewRoundData(comparison.conflicts, normalizedReview, reviewer);
          const roundEntry = compactV2EnsembleEntry({
            ...normalizedReviewResult,
            data: roundData,
          }, {
            round: index + 1,
            reviewer_model: reviewer.model,
            reviewer_model_key: reviewer.key,
            status: "completed",
          });
          llmEnsemble.cross_rounds[index] = roundEntry;
          return {
            ok: true,
            reviewer,
            roundEntry,
            review: normalizedReview,
          };
        } catch (error) {
          llmEnsemble.cross_rounds[index] = {
            round: index + 1,
            reviewer_model: reviewer.model,
            reviewer_model_key: reviewer.key,
            data: null,
            raw_text: getErrorRawText(error),
            status: "failed",
            error: getErrorMessage(error, "workflow V2 conflict review failed"),
          };
          return {
            ok: false,
            reviewer,
            error,
          };
        }
      }));

      const completedReviews = reviewResults
        .filter((item) => item.ok && item.roundEntry)
        .map((item) => item.roundEntry);
      const judgePrompt = buildWorkflowV2ConflictJudgePrompt({
        stage,
        instruction,
        retryHint,
        payload,
        conflicts: comparison.conflicts,
        sharedItems: comparison.shared_items,
        modelRuns,
        reviewRounds: completedReviews,
      });
      try {
        judgeResult = await this.llmJsonInvokerBase({
          stage,
          instruction: judgePrompt.instruction,
          payload: judgePrompt.payload,
          responseSchema: judgePrompt.responseSchema,
          retryHint: "",
          temperature: 0,
          modelOverride: this.workflowJudgeModel || this.workflowModelA,
          ensembleRole: "judge_pick",
          ensembleModelKey: "judge",
        });
        const normalizedJudgeResult = {
          llm_raw: judgeResult?.llm_raw ?? judgeResult?.data ?? judgeResult,
          llm_raw_text: asText(judgeResult?.llm_raw_text),
          llm_response: judgeResult?.llm_response,
          data: judgeResult?.data ?? judgeResult?.llm_raw ?? judgeResult,
        };
        const normalizedSelections = normalizeWorkflowV2JudgeResult(normalizedJudgeResult.data, comparison.conflicts);
        llmEnsemble.judge_result = compactV2EnsembleEntry({
          ...normalizedJudgeResult,
          data: normalizedSelections,
        }, {
          model: this.workflowJudgeModel || this.workflowModelA,
          status: "completed",
        });
        finalData = buildWorkflowV2FinalEnsembleData(comparison, normalizedSelections);
      } catch (error) {
        llmEnsemble.judge_result = {
          model: this.workflowJudgeModel || this.workflowModelA,
          data: null,
          raw_text: getErrorRawText(error),
          status: "failed",
          error: getErrorMessage(error, "workflow V2 judge failed"),
        };
        finalData = buildWorkflowV2FinalEnsembleData(comparison, {
          resolved_conflicts: comparison.conflicts.map((item) => ({
            item_key: item.item_key,
            selected_model: "model_a",
            reason: "判决模型失败，回退到模型 A。",
          })),
        });
      }
    }

    if (!finalData) {
      finalData = buildWorkflowV2FinalEnsembleData(comparison, { resolved_conflicts: [] });
    }
    const finalRawText = judgeResult?.llm_raw_text || JSON.stringify(finalData);
    llmEnsemble.final_result = {
      source: comparison.conflicts.length > 0 ? "judge_pick" : "shared_consensus",
      data: cloneJsonValue(finalData, null),
      raw_text: finalRawText,
      status: "completed",
    };
    return {
      llm_raw: finalData,
      llm_raw_text: finalRawText,
      llm_response: judgeResult?.llm_response,
      llm_ensemble: llmEnsemble,
      data: finalData,
    };
  }

  buildInitialStageResults() {
    return WORKFLOW_V2_STAGE_KEYS.map((stage, index) => ({
      stage,
      order: index + 1,
      status: "pending",
      started_at: null,
      finished_at: null,
      output: null,
      error: null,
    }));
  }

  async retryFileWorkflowFromStage(input) {
    const conversationId = asText(input?.conversationId) || "file-workflow-v2";
    const projectId = asText(input?.projectId);
    const startStage = asText(input?.startStage);
    const runtimeRoot = this.getConversationRuntimeRoot(conversationId);

    if (!projectId) {
      return createV2ResponseEnvelope({
        ok: false,
        stageResults: [],
        errors: [{ stage: "request", message: "projectId is required" }],
        runtimeRoot,
        inputFile: null,
        result: emptyWorkflowV2Result(),
      });
    }
    if (!startStage || !WORKFLOW_V2_STAGE_KEYS.includes(startStage)) {
      return createV2ResponseEnvelope({
        ok: false,
        stageResults: [],
        errors: [{ stage: "request", message: "startStage is invalid" }],
        runtimeRoot,
        inputFile: null,
        result: emptyWorkflowV2Result(),
      });
    }

    const snapshot = await this.readWorkflowSnapshot(conversationId);
    const retryValidation = validateWorkflowV2RetrySnapshot(snapshot, startStage);
    if (!retryValidation.ok) {
      return createV2ResponseEnvelope({
        ok: false,
        stageResults: Array.isArray(snapshot?.stage_results) ? snapshot.stage_results : [],
        errors: [{ stage: "request", message: retryValidation.message }],
        runtimeRoot,
        inputFile: asRecord(snapshot?.input_file),
        result: {
          ...buildWorkflowV2ResultFromState(snapshot?.state),
          reason: "重试请求被拒绝，因为当前阶段状态或前序阶段状态不满足重试条件。",
        },
      });
    }

    return this.runFileWorkflow({
      projectId,
      conversationId,
      fileName: asText(snapshot?.input_file?.originalName) || "upload.txt",
      mimeType: asText(snapshot?.input_file?.mimeType) || "text/plain",
      resumeFromStageIndex: retryValidation.stageIndex,
      resumeSnapshot: snapshot,
      handlers: input?.handlers,
    });
  }

  async getFileWorkflowSession(conversationId) {
    const normalizedConversationId = asText(conversationId) || "file-workflow-v2";
    const runtimeRoot = this.getConversationRuntimeRoot(normalizedConversationId);
    const snapshot = await this.readWorkflowSnapshot(normalizedConversationId);
    const stageResults = Array.isArray(snapshot?.stage_results) ? snapshot.stage_results : [];
    const workflowStatus = deriveWorkflowV2SnapshotStatus(stageResults);
    const errors = deriveWorkflowV2Errors(stageResults);
    const snapshotResult = asRecord(snapshot?.result);
    const result = Object.keys(snapshotResult).length > 0
      ? snapshotResult
      : {
        ...buildWorkflowV2ResultFromState(snapshot?.state),
        reason: workflowStatus === "running"
          ? "已从服务端快照恢复当前 V2 工作流的阶段结果与中间产物。"
          : "已从服务端快照恢复当前 V2 工作流结果。",
      };

    return {
      ok: workflowStatus === "success",
      workflow: {
        mode: "analysis-v2",
        status: workflowStatus,
        steps: [...WORKFLOW_V2_STAGE_KEYS],
      },
      input_file: asRecord(snapshot?.input_file),
      stage_results: stageResults,
      errors,
      runtime_root: runtimeRoot,
      result,
      started_at: deriveWorkflowV2StartedAt(stageResults),
      finished_at: deriveWorkflowV2FinishedAt(stageResults, workflowStatus),
    };
  }

  async chunkParseStage(document) {
    const text = asText(document?.raw_text);
    if (!text) {
      return {
        chunks: [],
        total_chunks: 0,
        reason: "输入文本为空，因此没有生成任何 chunk。",
      };
    }

    const rawParagraphs = [];
    const separatorRegex = /\n\s*\n+/g;
    let startOffset = 0;
    let paragraphIndex = 0;
    let match = separatorRegex.exec(text);
    while (match) {
      const end = match.index;
      const segment = text.slice(startOffset, end);
      const trimmed = segment.trim();
      if (trimmed) {
        const segmentStart = startOffset + segment.indexOf(trimmed);
        rawParagraphs.push({
          text: trimmed,
          start_offset: segmentStart,
          end_offset: segmentStart + trimmed.length,
          paragraph_index: paragraphIndex,
        });
        paragraphIndex += 1;
      }
      startOffset = match.index + match[0].length;
      match = separatorRegex.exec(text);
    }
    const trailing = text.slice(startOffset);
    const trailingTrimmed = trailing.trim();
    if (trailingTrimmed) {
      const segmentStart = startOffset + trailing.indexOf(trailingTrimmed);
      rawParagraphs.push({
        text: trailingTrimmed,
        start_offset: segmentStart,
        end_offset: segmentStart + trailingTrimmed.length,
        paragraph_index: paragraphIndex,
      });
    }

    const preChunks = [];
    for (const paragraph of rawParagraphs) {
      if (paragraph.text.length <= this.chunkMaxChars) {
        preChunks.push({
          ...paragraph,
          source_type: "paragraph",
        });
        continue;
      }
      const splitChunks = splitLongParagraph(paragraph, this.chunkMaxChars, paragraph.paragraph_index);
      for (const item of splitChunks) {
        preChunks.push({
          ...item,
          source_type: "sentence-merged",
        });
      }
    }

    const merged = [];
    const pending = preChunks.map((item) => ({ ...item }));
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      const last = merged.at(-1);
      const next = pending[index + 1];
      const isShortItem = item.text.length < this.chunkMinChars;
      if (isShortItem) {
        const canMergePrevious = Boolean(
          last && (last.text.length + 1 + item.text.length) <= this.chunkMaxChars,
        );
        const canMergeNext = Boolean(
          next && (item.text.length + 1 + next.text.length) <= this.chunkMaxChars,
        );
        const sameParagraphAsPrevious = Boolean(last && last.paragraph_index === item.paragraph_index);
        const weakStandalone = Boolean(
          next
          && item.paragraph_index !== next.paragraph_index
          && isWeakStandaloneParagraph(item.text, this.chunkMinChars),
        );
        const veryShortStandalone = item.text.length < Math.max(8, Math.floor(this.chunkMinChars / 2));
        const crossParagraphMergeEligible = weakStandalone || veryShortStandalone;

        if (sameParagraphAsPrevious && canMergePrevious) {
          last.text = `${last.text} ${item.text}`.trim();
          last.end_offset = item.end_offset;
          last.source_type = "short-merged";
          continue;
        }

        if (crossParagraphMergeEligible && canMergeNext) {
          pending[index + 1] = mergePreChunkItems(
            item,
            next,
            weakStandalone ? "heading-merged" : "neighbor-merged",
          );
          continue;
        }

        if (crossParagraphMergeEligible && canMergePrevious) {
          last.text = `${last.text}\n\n${item.text}`.trim();
          last.end_offset = item.end_offset;
          last.source_type = weakStandalone ? "heading-merged" : "neighbor-merged";
          continue;
        }
      }
      merged.push({ ...item });
    }

    const chunks = merged.map((item, index) => ({
      chunk_id: `c${index + 1}`,
      order: index + 1,
      text: item.text,
      start_offset: item.start_offset,
      end_offset: item.end_offset,
      paragraph_index: item.paragraph_index,
      reason: buildChunkReason(item.source_type, item.text),
    }));

    return {
      chunks,
      total_chunks: chunks.length,
      reason: "已优先按自然段切块，并对超长段做句界细分、对过短片段或弱语义短标题做相邻归并。",
    };
  }

  buildWindows(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return [];
    }
    const windows = [];
    const size = Math.max(2, this.windowSize);
    const step = Math.max(1, this.windowStep);
    for (let start = 0; start < chunks.length; start += step) {
      const windowChunks = chunks.slice(start, start + size);
      if (windowChunks.length === 0) {
        continue;
      }
      windows.push({
        window_id: `w${windows.length + 1}`,
        order: windows.length + 1,
        chunk_ids: windowChunks.map((chunk) => chunk.chunk_id),
        text: windowChunks.map((chunk) => chunk.text).join("\n\n"),
        start_chunk_order: windowChunks[0].order,
        end_chunk_order: windowChunks[windowChunks.length - 1].order,
        reason: buildWindowReason(windowChunks.map((chunk) => chunk.chunk_id)),
      });
      if (start + size >= chunks.length) {
        break;
      }
    }
    return windows;
  }

  async windowExtractStage(document, chunks, options = {}) {
    const windows = this.buildWindows(chunks);
    let completedWindows = 0;
    options?.onProgress?.({
      stage: "window_extract",
      completed: 0,
      total: windows.length,
      parallel: this.parallelWindows,
      message: windows.length > 0
        ? `第二阶段窗口抽取进行中：已完成 0 / ${windows.length} 个窗口。`
        : "第二阶段没有可执行的滑动窗口。",
    });
    const windowResults = await mapWithConcurrency(
      windows,
      this.parallelWindows,
      async (window) => {
        const prompt = buildWindowExtractPrompt(window);
        const llmResult = await this.invokeStageJson({
          stage: "window_extract",
          instruction: prompt.instruction,
          payload: prompt.payload,
          responseSchema: prompt.responseSchema,
        });
        const payload = asRecord(llmResult.data);
        const objects = Array.isArray(payload.objects) ? payload.objects.map((item) => {
          const record = asRecord(item);
          const objectName = asText(record.object_name);
          const normalizedName = normalizeObjectName(record.normalized_name || objectName);
          return {
            object_name: objectName,
            normalized_name: normalizedName,
            citation: uniqueStrings(record.citation),
            confidence: clampConfidence(record.confidence, 0.5),
            reason: asText(record.reason) || `${objectName || "该对象"} 在窗口文本中被识别为独立对象。`,
          };
        }).filter((item) => item.object_name && item.normalized_name) : [];
        completedWindows += 1;
        options?.onProgress?.({
          stage: "window_extract",
          completed: completedWindows,
          total: windows.length,
          parallel: this.parallelWindows,
          window_id: window.window_id,
          message: `第二阶段窗口抽取进行中：已完成 ${completedWindows} / ${windows.length} 个窗口。`,
        });
        return {
          window_id: window.window_id,
          objects,
          reason: asText(payload.reason) || "该窗口已完成对象抽取。",
          llm_ensemble: llmResult.llm_ensemble ?? null,
        };
      },
    );

    return {
      windows,
      total_windows: windows.length,
      window_results: windowResults,
      progress: {
        completed: windowResults.length,
        total: windows.length,
        parallel: this.parallelWindows,
      },
      reason: document.raw_text
        ? "已按滑动窗口并行完成对象抽取。"
        : "原始文本为空，因此窗口抽取结果为空。",
    };
  }

  shouldSendFusionJudge(existingObject, candidate) {
    const existing = normalizeObjectName(existingObject.object_name);
    const next = normalizeObjectName(candidate.object_name);
    if (!existing || !next || existing === next) {
      return false;
    }
    if (existing.includes(next) || next.includes(existing)) {
      return true;
    }
    const existingTokens = new Set(existing.split(/\s+/).filter(Boolean));
    const nextTokens = new Set(next.split(/\s+/).filter(Boolean));
    const overlap = [...existingTokens].filter((token) => nextTokens.has(token)).length;
    return overlap > 0 && overlap >= Math.min(existingTokens.size, nextTokens.size);
  }

  async objectFusionStage(windowResults) {
    const candidates = [];
    for (const windowResult of windowResults) {
      for (const object of Array.isArray(windowResult.objects) ? windowResult.objects : []) {
        candidates.push({
          ...object,
          source_window_id: windowResult.window_id,
        });
      }
    }

    const fused = [];
    const discardedCandidates = [];
    const judgeResults = [];

    for (const candidate of candidates) {
      const directMatch = fused.find((item) => item.normalized_name === candidate.normalized_name || item.aliases.includes(candidate.object_name));
      if (directMatch) {
        directMatch.aliases = uniqueStrings([...directMatch.aliases, candidate.object_name]);
        directMatch.citations = uniqueStrings([...directMatch.citations, ...candidate.citation]);
        directMatch.source_window_ids = uniqueStrings([...directMatch.source_window_ids, candidate.source_window_id]);
        directMatch.merge_reasons = uniqueStrings([...directMatch.merge_reasons, candidate.reason, "normalized_name 完全一致，因此直接合并。"]);
        directMatch.confidence = averageConfidence([directMatch.confidence, candidate.confidence]);
        directMatch.reason = "该对象由同名或已知别名候选合并而成。";
        continue;
      }

      const ambiguous = fused.find((item) => this.shouldSendFusionJudge(item, candidate));
      if (ambiguous) {
        const prompt = buildFusionJudgePrompt(ambiguous, candidate);
        const judgeResult = await this.invokeStageJson({
          stage: "object_fusion",
          instruction: prompt.instruction,
          payload: prompt.payload,
          responseSchema: prompt.responseSchema,
        });
        const judge = asRecord(judgeResult.data);
        if (judge.should_merge === true) {
          judgeResults.push({
            existing_object_name: ambiguous.object_name,
            candidate_object_name: candidate.object_name,
            selected_action: "merge",
            reason: asText(judge.reason) || "判决模型认为两个候选应合并。",
            llm_ensemble: judgeResult.llm_ensemble ?? null,
          });
          ambiguous.object_name = asText(judge.object_name) || ambiguous.object_name;
          ambiguous.normalized_name = normalizeObjectName(judge.normalized_name || ambiguous.normalized_name);
          ambiguous.aliases = uniqueStrings([...ambiguous.aliases, ...uniqueStrings(judge.aliases), candidate.object_name]);
          ambiguous.citations = uniqueStrings([...ambiguous.citations, ...candidate.citation]);
          ambiguous.source_window_ids = uniqueStrings([...ambiguous.source_window_ids, candidate.source_window_id]);
          ambiguous.merge_reasons = uniqueStrings([...ambiguous.merge_reasons, asText(judge.reason), candidate.reason]);
          ambiguous.confidence = averageConfidence([ambiguous.confidence, candidate.confidence]);
          ambiguous.reason = "该对象由同义或近义候选经裁决后融合而成。";
          continue;
        }
        judgeResults.push({
          existing_object_name: ambiguous.object_name,
          candidate_object_name: candidate.object_name,
          selected_action: "keep_separate",
          reason: asText(judge.reason) || "判决模型认为两个候选应保持分离。",
          llm_ensemble: judgeResult.llm_ensemble ?? null,
        });
      }

      fused.push({
        object_id: `obj-${buildSlug(candidate.normalized_name || candidate.object_name, "object")}-${fused.length + 1}`,
        object_name: candidate.object_name,
        normalized_name: candidate.normalized_name,
        aliases: uniqueStrings([candidate.object_name]),
        citations: uniqueStrings(candidate.citation),
        source_window_ids: uniqueStrings([candidate.source_window_id]),
        confidence: clampConfidence(candidate.confidence, 0.5),
        merge_reasons: uniqueStrings([candidate.reason]),
        reason: "该对象来自窗口抽取结果，当前没有发现需要与之合并的更早候选。",
      });
    }

    return {
      fused_objects: fused,
      total_fused_objects: fused.length,
      discarded_candidates: discardedCandidates,
      judge_results: judgeResults,
      reason: "已先按 normalized_name 直接合并，再对模糊候选执行 LLM 融合裁决。",
    };
  }

  async functionAnalysisStage(objects, options = {}) {
    let completedObjects = 0;
    options?.onProgress?.({
      stage: "function_analysis",
      completed: 0,
      total: objects.length,
      message: objects.length > 0
        ? `第四阶段功能分析进行中：已完成 0 / ${objects.length} 个对象。`
        : "第四阶段没有可分析核心功能的对象。",
    });

    const functionObjects = await mapWithConcurrency(
      objects,
      Math.min(4, Math.max(1, objects.length || 1)),
      async (object) => {
        const prompt = buildObjectFunctionPrompt(object);
        const llmResult = await this.invokeStageJson({
          stage: "function_analysis",
          instruction: prompt.instruction,
          payload: prompt.payload,
          responseSchema: prompt.responseSchema,
        });
        const payload = asRecord(llmResult.data);
        const nextObject = {
          ...object,
          core_function: asText(payload.core_function),
          function_citations: uniqueStrings(payload.citation),
          function_confidence: clampConfidence(payload.confidence, 0.5),
          function_reason: asText(payload.reason) || `${object.object_name} 的核心功能已基于 citations 归纳。`,
          function_llm_ensemble: llmResult.llm_ensemble ?? null,
        };
        completedObjects += 1;
        options?.onProgress?.({
          stage: "function_analysis",
          completed: completedObjects,
          total: objects.length,
          object_id: object.object_id,
          object_name: object.object_name,
          message: `第四阶段功能分析进行中：已完成 ${completedObjects} / ${objects.length} 个对象。`,
        });
        return nextObject;
      },
    );

    return {
      function_objects: functionObjects.map((object) => ({
        object_id: object.object_id,
        object_name: object.object_name,
        normalized_name: object.normalized_name,
        aliases: object.aliases,
        citations: object.citations,
        core_function: object.core_function,
        citation: object.function_citations,
        confidence: object.function_confidence,
        reason: object.function_reason,
        llm_ensemble: object.function_llm_ensemble ?? null,
      })),
      updated_objects: functionObjects,
      total_function_objects: functionObjects.length,
      progress: {
        completed: functionObjects.length,
        total: objects.length,
      },
      reason: "已基于每个融合对象的 citations 提取其核心功能。",
    };
  }

  async objectDecomposeStage(objects, options = {}) {
    let completedObjects = 0;
    let failedObjectsCount = 0;
    options?.onProgress?.({
      stage: "object_decompose",
      completed: 0,
      total: objects.length,
      failed: 0,
      message: objects.length > 0
        ? `第五阶段对象拆解进行中：已完成 0 / ${objects.length} 个对象。`
        : "第五阶段没有可拆解的对象。",
    });

    const decompositionResults = await mapWithConcurrency(
      objects,
      Math.min(4, Math.max(1, objects.length || 1)),
      async (object) => {
        const prompt = buildObjectDecomposePrompt(object);
        const attemptOutputs = [];
        let successPayload = null;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const llmResult = await this.invokeStageJson({
              stage: "object_decompose",
              instruction: prompt.instruction,
              payload: prompt.payload,
              responseSchema: prompt.responseSchema,
              retryHint: buildObjectDecomposeRetryHint(attempt),
            });
            successPayload = {
              data: asRecord(llmResult.data),
              llm_ensemble: llmResult.llm_ensemble ?? null,
            };
            break;
          } catch (error) {
            attemptOutputs.push({
              attempt,
              error: getErrorMessage(error, "object_decompose failed"),
              model_output: getErrorRawText(error),
              llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
              reason: getErrorRawText(error)
                ? "该次调用返回了不可解析的模型输出，因此未能通过 JSON 校验。"
                : "该次调用未返回可用的结构化结果，因此无法完成对象拆解。",
            });
          }
        }

        completedObjects += 1;
        if (!successPayload) {
          failedObjectsCount += 1;
          const failedObject = {
            object_id: object.object_id,
            object_name: object.object_name,
            attempts: attemptOutputs,
            reason: `对象 ${object.object_name} 连续 3 次拆解失败，已记录模型输出并跳过该对象。`,
          };
          options?.onProgress?.({
            stage: "object_decompose",
            completed: completedObjects,
            total: objects.length,
            failed: failedObjectsCount,
            object_id: object.object_id,
            object_name: object.object_name,
            skipped: true,
            message: `第五阶段对象拆解进行中：已完成 ${completedObjects} / ${objects.length} 个对象，失败 ${failedObjectsCount} 个。`,
          });
          return {
            object_id: object.object_id,
            decompositions: [],
            reason: `对象 ${object.object_name} 拆解失败，已跳过该对象。`,
            failed_object: failedObject,
          };
        }

        const decompositions = Array.isArray(successPayload.data.decompositions)
          ? successPayload.data.decompositions.map((item) => {
            const record = asRecord(item);
            return {
              parent_object_name: asText(record.parent_object_name) || object.object_name,
              child_object_name: asText(record.child_object_name),
              relation: "contains",
              citation: asText(record.citation),
              confidence: clampConfidence(record.confidence, 0.5),
              reason: asText(record.reason) || "该组成关系由输入 citation 直接支撑。",
            };
          }).filter((item) => item.parent_object_name && item.child_object_name && item.citation)
          : [];

        options?.onProgress?.({
          stage: "object_decompose",
          completed: completedObjects,
          total: objects.length,
          failed: failedObjectsCount,
          object_id: object.object_id,
          object_name: object.object_name,
          skipped: false,
          message: `第五阶段对象拆解进行中：已完成 ${completedObjects} / ${objects.length} 个对象，失败 ${failedObjectsCount} 个。`,
        });
        return {
          object_id: object.object_id,
          decompositions,
          reason: asText(successPayload.data.reason) || `已基于 ${object.object_name} 的 citations 完成拆解。`,
          llm_ensemble: successPayload.llm_ensemble ?? null,
          failed_object: null,
        };
      },
    );

    const failedObjects = decompositionResults
      .map((item) => item.failed_object)
      .filter(Boolean);

    return {
      decomposition_results: decompositionResults.map((item) => ({
        object_id: item.object_id,
        decompositions: item.decompositions,
        reason: item.reason,
        llm_ensemble: item.llm_ensemble ?? null,
      })),
      failed_objects: failedObjects,
      total_decomposition_groups: decompositionResults.length,
      total_decompositions: decompositionResults.reduce((sum, item) => sum + (Array.isArray(item.decompositions) ? item.decompositions.length : 0), 0),
      total_failed_objects: failedObjects.length,
      progress: {
        completed: decompositionResults.length,
        total: objects.length,
        failed: failedObjects.length,
      },
      reason: failedObjects.length > 0
        ? "已针对每个融合对象尝试拆解直接组成关系；失败对象已记录并跳过。"
        : "已针对每个融合对象，依据其 citations 抽取直接组成关系。",
    };
  }

  mapObjectNameToId(objects) {
    const map = new Map();
    for (const object of objects) {
      const candidates = uniqueStrings([object.object_name, object.normalized_name, ...(object.aliases ?? [])]);
      for (const candidate of candidates) {
        map.set(normalizeObjectName(candidate), object.object_id);
      }
    }
    return map;
  }

  async graphBuildStage(objects, decompositionResults) {
    const objectIdMap = this.mapObjectNameToId(objects);
    const edgeMap = new Map();

    for (const item of decompositionResults) {
      for (const decomposition of item.decompositions ?? []) {
        const sourceObjectId = objectIdMap.get(normalizeObjectName(decomposition.parent_object_name));
        const targetObjectId = objectIdMap.get(normalizeObjectName(decomposition.child_object_name));
        if (!sourceObjectId || !targetObjectId || sourceObjectId === targetObjectId) {
          continue;
        }
        const edgeKey = `${sourceObjectId}->${targetObjectId}->contains`;
        const current = edgeMap.get(edgeKey);
        const normalizedEdge = {
          edge_id: current?.edge_id || `edge-${edgeMap.size + 1}`,
          source_object_id: sourceObjectId,
          target_object_id: targetObjectId,
          relation: "contains",
          citation: asText(decomposition.citation),
          confidence: clampConfidence(decomposition.confidence, 0.5),
          derived_from: "object_decompose",
          reason: asText(decomposition.reason) || "该边来自对象拆解阶段的直接组成关系。",
        };
        if (!current || normalizedEdge.confidence > current.confidence || (
          normalizedEdge.confidence === current.confidence && normalizedEdge.citation.length > current.citation.length
        )) {
          edgeMap.set(edgeKey, normalizedEdge);
        }
      }
    }

    const edges = [...edgeMap.values()];
    const nodeIds = objects.map((item) => item.object_id);
    const removedCycleEdges = [];

    while (true) {
      const topo = computeTopologicalOrder(edges, nodeIds);
      if (topo.cyclicNodeIds.length === 0) {
        break;
      }
      const cycleEdges = edges.filter((edge) => topo.cyclicNodeIds.includes(edge.source_object_id) && topo.cyclicNodeIds.includes(edge.target_object_id));
      if (cycleEdges.length === 0) {
        break;
      }
      const weakest = cycleEdges
        .slice()
        .sort((left, right) => {
          if (left.confidence !== right.confidence) {
            return left.confidence - right.confidence;
          }
          if (left.citation.length !== right.citation.length) {
            return left.citation.length - right.citation.length;
          }
          return left.edge_id.localeCompare(right.edge_id);
        })[0];

      let reason = "该边与其他更强的 contains 关系共同构成环，因此被移除以保持 DAG。";
      try {
        const prompt = buildCycleResolvePrompt(cycleEdges);
        const cycleJudgeResult = await this.invokeStageJson({
          stage: "graph_build",
          instruction: prompt.instruction,
          payload: prompt.payload,
          responseSchema: prompt.responseSchema,
        });
        const judge = asRecord(cycleJudgeResult.data);
        if (asText(judge.remove_edge_id) === weakest.edge_id) {
          reason = asText(judge.reason) || reason;
        }
        weakest.llm_ensemble = cycleJudgeResult.llm_ensemble ?? null;
      } catch {
        // 环裁决失败时保留程序化兜底。
      }

      const removeIndex = edges.findIndex((edge) => edge.edge_id === weakest.edge_id);
      if (removeIndex === -1) {
        break;
      }
      edges.splice(removeIndex, 1);
      removedCycleEdges.push({
        edge_id: weakest.edge_id,
        citation: weakest.citation,
        reason,
        llm_ensemble: weakest.llm_ensemble ?? null,
      });
    }

    const annotatedObjects = annotateStructuredObjects(objects, edges);
    return {
      objects: annotatedObjects,
      edges,
      total_edges: edges.length,
      total_isolated_objects: annotatedObjects.filter((item) => item.is_isolated === true).length,
      removed_cycle_edges: removedCycleEdges,
      total_removed_cycle_edges: removedCycleEdges.length,
      is_dag: computeTopologicalOrder(edges, nodeIds).cyclicNodeIds.length === 0,
      reason: "已将对象拆解关系映射为 contains 边，并移除了会形成环的弱边。",
    };
  }

  async ablationAnalysisStage(objects, edges, options = {}) {
    const objectById = new Map(objects.map((object) => [object.object_id, object]));
    const childrenByParent = new Map();
    for (const edge of edges) {
      if (!childrenByParent.has(edge.source_object_id)) {
        childrenByParent.set(edge.source_object_id, []);
      }
      childrenByParent.get(edge.source_object_id).push(edge.target_object_id);
    }

    const parentEntries = Array.from(childrenByParent.entries()).filter(([parentObjectId, childIds]) => {
      const parent = objectById.get(parentObjectId);
      return Boolean(parent) && Array.isArray(childIds) && childIds.length > 0;
    });
    const total = parentEntries.length;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    onProgress?.({
      stage: "ablation_analysis",
      completed: 0,
      total,
      message: total > 0
        ? `最终阶段消融分析开始，待处理 ${total} 个父节点。`
        : "最终阶段没有可做消融分析的父节点，已跳过。",
    });

    let completedParents = 0;
    const parentConcurrency = Math.max(1, Math.min(parentEntries.length || 1, this.ablationParentConcurrency));
    const parentSummaries = await mapWithConcurrency(
      parentEntries,
      parentConcurrency,
      async ([parentObjectId, childIds]) => {
        const parent = objectById.get(parentObjectId);
        if (!parent || childIds.length === 0) {
          return null;
        }
        const children = childIds.map((childId) => objectById.get(childId)).filter(Boolean);
        const localEdges = edges.filter((edge) => edge.source_object_id === parentObjectId || childIds.includes(edge.source_object_id) || childIds.includes(edge.target_object_id));
        let processedChildren = 0;
        onProgress?.({
          stage: "ablation_analysis",
          completed: completedParents,
          total,
          current_parent_object_id: parent.object_id,
          current_parent_object_name: parent.object_name,
          processed_child_count: 0,
          total_child_count: children.length,
          message: `最终阶段正在分析父节点 ${parent.object_name}，已完成 0 / ${children.length} 个子节点。`,
        });
        const childConcurrency = Math.max(1, Math.min(children.length || 1, this.ablationChildConcurrency));
        const childAnalyses = await mapWithConcurrency(
          children,
          childConcurrency,
          async (child) => {
            onProgress?.({
              stage: "ablation_analysis",
              completed: completedParents,
              total,
              current_parent_object_id: parent.object_id,
              current_parent_object_name: parent.object_name,
              current_child_object_id: child.object_id,
              current_child_object_name: child.object_name,
              processed_child_count: processedChildren,
              total_child_count: children.length,
              message: `最终阶段正在分析父节点 ${parent.object_name} 的子节点 ${child.object_name}，当前已完成 ${processedChildren} / ${children.length} 个子节点。`,
            });
            const siblings = children.filter((item) => item.object_id !== child.object_id);
            const siblingImpacts = [];
            if (siblings.length > 0) {
              const siblingPrompt = buildSiblingAblationPrompt(parent, child, siblings, localEdges);
              const siblingResult = await this.invokeStageJson({
                stage: "ablation_analysis",
                instruction: siblingPrompt.instruction,
                payload: siblingPrompt.payload,
                responseSchema: siblingPrompt.responseSchema,
              });
              const siblingPayload = asRecord(siblingResult.data);
              const impacts = Array.isArray(siblingPayload.sibling_impacts) ? siblingPayload.sibling_impacts : [];
              for (const impact of impacts) {
                const record = asRecord(impact);
                siblingImpacts.push({
                  ablated_child_object_id: child.object_id,
                  target_sibling_object_id: asText(record.target_sibling_object_id),
                  impact_level: ["none", "low", "medium", "high"].includes(asText(record.impact_level)) ? asText(record.impact_level) : "low",
                  judgement: asText(record.judgement),
                  reason: asText(record.reason) || "该兄弟影响判断来自局部消融分析。",
                  llm_ensemble: siblingResult.llm_ensemble ?? null,
                });
              }
            }

            const parentPrompt = buildParentAblationPrompt(parent, child, children, localEdges);
            const parentResult = await this.invokeStageJson({
              stage: "ablation_analysis",
              instruction: parentPrompt.instruction,
              payload: parentPrompt.payload,
              responseSchema: parentPrompt.responseSchema,
            });
            const parentPayload = asRecord(parentResult.data);
            const impact = asRecord(parentPayload.impact_on_parent);
            const parentImpact = {
              ablated_child_object_id: child.object_id,
              parent_object_id: asText(impact.parent_object_id) || parent.object_id,
              importance_level: ["none", "low", "medium", "high", "critical"].includes(asText(impact.importance_level))
                ? asText(impact.importance_level)
                : "medium",
              judgement: asText(impact.judgement),
              reason: asText(impact.reason) || "该子节点重要性判断来自父节点消融分析。",
              llm_ensemble: parentResult.llm_ensemble ?? null,
            };

            processedChildren += 1;
            onProgress?.({
              stage: "ablation_analysis",
              completed: completedParents,
              total,
              current_parent_object_id: parent.object_id,
              current_parent_object_name: parent.object_name,
              current_child_object_id: child.object_id,
              current_child_object_name: child.object_name,
              processed_child_count: processedChildren,
              total_child_count: children.length,
              message: `最终阶段正在分析父节点 ${parent.object_name}，已完成 ${processedChildren} / ${children.length} 个子节点。`,
            });
            return {
              sibling_impacts: siblingImpacts,
              parent_impact: parentImpact,
            };
          },
        );

        const siblingDependencyTable = childAnalyses.flatMap((item) => item?.sibling_impacts ?? []);
        const childImportanceList = childAnalyses
          .map((item) => item?.parent_impact ?? null)
          .filter(Boolean);

        const summary = {
          parent_object_id: parent.object_id,
          sibling_dependency_table: siblingDependencyTable,
          child_importance_list: childImportanceList,
          reason: "该摘要聚合了该父对象全部直接子节点的兄弟影响分析与父级重要性分析。",
        };

        completedParents += 1;
        onProgress?.({
          stage: "ablation_analysis",
          completed: completedParents,
          total,
          parent_object_id: parent.object_id,
          parent_object_name: parent.object_name,
          message: `最终阶段已完成 ${completedParents} / ${total} 个父节点的消融分析。`,
        });
        return summary;
      },
    );

    return {
      parent_summaries: parentSummaries.filter(Boolean),
      total_parent_summaries: parentSummaries.filter(Boolean).length,
      progress: {
        completed: parentSummaries.filter(Boolean).length,
        total,
      },
      reason: "已对所有有直接子节点的父对象完成消融分析。",
    };
  }

  async runFileWorkflow(input) {
    await this.refreshWorkflowConfigFromResolver();
    const conversationId = asText(input?.conversationId) || "file-workflow-v2";
    const projectId = asText(input?.projectId) || "demo";
    const fileName = asText(input?.fileName) || "upload.txt";
    const mimeType = asText(input?.mimeType) || "text/plain";
    const handlers = input?.handlers && typeof input.handlers === "object" ? input.handlers : {};
    const runtimeRoot = await this.ensureConversationRuntime(conversationId);
    const releaseLock = await this.acquireProjectWorkflowLock(projectId);
    const startedAt = new Date().toISOString();
    const stageResults = this.buildInitialStageResults();
    const errors = [];

      let state = {
        document: null,
        chunks: [],
        windows: [],
        window_results: [],
        fused_objects: [],
        function_objects: [],
        decomposition_results: [],
        edges: [],
        removed_cycle_edges: [],
        parent_summaries: [],
      };

    try {
      let rawText = "";
      let inputFile = {
        originalName: fileName,
        storedName: fileName,
        size: 0,
        path: runtimeRoot,
        mimeType,
      };

      if (input.resumeSnapshot) {
        const snapshot = asRecord(input.resumeSnapshot);
        state = {
          ...state,
          ...asRecord(snapshot.state),
        };
        const previousResults = Array.isArray(snapshot.stage_results) ? snapshot.stage_results : [];
        for (let index = 0; index < stageResults.length; index += 1) {
          if (previousResults[index]) {
            stageResults[index] = previousResults[index];
          }
        }
        rawText = asText(snapshot?.state?.document?.raw_text);
        inputFile = {
          ...inputFile,
          ...asRecord(snapshot.input_file),
        };
      } else {
        const content = Buffer.isBuffer(input?.content) ? input.content : Buffer.from([]);
        rawText = content.toString("utf8").replace(/\u0000/g, "");
        inputFile.size = content.byteLength;
        const uploadDir = path.join(runtimeRoot, "uploads");
        await mkdir(uploadDir, { recursive: true });
        const uploadPath = path.join(uploadDir, fileName.replace(/[\\/]+/g, "_"));
        await writeFile(uploadPath, content);
        inputFile.path = uploadPath;
      }

      state.document = state.document || createDocumentRecord({
        conversationId,
        fileName,
        projectId,
        rawText,
      });

      const stageStartIndex = asInteger(input.resumeFromStageIndex, 0, 0);

      const runStage = async (stageKey, executor, applyOutput = () => {}) => {
        if (input?.signal?.aborted) {
          throw new Error("workflow V2 aborted");
        }
        const stageIndex = WORKFLOW_V2_STAGE_KEYS.indexOf(stageKey);
        const previous = stageResults[stageIndex];
        stageResults[stageIndex] = makeStageResult(stageKey, stageIndex + 1, "running", previous?.output ?? null, null, previous);
        handlers.onStatus?.({
          stage: stageKey,
          message: `正在执行 ${stageKey}`,
        });
        handlers.onStageUpdate?.(stageResults[stageIndex]);
        try {
          const output = await executor();
          if (input?.signal?.aborted) {
            throw new Error("workflow V2 aborted");
          }
          applyOutput(output);
          stageResults[stageIndex] = makeStageResult(stageKey, stageIndex + 1, "success", output, null, stageResults[stageIndex]);
          handlers.onStageUpdate?.(stageResults[stageIndex]);
          await this.writeWorkflowSnapshot(conversationId, {
            input_file: inputFile,
            stage_results: stageResults,
            state,
          });
          return output;
        } catch (error) {
          const message = error instanceof Error ? error.message : "workflow V2 stage failed";
          const currentStage = stageResults[stageIndex];
          if (currentStage?.status === "running") {
            stageResults[stageIndex] = makeStageResult(stageKey, stageIndex + 1, "failed", currentStage.output, message, currentStage);
            handlers.onStageUpdate?.(stageResults[stageIndex]);
          }
          try {
            await this.writeWorkflowSnapshot(conversationId, {
              input_file: inputFile,
              stage_results: stageResults,
              state,
            });
          } catch {
            // ignore snapshot write failure during stage error handling
          }
          throw error;
        }
      };

      if (stageStartIndex <= 0) {
        await runStage("chunk_parse", async () => this.chunkParseStage(state.document), (output) => {
          state.chunks = output.chunks;
        });
      }
      if (stageStartIndex <= 1) {
        await runStage("window_extract", async () => this.windowExtractStage(state.document, state.chunks, {
          onProgress: (progressPayload) => handlers.onStatus?.(progressPayload),
        }), (output) => {
          state.windows = output.windows;
          state.window_results = output.window_results;
        });
      }
      if (stageStartIndex <= 2) {
        await runStage("object_fusion", async () => this.objectFusionStage(state.window_results), (output) => {
          state.fused_objects = output.fused_objects;
        });
      }
      if (stageStartIndex <= 3) {
        await runStage("function_analysis", async () => this.functionAnalysisStage(state.fused_objects, {
          onProgress: (progressPayload) => handlers.onStatus?.(progressPayload),
        }), (output) => {
          state.function_objects = output.function_objects;
          state.fused_objects = output.updated_objects;
        });
      }
      if (stageStartIndex <= 4) {
        await runStage("object_decompose", async () => this.objectDecomposeStage(state.fused_objects, {
          onProgress: (progressPayload) => handlers.onStatus?.(progressPayload),
        }), (output) => {
          state.decomposition_results = output.decomposition_results;
        });
      }
      if (stageStartIndex <= 5) {
        await runStage("graph_build", async () => this.graphBuildStage(state.fused_objects, state.decomposition_results), (output) => {
          state.fused_objects = Array.isArray(output.objects) ? output.objects : state.fused_objects;
          state.edges = output.edges;
          state.removed_cycle_edges = output.removed_cycle_edges;
        });
      }
      if (stageStartIndex <= 6) {
        await runStage("ablation_analysis", async () => this.ablationAnalysisStage(state.fused_objects, state.edges, {
          onProgress: (progressPayload) => handlers.onStatus?.(progressPayload),
        }), (output) => {
          state.parent_summaries = output.parent_summaries;
        });
      }

      const result = {
        ...buildWorkflowV2ResultFromState(state),
        reason: "已完成文档分块、对象抽取、对象融合、核心功能分析、拆解建图与消融分析的全流程。",
      };
      const finishedAt = new Date().toISOString();
      await this.writeWorkflowSnapshot(conversationId, {
        input_file: inputFile,
        stage_results: stageResults,
        state,
        result,
      });
      return createV2ResponseEnvelope({
        ok: true,
        stageResults,
        errors,
        runtimeRoot,
        inputFile,
        result,
        startedAt,
        finishedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "workflow V2 failed";
      const failedStageIndex = stageResults.findIndex((item) => item.status === "running");
      if (failedStageIndex !== -1) {
        const current = stageResults[failedStageIndex];
        stageResults[failedStageIndex] = makeStageResult(current.stage, current.order, "failed", current.output, message, current);
        handlers.onStageUpdate?.(stageResults[failedStageIndex]);
        errors.push({
          stage: current.stage,
          message,
        });
      } else {
        const latestFailedIndex = [...stageResults]
          .map((item, index) => ({ item, index }))
          .reverse()
          .find(({ item }) => item.status === "failed")?.index ?? -1;
        if (latestFailedIndex !== -1) {
          errors.push({
            stage: stageResults[latestFailedIndex].stage,
            message,
          });
        } else {
          errors.push({
            stage: "request",
            message,
          });
        }
      }
      try {
        await this.writeWorkflowSnapshot(conversationId, {
          input_file: inputFile,
          stage_results: stageResults,
          state,
        });
      } catch {
        // ignore snapshot write failure during error handling
      }
      return createV2ResponseEnvelope({
        ok: false,
        stageResults,
        errors,
        runtimeRoot,
        inputFile: {
          originalName: fileName,
          storedName: fileName,
          size: Buffer.isBuffer(input?.content) ? input.content.byteLength : 0,
          path: runtimeRoot,
          mimeType,
        },
        result: {
          ...buildWorkflowV2ResultFromState(state),
          reason: "工作流在中途失败，当前结果只包含已完成阶段的部分产物。",
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      await releaseLock();
    }
  }
}
