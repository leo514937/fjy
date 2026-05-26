import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchKnowledgeGraph, fetchOntologies, searchEntities as searchEntitiesRequest } from '@/features/ontology/api';
import { subscribeRepositorySync } from '@/shared/events/repositorySync';
import type { KnowledgeGraphData, Entity, OntologyModule } from '@/types/ontology';
import { getStoredSelectedProjectId, subscribeSelectedProjectIdChange } from '@/features/workspace/selectedProject';

export function useOntologyData(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphData | null>(null);
  const [philosophicalOntology, setPhilosophicalOntology] = useState<OntologyModule | null>(null);
  const [formalOntology, setFormalOntology] = useState<OntologyModule | null>(null);
  const [scientificOntology, setScientificOntology] = useState<OntologyModule | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(getStoredSelectedProjectId);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const requestSequenceRef = useRef(0);
  const activeRequestIdRef = useRef(0);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const refreshKnowledgeGraph = useCallback(async (options: { silent?: boolean; forceRefresh?: boolean } = {}) => {
    if (!enabled) {
      return;
    }

    const silent = options.silent ?? true;
    const projectId = selectedProjectId;
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    activeRequestIdRef.current = requestId;

    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const knowledgeGraphPromise = fetchKnowledgeGraph({ refresh: options.forceRefresh, projectId });
      const ontologiesPromise = fetchOntologies();
      const [kgData, ontologies] = await Promise.all([
        knowledgeGraphPromise,
        ontologiesPromise,
      ]);

      if (activeRequestIdRef.current !== requestId || selectedProjectIdRef.current !== projectId) {
        return;
      }

      setKnowledgeGraph(kgData);
      setPhilosophicalOntology(ontologies.philosophicalOntology);
      setFormalOntology(ontologies.formalOntology);
      setScientificOntology(ontologies.scientificOntology);
      setLastRefreshAt(new Date().toISOString());
    } catch (err) {
      if (activeRequestIdRef.current !== requestId || selectedProjectIdRef.current !== projectId) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (activeRequestIdRef.current !== requestId) {
        return;
      }
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [enabled, selectedProjectId]);

  useEffect(() => {
    if (!enabled) {
      requestSequenceRef.current += 1;
      activeRequestIdRef.current = requestSequenceRef.current;
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return undefined;
    }

    void refreshKnowledgeGraph({ silent: false });
  }, [enabled, refreshKnowledgeGraph, selectedProjectId]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    return subscribeRepositorySync((detail) => {
      if (
        detail.source === 'initXgProject'
        || detail.source === 'updateXgProjectName'
        || detail.source === 'softDeleteXgProject'
      ) {
        return;
      }

      const detailProjectId = detail.projectId?.trim();
      if (detailProjectId && detailProjectId !== selectedProjectIdRef.current) {
        return;
      }
      void refreshKnowledgeGraph({ silent: true, forceRefresh: true });
    });
  }, [enabled, refreshKnowledgeGraph]);

  useEffect(() => subscribeSelectedProjectIdChange((projectId) => {
    setSelectedProjectId(projectId);
  }), []);

  const getEntityById = (id: string): Entity | undefined => {
    return knowledgeGraph?.entity_index[id];
  };

  const searchEntities = async (query: string): Promise<Entity[]> => {
    if (!query.trim()) return [];
    return searchEntitiesRequest(query, selectedProjectId);
  };

  const getEntitiesByDomain = (domain: string): Entity[] => {
    if (!knowledgeGraph) return [];
    return Object.values(knowledgeGraph.entity_index).filter((entity) => entity.domain === domain);
  };

  const getEntitiesByLevel = (level: number): Entity[] => {
    if (!knowledgeGraph) return [];
    return Object.values(knowledgeGraph.entity_index).filter((entity) => entity.level === level);
  };

  const getRelatedEntities = (entityId: string): Entity[] => {
    if (!knowledgeGraph) return [];

    const related = knowledgeGraph.cross_references.filter((ref) => ref.source === entityId || ref.target === entityId);

    return related.map((ref) => {
      const relatedId = ref.source === entityId ? ref.target : ref.source;
      return knowledgeGraph.entity_index[relatedId];
    }).filter(Boolean);
  };

  return {
    knowledgeGraph,
    philosophicalOntology,
    formalOntology,
    scientificOntology,
    loading,
    refreshing,
    lastRefreshAt,
    error,
    getEntityById,
    searchEntities,
    getEntitiesByDomain,
    getEntitiesByLevel,
    getRelatedEntities,
    refreshKnowledgeGraph,
    selectedProjectId,
  };
}
