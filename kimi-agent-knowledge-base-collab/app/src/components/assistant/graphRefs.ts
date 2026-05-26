import type { ConversationMessage } from './types';
import type { CrossReference, Entity } from '@/types/ontology';

export interface GraphSlice {
  viewedRefs: string[];
  entities: Entity[];
  crossReferences: CrossReference[];
}

const SHOW_COMMAND_RE = /(?:\.\/)?io\.sh\s+show\s+([^\r\n]+)/gi;

function stripWrappingQuotes(value: string) {
  return value.replace(/^["'`]+|["'`]+$/g, '');
}

export function extractGraphShowRefs(text: string): string[] {
  if (!text.trim()) {
    return [];
  }

  const refs: string[] = [];
  const regex = new RegExp(SHOW_COMMAND_RE);
  let match = regex.exec(text);
  while (match) {
    const rawTarget = match[1]?.trim() || '';
    const firstToken = rawTarget.split(/\s+/)[0] || '';
    const candidate = stripWrappingQuotes(firstToken);
    if (candidate) {
      refs.push(candidate);
    }
    match = regex.exec(text);
  }

  return refs;
}

function extractRefsFromToolRuns(message: ConversationMessage): string[] {
  const toolRuns = Array.isArray(message.toolRuns) ? message.toolRuns : [];
  const refs: string[] = [];

  for (let index = toolRuns.length - 1; index >= 0; index -= 1) {
    refs.unshift(...extractGraphShowRefs(toolRuns[index]?.command || ''));
  }

  return refs;
}

function extractRefsFromBlocks(message: ConversationMessage): string[] {
  const blocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : [];
  const refs: string[] = [];

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === 'tool_call' || block.type === 'tool_result') {
      refs.unshift(...extractGraphShowRefs(block.command || ''));
    }

    if (block.type === 'assistant') {
      refs.unshift(...extractGraphShowRefs(block.content || ''));
    }
  }

  return refs;
}

function extractRefsFromAnswer(message: ConversationMessage): string[] {
  return extractGraphShowRefs(message.answer || '');
}

function dedupeRefs(refs: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const ref of refs) {
    if (!seen.has(ref)) {
      seen.add(ref);
      result.push(ref);
    }
  }

  return result;
}

export function findGraphShowRefs(message: ConversationMessage | null | undefined): string[] {
  if (!message) {
    return [];
  }

  return dedupeRefs([
    ...extractRefsFromToolRuns(message),
    ...extractRefsFromBlocks(message),
    ...extractRefsFromAnswer(message),
  ]);
}

export function collectGraphShowRefs(messages: ConversationMessage[] | null | undefined): string[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const refs: string[] = [];
  for (const message of messages) {
    refs.push(...findGraphShowRefs(message));
  }

  return dedupeRefs(refs);
}

function normalizeGraphRefCandidate(value: string) {
  return value.trim().replace(/^["'`]+|["'`]+$/g, '');
}

function normalizeGraphRefComparable(value: string) {
  return normalizeGraphRefCandidate(value)
    .toLowerCase()
    .replace(/^(common|domain|private):/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function findTargetEntity(entities: Entity[], ref: string): Entity | null {
  const normalizedRef = normalizeGraphRefCandidate(ref);
  if (!normalizedRef) {
    return null;
  }

  const comparableRef = normalizeGraphRefComparable(normalizedRef);
  const refTail = normalizedRef.split('/').filter(Boolean).at(-1) || normalizedRef;
  const comparableTail = normalizeGraphRefComparable(refTail);

  return (
    entities.find((entity) => entity.id === normalizedRef)
      || entities.find((entity) => entity.id.endsWith(`/${normalizedRef}`))
      || entities.find((entity) => entity.id.endsWith(`:${normalizedRef}`))
      || entities.find((entity) => entity.name === normalizedRef)
      || entities.find((entity) => entity.name.includes(normalizedRef))
      || entities.find((entity) => normalizeGraphRefComparable(entity.id) === comparableRef)
      || entities.find((entity) => normalizeGraphRefComparable(entity.id).endsWith(comparableTail))
      || entities.find((entity) => normalizeGraphRefComparable(entity.name) === comparableRef)
      || entities.find((entity) => normalizeGraphRefComparable(entity.name).includes(comparableTail))
      || null
  );
}

export function buildGraphSlice(
  entities: Entity[],
  crossReferences: CrossReference[],
  viewedRefs: string[],
): GraphSlice | null {
  const targetEntities = dedupeRefs(viewedRefs)
    .map((ref) => findTargetEntity(entities, ref))
    .filter((entity): entity is Entity => Boolean(entity));

  if (targetEntities.length === 0) {
    return null;
  }

  const visibleEntityIds = new Set<string>(targetEntities.map((entity) => entity.id));

  const visibleEntities = entities.filter((entity) => visibleEntityIds.has(entity.id));
  const visibleCrossReferences = crossReferences.filter((reference) => (
    visibleEntityIds.has(reference.source) && visibleEntityIds.has(reference.target)
  ));

  return {
    viewedRefs: dedupeRefs(viewedRefs).map(normalizeGraphRefCandidate),
    entities: visibleEntities,
    crossReferences: visibleCrossReferences,
  };
}
