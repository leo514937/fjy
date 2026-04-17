import type { Entity, KnowledgeLayer } from '@/types/ontology';
import type { Dispatch, SetStateAction } from 'react';

export interface OntologyContextValue {
  entities: Entity[];
  crossReferences: Array<{ source: string; target: string; relation: string; description: string }>;
  filteredEntities: Entity[];
  filteredCrossReferences: Array<{ source: string; target: string; relation: string; description: string }>;
  selectedEntity: Entity | null;
  relatedEntities: Entity[];
  loading: boolean;
  error: string | null;
  selectedLayer: 'all' | KnowledgeLayer;
  setSelectedLayer: Dispatch<SetStateAction<'all' | KnowledgeLayer>>;
  selectedEntityId: string | null;
  selectEntity: (entity: Entity) => void;
  searchInLayer: (query: string) => Promise<Entity[]>;
}
