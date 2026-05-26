import { useMemo, useState } from 'react';

import { EntityDetail } from '@/components/EntityDetail';
import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GraphProbabilityFilterPanel } from '@/features/ontology/components/GraphProbabilityFilterPanel';
import {
  DEFAULT_GRAPH_PROBABILITY_FILTERS,
  filterGraphCrossReferencesByProbability,
  filterGraphEntitiesByProbability,
  type GraphProbabilityFilters,
} from '@/features/ontology/graphProbabilityFilters';
import {
  selectOntologyRelatedEntities,
  selectOntologySelectedEntity,
} from '@/features/ontology/stateSelectors';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import type { Entity } from '@/types/ontology';

interface GraphPageProps {
  onSelectEntity: (entity: Entity) => void;
}

export function GraphPage({ onSelectEntity }: GraphPageProps) {
  const {
    filteredEntities,
    filteredCrossReferences,
    selectedEntityId,
  } = useOntologyContext();
  const [probabilityFilters, setProbabilityFilters] = useState<GraphProbabilityFilters>(
    DEFAULT_GRAPH_PROBABILITY_FILTERS,
  );

  const graphEntities = useMemo(
    () => filterGraphEntitiesByProbability(filteredEntities, probabilityFilters),
    [filteredEntities, probabilityFilters],
  );

  const graphEntityIndex = useMemo(
    () => new Map(graphEntities.map((entity) => [entity.id, entity])),
    [graphEntities],
  );

  const graphCrossReferences = useMemo(
    () => filterGraphCrossReferencesByProbability(filteredCrossReferences, graphEntities),
    [filteredCrossReferences, graphEntities],
  );

  const selectedGraphEntity = useMemo(
    () => selectOntologySelectedEntity(graphEntities, selectedEntityId, graphEntityIndex),
    [graphEntities, graphEntityIndex, selectedEntityId],
  );

  const relatedGraphEntities = useMemo(
    () => selectOntologyRelatedEntities(selectedGraphEntity, graphCrossReferences, graphEntityIndex),
    [graphCrossReferences, graphEntityIndex, selectedGraphEntity],
  );

  const matchedEntityCount = graphEntities.length;
  const totalEntityCount = filteredEntities.length;

  return (
    <ScrollArea className="h-full w-full">
      <div className="p-6 space-y-12 flex flex-col pb-20">
        <GraphProbabilityFilterPanel
          filters={probabilityFilters}
          onChange={setProbabilityFilters}
          matchedEntityCount={matchedEntityCount}
          totalEntityCount={totalEntityCount}
          relationCount={graphCrossReferences.length}
        />

        <div className="w-full h-[700px] xl:h-[850px] shadow-sm rounded-3xl overflow-hidden border border-border">
          <KnowledgeGraph
            entities={graphEntities}
            crossReferences={graphCrossReferences}
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId ?? undefined}
          />
        </div>
        <div className="w-full relative z-10 bg-background">
          <EntityDetail
            entity={selectedGraphEntity}
            relatedEntities={relatedGraphEntities}
            onSelectRelated={onSelectEntity}
          />
        </div>
      </div>
    </ScrollArea>
  );
}
