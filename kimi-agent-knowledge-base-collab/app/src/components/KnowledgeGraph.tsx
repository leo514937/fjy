import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2, Network } from 'lucide-react';
import type { Entity, CrossReference, KnowledgeLayer } from '@/types/ontology';
import {
  buildKnowledgeGraphDomainColors,
  createKnowledgeGraphNodeIndex,
  createKnowledgeGraphNodes,
  mergeKnowledgeGraphLinks,
  type KnowledgeGraphLayoutCache,
  type KnowledgeGraphLink,
  type KnowledgeGraphNode,
} from './knowledgeGraphLayout';
import {
  buildKnowledgeGraphSpatialIndex,
  forEachKnowledgeGraphNeighborPair,
  getKnowledgeGraphRepulsionStrategy,
} from './knowledgeGraphSpatialIndex';

interface KnowledgeGraphProps {
  entities: Entity[];
  crossReferences: CrossReference[];
  onSelectEntity: (entity: Entity) => void;
  selectedEntityId?: string;
  isActive?: boolean;
}

export function KnowledgeGraph({
  entities,
  crossReferences,
  onSelectEntity,
  selectedEntityId,
  isActive = true,
}: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const layoutCacheRef = useRef<KnowledgeGraphLayoutCache>({});
  const animationFrameRef = useRef<number | null>(null);
  const nodesRef = useRef<KnowledgeGraphNode[]>([]);
  const nodeIndexRef = useRef<Map<string, KnowledgeGraphNode>>(new Map());
  const [nodes, setNodes] = useState<KnowledgeGraphNode[]>([]);
  const [links, setLinks] = useState<KnowledgeGraphLink[]>([]);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    translateX: number;
    translateY: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || 600,
        });
      }
    };

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);
    updateDimensions();

    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const domainColors = useMemo(() => buildKnowledgeGraphDomainColors(entities), [entities]);
  const layerStrokeColors: Record<KnowledgeLayer, string> = {
    common: '#99AF91',
    domain: '#4F83C3',
    private: '#C19292',
  };
  const isVisibleEntity = (entity: Entity) => entity.visible !== false;
  const snapshotGraphLayout = (nextNodes: KnowledgeGraphNode[]) => {
    const nextLayoutCache: KnowledgeGraphLayoutCache = {};
    for (const node of nextNodes) {
      nextLayoutCache[node.id] = {
        x: node.x,
        y: node.y,
        vx: node.vx,
        vy: node.vy,
        radius: node.radius,
        color: node.color,
      };
    }

    layoutCacheRef.current = nextLayoutCache;
  };
  const syncGraphSnapshot = (nextNodes: KnowledgeGraphNode[]) => {
    nodesRef.current = nextNodes;
    nodeIndexRef.current = createKnowledgeGraphNodeIndex(nextNodes);
    snapshotGraphLayout(nextNodes);
  };

  useEffect(() => {
    const nextNodes = createKnowledgeGraphNodes(entities, dimensions, {
      layoutCache: layoutCacheRef.current,
      domainColors,
    });
    syncGraphSnapshot(nextNodes);
    setNodes(nextNodes);
    setLinks(mergeKnowledgeGraphLinks(crossReferences));
  }, [crossReferences, dimensions, domainColors, entities]);

  useEffect(() => {
    if (!isActive || nodes.length === 0) {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const step = () => {
      if (cancelled) {
        return;
      }

      const currentNodes = nodesRef.current;
      if (currentNodes.length === 0 || !isActive) {
        animationFrameRef.current = null;
        return;
      }

      const nextNodes = [...currentNodes];
      const nextNodeIndex = nodeIndexRef.current;
      let totalSpeed = 0;
      const repulsionStrength = 9000;
      const targetLinkDistance = 280;
      const springStrength = 0.005;
      const centerPullStrength = 0.006;
      const velocityDamping = 0.5;
      const repulsionStrategy = getKnowledgeGraphRepulsionStrategy(nextNodes.length);
      const applyRepulsion = (sourceNode: KnowledgeGraphNode, targetNode: KnowledgeGraphNode) => {
        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsionStrength / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        sourceNode.vx -= fx;
        sourceNode.vy -= fy;
        targetNode.vx += fx;
        targetNode.vy += fy;
      };

      if (repulsionStrategy.mode === 'exact') {
        for (let i = 0; i < nextNodes.length; i += 1) {
          for (let j = i + 1; j < nextNodes.length; j += 1) {
            applyRepulsion(nextNodes[i], nextNodes[j]);
          }
        }
      } else {
        const spatialIndex = buildKnowledgeGraphSpatialIndex(nextNodes, repulsionStrategy.cellSize);
        forEachKnowledgeGraphNeighborPair(
          nextNodes,
          spatialIndex,
          repulsionStrategy.neighborSpan,
          (sourceNode, targetNode) => {
            applyRepulsion(sourceNode, targetNode);
          },
        );
      }

      links.forEach((link) => {
        const sourceNode = nextNodeIndex.get(link.source);
        const targetNode = nextNodeIndex.get(link.target);
        if (!sourceNode || !targetNode) {
          return;
        }

        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - targetLinkDistance) * springStrength;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        sourceNode.vx += fx;
        sourceNode.vy += fy;
        targetNode.vx -= fx;
        targetNode.vy -= fy;
      });

      nextNodes.forEach((node) => {
        const dx = width / 2 - node.x;
        const dy = (height * 0.45) - node.y;
        node.vx += dx * centerPullStrength;
        node.vy += dy * centerPullStrength;
      });

      nextNodes.forEach((node) => {
        if (node.id !== draggedNode) {
          node.vx *= velocityDamping;
          node.vy *= velocityDamping;
          node.x += node.vx;
          node.y += node.vy;
          totalSpeed += Math.abs(node.vx) + Math.abs(node.vy);
        }
      });

      nodesRef.current = nextNodes;
      if (draggedNode === null && totalSpeed < 0.6) {
        snapshotGraphLayout(nextNodes);
      }
      setNodes(nextNodes);

      if (cancelled) {
        return;
      }

      if (draggedNode === null && totalSpeed < 0.6) {
        animationFrameRef.current = null;
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(step);
    };

    animationFrameRef.current = window.requestAnimationFrame(step);

    return () => {
      cancelled = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [draggedNode, height, isActive, links, width]);

  const handleNodeMouseDown = (nodeId: string) => {
    setIsDragging(true);
    setIsPanning(false);
    setDraggedNode(nodeId);
  };

  const handlePanMouseDown = (e: MouseEvent<SVGRectElement>) => {
    if (e.button !== 0) {
      return;
    }

    if (e.target !== e.currentTarget) {
      return;
    }

    setIsPanning(true);
    setIsDragging(false);
    setDraggedNode(null);
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      translateX: translate.x,
      translateY: translate.y,
    };
  };

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;

    if (isPanning && panStartRef.current) {
      const deltaX = e.clientX - panStartRef.current.clientX;
      const deltaY = e.clientY - panStartRef.current.clientY;
      setTranslate({
        x: panStartRef.current.translateX + deltaX,
        y: panStartRef.current.translateY + deltaY,
      });
      return;
    }

    if (!isDragging || !draggedNode) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - translate.x) / scale;
    const y = (e.clientY - rect.top - translate.y) / scale;

    setNodes((prevNodes) => {
      const nextNodes = [...prevNodes];
      let targetNode: KnowledgeGraphNode | undefined;
      for (const node of nextNodes) {
        if (node.id === draggedNode) {
          targetNode = node;
          break;
        }
      }
      if (targetNode) {
        targetNode.x = x;
        targetNode.y = y;
        targetNode.vx = 0;
        targetNode.vy = 0;
        layoutCacheRef.current[targetNode.id] = {
          x: targetNode.x,
          y: targetNode.y,
          vx: targetNode.vx,
          vy: targetNode.vy,
          radius: targetNode.radius,
          color: targetNode.color,
        };
      }
      nodesRef.current = nextNodes;
      return nextNodes;
    });
  };

  const handleMouseUp = () => {
    snapshotGraphLayout(nodesRef.current);
    setIsDragging(false);
    setIsPanning(false);
    setDraggedNode(null);
    panStartRef.current = null;
  };

  const handleZoom = (factor: number) => {
    setScale((currentScale) => {
      const nextScale = Math.min(Math.max(currentScale * factor, 0.3), 3);
      const centerX = width / 2;
      const centerY = height / 2;
      setTranslate((currentTranslate) => ({
        x: centerX - (nextScale / currentScale) * (centerX - currentTranslate.x),
        y: centerY - (nextScale / currentScale) * (centerY - currentTranslate.y),
      }));
      return nextScale;
    });
  };
  const handleZoomIn = () => handleZoom(1.2);
  const handleZoomOut = () => handleZoom(1 / 1.2);
  const handleReset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  return (
    <Card className="w-full h-full border-0 shadow-none bg-transparent flex flex-col relative overflow-hidden">
      <div className="absolute top-2 left-6 right-6 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 bg-background/40 backdrop-blur-md px-3 py-1 rounded-full border border-border/40 shadow-sm pointer-events-auto">
          <Network className="w-3.5 h-3.5 text-primary" />
          <CardTitle className="text-xs font-bold tracking-tight">本体图谱</CardTitle>
        </div>
        <div className="flex items-center gap-1 bg-background/40 backdrop-blur-md px-1.5 py-0.5 rounded-full border border-border/40 shadow-sm pointer-events-auto">
          <Button variant="ghost" size="icon" className="w-6 h-6 rounded-md hover:bg-primary/20" onClick={handleZoomOut}>
            <ZoomOut className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="w-6 h-6 rounded-md hover:bg-primary/20" onClick={handleReset}>
            <Maximize2 className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="w-6 h-6 rounded-md hover:bg-primary/20" onClick={handleZoomIn}>
            <ZoomIn className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div ref={containerRef} className="relative flex-1 w-full overflow-hidden bg-background/50">
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className={`w-full h-full ${isDragging || isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <defs>
              <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" className="fill-border/40" />
              </pattern>
            </defs>
            <g transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}>
              <rect
                x={-width * 2}
                y={-height * 2}
                width={width * 5}
                height={height * 5}
                fill="url(#grid)"
                onMouseDown={handlePanMouseDown}
              />

              {links.map((link) => {
                const sourceNode = nodeIndexRef.current.get(link.source);
                const targetNode = nodeIndexRef.current.get(link.target);
                if (!sourceNode || !targetNode) return null;
                if (!isVisibleEntity(sourceNode.entity) || !isVisibleEntity(targetNode.entity)) return null;
                const displayLevel = Math.max(sourceNode.entity.display_level ?? 2, targetNode.entity.display_level ?? 2);
                const muted = displayLevel >= 3;

                return (
                  <g key={`${link.source}--${link.target}`} pointerEvents="none">
                    <line
                      x1={sourceNode.x}
                      y1={sourceNode.y}
                      x2={targetNode.x}
                      y2={targetNode.y}
                      className="stroke-muted-foreground/30"
                      strokeWidth={muted ? 0.8 : 1.5}
                      opacity={muted ? 0.35 : 1}
                    />
                    <text
                      x={(sourceNode.x + targetNode.x) / 2}
                      y={(sourceNode.y + targetNode.y) / 2}
                      textAnchor="middle"
                      className="text-[10px] fill-muted-foreground font-medium"
                      style={{ textShadow: '0 0 4px hsl(var(--background))', opacity: muted ? 0.45 : 1 }}
                    >
                      {link.relation}
                    </text>
                  </g>
                );
              })}

              {nodes.map((node) => (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    handleNodeMouseDown(node.id);
                  }}
                  onClick={() => onSelectEntity(node.entity)}
                  className="cursor-pointer"
                  opacity={node.entity.visible === false ? 0.2 : node.entity.display_level === 3 ? 0.55 : 1}
                >
                  {node.id === selectedEntityId && (
                    <circle
                      r={node.radius + 6}
                      fill="none"
                      stroke="currentColor"
                      className={node.entity.highlight ? 'text-cyan-500' : 'text-primary'}
                      strokeWidth={node.entity.highlight ? 3 : 2.5}
                      strokeDasharray="4,4"
                    >
                      <animateTransform
                        attributeName="transform"
                        attributeType="XML"
                        type="rotate"
                        from="0 0 0"
                        to="360 0 0"
                        dur="10s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                  <circle
                    r={node.radius}
                    fill={node.color}
                    stroke={layerStrokeColors[node.entity.layer]}
                    strokeWidth={node.entity.layer === 'private' ? 4 : 2.5}
                    opacity={node.entity.display_level === 3 ? 0.7 : 1}
                    className="hover:opacity-80 transition-opacity"
                  />
                  <text
                    textAnchor="middle"
                    dy={node.radius + 18}
                    className="text-xs fill-foreground font-bold"
                    style={{
                      fontSize: node.entity.display_level === 1 ? '14px' : '13px',
                      pointerEvents: 'none',
                      textShadow: '0 1px 2px hsl(var(--background))',
                    }}
                  >
                    {node.name}
                  </text>
                </g>
              ))}
            </g>
          </svg>
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-border/40 bg-background/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shadow-sm backdrop-blur-md">
            拖动画布可平移视野
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
