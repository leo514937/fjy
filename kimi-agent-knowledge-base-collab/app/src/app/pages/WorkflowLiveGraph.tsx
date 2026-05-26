import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type WorkflowStageStatus = 'pending' | 'running' | 'success' | 'failed';

interface WorkflowStageResult {
  stage: string;
  status: WorkflowStageStatus;
  output: Record<string, unknown> | null;
}

type WorkflowLiveGraphStageKey = 'observe' | 'relations' | 'ablation_judge';

interface WorkflowLiveGraphProps {
  stageKey: WorkflowLiveGraphStageKey;
  stageResults: WorkflowStageResult[];
  stageStatus: WorkflowStageStatus;
}

interface GraphNodeDatum {
  id: string;
  name: string;
  summary?: string;
}

interface GraphEdgeDatum {
  id: string;
  source: string;
  target: string;
  relation: string;
}

interface GraphHighlightState {
  activeSystemNodeIds: Set<string>;
  removedNodeIds: Set<string>;
  focusNodeIds: Set<string>;
  parentNodeIds: Set<string>;
  activeLabels: string[];
}

interface PositionedNode extends GraphNodeDatum {
  x: number;
  y: number;
  radius: number;
}

const DEFAULT_HIGHLIGHT_STATE: GraphHighlightState = {
  activeSystemNodeIds: new Set<string>(),
  removedNodeIds: new Set<string>(),
  focusNodeIds: new Set<string>(),
  parentNodeIds: new Set<string>(),
  activeLabels: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'node';
}

function getStageOutput(stageResults: WorkflowStageResult[], stageName: string): Record<string, unknown> {
  const stage = stageResults.find((item) => item.stage === stageName);
  return asRecord(stage?.output);
}

function pushRawText(rawTexts: string[], value: unknown) {
  const text = asText(value);
  if (text) {
    rawTexts.push(text);
  }
}

function collectRawTexts(value: unknown, rawTexts: string[]) {
  const record = asRecord(value);
  pushRawText(rawTexts, record.raw_text);

  const candidates = asArray(record.candidates);
  for (const candidate of candidates) {
    pushRawText(rawTexts, asRecord(candidate).raw_text);
  }

  const singleResult = asRecord(record.single_result);
  pushRawText(rawTexts, singleResult.raw_text);
}

function collectStageRawTexts(output: Record<string, unknown>): string[] {
  const rawTexts: string[] = [];
  pushRawText(rawTexts, output.llm_raw_text);

  const llmEnsemble = asRecord(output.llm_ensemble);
  const models = asRecord(llmEnsemble.models);
  collectRawTexts(models.model_a, rawTexts);
  collectRawTexts(models.model_b, rawTexts);

  const judgeResults = asArray(llmEnsemble.judge_results);
  for (const item of judgeResults) {
    const nested = asRecord(asRecord(item).llm_ensemble);
    collectRawTexts(nested.keep_result, rawTexts);
    collectRawTexts(nested.remove_result, rawTexts);
  }

  return [...new Set(rawTexts.filter(Boolean))];
}

function mergeNode(nodeMap: Map<string, GraphNodeDatum>, node: GraphNodeDatum) {
  const existing = nodeMap.get(node.id);
  if (!existing) {
    nodeMap.set(node.id, node);
    return;
  }

  nodeMap.set(node.id, {
    ...existing,
    name: existing.name || node.name,
    summary: existing.summary || node.summary,
  });
}

function extractEntitiesFromStructured(value: unknown): GraphNodeDatum[] {
  return asArray(value)
    .map((item): GraphNodeDatum | null => {
      const record = asRecord(item);
      const name = asText(record.name);
      if (!name) {
        return null;
      }
      return {
        id: asText(record.id) || `entity-${slugify(name)}`,
        name,
        summary: asText(record.summary),
      } satisfies GraphNodeDatum;
    })
    .filter((item): item is GraphNodeDatum => item !== null);
}

function extractEntityDraftsFromText(text: string): GraphNodeDatum[] {
  const nodeMap = new Map<string, GraphNodeDatum>();
  const objectPattern = /\{[\s\S]{0,500}?"name"\s*:\s*"([^"]{1,80})"[\s\S]{0,500}?\}/g;

  for (const match of text.matchAll(objectPattern)) {
    const chunk = match[0];
    const name = asText(match[1]);
    if (!name || name.includes('%')) {
      continue;
    }
    const idMatch = chunk.match(/"id"\s*:\s*"([^"]+)"/);
    const summaryMatch = chunk.match(/"summary"\s*:\s*"([^"]{1,160})"/);
    const id = asText(idMatch?.[1]) || `entity-${slugify(name)}`;
    mergeNode(nodeMap, {
      id,
      name,
      summary: asText(summaryMatch?.[1]),
    });
  }

  const fallbackNamePattern = /"name"\s*:\s*"([^"]{1,80})"/g;
  for (const match of text.matchAll(fallbackNamePattern)) {
    const name = asText(match[1]);
    if (!name || name.includes('%')) {
      continue;
    }
    mergeNode(nodeMap, {
      id: `entity-${slugify(name)}`,
      name,
    });
  }

  return [...nodeMap.values()];
}

function extractRelationsFromStructured(value: unknown, nodeMap: Map<string, GraphNodeDatum>): GraphEdgeDatum[] {
  const edges: GraphEdgeDatum[] = [];
  const edgeKeys = new Set<string>();

  for (const item of asArray(value)) {
    const record = asRecord(item);
    const sourceName = asText(record.source_name) || asText(record.source);
    const targetName = asText(record.target_name) || asText(record.target);
    const relation = asText(record.relation_type) || 'part_of';
    if (!sourceName || !targetName) {
      continue;
    }

    const sourceId = asText(record.source_entity_id) || `entity-${slugify(sourceName)}`;
    const targetId = asText(record.target_entity_id) || `entity-${slugify(targetName)}`;
    mergeNode(nodeMap, { id: sourceId, name: sourceName });
    mergeNode(nodeMap, { id: targetId, name: targetName });
    const edgeId = `${sourceId}->${targetId}:${relation}`;
    if (edgeKeys.has(edgeId)) {
      continue;
    }
    edgeKeys.add(edgeId);
    edges.push({
      id: edgeId,
      source: sourceId,
      target: targetId,
      relation,
    });
  }

  return edges;
}

function extractRelationDraftsFromText(text: string, nodeMap: Map<string, GraphNodeDatum>): GraphEdgeDatum[] {
  const edges: GraphEdgeDatum[] = [];
  const edgeKeys = new Set<string>();
  const objectPattern = /\{[\s\S]{0,480}?"relation_type"\s*:\s*"([^"]{1,80})"[\s\S]{0,480}?\}/g;

  for (const match of text.matchAll(objectPattern)) {
    const chunk = match[0];
    const relation = asText(match[1]) || 'part_of';
    const sourceMatch = chunk.match(/"(?:source_name|source)"\s*:\s*"([^"]{1,80})"/);
    const targetMatch = chunk.match(/"(?:target_name|target)"\s*:\s*"([^"]{1,80})"/);
    const sourceName = asText(sourceMatch?.[1]);
    const targetName = asText(targetMatch?.[1]);
    if (!sourceName || !targetName) {
      continue;
    }

    const sourceId = `entity-${slugify(sourceName)}`;
    const targetId = `entity-${slugify(targetName)}`;
    mergeNode(nodeMap, { id: sourceId, name: sourceName });
    mergeNode(nodeMap, { id: targetId, name: targetName });
    const edgeId = `${sourceId}->${targetId}:${relation}`;
    if (edgeKeys.has(edgeId)) {
      continue;
    }
    edgeKeys.add(edgeId);
    edges.push({
      id: edgeId,
      source: sourceId,
      target: targetId,
      relation,
    });
  }

  return edges;
}

function buildObserveGraph(stageResults: WorkflowStageResult[]): GraphNodeDatum[] {
  const observeOutput = getStageOutput(stageResults, 'observe');
  const nodeMap = new Map<string, GraphNodeDatum>();
  const structuredEntities = extractEntitiesFromStructured(
    observeOutput.entities || asRecord(observeOutput.llm_raw).entities,
  );

  for (const node of structuredEntities) {
    mergeNode(nodeMap, node);
  }

  if (nodeMap.size === 0) {
    const rawTexts = collectStageRawTexts(observeOutput);
    for (const rawText of rawTexts) {
      const drafts = extractEntityDraftsFromText(rawText);
      for (const node of drafts) {
        mergeNode(nodeMap, node);
      }
    }
  }

  return [...nodeMap.values()];
}

function buildRelationsGraph(stageResults: WorkflowStageResult[]): {
  nodes: GraphNodeDatum[];
  edges: GraphEdgeDatum[];
} {
  const observeNodes = buildObserveGraph(stageResults);
  const nodeMap = new Map<string, GraphNodeDatum>();
  for (const node of observeNodes) {
    mergeNode(nodeMap, node);
  }

  const relationsOutput = getStageOutput(stageResults, 'relations');
  const structuredEdges = extractRelationsFromStructured(
    relationsOutput.relations || asRecord(relationsOutput.llm_raw).relations,
    nodeMap,
  );

  const edges = [...structuredEdges];
  if (edges.length === 0) {
    const rawTexts = collectStageRawTexts(relationsOutput);
    for (const rawText of rawTexts) {
      const drafts = extractRelationDraftsFromText(rawText, nodeMap);
      for (const edge of drafts) {
        if (!edges.some((item) => item.id === edge.id)) {
          edges.push(edge);
        }
      }
    }
  }

  return {
    nodes: [...nodeMap.values()],
    edges,
  };
}

function buildAblationHighlightState(stageResults: WorkflowStageResult[]): GraphHighlightState {
  const output = getStageOutput(stageResults, 'ablation_judge');
  const candidates = asArray(output.ablation_candidates).map((item) => asRecord(item));
  const completedJudges = new Set(
    asArray(output.ablation_judges)
      .map((item) => asText(asRecord(item).entity_id))
      .filter(Boolean),
  );
  const judgeResults = asArray(asRecord(output.llm_ensemble).judge_results).map((item) => asRecord(item));

  const inFlightIds = judgeResults
    .map((item) => asText(item.entity_id))
    .filter((id) => id && !completedJudges.has(id));

  const activeCandidateIds = inFlightIds.length > 0
    ? inFlightIds
    : candidates
      .map((item) => asText(item.entity_id))
      .filter((id) => id && !completedJudges.has(id))
      .slice(0, 1);

  if (activeCandidateIds.length === 0) {
    return DEFAULT_HIGHLIGHT_STATE;
  }

  const activeSystemNodeIds = new Set<string>();
  const removedNodeIds = new Set<string>();
  const focusNodeIds = new Set<string>();
  const parentNodeIds = new Set<string>();
  const activeLabels: string[] = [];

  for (const activeId of activeCandidateIds) {
    const candidate = candidates.find((item) => asText(item.entity_id) === activeId);
    if (!candidate) {
      continue;
    }

    const entityName = asText(candidate.entity_name) || activeId;
    activeLabels.push(entityName);
    focusNodeIds.add(activeId);

    const parentId = asText(candidate.parent_entity_id);
    if (parentId) {
      parentNodeIds.add(parentId);
      activeSystemNodeIds.add(parentId);
    }

    for (const systemId of asArray(candidate.system_entity_ids).map((item) => asText(item)).filter(Boolean)) {
      activeSystemNodeIds.add(systemId);
    }

    for (const removedId of asArray(candidate.removed_subtree_entity_ids).map((item) => asText(item)).filter(Boolean)) {
      removedNodeIds.add(removedId);
      activeSystemNodeIds.add(removedId);
    }
  }

  return {
    activeSystemNodeIds,
    removedNodeIds,
    focusNodeIds,
    parentNodeIds,
    activeLabels,
  };
}

function buildGraphData(stageKey: WorkflowLiveGraphStageKey, stageResults: WorkflowStageResult[]) {
  if (stageKey === 'observe') {
    return {
      nodes: buildObserveGraph(stageResults),
      edges: [] as GraphEdgeDatum[],
      highlight: DEFAULT_HIGHLIGHT_STATE,
    };
  }

  const relationsGraph = buildRelationsGraph(stageResults);
  if (stageKey === 'relations') {
    return {
      ...relationsGraph,
      highlight: DEFAULT_HIGHLIGHT_STATE,
    };
  }

  return {
    ...relationsGraph,
    highlight: buildAblationHighlightState(stageResults),
  };
}

function buildGraphLayout(
  nodes: GraphNodeDatum[],
  edges: GraphEdgeDatum[],
  width: number,
  height: number,
): PositionedNode[] {
  if (nodes.length === 0) {
    return [];
  }

  const safeWidth = Math.max(420, width);
  const safeHeight = Math.max(320, height);
  const radius = Math.min(28, Math.max(20, 32 - nodes.length * 0.35));

  if (edges.length === 0) {
    const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.length)));
    const rows = Math.max(1, Math.ceil(nodes.length / columns));
    const horizontalGap = safeWidth / (columns + 1);
    const verticalGap = safeHeight / (rows + 1);
    return nodes.map((node, index) => ({
      ...node,
      x: horizontalGap * ((index % columns) + 1),
      y: verticalGap * (Math.floor(index / columns) + 1),
      radius,
    }));
  }

  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const nodeIds = new Set(nodes.map((item) => item.id));

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    outgoing.get(edge.source)?.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
  }

  const roots = nodes
    .filter((node) => (incomingCount.get(node.id) || 0) === 0)
    .map((node) => node.id);

  const queue = roots.length > 0 ? [...roots] : [nodes[0].id];
  const levels = new Map<string, number>();
  for (const rootId of queue) {
    levels.set(rootId, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift() || '';
    const currentLevel = levels.get(current) || 0;
    for (const nextId of outgoing.get(current) || []) {
      const nextLevel = currentLevel + 1;
      if (!levels.has(nextId) || nextLevel > (levels.get(nextId) || 0)) {
        levels.set(nextId, nextLevel);
        queue.push(nextId);
      }
    }
  }

  let fallbackLevel = Math.max(...levels.values(), 0);
  for (const node of nodes) {
    if (!levels.has(node.id)) {
      fallbackLevel += 1;
      levels.set(node.id, fallbackLevel);
    }
  }

  const grouped = new Map<number, GraphNodeDatum[]>();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    const list = grouped.get(level) || [];
    list.push(node);
    grouped.set(level, list);
  }

  const sortedLevels = [...grouped.keys()].sort((left, right) => left - right);
  const verticalGap = safeHeight / (sortedLevels.length + 1);

  return sortedLevels.flatMap((level, levelIndex) => {
    const levelNodes = grouped.get(level) || [];
    const horizontalGap = safeWidth / (levelNodes.length + 1);
    return levelNodes.map((node, nodeIndex) => ({
      ...node,
      x: horizontalGap * (nodeIndex + 1),
      y: verticalGap * (levelIndex + 1),
      radius,
    }));
  });
}

function trimLineEndpoint(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  padding: number,
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const ratio = padding / distance;
  return {
    x: toX - dx * ratio,
    y: toY - dy * ratio,
  };
}

export function WorkflowLiveGraph({
  stageKey,
  stageResults,
  stageStatus,
}: WorkflowLiveGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 760, height: 420 });

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const updateDimensions = () => {
      if (!containerRef.current) {
        return;
      }

      setDimensions({
        width: containerRef.current.clientWidth || 760,
        height: 420,
      });
    };

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);
    updateDimensions();

    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(
    () => buildGraphData(stageKey, stageResults),
    [stageKey, stageResults],
  );
  const positionedNodes = useMemo(
    () => buildGraphLayout(graphData.nodes, graphData.edges, dimensions.width, dimensions.height),
    [dimensions.height, dimensions.width, graphData.edges, graphData.nodes],
  );
  const nodeMap = useMemo(
    () => new Map(positionedNodes.map((node) => [node.id, node] as const)),
    [positionedNodes],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="rounded-full bg-background/80">
          节点 {positionedNodes.length}
        </Badge>
        <Badge variant="outline" className="rounded-full bg-background/80">
          边 {graphData.edges.length}
        </Badge>
        {stageKey === 'ablation_judge' && graphData.highlight.activeLabels.length > 0 ? (
          <Badge className="rounded-full border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            正在消融：{graphData.highlight.activeLabels.join('、')}
          </Badge>
        ) : null}
        {stageStatus === 'running' ? (
          <Badge className="rounded-full border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300">
            流式增量更新
          </Badge>
        ) : null}
      </div>

      <div ref={containerRef} className="overflow-hidden rounded-2xl border border-border/40 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_38%),linear-gradient(180deg,rgba(15,23,42,0.06),rgba(15,23,42,0.02))]">
        {positionedNodes.length === 0 ? (
          <div className="flex h-[420px] items-center justify-center px-6 text-sm text-muted-foreground">
            {stageStatus === 'running' ? '等待流式 JSON 中的节点被解析出来...' : '当前阶段还没有可绘制的图谱结构。'}
          </div>
        ) : (
          <svg viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} className="h-[420px] w-full">
            <defs>
              <marker
                id={`workflow-arrow-${stageKey}`}
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="5"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
              </marker>
            </defs>

            {graphData.highlight.activeSystemNodeIds.size > 0 ? (
              <rect
                x="16"
                y="16"
                width={dimensions.width - 32}
                height={dimensions.height - 32}
                rx="24"
                fill="rgba(59,130,246,0.05)"
                stroke="rgba(59,130,246,0.14)"
                strokeDasharray="10 6"
              />
            ) : null}

            {graphData.edges.map((edge) => {
              const sourceNode = nodeMap.get(edge.source);
              const targetNode = nodeMap.get(edge.target);
              if (!sourceNode || !targetNode) {
                return null;
              }

              const start = trimLineEndpoint(targetNode.x, targetNode.y, sourceNode.x, sourceNode.y, sourceNode.radius + 4);
              const end = trimLineEndpoint(sourceNode.x, sourceNode.y, targetNode.x, targetNode.y, targetNode.radius + 10);
              const isHighlighted = (
                graphData.highlight.activeSystemNodeIds.has(edge.source)
                && graphData.highlight.activeSystemNodeIds.has(edge.target)
              );

              return (
                <g key={edge.id}>
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={isHighlighted ? '#2563eb' : '#94a3b8'}
                    strokeWidth={isHighlighted ? 2.6 : 1.6}
                    strokeOpacity={isHighlighted ? 0.95 : 0.65}
                    markerEnd={`url(#workflow-arrow-${stageKey})`}
                  />
                  <text
                    x={(start.x + end.x) / 2}
                    y={(start.y + end.y) / 2 - 6}
                    textAnchor="middle"
                    className="fill-slate-500 text-[10px] font-semibold"
                  >
                    {edge.relation}
                  </text>
                </g>
              );
            })}

            {positionedNodes.map((node) => {
              const isRemoved = graphData.highlight.removedNodeIds.has(node.id);
              const isFocus = graphData.highlight.focusNodeIds.has(node.id);
              const isParent = graphData.highlight.parentNodeIds.has(node.id);
              const isSystem = graphData.highlight.activeSystemNodeIds.has(node.id);
              const fill = isRemoved
                ? '#f97316'
                : isFocus
                  ? '#dc2626'
                  : isParent
                    ? '#16a34a'
                    : isSystem
                      ? '#2563eb'
                      : '#0f172a';
              const stroke = isRemoved
                ? '#fdba74'
                : isFocus
                  ? '#fca5a5'
                  : isParent
                    ? '#86efac'
                    : isSystem
                      ? '#93c5fd'
                      : '#cbd5e1';

              return (
                <g key={node.id}>
                  {isSystem ? (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius + 8}
                      fill={isRemoved ? 'rgba(249,115,22,0.16)' : 'rgba(37,99,235,0.12)'}
                    />
                  ) : null}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isFocus || isParent || isRemoved ? 3 : 1.6}
                    className={cn(isFocus && stageStatus === 'running' && 'animate-pulse')}
                  />
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    className="fill-white text-[11px] font-bold"
                  >
                    {node.name.slice(0, 8)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {stageKey === 'ablation_judge' ? (
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/70 px-2 py-1">
            <span className="h-2 w-2 rounded-full bg-red-600" />
            当前被消融节点
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/70 px-2 py-1">
            <span className="h-2 w-2 rounded-full bg-green-600" />
            父节点
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/70 px-2 py-1">
            <span className="h-2 w-2 rounded-full bg-blue-600" />
            当前父子系统
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/70 px-2 py-1">
            <span className="h-2 w-2 rounded-full bg-orange-500" />
            被移除子树
          </span>
        </div>
      ) : null}
    </div>
  );
}
