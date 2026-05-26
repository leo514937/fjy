import type { Entity, KnowledgeGraphData, KnowledgeLayer } from '../../types/ontology.ts';

import {
  selectOntologyEntityViews,
  selectOntologyFilteredCrossReferences,
  selectOntologyFilteredStatistics,
  selectOntologyRelatedEntities,
  selectOntologySelectedEntity,
} from './stateSelectors.ts';

export interface OntologyAppState {
  entities: Entity[];
  crossReferences: Array<{ source: string; target: string; relation: string; description: string }>;
  filteredEntities: Entity[];
  filteredCrossReferences: Array<{ source: string; target: string; relation: string; description: string }>;
  selectedEntity: Entity | null;
  relatedEntities: Entity[];
  filteredStatistics: KnowledgeGraphData['statistics'] | null;
}

export function buildOntologyAppState(input: {
  knowledgeGraph: KnowledgeGraphData | null;
  selectedLayer: 'all' | KnowledgeLayer;
  selectedEntityId: string | null;
}): OntologyAppState {
  const { entities, filteredEntities, visibleEntityIndex } = selectOntologyEntityViews(
    input.knowledgeGraph,
    input.selectedLayer,
  );
  const crossReferences = input.knowledgeGraph?.cross_references || [];
  const filteredCrossReferences = selectOntologyFilteredCrossReferences(crossReferences, visibleEntityIndex);
  const selectedEntity = selectOntologySelectedEntity(filteredEntities, input.selectedEntityId, visibleEntityIndex);
  const relatedEntities = selectOntologyRelatedEntities(selectedEntity, filteredCrossReferences, visibleEntityIndex);
  const filteredStatistics = input.knowledgeGraph
    ? selectOntologyFilteredStatistics(filteredEntities, filteredCrossReferences)
    : null;

  return {
    entities,
    crossReferences,
    filteredEntities,
    filteredCrossReferences,
    selectedEntity,
    relatedEntities,
    filteredStatistics,
  };
}
