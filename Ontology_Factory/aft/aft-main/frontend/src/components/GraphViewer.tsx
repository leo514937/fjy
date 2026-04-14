/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { exploreGraph, type GraphData, type GraphNode } from "../lib/api";
import { Share2, RefreshCw, AlertCircle } from "lucide-react";
import { Badge } from "./ui/badge";

const LINK_COLORS: Record<string, string> = {
  is_a: "#6366f1",
  subclass_of: "#8b5cf6",
  part_of: "#10b981",
  contains: "#0ea5e9",
  default: "rgba(148,163,184,0.4)",
};

const LINK_HIGHLIGHT = "#f59e0b";
const NODE_HIGHLIGHT = "#f59e0b";

// Map node degree (hierarchy level) to different distinct, beautiful colors
function getDegreeColor(degree: number): string {
    // Cohesive, distinct "neon/sunset" progression for dark background
    const palette = [
      "#52525b", // Level 0: Zinc (Slate/gray for isolated/unimportant)
      "#2dd4bf", // Level 1: Teal (Fringe/leaves, cool and distinct)
      "#3b82f6", // Level 2: Blue (Outer branches)
      "#8b5cf6", // Level 3: Violet (Mid-level nodes)
      "#ec4899", // Level 4: Pink (Sub-cores)
      "#f97316", // Level 5: Orange (Core nodes)
      "#facc15"  // Level 6: Yellow (Epicenter/highest degree)
    ];
    if (degree === 0) return palette[0];
    if (degree <= 2) return palette[1];
    if (degree <= 4) return palette[2];
    if (degree <= 7) return palette[3];
    if (degree <= 12) return palette[4];
    if (degree <= 20) return palette[5];
    return palette[6];
}

export function GraphViewer() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<string>>(new Set());
  const graphRef = useRef<any>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelectedNode(null);
    try {
      const data = await exploreGraph();
      setGraphData(data);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || "Failed to load graph.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // Adjust physics engine to space out nodes and make the graph more circular
  useEffect(() => {
    if (graphRef.current) {
      // Scatter nodes by massively increasing repulsion charge
      graphRef.current.d3Force('charge').strength(-500);
      // Lengthen links to reduce crowding
      graphRef.current.d3Force('link').distance(100);
      // Tighten center gravity to pull the entire scattered structure into a neat circle
      graphRef.current.d3Force('center') && graphRef.current.d3Force('center').strength(0.15);
    }
  }, [graphData, graphRef]);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node as GraphNode);
    // Highlight connected nodes and links
    const connected = new Set<string>();
    const connectedLinks = new Set<string>();
    connected.add(node.id);
    graphData.links.forEach((link: any) => {
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      if (src === node.id || tgt === node.id) {
        connected.add(src);
        connected.add(tgt);
        connectedLinks.add(`${src}-${tgt}`);
      }
    });
    setHighlightNodes(connected);
    setHighlightLinks(connectedLinks);
    // Zoom to node
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 600);
      graphRef.current.zoom(3, 600);
    }
  }, [graphData.links]);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
    setHighlightNodes(new Set());
    setHighlightLinks(new Set());
  }, []);

  const getLinkColor = useCallback((link: any) => {
    const src = typeof link.source === "object" ? link.source.id : link.source;
    const tgt = typeof link.target === "object" ? link.target.id : link.target;
    if (highlightLinks.has(`${src}-${tgt}`)) return LINK_HIGHLIGHT;

    const type = (link.type || "").toLowerCase();
    return LINK_COLORS[type] || LINK_COLORS.default;
  }, [highlightLinks]);

  const getLinkWidth = useCallback((link: any) => {
    const src = typeof link.source === "object" ? link.source.id : link.source;
    const tgt = typeof link.target === "object" ? link.target.id : link.target;
    const isHighlighted = highlightLinks.has(`${src}-${tgt}`);
    
    const type = (link.type || "").toLowerCase();
    const isHierarchy = type === "is_a" || type === "subclass_of";
    
    let width = isHierarchy ? 1.5 : 0.8;
    if (isHighlighted) width += 1;
    return width;
  }, [highlightLinks]);

  // Connected nodes for detail panel
  const connectedNodes = selectedNode
    ? graphData.links
        .filter((l: any) => {
          const src = typeof l.source === "object" ? l.source.id : l.source;
          const tgt = typeof l.target === "object" ? l.target.id : l.target;
          return src === selectedNode.id || tgt === selectedNode.id;
        })
        .map((l: any) => {
          const src = typeof l.source === "object" ? l.source.id : l.source;
          const tgt = typeof l.target === "object" ? l.target.id : l.target;
          return {
            neighbor: src === selectedNode.id ? tgt : src,
            direction: src === selectedNode.id ? "out" : "in",
            type: l.type,
          };
        })
    : [];

  return (
    <div className="relative w-full h-full overflow-hidden bg-black flex-1">
      {/* Immersive Graph Background */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {/* Deep Space Base */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/30 via-[#050510] to-black"></div>
        {/* Stars Layer 1 */}
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_center,_#ffffff_0.5px,_transparent_1px)] bg-[size:40px_40px]"></div>
        {/* Stars Layer 2 */}
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_#ffffff_1px,_transparent_1px)] bg-[size:100px_100px]" style={{ backgroundPosition: '50px 50px' }}></div>
        {/* Nebula Spin */}
        <div className="absolute -inset-[100%] bg-[conic-gradient(from_0deg_at_50%_50%,_rgba(99,102,241,0.1)_0deg,_transparent_60deg,_transparent_300deg,_rgba(99,102,241,0.1)_360deg)] animate-[spin_60s_linear_infinite] pointer-events-none mix-blend-screen"></div>

        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          linkColor={getLinkColor}
          linkWidth={getLinkWidth}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          linkDirectionalParticles={(link: any) => {
            const src = typeof link.source === "object" ? link.source.id : link.source;
            const tgt = typeof link.target === "object" ? link.target.id : link.target;
            return highlightLinks.has(`${src}-${tgt}`) ? 4 : 1;
          }}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleSpeed={0.005}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const isSelected = selectedNode?.id === node.id;
            const isHighlighted = highlightNodes.size === 0 || highlightNodes.has(node.id);
            
            // Dynamic Size based on degree (hierarchy)
            // min size 3, max size 10
            const degree = node.degree || 0;
            const baseRadius = 3 + Math.min(degree * 1.2, 8);
            const r = isSelected ? baseRadius * 1.4 : baseRadius;

            // Draw Node Circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
            const baseColor = getDegreeColor(degree);
            ctx.fillStyle = isHighlighted ? baseColor : `${baseColor}40`;
            ctx.fill();


            // Glow / Stroke if selected
            if (isSelected) {
               ctx.beginPath();
               ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI, false);
               ctx.strokeStyle = NODE_HIGHLIGHT;
               ctx.lineWidth = 2 / globalScale;
               ctx.stroke();

               // Outer glow
               ctx.shadowBlur = 15;
               ctx.shadowColor = baseColor;
            } else {
                ctx.shadowBlur = 0;
            }

            // Draw Node Text
            const label = node.name;
            const fontSize = Math.max(12 / globalScale, 3);
            ctx.font = `${isSelected ? '700' : '600'} ${fontSize}px 'Outfit', sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            
            ctx.fillStyle = isHighlighted ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)";
            ctx.fillText(label, node.x, node.y + r + (2 / globalScale));
            
            // Reset shadows
            ctx.shadowBlur = 0;
          }}
          cooldownTicks={100}
          width={window.innerWidth - 300}
          height={1000}
        />

        {/* Subtle grid and vignette */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.05] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:40px_40px] mix-blend-overlay"></div>
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_20%,rgba(0,0,0,0.8)_120%)]"></div>
      </div>

      {/* Floating Header Panel */}
      <div className="absolute top-6 left-6 z-20 flex flex-col gap-2">
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 p-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-left-4 duration-500">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary shadow-inner">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm tracking-tight">本体知识图谱浏览器</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge className="bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 text-[10px] border-none px-1.5 py-0 h-5">
                {graphData.nodes.length} 实体
              </Badge>
              <div className="w-1 h-1 rounded-full bg-zinc-700"></div>
              <Badge className="bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 text-[10px] border-none px-1.5 py-0 h-5">
                {graphData.links.length} 关系
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Refresh Control */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={loadGraph}
          disabled={loading}
          className="group bg-black/40 backdrop-blur-xl border border-white/10 p-3 rounded-xl text-white hover:bg-primary transition-all duration-300 shadow-2xl disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} />
        </button>
      </div>

      {/* Floating Legend Panel Removed */}

      {/* Node Details Overlay */}
      {selectedNode && (
        <div className="absolute top-6 bottom-6 right-6 z-30 w-72 flex flex-col">
          <div className="flex-1 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right-8 duration-500">
            <div className="p-6 border-b border-white/5 space-y-4">
              <div className="flex justify-between items-start">
                <Badge className="bg-primary/20 text-primary border-none rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
                  {{
                    entity: "实体",
                    concept: "概念",
                    category: "类别",
                    attribute: "属性",
                    constraint: "约束"
                  }[selectedNode.type] || selectedNode.type}
                </Badge>
                <button onClick={handleBackgroundClick} className="text-zinc-500 hover:text-white transition-colors">
                  <AlertCircle className="w-4 h-4 rotate-45" />
                </button>
              </div>
              <div>
                <h4 className="text-xl font-bold text-white mb-1 leading-tight">{selectedNode.name}</h4>
                <p className="text-xs text-zinc-400 font-mono italic">#{selectedNode.id}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {connectedNodes.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">图谱关系 ({connectedNodes.length})</p>
                  <div className="space-y-2">
                    {connectedNodes.map((c, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5 group">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${c.direction === "out" ? "bg-indigo-500/20 text-indigo-400" : "bg-purple-500/20 text-purple-400"}`}>
                          {c.direction === "out" ? "→" : "←"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-zinc-300 truncate font-medium">{c.neighbor}</p>
                          <p className="text-[9px] text-zinc-500 uppercase tracking-tighter">{c.type}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedNode.props && Object.keys(selectedNode.props).length > 0 && (
                <div className="space-y-3">
                   <p className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">属性详情</p>
                   <div className="grid gap-2">
                     {Object.entries(selectedNode.props).map(([k, v]) => (
                       <div key={k} className="p-2.5 rounded-xl bg-zinc-800/30 border border-white/5">
                         <p className="text-[9px] text-zinc-500 uppercase mb-0.5 tracking-wider">{k}</p>
                         <p className="text-[11px] text-zinc-200 font-mono break-all">{String(v)}</p>
                       </div>
                     ))}
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* States: Loading / Empty / Error */}
      {loading && !graphData.nodes.length && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-40 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <p className="text-zinc-400 text-sm font-medium tracking-wide">正在同步本体数据...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4">
           <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-6 py-3 rounded-2xl flex items-center gap-3 backdrop-blur-xl shadow-2xl">
             <AlertCircle className="w-5 h-5" />
             <span className="text-sm font-semibold">{error}</span>
           </div>
        </div>
      )}
    </div>
  );
}
