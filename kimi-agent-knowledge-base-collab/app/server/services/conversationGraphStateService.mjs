import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function normalizeConversationId(conversationId) {
  return String(conversationId || "").trim();
}

function buildConversationRuntimeSlug(conversationId) {
  return normalizeConversationId(conversationId)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "session";
}

function emptyOverlay(conversationId) {
  return {
    version: 1,
    conversationId,
    updatedAt: null,
    nodes: [],
    relations: [],
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeNode(value) {
  const raw = asObject(value);
  if (!raw) {
    return null;
  }

  const id = typeof raw.entity_id === "string"
    ? raw.entity_id
    : typeof raw.id === "string"
      ? raw.id
      : "";
  if (!id) {
    return null;
  }

  return {
    entity_id: id,
    text: typeof raw.text === "string" ? raw.text : "",
    normalized_text: typeof raw.normalized_text === "string" ? raw.normalized_text : "",
    label: typeof raw.label === "string" ? raw.label : "",
    start: typeof raw.start === "number" ? raw.start : 0,
    end: typeof raw.end === "number" ? raw.end : 0,
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
    source_sentence: typeof raw.source_sentence === "string" ? raw.source_sentence : "",
    metadata: asObject(raw.metadata) || {},
    display_level: typeof raw.display_level === "number" ? raw.display_level : 1,
    visible: raw.visible !== false,
    highlight: Boolean(raw.highlight),
    pinned: Boolean(raw.pinned),
    focus: Boolean(raw.focus),
  };
}

function normalizeRelation(value) {
  const raw = asObject(value);
  if (!raw) {
    return null;
  }

  const source = typeof raw.source_entity_id === "string"
    ? raw.source_entity_id
    : typeof raw.source === "string"
      ? raw.source
      : "";
  const target = typeof raw.target_entity_id === "string"
    ? raw.target_entity_id
    : typeof raw.target === "string"
      ? raw.target
      : "";
  if (!source || !target) {
    return null;
  }

  return {
    relation_id: typeof raw.relation_id === "string" ? raw.relation_id : `${source}__${target}__${typeof raw.relation_type === "string" ? raw.relation_type : "关联"}`,
    source_entity_id: source,
    target_entity_id: target,
    source_text: typeof raw.source_text === "string" ? raw.source_text : "",
    target_text: typeof raw.target_text === "string" ? raw.target_text : "",
    relation_type: typeof raw.relation_type === "string" ? raw.relation_type : "关联",
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
    evidence_sentence: typeof raw.evidence_sentence === "string" ? raw.evidence_sentence : "",
    metadata: asObject(raw.metadata) || {},
    display_level: typeof raw.display_level === "number" ? raw.display_level : 1,
    visible: raw.visible !== false,
    highlight: Boolean(raw.highlight),
  };
}

function normalizeOverlay(value, conversationId) {
  const raw = asObject(value);
  if (!raw) {
    return emptyOverlay(conversationId);
  }

  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    conversationId: typeof raw.conversationId === "string" ? raw.conversationId : conversationId,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    nodes: Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode).filter(Boolean) : [],
    relations: Array.isArray(raw.relations) ? raw.relations.map(normalizeRelation).filter(Boolean) : [],
  };
}

export class ConversationGraphStateService {
  constructor(options) {
    this.runtimeRoot = options.runtimeRoot;
  }

  getConversationGraphPath(conversationId) {
    const runtimeParent = path.join(this.runtimeRoot, ".web-chat-runs");
    const slug = buildConversationRuntimeSlug(conversationId);
    return path.join(runtimeParent, `conversation-${slug}`, "knowledge-graph", "overlay.json");
  }

  async load(conversationId) {
    const graphPath = this.getConversationGraphPath(conversationId);
    try {
      const content = await readFile(graphPath, "utf8");
      return normalizeOverlay(JSON.parse(content), normalizeConversationId(conversationId));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return emptyOverlay(normalizeConversationId(conversationId));
      }
      throw error;
    }
  }

  async save(input) {
    const conversationId = normalizeConversationId(input?.conversationId);
    if (!conversationId) {
      throw new Error("conversationId is required");
    }

    const overlay = normalizeOverlay(input, conversationId);
    overlay.updatedAt = new Date().toISOString();

    const graphPath = this.getConversationGraphPath(conversationId);
    await mkdir(path.dirname(graphPath), { recursive: true });
    await writeFile(graphPath, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");
    return overlay;
  }
}
