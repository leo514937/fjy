import axios from "axios";

const API_BASE_URL = "http://127.0.0.1:8000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export interface MessagePair {
  role: "user" | "assistant";
  content: string;
}

export interface QuestionAnswerPayload {
  question: string;
  request_id?: string;
  history?: MessagePair[];
  rag_options?: {
    candidate_pool?: number;
    top_k?: number;
    max_context_chunks?: number;
    enable_graph_context?: boolean;
  };
}

export interface GitHubReviewRequest {
  repository_url: string;
  ref: string;
  paths: string[];
  request_id?: string;
}

export interface GitHubReviewIssue {
  title: string;
  severity: string;
  file_path: string;
  line: number | null;
  summary: string;
  evidence: string;
  recommendation: string;
  category?: string;
}

export interface GitHubReviewResponse {
  summary: string;
  issues: GitHubReviewIssue[];
  reviewed_files: string[];
  warnings: string[];
  next_steps: string[];
}

export interface GitHubReviewProgress {
  phase: string;
  completed_phases: number;
  total_phases: number;
}

export interface GitHubReviewPartialReport {
  category: string;
  issues: GitHubReviewIssue[];
  warnings: string[];
  reviewed_files: string[];
}

export interface GitHubReviewStreamHandlers {
  onStatus?: (message: string) => void;
  onProgress?: (progress: GitHubReviewProgress) => void;
  onPartialReport?: (report: GitHubReviewPartialReport) => void;
  onComplete?: (response: GitHubReviewResponse) => void;
}

export interface GitHubReviewStreamOptions {
  signal?: AbortSignal;
}

export interface QARouteTraceStep {
  stage: string;
  status: string;
  detail: string;
}

export interface QASourceResult {
  source_type: "graph_ref" | "rag_ref";
  status: string;
  summary: string;
}

export interface RAGHitMetadata {
  collection?: string;
  id?: string;
  url?: string;
  filename?: string;
  content_type?: string;
  section_ordinal?: number | null;
  chunk_ordinal?: number | null;
  index_profile?: string;
  content_sha256?: string;
  mmr_score?: number;
  candidate_pool?: number;
  [key: string]: unknown;
}

export interface RAGHit {
  chunk_id: string;
  source_file: string;
  section: string;
  content: string;
  source_id: string;
  heading_path: string[];
  ontology_tags: string[];
  version: string;
  status: string;
  score: number;
  dense_score: number;
  token_count: number;
  citation_id: string;
  match_reason: string;
  metadata: RAGHitMetadata;
}

export interface GraphHit {
  entity: string;
  evidence_text: string;
  related_entities: string[];
  relations: string[];
  citation_id: string;
}

export interface QuestionAnswerEvidence {
  rag_hits: RAGHit[];
  graph_hits: GraphHit[];
  graph_paths: string[];
}

export interface QuestionAnswerResponse {
  answer: string;
  route_trace: QARouteTraceStep[];
  source_results: QASourceResult[];
  evidence: QuestionAnswerEvidence;
  warnings: string[];
}

export interface KnowledgeUploadPayload {
  collectionName?: string;
  sourceId?: string;
  chunkStrategy?: "semantic_token_v1" | "legacy_char_window";
  targetChunkTokens?: number;
  chunkOverlapTokens?: number;
  maxChunkTokens?: number;
  chunkSize?: number;
  overlapSize?: number;
  language?: string;
  indexProfile?: string;
}

export interface KnowledgeUploadResponse {
  collection_name: string;
  source_id: string;
  filename: string;
  content_type: string;
  chunk_size: number | null;
  overlap_size: number | null;
  target_chunk_tokens: number | null;
  chunk_overlap_tokens: number | null;
  max_chunk_tokens: number | null;
  index_profile: string;
  embedding_model: string;
  embedding_dimensions: number;
  avg_chunk_tokens: number;
  heading_aware: boolean;
  section_count: number;
  chunk_count: number;
  total_characters: number;
  replaced_existing_chunks: boolean;
  sample_sections: string[];
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  props?: Record<string, unknown>;
  degree?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface QuestionAnswerStreamContext {
  route_trace: QARouteTraceStep[];
  source_results: QASourceResult[];
  evidence: QuestionAnswerEvidence;
  warnings: string[];
}

export interface QuestionAnswerStreamHandlers {
  onStatus?: (message: string) => void;
  onContext?: (context: QuestionAnswerStreamContext) => void;
  onAnswerDelta?: (delta: string) => void;
  onComplete?: (response: QuestionAnswerResponse) => void;
}

export interface QuestionAnswerStreamOptions {
  signal?: AbortSignal;
}

interface APIErrorPayload {
  message?: string;
}

interface APIRequestError extends Error {
  response?: {
    data?: APIErrorPayload;
  };
}

export async function checkHealth() {
  const { data } = await api.get("/health");
  return data;
}

export async function askQuestion(payload: QuestionAnswerPayload): Promise<QuestionAnswerResponse> {
  const { data } = await api.post("/qa/answer", payload);
  return data;
}

export async function reviewGitHubCode(
  payload: GitHubReviewRequest,
  options: { signal?: AbortSignal } = {},
): Promise<GitHubReviewResponse> {
  const { data } = await api.post("/review/github", payload, {
    signal: options.signal,
  });
  return data;
}

export async function cancelGitHubReviewStream(requestId: string): Promise<void> {
  await api.post("/review/github/cancel", {
    request_id: requestId,
  });
}

export async function cancelQuestionStream(requestId: string): Promise<void> {
  await api.post("/qa/answer/cancel", {
    request_id: requestId,
  });
}

export async function uploadKnowledgeDocument(
  file: File,
  payload: KnowledgeUploadPayload = {},
): Promise<KnowledgeUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  if (payload.collectionName) {
    formData.append("collection_name", payload.collectionName);
  }
  if (payload.sourceId) {
    formData.append("source_id", payload.sourceId);
  }
  if (payload.chunkStrategy) {
    formData.append("chunk_strategy", payload.chunkStrategy);
  }
  if (payload.targetChunkTokens !== undefined) {
    formData.append("target_chunk_tokens", String(payload.targetChunkTokens));
  }
  if (payload.chunkOverlapTokens !== undefined) {
    formData.append("chunk_overlap_tokens", String(payload.chunkOverlapTokens));
  }
  if (payload.maxChunkTokens !== undefined) {
    formData.append("max_chunk_tokens", String(payload.maxChunkTokens));
  }
  if (payload.chunkSize !== undefined) {
    formData.append("chunk_size", String(payload.chunkSize));
  }
  if (payload.overlapSize !== undefined) {
    formData.append("overlap_size", String(payload.overlapSize));
  }
  if (payload.language) {
    formData.append("language", payload.language);
  }
  if (payload.indexProfile) {
    formData.append("index_profile", payload.indexProfile);
  }

  const { data } = await api.post("/knowledge/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

export async function exploreGraph(): Promise<GraphData> {
  const { data } = await api.get("/graph/explore");
  return data;
}

export async function askQuestionStream(
  payload: QuestionAnswerPayload,
  handlers: QuestionAnswerStreamHandlers = {},
  options: QuestionAnswerStreamOptions = {},
): Promise<QuestionAnswerResponse> {
  const response = await fetch(`${API_BASE_URL}/qa/answer/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const error = new Error(errorPayload?.message || "Streaming request failed.") as APIRequestError;
    if (errorPayload) {
      error.response = { data: errorPayload };
    }
    throw error;
  }

  if (!response.body) {
    throw new Error("Streaming response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: QuestionAnswerResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (parsed) {
        const eventData = asObject(parsed.data);
        if (parsed.event === "status") {
          handlers.onStatus?.(typeof eventData?.message === "string" ? eventData.message : "");
        } else if (parsed.event === "context") {
          handlers.onContext?.(parsed.data as QuestionAnswerStreamContext);
        } else if (parsed.event === "answer_delta") {
          handlers.onAnswerDelta?.(typeof eventData?.delta === "string" ? eventData.delta : "");
        } else if (parsed.event === "complete") {
          finalResponse = parsed.data as QuestionAnswerResponse;
          handlers.onComplete?.(finalResponse);
        } else if (parsed.event === "error") {
          const error = new Error(
            typeof eventData?.message === "string" ? eventData.message : "Streaming request failed.",
          ) as APIRequestError;
          error.response = { data: eventData ?? undefined };
          throw error;
        }
      }
      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error("Question stream ended before completion.");
  }
  return finalResponse;
}

export async function reviewGitHubCodeStream(
  payload: GitHubReviewRequest,
  handlers: GitHubReviewStreamHandlers = {},
  options: GitHubReviewStreamOptions = {},
): Promise<GitHubReviewResponse> {
  const response = await fetch(`${API_BASE_URL}/review/github/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const error = new Error(errorPayload?.message || "GitHub 审查流式请求失败。") as APIRequestError;
    if (errorPayload) {
      error.response = { data: errorPayload };
    }
    throw error;
  }

  if (!response.body) {
    throw new Error("GitHub 审查流式响应体缺失。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: GitHubReviewResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (parsed) {
        const eventData = asObject(parsed.data);
        if (parsed.event === "status") {
          handlers.onStatus?.(typeof eventData?.message === "string" ? eventData.message : "");
        } else if (parsed.event === "progress") {
          handlers.onProgress?.({
            phase: typeof eventData?.phase === "string" ? eventData.phase : "",
            completed_phases: typeof eventData?.completed_phases === "number" ? eventData.completed_phases : 0,
            total_phases: typeof eventData?.total_phases === "number" ? eventData.total_phases : 0,
          });
        } else if (parsed.event === "partial_report") {
          handlers.onPartialReport?.({
            category: typeof eventData?.category === "string" ? eventData.category : "",
            issues: Array.isArray(eventData?.issues) ? (eventData.issues as GitHubReviewIssue[]) : [],
            warnings: Array.isArray(eventData?.warnings) ? (eventData.warnings as string[]) : [],
            reviewed_files: Array.isArray(eventData?.reviewed_files)
              ? (eventData.reviewed_files as string[])
              : [],
          });
        } else if (parsed.event === "complete") {
          finalResponse = parsed.data as GitHubReviewResponse;
          handlers.onComplete?.(finalResponse);
        } else if (parsed.event === "error") {
          const error = new Error(
            typeof eventData?.message === "string" ? eventData.message : "GitHub 审查流式请求失败。",
          ) as APIRequestError;
          error.response = { data: eventData ?? undefined };
          throw error;
        }
      }
      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error("GitHub 审查流在完成前已结束。");
  }

  return finalResponse;
}

function parseSseEvent(rawEvent: string): { event: string; data: unknown } | null {
  const normalized = rawEvent.replace(/\r/g, "").trim();
  if (!normalized) {
    return null;
  }

  let event = "";
  const dataLines: string[] = [];
  for (const line of normalized.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (!event || dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: JSON.parse(dataLines.join("\n")),
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}
