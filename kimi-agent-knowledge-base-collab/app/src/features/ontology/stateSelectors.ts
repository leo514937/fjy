import type { CrossReference, Entity, KnowledgeGraphData, KnowledgeLayer } from '../../types/ontology.ts';

export interface OntologyEntityViews {
  entities: Entity[];
  filteredEntities: Entity[];
  visibleEntityIndex: Map<string, Entity>;
}

export interface OntologyStatistics {
  total_entities: number;
  total_relations: number;
  domains: string[];
  levels: number[];
  sources?: string[];
  layers: KnowledgeLayer[];
  layer_counts: Partial<Record<KnowledgeLayer, number>>;
}

export function selectOntologyEntityViews(
  knowledgeGraph: KnowledgeGraphData | null,
  selectedLayer: 'all' | KnowledgeLayer,
): OntologyEntityViews {
  const entities: Entity[] = [];
  const filteredEntities: Entity[] = [];
  const visibleEntityIndex = new Map<string, Entity>();

  if (!knowledgeGraph) {
    return { entities, filteredEntities, visibleEntityIndex };
  }

  for (const entity of Object.values(knowledgeGraph.entity_index)) {
    entities.push(entity);
    if (selectedLayer === 'all' || entity.layer === selectedLayer) {
      filteredEntities.push(entity);
      visibleEntityIndex.set(entity.id, entity);
    }
  }

  return { entities, filteredEntities, visibleEntityIndex };
}

export function selectOntologyFilteredCrossReferences(
  crossReferences: CrossReference[],
  visibleEntityIndex: Map<string, Entity>,
): CrossReference[] {
  const filteredCrossReferences: CrossReference[] = [];

  for (const reference of crossReferences) {
    if (visibleEntityIndex.has(reference.source) && visibleEntityIndex.has(reference.target)) {
      filteredCrossReferences.push(reference);
    }
  }

  return filteredCrossReferences;
}

export function selectOntologySelectedEntity(
  filteredEntities: Entity[],
  selectedEntityId: string | null,
  visibleEntityIndex: Map<string, Entity>,
): Entity | null {
  if (selectedEntityId) {
    const selectedEntity = visibleEntityIndex.get(selectedEntityId);
    if (selectedEntity) {
      return selectedEntity;
    }
  }

  return filteredEntities[0] ?? null;
}

export function selectOntologyRelatedEntities(
  selectedEntity: Entity | null,
  filteredCrossReferences: CrossReference[],
  visibleEntityIndex: Map<string, Entity>,
): Entity[] {
  if (!selectedEntity) {
    return [];
  }

  const relatedEntities: Entity[] = [];

  for (const reference of filteredCrossReferences) {
    const relatedId = reference.source === selectedEntity.id
      ? reference.target
      : reference.target === selectedEntity.id
        ? reference.source
        : null;

    if (!relatedId) {
      continue;
    }

    const relatedEntity = visibleEntityIndex.get(relatedId);
    if (relatedEntity) {
      relatedEntities.push(relatedEntity);
    }
  }

  return relatedEntities;
}

export function selectOntologyFilteredStatistics(
  filteredEntities: Entity[],
  filteredCrossReferences: CrossReference[],
): OntologyStatistics {
  const domains = new Set<string>();
  const levels = new Set<number>();
  const sources = new Set<string>();
  const layers = new Set<KnowledgeLayer>();
  const layer_counts: Partial<Record<KnowledgeLayer, number>> = {};

  for (const entity of filteredEntities) {
    domains.add(entity.domain);

    if (entity.level !== undefined) {
      levels.add(entity.level);
    }

    sources.add(entity.source);
    layers.add(entity.layer);
    layer_counts[entity.layer] = (layer_counts[entity.layer] ?? 0) + 1;
  }

  return {
    total_entities: filteredEntities.length,
    total_relations: filteredCrossReferences.length,
    domains: [...domains],
    levels: [...levels],
    sources: sources.size > 0 ? [...sources] : undefined,
    layers: [...layers],
    layer_counts,
  };
}
