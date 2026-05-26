import type { KnowledgeGraphNode } from './knowledgeGraphLayout';

export const KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE = 240;
export const KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN = 1;
export const KNOWLEDGE_GRAPH_SPATIAL_EXACT_THRESHOLD = 64;

export type KnowledgeGraphRepulsionStrategy =
  | {
      mode: 'exact';
      cellSize: 0;
      neighborSpan: 0;
    }
  | {
      mode: 'spatial';
      cellSize: typeof KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE;
      neighborSpan: typeof KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN;
    };

export interface KnowledgeGraphSpatialIndex {
  cellSize: number;
  buckets: Map<string, number[]>;
  cells: Array<{
    cellKey: string;
    cellX: number;
    cellY: number;
  }>;
}

export type KnowledgeGraphNeighborPairCallback = (
  sourceNode: KnowledgeGraphNode,
  targetNode: KnowledgeGraphNode,
  sourceIndex: number,
  targetIndex: number,
) => void;

function getKnowledgeGraphSpatialCellKey(cellX: number, cellY: number) {
  return `${cellX},${cellY}`;
}

export function getKnowledgeGraphRepulsionStrategy(
  nodeCount: number,
): KnowledgeGraphRepulsionStrategy {
  if (nodeCount <= KNOWLEDGE_GRAPH_SPATIAL_EXACT_THRESHOLD) {
    return {
      mode: 'exact',
      cellSize: 0,
      neighborSpan: 0,
    };
  }

  return {
    mode: 'spatial',
    cellSize: KNOWLEDGE_GRAPH_SPATIAL_CELL_SIZE,
    neighborSpan: KNOWLEDGE_GRAPH_SPATIAL_NEIGHBOR_SPAN,
  };
}

export function buildKnowledgeGraphSpatialIndex(
  nodes: KnowledgeGraphNode[],
  cellSize: number,
): KnowledgeGraphSpatialIndex {
  const buckets = new Map<string, number[]>();
  const cells: Array<{
    cellKey: string;
    cellX: number;
    cellY: number;
  }> = [];

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    const cellKey = getKnowledgeGraphSpatialCellKey(cellX, cellY);
    const bucket = buckets.get(cellKey);

    if (bucket) {
      bucket.push(nodeIndex);
      continue;
    }

    buckets.set(cellKey, [nodeIndex]);
    cells.push({
      cellKey,
      cellX,
      cellY,
    });
  }

  return {
    cellSize,
    buckets,
    cells,
  };
}

export function forEachKnowledgeGraphNeighborPair(
  nodes: KnowledgeGraphNode[],
  index: KnowledgeGraphSpatialIndex,
  neighborSpan: number,
  callback: KnowledgeGraphNeighborPairCallback,
) {
  if (nodes.length < 2 || neighborSpan < 0) {
    return;
  }

  for (const { cellKey: bucketKey, cellX, cellY } of index.cells) {
    const sourceBucket = index.buckets.get(bucketKey);
    if (!sourceBucket) {
      continue;
    }

    for (let deltaY = -neighborSpan; deltaY <= neighborSpan; deltaY += 1) {
      for (let deltaX = -neighborSpan; deltaX <= neighborSpan; deltaX += 1) {
        if (deltaY < 0 || (deltaY === 0 && deltaX < 0)) {
          continue;
        }

        const neighborKey = getKnowledgeGraphSpatialCellKey(cellX + deltaX, cellY + deltaY);
        const targetBucket = index.buckets.get(neighborKey);

        if (!targetBucket) {
          continue;
        }

        if (deltaX === 0 && deltaY === 0) {
          for (let sourceOffset = 0; sourceOffset < sourceBucket.length; sourceOffset += 1) {
            const sourceIndex = sourceBucket[sourceOffset];
            const sourceNode = nodes[sourceIndex];

            for (let targetOffset = sourceOffset + 1; targetOffset < sourceBucket.length; targetOffset += 1) {
              const targetIndex = sourceBucket[targetOffset];
              callback(sourceNode, nodes[targetIndex], sourceIndex, targetIndex);
            }
          }
          continue;
        }

        for (const sourceIndex of sourceBucket) {
          const sourceNode = nodes[sourceIndex];

          for (const targetIndex of targetBucket) {
            callback(sourceNode, nodes[targetIndex], sourceIndex, targetIndex);
          }
        }
      }
    }
  }
}
