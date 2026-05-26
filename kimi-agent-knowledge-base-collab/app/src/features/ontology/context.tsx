import * as React from 'react';

import { useOntologyData } from '@/hooks/useOntologyData';
import type { Entity, KnowledgeLayer } from '@/types/ontology';
import { buildOntologyAppState } from '@/features/ontology/state';
import { OntologyContext } from '@/features/ontology/context.shared';
import type { OntologyContextValue } from '@/features/ontology/context.types';

interface OntologyProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
}

export function OntologyProvider({ children, enabled = true }: OntologyProviderProps) {
  const { knowledgeGraph, loading, refreshing, lastRefreshAt, error, searchEntities, refreshKnowledgeGraph } = useOntologyData({ enabled });
  const [selectedLayer, setSelectedLayer] = React.useState<'all' | KnowledgeLayer>('all');
  const [selectedEntityId, setSelectedEntityId] = React.useState<string | null>(null);

  const appState = React.useMemo(() => buildOntologyAppState({
    knowledgeGraph,
    selectedLayer,
    selectedEntityId,
  }), [knowledgeGraph, selectedEntityId, selectedLayer]);

  const selectEntity = React.useCallback((entity: Entity) => {
    setSelectedEntityId(entity.id);
  }, []);

  const selectEntityById = React.useCallback((entityId: string | null) => {
    setSelectedEntityId(entityId);
  }, []);

  const searchInLayer = React.useCallback(async (query: string) => {
    const results = await searchEntities(query);
    return results.filter((entity) => selectedLayer === 'all' || entity.layer === selectedLayer);
  }, [searchEntities, selectedLayer]);

  const value = React.useMemo<OntologyContextValue>(() => ({
    ...appState,
    loading,
    refreshing,
    lastRefreshAt,
    error,
    selectedLayer,
    setSelectedLayer,
    selectedEntityId: appState.selectedEntity?.id ?? selectedEntityId,
    selectEntity,
    selectEntityById,
    searchInLayer,
    refreshKnowledgeGraph,
  }), [appState, error, lastRefreshAt, loading, refreshKnowledgeGraph, refreshing, searchInLayer, selectEntity, selectEntityById, selectedEntityId, selectedLayer]);

  return <OntologyContext.Provider value={value}>{children}</OntologyContext.Provider>;
}
