import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2, Network } from 'lucide-react';
import type { Entity, CrossReference, KnowledgeLayer } from '@/types/ontology';

interface KnowledgeGraphProps {
  entities: Entity[];
  crossReferences: CrossReference[];
  onSelectEntity: (entity: Entity) => void;
  selectedEntityId?: string;
}

interface Node {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  entity: Entity;
}

interface Link {
  source: string;
  target: string;
  relation: string;
}

export function KnowledgeGraph({
  entities,
  crossReferences,
  onSelectEntity,
  selectedEntityId
}: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || 600
        });
      }
    };

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);
    updateDimensions();

    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const initialOrbitRadius = 80;
  const repulsionStrength = 9000;
  const targetLinkDistance = 280; // Spread more
  const springStrength = 0.005;
  const centerPullStrength = 0.006;
  const velocityDamping = 0.5;
  const palette = ['#2563eb', '#7c3aed', '#059669', '#ea580c', '#db2777', '#0f766e', '#4f46e5', '#ca8a04'];
  const uniqueDomains = [...new Set(entities.map((entity) => entity.domain).filter(Boolean))];
  const domainColors = uniqueDomains.reduce<Record<string, string>>((accumulator, domain, index) => {
    accumulator[domain] = palette[index % palette.length];
    return accumulator;
  }, {});
  const layerStrokeColors: Record<KnowledgeLayer, string> = {
    common: '#99AF91', // 草木灰绿
    domain: '#4F83C3', // 工业深蓝 (明显蓝色)
    private: '#C19292', // 干枯玫瑰红
  };
  const layerLabels: Record<KnowledgeLayer, string> = {
    common: 'Common',
    domain: 'Domain',
    private: 'Private',
  };
  const isVisibleEntity = (entity: Entity) => entity.visible !== false;

  // 初始化节点和链接
  useEffect(() => {
    if (entities.length === 0) {
      setNodes([]);
      setLinks([]);
      return;
    }

    // 创建节点
    const visibleEntities = entities.filter(isVisibleEntity);
    if (visibleEntities.length === 0) {
      setNodes([]);
      setLinks([]);
      return;
    }
    const initialNodes: Node[] = visibleEntities.map((entity, index) => {
      const angle = (index / visibleEntities.length) * 2 * Math.PI;
      const displayLevel = entity.display_level ?? 2;
      return {
        id: entity.id,
        name: entity.name,
        x: width / 2 + Math.cos(angle) * initialOrbitRadius,
        y: height / 2 + Math.sin(angle) * initialOrbitRadius,
        vx: 0,
        vy: 0,
        radius: displayLevel <= 1 ? 23 : displayLevel >= 3 ? 17 : 20,
        color: domainColors[entity.domain] || '#6b7280',
        entity: entity
      };
    });

    // 创建链接 (增加合并去重逻辑，防止相同两点间的关系文字叠加)
    // 使用排序后的 ID 作为 key，确保 A->B 和 B->A 被归为同一条物理边，从根本上解决中点文字重叠
    const mergedLinksMap = new Map<string, Link>();

    crossReferences.forEach(ref => {
      const ids = [ref.source, ref.target].sort();
      const key = ids.join('--');
      const existing = mergedLinksMap.get(key);

      if (existing) {
        if (!existing.relation.split(' | ').includes(ref.relation)) {
          existing.relation += ` | ${ref.relation}`;
        }
      } else {
        mergedLinksMap.set(key, {
          source: ref.source,
          target: ref.target,
          relation: ref.relation
        });
      }
    });

    setNodes(initialNodes);
    setLinks(Array.from(mergedLinksMap.values()));
  }, [entities, crossReferences, selectedEntityId]);

  // 力导向模拟
  useEffect(() => {
    if (nodes.length === 0) return;

    const simulation = setInterval(() => {
      setNodes(prevNodes => {
        const newNodes = [...prevNodes];

        // 节点间斥力
        for (let i = 0; i < newNodes.length; i++) {
          for (let j = i + 1; j < newNodes.length; j++) {
            const dx = newNodes[j].x - newNodes[i].x;
            const dy = newNodes[j].y - newNodes[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = repulsionStrength / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            newNodes[i].vx -= fx;
            newNodes[i].vy -= fy;
            newNodes[j].vx += fx;
            newNodes[j].vy += fy;
          }
        }

        // 链接引力
        links.forEach(link => {
          const sourceNode = newNodes.find(n => n.id === link.source);
          const targetNode = newNodes.find(n => n.id === link.target);
          if (sourceNode && targetNode) {
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
          }
        });

        // 中心引力 (平衡布局，偏向 45% 的高度处)
        newNodes.forEach(node => {
          const dx = width / 2 - node.x;
          const dy = (height * 0.45) - node.y;
          node.vx += dx * centerPullStrength;
          node.vy += dy * centerPullStrength;
        });

        // 更新位置
        let totalSpeed = 0;
        newNodes.forEach(node => {
          if (node.id !== draggedNode) {
            node.vx *= velocityDamping; // 阻尼
            node.vy *= velocityDamping;
            node.x += node.vx;
            node.y += node.vy;
            totalSpeed += Math.abs(node.vx) + Math.abs(node.vy);

            // 极简边界限制 (只有 5px 内边距)
            node.x = Math.max(node.radius + 5, Math.min(width - node.radius - 5, node.x));
            node.y = Math.max(node.radius + 5, Math.min(height - node.radius - 5, node.y));
          }
        });

        if (draggedNode === null && totalSpeed < 0.6) {
          clearInterval(simulation);
        }

        return newNodes;
      });
    }, 16);

    return () => clearInterval(simulation);
  }, [links, draggedNode]);

  const handleMouseDown = (nodeId: string) => {
    setIsDragging(true);
    setDraggedNode(nodeId);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging || !draggedNode || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - translate.x) / scale;
    const y = (e.clientY - rect.top - translate.y) / scale;

    setNodes(prevNodes =>
      prevNodes.map(node =>
        node.id === draggedNode
          ? { ...node, x, y, vx: 0, vy: 0 }
          : node
      )
    );
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDraggedNode(null);
  };

  const handleZoomIn = () => setScale(s => Math.min(s * 1.2, 3));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.2, 0.3));
  const handleReset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  return (
    <Card className="w-full h-full border-0 shadow-none bg-transparent flex flex-col relative overflow-hidden">
      {/* 绝对定位头部，省去占位空间 */}
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
            className="cursor-grab active:cursor-grabbing w-full h-full"
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: 'center'
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* 背景网格 */}
            <defs>
              <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" className="fill-border/40" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* 链接 */}
            {links.map((link, index) => {
              const sourceNode = nodes.find(n => n.id === link.source);
              const targetNode = nodes.find(n => n.id === link.target);
              if (!sourceNode || !targetNode) return null;
              if (!isVisibleEntity(sourceNode.entity) || !isVisibleEntity(targetNode.entity)) return null;
              const displayLevel = Math.max(sourceNode.entity.display_level ?? 2, targetNode.entity.display_level ?? 2);
              const muted = displayLevel >= 3;

              return (
                <g key={index}>
                  <line
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    className="stroke-muted-foreground/30"
                    strokeWidth={muted ? 0.8 : 1.5}
                    opacity={muted ? 0.35 : 1}
                  />
                  {/* 关系标签 */}
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

            {/* 节点 */}
            {nodes.map(node => (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onMouseDown={() => handleMouseDown(node.id)}
                onClick={() => onSelectEntity(node.entity)}
                className="cursor-pointer"
                opacity={node.entity.visible === false ? 0.2 : node.entity.display_level === 3 ? 0.55 : 1}
              >
                {/* 选中光环 */}
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
                      from={`0 0 0`}
                      to={`360 0 0`}
                      dur="10s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                {/* 节点圆圈 */}
                <circle
                  r={node.radius}
                  fill={node.color}
                  stroke={layerStrokeColors[node.entity.layer]}
                  strokeWidth={node.entity.layer === 'private' ? 4 : 2.5}
                  opacity={node.entity.display_level === 3 ? 0.7 : 1}
                  className="hover:opacity-80 transition-opacity"
                />
                {/* Removed default title tooltip */}
                {/* 节点标签 */}
                <text
                  textAnchor="middle"
                  dy={node.radius + 18}
                  className="text-xs fill-foreground font-bold"
                  style={{
                    fontSize: node.entity.display_level === 1 ? '14px' : '13px',
                    pointerEvents: 'none',
                    textShadow: '0 1px 2px hsl(var(--background))',
                    opacity: node.entity.display_level === 3 ? 0.7 : 1,
                  }}
                >
                  {node.name}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* 工业级专业图例 - 对称居中布局 */}
        <div className="px-6 pt-4 pb-3 border-t bg-muted/10 backdrop-blur-xl shrink-0 border-border/20">
          <div className="relative flex items-center justify-center h-8">
            {/* 左侧装饰线 */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex items-center justify-between px-10 pointer-events-none">
              <div className="h-px w-1/4 bg-gradient-to-r from-transparent via-border/40 to-transparent" />
              <div className="h-px w-1/4 bg-gradient-to-r from-transparent via-border/40 to-transparent" />
            </div>

            {/* 中心内容 */}
            <div className="z-10 bg-background/5 px-4 flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-[0.2em] leading-none">Knowledge Layers</span>
                <div className="w-1 h-3 bg-primary/30 rounded-full" />
                <span className="text-[10px] font-bold text-muted-foreground/80 leading-none">图层分级</span>
              </div>

              <div className="flex items-center gap-2">
                {Object.entries(layerLabels).map(([layer, label]) => (
                  <div key={layer} className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-background/20 border border-border/30 shadow-inner">
                    <div
                      className="w-1.5 h-1.5 rounded-full border border-white/40 ring-1 ring-black/20 shadow-[0_0_8px_rgba(0,0,0,0.3)]"
                      style={{ backgroundColor: layerStrokeColors[layer as KnowledgeLayer] }}
                    />
                    <span className="text-[10px] font-bold text-foreground/60">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
