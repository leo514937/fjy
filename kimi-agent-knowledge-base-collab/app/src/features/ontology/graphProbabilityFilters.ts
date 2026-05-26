import type { CrossReference, Entity } from '@/types/ontology';

export interface GraphProbabilityFilters {
  keepProbabilityMin: number;
  removeProbabilityMax: number;
  probabilityGapMin: number;
}

export interface EntityProbabilityMetrics {
  keepProbability: number | null;
  removeProbability: number | null;
  probabilityGap: number | null;
}

export const DEFAULT_GRAPH_PROBABILITY_FILTERS: GraphProbabilityFilters = {
  keepProbabilityMin: 0,
  removeProbabilityMax: 100,
  probabilityGapMin: -100,
};

function clampPercentage(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

export function parseProbabilityPercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= -1 && value <= 1) {
      return clampPercentage(value * 100, -100, 100);
    }

    return clampPercentage(value, -100, 100);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.endsWith('%')) {
    const numeric = Number(trimmed.slice(0, -1));
    return Number.isFinite(numeric) ? clampPercentage(numeric, -100, 100) : null;
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric >= -1 && numeric <= 1) {
    return clampPercentage(numeric * 100, -100, 100);
  }

  return clampPercentage(numeric, -100, 100);
}

export function getEntityProbabilityMetrics(entity: Entity): EntityProbabilityMetrics {
  const ablation = entity.ablation ?? null;

  return {
    keepProbability: parseProbabilityPercent(ablation?.keep_probability),
    removeProbability: parseProbabilityPercent(ablation?.remove_probability),
    probabilityGap: parseProbabilityPercent(ablation?.probability_gap),
  };
}

export function hasActiveGraphProbabilityFilters(filters: GraphProbabilityFilters): boolean {
  return filters.keepProbabilityMin > DEFAULT_GRAPH_PROBABILITY_FILTERS.keepProbabilityMin
    || filters.removeProbabilityMax < DEFAULT_GRAPH_PROBABILITY_FILTERS.removeProbabilityMax
    || filters.probabilityGapMin > DEFAULT_GRAPH_PROBABILITY_FILTERS.probabilityGapMin;
}

export function passesGraphProbabilityFilters(entity: Entity, filters: GraphProbabilityFilters): boolean {
  if (!hasActiveGraphProbabilityFilters(filters)) {
    return true;
  }

  const metrics = getEntityProbabilityMetrics(entity);
  const keepFilterActive = filters.keepProbabilityMin > DEFAULT_GRAPH_PROBABILITY_FILTERS.keepProbabilityMin;
  const removeFilterActive = filters.removeProbabilityMax < DEFAULT_GRAPH_PROBABILITY_FILTERS.removeProbabilityMax;
  const gapFilterActive = filters.probabilityGapMin > DEFAULT_GRAPH_PROBABILITY_FILTERS.probabilityGapMin;

  if (keepFilterActive && metrics.keepProbability !== null && metrics.keepProbability < filters.keepProbabilityMin) {
    return false;
  }

  if (removeFilterActive && metrics.removeProbability !== null && metrics.removeProbability > filters.removeProbabilityMax) {
    return false;
  }

  if (gapFilterActive && metrics.probabilityGap !== null && metrics.probabilityGap < filters.probabilityGapMin) {
    return false;
  }

  return true;
}

export function filterGraphEntitiesByProbability(
  entities: Entity[],
  filters: GraphProbabilityFilters,
): Entity[] {
  return entities.filter((entity) => passesGraphProbabilityFilters(entity, filters));
}

export function filterGraphCrossReferencesByProbability(
  crossReferences: CrossReference[],
  visibleEntities: Entity[],
): CrossReference[] {
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));
  return crossReferences.filter((reference) => (
    visibleEntityIds.has(reference.source) && visibleEntityIds.has(reference.target)
  ));
}
