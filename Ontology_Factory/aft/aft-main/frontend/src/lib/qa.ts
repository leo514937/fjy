import type {
  GraphHit,
  GitHubReviewProgress,
  GitHubReviewResponse,
  QuestionAnswerResponse,
  RAGHit,
} from "./api";

export const CONVERSATIONS_STORAGE_KEY = "qa_conversations_v1";
export const ACTIVE_CONVERSATION_STORAGE_KEY = "qa_active_conversation_id";
const LEGACY_CHAT_STORAGE_KEY = "chat_history";

export interface Message {
  role: "user" | "assistant";
  content: string;
  kind?: "qa" | "github_review";
  response?: QuestionAnswerResponse;
  githubReview?: GitHubReviewResponse;
  githubReviewProgress?: GitHubReviewProgress;
  status?: string;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface ConversationStateSnapshot {
  conversations: Conversation[];
  activeConversationId: string;
}

export type CitationTextPart =
  | { type: "text"; value: string; key: string }
  | { type: "citation"; value: string; citationId: string; key: string };

export type CitationDetail =
  | { kind: "rag"; citationId: string; hit: RAGHit }
  | { kind: "graph"; citationId: string; hit: GraphHit };

export interface GraphRelationDetail {
  direction: "out" | "in" | "unknown";
  relationType: string;
  neighbor: string;
  label: string;
}

export function createConversation(seed?: Partial<Conversation>): Conversation {
  const now = seed?.updatedAt ?? new Date().toISOString();
  const messages = seed?.messages ?? [];
  const createdAt = seed?.createdAt ?? now;
  return {
    id: seed?.id ?? buildConversationId(),
    title: seed?.title ?? deriveConversationTitle(messages),
    createdAt,
    updatedAt: now,
    messages,
  };
}

export function loadConversationState(): ConversationStateSnapshot {
  if (typeof window === "undefined") {
    const fallback = createConversation();
    return {
      conversations: [fallback],
      activeConversationId: fallback.id,
    };
  }

  const rawConversations = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
  if (rawConversations) {
    try {
      const parsed = JSON.parse(rawConversations);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const conversations = sortConversations(parsed.map(normalizeConversation));
        const storedActiveId = window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
        const activeConversationId =
          storedActiveId && conversations.some((conversation) => conversation.id === storedActiveId)
            ? storedActiveId
            : conversations[0].id;
        return { conversations, activeConversationId };
      }
    } catch {
      // Fall through to legacy migration.
    }
  }

  const rawLegacyMessages = window.localStorage.getItem(LEGACY_CHAT_STORAGE_KEY);
  if (rawLegacyMessages) {
    try {
      const parsed = JSON.parse(rawLegacyMessages);
      if (Array.isArray(parsed)) {
        const migrated = createConversation({
          messages: parsed.map(normalizeMessage),
        });
        return {
          conversations: [migrated],
          activeConversationId: migrated.id,
        };
      }
    } catch {
      // Ignore malformed legacy payloads.
    }
  }

  const initialConversation = createConversation();
  return {
    conversations: [initialConversation],
    activeConversationId: initialConversation.id,
  };
}

export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function parseAnswerText(text: string): CitationTextPart[] {
  const normalizedText = text ?? "";
  const regex = /(?:\[|【)\s*([RG]?\d+)\s*(?:\]|】)/gi;
  const parts: CitationTextPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalizedText)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        value: normalizedText.slice(lastIndex, match.index),
        key: `text-${lastIndex}`,
      });
    }

    parts.push({
      type: "citation",
      value: match[0],
      citationId: normalizeCitationId(match[1]),
      key: `citation-${match.index}`,
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < normalizedText.length) {
    parts.push({
      type: "text",
      value: normalizedText.slice(lastIndex),
      key: `text-${lastIndex}`,
    });
  }

  return parts;
}

export function normalizeCitationId(rawCitationId: string): string {
  const trimmed = (rawCitationId ?? "")
    .trim()
    .replace(/^[\[【\s]+/, "")
    .replace(/[\]】\s]+$/, "")
    .toUpperCase();
  if (/^\d+$/.test(trimmed)) {
    return `R${trimmed}`;
  }
  return trimmed;
}

export function findCitationDetail(
  citationId: string,
  ragHits: RAGHit[],
  graphHits: GraphHit[],
): CitationDetail | null {
  const normalizedCitationId = normalizeCitationId(citationId);
  if (normalizedCitationId.startsWith("G")) {
    const graphHit =
      graphHits.find((hit) => normalizeCitationId(hit.citation_id) === normalizedCitationId) ??
      graphHits[Number.parseInt(normalizedCitationId.slice(1), 10) - 1];
    return graphHit ? { kind: "graph", citationId: normalizedCitationId, hit: graphHit } : null;
  }

  const ragHit =
    ragHits.find((hit) => normalizeCitationId(hit.citation_id) === normalizedCitationId) ??
    ragHits[Number.parseInt(normalizedCitationId.slice(1), 10) - 1];
  return ragHit ? { kind: "rag", citationId: normalizedCitationId, hit: ragHit } : null;
}

export function formatConversationTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function deriveConversationTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content?.trim() ?? "";
  if (!firstUserMessage) {
    return "New chat";
  }

  const condensed = firstUserMessage.replace(/\s+/g, " ");
  return condensed.length > 5 ? `${condensed.slice(0, 5)}...` : condensed;
}

export function updateConversationMessages(
  conversation: Conversation,
  messages: Message[],
  updatedAt = new Date().toISOString(),
): Conversation {
  return {
    ...conversation,
    messages,
    updatedAt,
    title: deriveConversationTitle(messages),
  };
}

export function formatGraphRelation(entity: string, relation: string): GraphRelationDetail {
  const [directionRaw = "unknown", relationTypeRaw = "related", neighborRaw = "Unknown"] = relation.split(":");
  const direction = directionRaw === "out" || directionRaw === "in" ? directionRaw : "unknown";
  const relationType = relationTypeRaw || "related";
  const neighbor = neighborRaw || "Unknown";

  if (direction === "out") {
    return {
      direction,
      relationType,
      neighbor,
      label: `${entity} -[${relationType}]-> ${neighbor}`,
    };
  }

  if (direction === "in") {
    return {
      direction,
      relationType,
      neighbor,
      label: `${neighbor} -[${relationType}]-> ${entity}`,
    };
  }

  return {
    direction,
    relationType,
    neighbor,
    label: `${entity} -[${relationType}]- ${neighbor}`,
  };
}

function buildConversationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeConversation(input: unknown): Conversation {
  const candidate = input as Partial<Conversation> | undefined;
  const messages = Array.isArray(candidate?.messages) ? candidate.messages.map(normalizeMessage) : [];
  return createConversation({
    id: typeof candidate?.id === "string" && candidate.id ? candidate.id : undefined,
    title:
      typeof candidate?.title === "string" && candidate.title
        ? candidate.title
        : deriveConversationTitle(messages),
    createdAt: typeof candidate?.createdAt === "string" && candidate.createdAt ? candidate.createdAt : undefined,
    updatedAt: typeof candidate?.updatedAt === "string" && candidate.updatedAt ? candidate.updatedAt : undefined,
    messages,
  });
}

function normalizeMessage(input: unknown): Message {
  const candidate = input as Partial<Message> | undefined;
  const kind =
    candidate?.kind === "github_review" || candidate?.githubReview
      ? "github_review"
      : "qa";
  return {
    role: candidate?.role === "assistant" ? "assistant" : "user",
    content: typeof candidate?.content === "string" ? candidate.content : "",
    kind,
    response: candidate?.response,
    githubReview: candidate?.githubReview,
    githubReviewProgress: candidate?.githubReviewProgress,
    status: typeof candidate?.status === "string" ? candidate.status : undefined,
    error: typeof candidate?.error === "string" ? candidate.error : undefined,
  };
}
