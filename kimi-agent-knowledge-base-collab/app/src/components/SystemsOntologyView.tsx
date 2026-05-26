import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRightLeft, Boxes, Circle, Database, Globe, Layers, RefreshCw, Search, Square, Target, Triangle, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { fetchSystemAnalysis, type SystemAnalysisData } from '@/features/ontology/api';
import { buildSystemRelationshipMap } from '@/components/systemRelationshipMap';
import type { CrossReference, Entity, KnowledgeLayer } from '@/types/ontology';

interface SystemsOntologyViewProps {
  entities: Entity[];
  crossReferences: CrossReference[];
  selectedEntity?: Entity | null;
  onSelectEntity?: (entity: Entity) => void;
}

const layerLabels: Record<KnowledgeLayer, string> = {
  common: 'Common',
  domain: 'Domain',
  private: 'Private',
};

export function SystemsOntologyView({ entities, crossReferences, selectedEntity, onSelectEntity }: SystemsOntologyViewProps) {
  const [analysis, setAnalysis] = useState<SystemAnalysisData | null>(null);
  const [input, setInput] = useState('');
  const [analyzedEntity, setAnalyzedEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exampleEntities = useMemo(() => {
    if (selectedEntity) {
      return [
        selectedEntity,
        ...entities
          .filter((entity) => entity.id !== selectedEntity.id)
          .sort((left, right) => {
            const leftScore = Number(left.domain === selectedEntity.domain);
            const rightScore = Number(right.domain === selectedEntity.domain);
            return rightScore - leftScore;
          })
          .slice(0, 5),
      ];
    }

    return entities.slice(0, 6);
  }, [entities, selectedEntity]);

  const relationshipMap = useMemo(() => (
    buildSystemRelationshipMap(selectedEntity ?? null, entities, crossReferences)
  ), [crossReferences, entities, selectedEntity]);

  const hierarchySupersystems = useMemo(() => {
    const names = new Set<string>(analysis?.hierarchy.supersystems ?? []);
    for (const name of relationshipMap?.supersystems ?? []) {
      names.add(name);
    }
    return [...names];
  }, [analysis?.hierarchy.supersystems, relationshipMap?.supersystems]);

  const resolveEntity = (query: string): Entity | null => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    return (
      entities.find((entity) => entity.name.trim().toLowerCase() === normalized)
      || entities.find((entity) => entity.name.includes(query.trim()))
      || null
    );
  };

  const handleAnalyze = async (value?: string, preferredEntity?: Entity | null) => {
    const query = (value ?? input).trim();
    if (!query) {
      return;
    }

    const matchedEntity = preferredEntity || resolveEntity(query);

    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemAnalysis(query, matchedEntity?.id);
      setInput(query);
      setAnalysis(result);
      setAnalyzedEntity(matchedEntity);
      if (matchedEntity && matchedEntity.id !== selectedEntity?.id) {
        onSelectEntity?.(matchedEntity);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '系统分析加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedEntity) {
      return;
    }

    setInput(selectedEntity.name);
    void handleAnalyze(selectedEntity.name, selectedEntity);
  }, [selectedEntity?.id]);

  const currentAnalysis: SystemAnalysisData = analysis ?? {
    entity: selectedEntity?.name || input.trim() || '未选择系统节点',
    holistic_properties: selectedEntity
      ? [`正在等待系统分析接口返回，当前先展示 ${selectedEntity.name} 的结构关系。`]
      : ['请先选择一个系统节点，结构视图才会建立明确的根系统。'],
    boundary: {
      physical: selectedEntity?.definition || '接口尚未返回物理边界描述。',
      functional: selectedEntity ? `将 ${selectedEntity.name} 视作 ${selectedEntity.type} 来组织结构。` : '请先选择系统节点。',
      cognitive: '结构视图已可用，深层系统分析仍在加载中。',
      dynamic: '当补充更多关系后，系统边界和层次会自动扩展。',
    },
    environment: {
      description: selectedEntity
        ? `${selectedEntity.name} 的结构视图已从当前实体、属性和关系中推导。`
        : '暂无已选系统环境。',
      inputs: relationshipMap?.root.children.map((item) => item.name).slice(0, 4) ?? [],
      outputs: relationshipMap?.dependencyClusters.flatMap((cluster) => cluster.edges.map((edge) => edge.relation)).slice(0, 4) ?? [],
    },
    feedback: {
      negative: ['当前接口未返回完整反馈回路，先保留结构视图。'],
      positive: ['结构和依赖关系已可直接用于观察系统组成。'],
    },
    hierarchy: {
      subsystems: relationshipMap?.root.children.map((item) => item.name) ?? [],
      supersystems: relationshipMap?.supersystems ?? [],
    },
    emergence_examples: ['随着包含和依赖关系增多，系统结构图会变得更完整。'],
    systems_questions: [
      {
        question: '当前结构图是怎么推导出来的？',
        analysis: '优先读取显式包含/依赖关系，再回退到实体 properties 中的 components、subsystems、hierarchy 等字段。',
      },
    ],
  };

  const renderStructureNode = (node: NonNullable<typeof relationshipMap>['root'], depth: number = 0) => {
    const isRoot = depth === 0;
    const isEntityNode = Boolean(node.entity);

    return (
      <div
        key={node.id}
        className={cn(
          'rounded-3xl border p-4 transition-colors',
          isRoot
            ? 'border-primary/30 bg-primary/5 shadow-sm'
            : 'border-border/60 bg-background/80',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {isEntityNode ? (
            <button
              type="button"
              className="text-left text-sm font-bold tracking-tight text-foreground hover:text-primary"
              onClick={() => node.entity && onSelectEntity?.(node.entity)}
            >
              {node.name}
            </button>
          ) : (
            <span className="text-sm font-bold tracking-tight text-foreground">{node.name}</span>
          )}
          <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-widest">
            {isRoot ? '根系统' : node.source === 'relation' ? '关系推导' : '属性推导'}
          </Badge>
          {node.entity ? <Badge variant="secondary">{node.entity.type}</Badge> : null}
          {node.entity?.domain ? <Badge variant="outline">{node.entity.domain}</Badge> : null}
        </div>

        {node.children.length > 0 ? (
          <div className={cn('mt-4 grid gap-3', depth < 2 ? 'md:grid-cols-2' : 'grid-cols-1')}>
            {node.children.map((child) => renderStructureNode(child, depth + 1))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            该节点当前没有继续向下展开的显式包含信息。
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-primary" />
            系统本体分析
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">当前系统视图来自 本体知识库 节点、关系和派生分析结果</span>
            </div>
            {selectedEntity ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{selectedEntity.type}</Badge>
                <Badge variant="secondary">{selectedEntity.domain}</Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "border-none font-bold",
                    selectedEntity.layer === 'common' && "bg-[#99AF91]/10 text-[#768A6F]",
                    selectedEntity.layer === 'domain' && "bg-[#4F83C3]/10 text-[#345C8F]",
                    selectedEntity.layer === 'private' && "bg-[#C19292]/10 text-[#9B6D6D]"
                  )}
                >
                  {layerLabels[selectedEntity.layer]}
                </Badge>
                <Badge variant="outline">{selectedEntity.source}</Badge>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                当前还没有选中节点，可以从浏览、图谱或搜索里先选一个实体。
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="输入当前 本体知识库 中的节点名称"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleAnalyze()}
              className="flex-1"
            />
            <Button onClick={() => void handleAnalyze()} disabled={loading || !input.trim()}>
              {loading ? '分析中...' : <><Search className="w-4 h-4 mr-2" />分析</>}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-muted-foreground">当前 本体知识库 节点:</span>
            {exampleEntities.map((entity) => (
              <Badge
                key={entity.id}
                variant="outline"
                className="cursor-pointer hover:bg-primary/10"
                onClick={() => void handleAnalyze(entity.name, entity)}
              >
                {entity.name}
              </Badge>
            ))}
          </div>

          {error && analysis ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-purple-500">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Boxes className="w-6 h-6 text-purple-500" />
                系统本体分析：{currentAnalysis.entity}
              </CardTitle>
              <p className="text-muted-foreground mt-1">
                基于 本体知识库 文档节点与关联语境派生出的动态系统视图
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/20">
                系统本体论
              </Badge>
              {analyzedEntity ? (
                <>
                  <Badge variant="secondary">{analyzedEntity.domain}</Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-none font-bold",
                      analyzedEntity.layer === 'common' && "bg-[#99AF91]/10 text-[#768A6F]",
                      analyzedEntity.layer === 'domain' && "bg-[#4F83C3]/10 text-[#345C8F]",
                      analyzedEntity.layer === 'private' && "bg-[#C19292]/10 text-[#9B6D6D]"
                    )}
                  >
                    {layerLabels[analyzedEntity.layer]}
                  </Badge>
                </>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs defaultValue="hierarchy" className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="holistic"><Boxes className="w-3 h-3 mr-1" />整体性</TabsTrigger>
              <TabsTrigger value="boundary"><Circle className="w-3 h-3 mr-1" />边界</TabsTrigger>
              <TabsTrigger value="environment"><Globe className="w-3 h-3 mr-1" />环境</TabsTrigger>
              <TabsTrigger value="feedback"><RefreshCw className="w-3 h-3 mr-1" />反馈</TabsTrigger>
              <TabsTrigger value="hierarchy"><Layers className="w-3 h-3 mr-1" />层次</TabsTrigger>
              <TabsTrigger value="questions"><Target className="w-3 h-3 mr-1" />问题</TabsTrigger>
            </TabsList>

            <TabsContent value="holistic" className="space-y-4">
              <Card className="bg-muted/10 border-border/40 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="w-5 h-5 text-purple-500" />
                    涌现属性
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentAnalysis.holistic_properties.map((prop, index) => (
                      <div key={prop} className="flex items-start gap-3 p-4 bg-muted/30 rounded-lg border border-border/20">
                        <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center text-purple-500 font-black shrink-0">
                          {index + 1}
                        </div>
                        <p className="text-sm text-foreground/80">{prop}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">涌现示例</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {currentAnalysis.emergence_examples.map((example) => (
                    <div key={example} className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                      <ArrowRightLeft className="w-5 h-5 text-muted-foreground" />
                      <span className="text-sm">{example}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="boundary" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-blue-500/5 border-blue-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Square className="w-4 h-4 text-blue-500" />物理边界</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-foreground/80">{currentAnalysis.boundary.physical}</p></CardContent>
                </Card>
                <Card className="bg-emerald-500/5 border-emerald-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-500" />功能边界</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-foreground/80">{currentAnalysis.boundary.functional}</p></CardContent>
                </Card>
                <Card className="bg-amber-500/5 border-amber-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Triangle className="w-4 h-4 text-amber-500" />认知边界</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-foreground/80">{currentAnalysis.boundary.cognitive}</p></CardContent>
                </Card>
                <Card className="bg-rose-500/5 border-rose-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><RefreshCw className="w-4 h-4 text-rose-500" />动态边界</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-foreground/80">{currentAnalysis.boundary.dynamic}</p></CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="environment" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    系统环境
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{currentAnalysis.environment.description}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                      <h4 className="font-bold text-emerald-500 mb-2 uppercase tracking-tighter text-[11px]">输入</h4>
                      <div className="flex flex-wrap gap-2">
                        {currentAnalysis.environment.inputs.map((item) => <Badge key={item} variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none">{item}</Badge>)}
                      </div>
                    </div>
                    <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                      <h4 className="font-bold text-blue-500 mb-2 uppercase tracking-tighter text-[11px]">输出</h4>
                      <div className="flex flex-wrap gap-2">
                        {currentAnalysis.environment.outputs.map((item) => <Badge key={item} variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-none">{item}</Badge>)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="feedback" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-blue-500/5 border-blue-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2 text-blue-500 font-bold uppercase tracking-tight"><RefreshCw className="w-4 h-4" />负反馈</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {currentAnalysis.feedback.negative.map((item) => <div key={item} className="text-sm p-2 bg-muted/40 rounded border border-blue-500/10 text-foreground/80">{item}</div>)}
                  </CardContent>
                </Card>
                <Card className="bg-rose-500/5 border-rose-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2 text-rose-500 font-bold uppercase tracking-tight"><Activity className="w-4 h-4" />正反馈</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {currentAnalysis.feedback.positive.map((item) => <div key={item} className="text-sm p-2 bg-muted/40 rounded border border-rose-500/10 text-foreground/80">{item}</div>)}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="hierarchy" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-lg">子系统</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {(relationshipMap?.root.children.map((item) => item.name) ?? currentAnalysis.hierarchy.subsystems).map((item) => (
                      <div key={item} className="rounded-lg bg-muted/40 p-3 text-sm">{item}</div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-lg">上位系统</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {hierarchySupersystems.map((item) => <div key={item} className="rounded-lg bg-muted/40 p-3 text-sm">{item}</div>)}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-lg">包含边</CardTitle></CardHeader>
                  <CardContent>
                    <div className="rounded-lg bg-muted/40 p-3 text-2xl font-black tracking-tight">
                      {relationshipMap?.containmentCount ?? 0}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">优先使用“包含/组成/components/subsystems”等显式信息构造。</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-lg">依赖边</CardTitle></CardHeader>
                  <CardContent>
                    <div className="rounded-lg bg-muted/40 p-3 text-2xl font-black tracking-tight">
                      {relationshipMap?.dependencyCount ?? 0}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">仅统计当前系统展开范围内的依赖、支撑、调用等关系。</p>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Boxes className="w-5 h-5 text-primary" />
                    系统结构示意
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    嵌套框表示包含关系；同一父系统下的依赖关系会在下方通过连线条目展示。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {relationshipMap ? renderStructureNode(relationshipMap.root) : (
                    <div className="rounded-2xl border border-dashed border-border bg-background/70 p-5 text-sm text-muted-foreground">
                      当前未能从所选实体中提取出明确的包含结构，请先选择一个更具体的系统节点，或补充“包含 / 组成 / 依赖”关系。
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {(relationshipMap?.dependencyClusters.length ?? 0) > 0 ? relationshipMap?.dependencyClusters.map((cluster) => (
                  <Card key={cluster.parentId}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">{cluster.parentName} 内部依赖</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        仅显示同一父系统下节点之间的依赖关系，避免跨层级连线把结构搅乱。
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {cluster.nodes.map((node) => (
                          <Badge key={node.id} variant="outline" className="rounded-full px-3 py-1">
                            {node.name}
                          </Badge>
                        ))}
                      </div>

                      <div className="space-y-3">
                        {cluster.edges.map((edge) => {
                          const sourceNode = cluster.nodes.find((node) => node.id === edge.source);
                          const targetNode = cluster.nodes.find((node) => node.id === edge.target);
                          if (!sourceNode || !targetNode) {
                            return null;
                          }

                          return (
                            <div key={`${cluster.parentId}:${edge.source}:${edge.target}:${edge.relation}`} className="rounded-2xl border border-border/60 bg-background/70 p-3">
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  className="rounded-full border border-sky-500/20 bg-sky-500/5 px-3 py-1 text-xs font-bold text-sky-700 transition-colors hover:bg-sky-500/10 dark:text-sky-300"
                                  onClick={() => sourceNode.entity && onSelectEntity?.(sourceNode.entity)}
                                >
                                  {sourceNode.name}
                                </button>
                                <div className="h-px flex-1 bg-gradient-to-r from-sky-400/60 to-violet-400/60" />
                                <Badge variant="secondary" className="shrink-0 rounded-full">{edge.relation}</Badge>
                                <div className="h-px flex-1 bg-gradient-to-r from-violet-400/60 to-emerald-400/60" />
                                <button
                                  type="button"
                                  className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300"
                                  onClick={() => targetNode.entity && onSelectEntity?.(targetNode.entity)}
                                >
                                  {targetNode.name}
                                </button>
                              </div>
                              {edge.description ? (
                                <p className="mt-2 text-xs text-muted-foreground">{edge.description}</p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )) : (
                  <Card className="xl:col-span-2">
                    <CardContent className="pt-6">
                      <div className="rounded-2xl border border-dashed border-border bg-background/70 p-5 text-sm text-muted-foreground">
                        当前系统展开范围内还没有检测到同级依赖关系。若补充“依赖 / 支撑 / 调用 / 控制”等关系，这里会自动显示连线。
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="questions" className="space-y-4">
              <Card>
                <CardContent className="pt-6 space-y-4">
                  {currentAnalysis.systems_questions.map((item) => (
                    <div key={item.question} className="rounded-lg bg-muted/40 p-4">
                      <p className="font-medium">{item.question}</p>
                      <p className="text-sm text-muted-foreground mt-2">{item.analysis}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          {error && !analysis ? <p className="text-sm text-destructive mt-4">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
