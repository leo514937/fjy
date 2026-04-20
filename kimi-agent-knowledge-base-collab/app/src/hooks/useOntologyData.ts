import { useState, useEffect } from 'react';
import { fetchKnowledgeGraph, fetchOntologies, searchEntities as searchEntitiesRequest } from '@/features/ontology/api';
import type { KnowledgeGraphData, Entity, OntologyModule } from '@/types/ontology';

export function useOntologyData() {
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphData | null>(null);
  const [philosophicalOntology, setPhilosophicalOntology] = useState<OntologyModule | null>(null);
  const [formalOntology, setFormalOntology] = useState<OntologyModule | null>(null);
  const [scientificOntology, setScientificOntology] = useState<OntologyModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshKnowledgeGraph = async (options: { silent?: boolean; forceRefresh?: boolean } = {}) => {
    try {
      if (!options.silent) {
        setLoading(true);
      }
      setError(null);

      const [kgData, ontologies] = await Promise.all([
        fetchKnowledgeGraph({ refresh: options.forceRefresh }),
        fetchOntologies(),
      ]);

      setKnowledgeGraph(kgData);
      setPhilosophicalOntology(ontologies.philosophicalOntology);
      setFormalOntology(ontologies.formalOntology);
      setScientificOntology(ontologies.scientificOntology);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void refreshKnowledgeGraph();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshKnowledgeGraph({ silent: true, forceRefresh: true });
    }, 10000);

    return () => window.clearInterval(interval);
  }, []);

  const getEntityById = (id: string): Entity | undefined => {
    return knowledgeGraph?.entity_index[id];
  };

  const searchEntities = async (query: string): Promise<Entity[]> => {
    if (!query.trim()) return [];
    return searchEntitiesRequest(query);
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
    error,
    getEntityById,
    searchEntities,
    getEntitiesByDomain,
    getEntitiesByLevel,
    getRelatedEntities,
    refreshKnowledgeGraph,
  };
}
