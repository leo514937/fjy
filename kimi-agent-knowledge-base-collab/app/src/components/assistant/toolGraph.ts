import type { CrossReference, Entity } from '@/types/ontology';
import type {
  AssistantGraphEntity,
  AssistantGraphRelation,
  PersistedOntologyAssistantToolRun,
} from '@/features/assistant/api';

type AssistantGraphNode = {
  entities: Entity[];
  crossReferences: CrossReference[];
};

function isVisibleText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeToolName(command: string) {
  const normalized = command.toLowerCase();
  if (normalized.includes('ner.sh') || normalized.includes('python -m ner')) return 'ner';
  if (normalized.includes('re.sh') || normalized.includes('entity_relation')) return 're';
  return '';
}

function parseStructuredOutput(content: string) {
  if (!isVisibleText(content)) {
    return null;
  }

  const trimmed = content.trim();
  const candidates = [trimmed];
  const firstJson = trimmed.indexOf('{');
  const firstArray = trimmed.indexOf('[');
  const start = [firstJson, firstArray].filter((value) => value >= 0).sort((a, b) => a - b)[0];

  if (typeof start === 'number' && start > 0) {
    candidates.unshift(trimmed.slice(start));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }

  return null;
}

function entityToNode(entity: AssistantGraphEntity, prefix: string): Entity {
  const displayLevel = entity.label === 'REL' ? 2 : 1;
  return {
    id: `${prefix}:${entity.entity_id}`,
    name: entity.text || entity.normalized_text || entity.entity_id,
    type: entity.label || '实体',
    domain: '抽取结果',
    layer: 'private',
    level: 2,
    source: 'QAgent NER',
    definition: entity.source_sentence || entity.text || entity.normalized_text || '',
    properties: {
      confidence: entity.confidence ?? null,
      metadata: entity.metadata || {},
    },
    display_level: displayLevel,
    visible: true,
    highlight: displayLevel === 1,
    pinned: false,
    focus: false,
  };
}

function relationToEdge(
  relation: AssistantGraphRelation,
  entityIndex: Map<string, Entity>,
): CrossReference | null {
  const sourceKey = relation.source_entity_id || relation.source_text || '';
  const targetKey = relation.target_entity_id || relation.target_text || '';
  const source = entityIndex.get(sourceKey) || entityIndex.get(relation.source_text || '');
  const target = entityIndex.get(targetKey) || entityIndex.get(relation.target_text || '');
  if (!source || !target) {
    return null;
  }

  return {
    source: source.id,
    target: target.id,
    relation: relation.relation_type || '关联',
    description: relation.evidence_sentence || `${source.name} ${relation.relation_type || '关联'} ${target.name}`,
    display_level: 1,
    visible: true,
    highlight: true,
  };
}

function collectNerNodes(runs: PersistedOntologyAssistantToolRun[]) {
  const entities: Entity[] = [];

  for (const run of runs) {
    if (normalizeToolName(run.command) !== 'ner') {
      continue;
    }

    const parsed = parseStructuredOutput(run.stdout) as { doc_id?: string; entities?: AssistantGraphEntity[] } | null;
    if (!parsed?.entities?.length) {
      continue;
    }

    const prefix = parsed.doc_id || run.callId;
    entities.push(...parsed.entities.map((entity) => entityToNode(entity, prefix)));
  }

  return entities;
}

function collectRelationEdges(runs: PersistedOntologyAssistantToolRun[], nodes: Entity[]) {
  const edges: CrossReference[] = [];
  const entityIndex = new Map<string, Entity>();
  for (const node of nodes) {
    entityIndex.set(node.id.split(':').slice(1).join(':'), node);
    entityIndex.set(node.name, node);
  }

  for (const run of runs) {
    if (normalizeToolName(run.command) !== 're') {
      continue;
    }

    const parsed = parseStructuredOutput(run.stdout) as { doc_id?: string; relations?: AssistantGraphRelation[] } | null;
    if (!parsed?.relations?.length) {
      continue;
    }

    for (const relation of parsed.relations) {
      const edge = relationToEdge(relation, entityIndex);
      if (edge) {
        edges.push(edge);
      }
    }
  }

  return edges;
}

export function buildAssistantGraphOverlay(
  toolRuns: PersistedOntologyAssistantToolRun[],
): AssistantGraphNode {
  const nerNodes = collectNerNodes(toolRuns);
  const relationEdges = collectRelationEdges(toolRuns, nerNodes);
  return {
    entities: nerNodes,
    crossReferences: relationEdges,
  };
}
