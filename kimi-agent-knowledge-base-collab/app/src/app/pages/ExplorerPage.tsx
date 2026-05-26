import { useEffect, useMemo, useState } from 'react';

import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import { EntityDetail } from '@/components/EntityDetail';
import { EntitySelectorPanel } from '@/components/EntitySelectorPanel';
import { SystemRelationshipPanel } from '@/components/SystemRelationshipPanel';
import { GraphProbabilityFilterPanel } from '@/features/ontology/components/GraphProbabilityFilterPanel';
import {
  DEFAULT_GRAPH_PROBABILITY_FILTERS,
  filterGraphCrossReferencesByProbability,
  filterGraphEntitiesByProbability,
  type GraphProbabilityFilters,
} from '@/features/ontology/graphProbabilityFilters';
import {
  selectOntologyRelatedEntities,
  selectOntologySelectedEntity,
} from '@/features/ontology/stateSelectors';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Network, Info, Zap, LayoutList, Boxes } from 'lucide-react';
import type { Entity } from '@/types/ontology';

interface ExplorerPageProps {
  onSelectEntity: (entity: Entity) => void;
  isActive?: boolean;
}

function ExplorerLoadingState() {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <div className="flex-1 relative flex flex-col min-h-0 min-w-0 p-4 lg:p-6">
        <div className="flex-1 rounded-3xl border border-border/40 bg-card/40 p-4 shadow-inner">
          <Skeleton className="h-full w-full rounded-3xl" />
        </div>
      </div>

      <div className="w-[520px] flex flex-col min-h-0 border-l border-border bg-card/30 backdrop-blur-sm">
        <div className="p-3 border-b border-border bg-card flex flex-col gap-3 shrink-0">
          <Skeleton className="h-5 w-32 rounded-full" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-[calc(100%-5rem)] w-full rounded-3xl" />
        </div>
      </div>
    </div>
  );
}

export function ExplorerPage({ onSelectEntity, isActive = true }: ExplorerPageProps) {
  const {
    filteredEntities,
    filteredCrossReferences,
    selectedEntityId,
    loading,
  } = useOntologyContext();
  const [activePanelTab, setActivePanelTab] = useState<'details' | 'structure' | 'selector'>('structure');
  const [probabilityFilters, setProbabilityFilters] = useState<GraphProbabilityFilters>(
    DEFAULT_GRAPH_PROBABILITY_FILTERS,
  );
  const showLoading = loading && filteredEntities.length === 0;

  const graphEntities = useMemo(
    () => filterGraphEntitiesByProbability(filteredEntities, probabilityFilters),
    [filteredEntities, probabilityFilters],
  );

  const graphEntityIndex = useMemo(
    () => new Map(graphEntities.map((entity) => [entity.id, entity])),
    [graphEntities],
  );

  const graphCrossReferences = useMemo(
    () => filterGraphCrossReferencesByProbability(filteredCrossReferences, graphEntities),
    [filteredCrossReferences, graphEntities],
  );

  const selectedGraphEntity = useMemo(
    () => selectOntologySelectedEntity(graphEntities, selectedEntityId, graphEntityIndex),
    [graphEntities, graphEntityIndex, selectedEntityId],
  );

  const relatedGraphEntities = useMemo(
    () => selectOntologyRelatedEntities(selectedGraphEntity, graphCrossReferences, graphEntityIndex),
    [graphCrossReferences, graphEntityIndex, selectedGraphEntity],
  );

  useEffect(() => {
    if (selectedEntityId) {
      setActivePanelTab('structure');
    }
  }, [selectedEntityId]);

  if (showLoading) {
    return <ExplorerLoadingState />;
  }

  return (
    <div className="flex flex-1 h-full w-full overflow-hidden bg-background">
      {/* Main Graph Area */}
      <div className="flex-1 relative flex flex-col min-h-0 min-w-0">
        <div className="flex-1 w-full relative min-h-0">
          <KnowledgeGraph
            entities={graphEntities}
            crossReferences={graphCrossReferences}
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId ?? undefined}
            isActive={isActive}
          />
        </div>
      </div>

      {/* Side Info Panel */}
      <div className="w-[520px] flex flex-col min-h-0 border-l border-border bg-card/30 backdrop-blur-sm animate-in slide-in-from-right-4 duration-500">
        <Tabs
          value={activePanelTab}
          onValueChange={(value) => setActivePanelTab(value as 'details' | 'structure' | 'selector')}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="p-3 border-b border-border bg-card flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500 animate-pulse" />
                <h3 className="text-sm font-black tracking-tight uppercase">图谱工作台</h3>
              </div>
              {selectedGraphEntity && (
                <div className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-black flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-primary animate-ping" />
                  已选中: {selectedGraphEntity.name}
                </div>
              )}
            </div>
            <GraphProbabilityFilterPanel
              filters={probabilityFilters}
              onChange={setProbabilityFilters}
              matchedEntityCount={graphEntities.length}
              totalEntityCount={filteredEntities.length}
              relationCount={graphCrossReferences.length}
              compact
            />
            <TabsList className="grid w-full grid-cols-3 h-10 rounded-xl bg-muted/60 p-1 border border-border/40">
              <TabsTrigger
                value="structure"
                className="rounded-lg text-[11px] font-black uppercase tracking-widest transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md hover:text-foreground/80"
              >
                <Boxes className="w-4 h-4 mr-2" /> 系统结构
              </TabsTrigger>
              <TabsTrigger
                value="details"
                className="rounded-lg text-[11px] font-black uppercase tracking-widest transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md hover:text-foreground/80"
              >
                <Info className="w-4 h-4 mr-2" /> 详细参数
              </TabsTrigger>
              <TabsTrigger
                value="selector"
                className="rounded-lg text-[11px] font-black uppercase tracking-widest transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md hover:text-foreground/80"
              >
                <LayoutList className="w-4 h-4 mr-2" /> 实体选取
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent value="structure" className="mt-0 outline-none h-full data-[state=active]:flex flex-col">
              <ScrollArea className="flex-1 h-full">
                <div className="p-4">
                  <SystemRelationshipPanel
                    entities={graphEntities}
                    crossReferences={graphCrossReferences}
                    selectedEntity={selectedGraphEntity}
                    onSelectEntity={onSelectEntity}
                    maxDepth={1}
                    emptyMessage="请先在左侧本体图谱中选择一个节点，系统结构会以该节点为根系统展开。"
                  />
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="details" className="mt-0 outline-none h-full data-[state=active]:flex flex-col">
              <ScrollArea className="flex-1 h-full">
                <div className="p-4">
                  {selectedGraphEntity ? (
                    <EntityDetail
                      entity={selectedGraphEntity}
                      relatedEntities={relatedGraphEntities}
                      onSelectRelated={onSelectEntity}
                    />
                  ) : (
                    <div className="h-[calc(100vh-250px)] flex flex-col items-center justify-center text-center p-8 space-y-4">
                      <div className="p-6 rounded-full bg-muted/50 border border-dashed border-border mb-2">
                        <Network className="w-12 h-12 text-muted-foreground/30 animate-pulse" />
                      </div>
                      <h4 className="text-lg font-bold text-foreground/70 tracking-tight">等待选取</h4>
                      <p className="text-sm text-muted-foreground max-w-[240px]">
                        请在左侧图谱中点击节点，或切换至“实体选取”搜索名录，即可查看工业属性模型。
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="selector" className="mt-0 outline-none h-full data-[state=active]:flex flex-col">
              <ScrollArea className="flex-1 h-full">
                <div className="p-4">
                  <EntitySelectorPanel
                    entities={graphEntities}
                    crossReferences={graphCrossReferences}
                    selectedEntityId={selectedEntityId ?? undefined}
                    onSelectEntity={(entity) => {
                      onSelectEntity(entity);
                    }}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
