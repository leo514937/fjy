import type { WorkflowV2Result, WorkflowV2StageResult } from '@/features/workflow/runtimeV2';

export interface WorkflowV2GraphNode {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  isIsolated: boolean;
  structureStatus: string;
  structureReason: string;
}

export interface WorkflowV2GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface WorkflowV2SiblingImpactEdge {
  id: string;
  sourceId: string;
  targetId: string;
  parentId: string;
  impactLevel: 'none' | 'low' | 'medium' | 'high';
}

export interface WorkflowV2ImpactEdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

export interface WorkflowV2GraphViewOptions {
  hideIsolatedNodes?: boolean;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeImpactLevel(value: unknown): WorkflowV2SiblingImpactEdge['impactLevel'] {
  const normalized = asText(value).trim().toLowerCase();
  if (normalized === 'none' || normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'none';
}

function getImpactLevelRank(level: WorkflowV2SiblingImpactEdge['impactLevel']) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  if (level === 'low') return 1;
  return 0;
}

export function getWorkflowV2StageOutput<T extends Record<string, unknown> = Record<string, unknown>>(
  stageResults: WorkflowV2StageResult[],
  stageName: string,
): T {
  const stage = stageResults.find((item) => item.stage === stageName);
  return asRecord(stage?.output) as T;
}

export function extractWorkflowV2Summary(result: WorkflowV2Result | null) {
  const meta = asRecord(result?.meta);
  return {
    chunkCount: Number(meta.total_chunks ?? 0) || 0,
    windowCount: Number(meta.total_windows ?? 0) || 0,
    objectCount: Number(meta.total_objects ?? 0) || 0,
    edgeCount: Number(meta.total_edges ?? 0) || 0,
    isDag: Boolean(meta.is_dag),
  };
}

export function extractWorkflowV2SiblingImpactEdges(parentSummaries: unknown): WorkflowV2SiblingImpactEdge[] {
  const edgeMap = new Map<string, WorkflowV2SiblingImpactEdge>();

  for (const summary of asArray(parentSummaries)) {
    const summaryRecord = asRecord(summary);
    const parentId = asText(summaryRecord.parent_object_id);
    for (const impact of asArray(summaryRecord.sibling_dependency_table)) {
      const impactRecord = asRecord(impact);
      const sourceId = asText(impactRecord.ablated_child_object_id);
      const targetId = asText(impactRecord.target_sibling_object_id);
      if (!sourceId || !targetId || sourceId === targetId) {
        continue;
      }
      const impactLevel = normalizeImpactLevel(impactRecord.impact_level);
      const nextEdge: WorkflowV2SiblingImpactEdge = {
        id: `${parentId || 'parent'}:${sourceId}->${targetId}`,
        sourceId,
        targetId,
        parentId,
        impactLevel,
      };
      const edgeKey = `${sourceId}->${targetId}`;
      const existing = edgeMap.get(edgeKey);
      if (!existing || getImpactLevelRank(impactLevel) > getImpactLevelRank(existing.impactLevel)) {
        edgeMap.set(edgeKey, nextEdge);
      }
    }
  }

  return [...edgeMap.values()];
}

export function getWorkflowV2ImpactEdgeStyle(impactLevel: string): WorkflowV2ImpactEdgeStyle {
  const level = normalizeImpactLevel(impactLevel);
  if (level === 'high') {
    return {
      stroke: 'rgba(239,68,68,0.8)',
      strokeWidth: 4,
    };
  }
  if (level === 'medium') {
    return {
      stroke: 'rgba(245,158,11,0.78)',
      strokeWidth: 3.25,
    };
  }
  if (level === 'low') {
    return {
      stroke: 'rgba(14,165,233,0.72)',
      strokeWidth: 2.5,
      strokeDasharray: '8 6',
    };
  }
  return {
    stroke: 'rgba(148,163,184,0.58)',
    strokeWidth: 1.75,
    strokeDasharray: '4 8',
  };
}

function getConnectedObjectIds(edges: Record<string, unknown>[]) {
  const connectedIds = new Set<string>();
  for (const edge of edges) {
    const sourceId = asText(edge.source_object_id);
    const targetId = asText(edge.target_object_id);
    if (sourceId) {
      connectedIds.add(sourceId);
    }
    if (targetId) {
      connectedIds.add(targetId);
    }
  }
  return connectedIds;
}

function filterGraphObjects(
  objects: Record<string, unknown>[],
  edges: Record<string, unknown>[],
  options?: WorkflowV2GraphViewOptions,
) {
  if (options?.hideIsolatedNodes !== false) {
    const connectedIds = getConnectedObjectIds(edges);
    return objects.filter((item) => connectedIds.has(asText(item.object_id)));
  }
  return objects;
}

function buildWorkflowV2GraphLayoutFromParts(input: {
  objects: unknown;
  edges: unknown;
  options?: WorkflowV2GraphViewOptions;
}): {
  nodes: WorkflowV2GraphNode[];
  edges: WorkflowV2GraphEdge[];
} {
  const edges = asArray(input.edges).map((item) => asRecord(item));
  const objects = filterGraphObjects(
    asArray(input.objects).map((item) => asRecord(item)),
    edges,
    input.options,
  );
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const depthMap = new Map<string, number>();

  for (const object of objects) {
    const objectId = asText(object.object_id);
    if (!objectId) continue;
    indegree.set(objectId, 0);
    adjacency.set(objectId, []);
    depthMap.set(objectId, 0);
  }

  const normalizedEdges: WorkflowV2GraphEdge[] = [];
  for (const edge of edges) {
    const sourceId = asText(edge.source_object_id);
    const targetId = asText(edge.target_object_id);
    if (!sourceId || !targetId || !indegree.has(sourceId) || !indegree.has(targetId)) {
      continue;
    }
    normalizedEdges.push({
      id: asText(edge.edge_id) || `${sourceId}-${targetId}`,
      sourceId,
      targetId,
    });
    indegree.set(targetId, (indegree.get(targetId) ?? 0) + 1);
    adjacency.get(sourceId)?.push(targetId);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([objectId]) => objectId);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const nextDepth = depthMap.get(current) ?? 0;
    for (const target of adjacency.get(current) ?? []) {
      depthMap.set(target, Math.max(depthMap.get(target) ?? 0, nextDepth + 1));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  const columns = new Map<number, string[]>();
  for (const object of objects) {
    const objectId = asText(object.object_id);
    if (!objectId) continue;
    const depth = depthMap.get(objectId) ?? 0;
    const current = columns.get(depth) ?? [];
    current.push(objectId);
    columns.set(depth, current);
  }

  const nodes: WorkflowV2GraphNode[] = [];
  const sortedColumns = [...columns.entries()].sort((a, b) => a[0] - b[0]);
  for (const [depth, columnNodes] of sortedColumns) {
    columnNodes.forEach((nodeId, index) => {
      const object = objects.find((item) => asText(item.object_id) === nodeId);
      nodes.push({
        id: nodeId,
        label: asText(object?.object_name) || nodeId,
        depth,
        x: 140 + depth * 220,
        y: 90 + index * 120,
        isIsolated: asBoolean(object?.is_isolated),
        structureStatus: asText(object?.structure_status),
        structureReason: asText(object?.structure_reason),
      });
    });
  }

  return {
    nodes,
    edges: normalizedEdges,
  };
}

export function buildWorkflowV2GraphLayout(result: WorkflowV2Result | null, options?: WorkflowV2GraphViewOptions): {
  nodes: WorkflowV2GraphNode[];
  edges: WorkflowV2GraphEdge[];
} {
  return buildWorkflowV2GraphLayoutFromParts({
    objects: result?.objects,
    edges: result?.edges,
    options,
  });
}

export function buildWorkflowV2GraphLayoutFromStageData(input: {
  objects: unknown;
  edges: unknown;
  options?: WorkflowV2GraphViewOptions;
}): {
  nodes: WorkflowV2GraphNode[];
  edges: WorkflowV2GraphEdge[];
} {
  return buildWorkflowV2GraphLayoutFromParts(input);
}

function escapeMermaidLabel(value: string) {
  return value.replace(/"/g, '\\"');
}

function buildWorkflowV2MermaidFromParts(input: {
  objects: unknown;
  edges: unknown;
  options?: WorkflowV2GraphViewOptions;
}) {
  const edges = asArray(input.edges).map((item) => asRecord(item));
  const objects = filterGraphObjects(
    asArray(input.objects).map((item) => asRecord(item)),
    edges,
    input.options,
  );
  if (objects.length === 0) {
    return '';
  }

  const idMap = new Map<string, string>();
  const lines = ['flowchart LR'];

  objects.forEach((object, index) => {
    const objectId = asText(object.object_id);
    if (!objectId) {
      return;
    }
    const mermaidId = `n${index + 1}`;
    idMap.set(objectId, mermaidId);
    lines.push(`  ${mermaidId}["${escapeMermaidLabel(asText(object.object_name) || objectId)}"]`);
  });

  edges.forEach((edge) => {
    const sourceId = idMap.get(asText(edge.source_object_id));
    const targetId = idMap.get(asText(edge.target_object_id));
    if (!sourceId || !targetId) {
      return;
    }
    lines.push(`  ${sourceId} --> ${targetId}`);
  });

  return lines.join('\n');
}

export function buildWorkflowV2Mermaid(result: WorkflowV2Result | null, options?: WorkflowV2GraphViewOptions) {
  return buildWorkflowV2MermaidFromParts({
    objects: result?.objects,
    edges: result?.edges,
    options,
  });
}

export function buildWorkflowV2MermaidFromStageData(input: {
  objects: unknown;
  edges: unknown;
  options?: WorkflowV2GraphViewOptions;
}) {
  return buildWorkflowV2MermaidFromParts(input);
}
