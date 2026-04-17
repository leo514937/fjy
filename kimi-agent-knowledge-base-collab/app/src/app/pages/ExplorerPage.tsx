import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import { EntityDetail } from '@/components/EntityDetail';
import { EntitySelectorPanel } from '@/components/EntitySelectorPanel';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Network, Info, Zap, LayoutList } from 'lucide-react';
import type { Entity } from '@/types/ontology';

interface ExplorerPageProps {
  onSelectEntity: (entity: Entity) => void;
}

export function ExplorerPage({ onSelectEntity }: ExplorerPageProps) {
  const {
    filteredEntities,
    filteredCrossReferences,
    selectedEntity,
    relatedEntities,
    selectedEntityId,
  } = useOntologyContext();

  return (
    <div className="flex flex-1 h-full w-full overflow-hidden bg-background">
      {/* Main Graph Area */}
      <div className="flex-1 relative flex flex-col min-h-0 min-w-0">
        <div className="flex-1 w-full relative min-h-0">
          <KnowledgeGraph
            entities={filteredEntities}
            crossReferences={filteredCrossReferences}
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId ?? undefined}
          />
        </div>
      </div>

      {/* Side Info Panel */}
      <div className="w-[450px] flex flex-col min-h-0 border-l border-border bg-card/30 backdrop-blur-sm animate-in slide-in-from-right-4 duration-500">
        <Tabs defaultValue="details" className="flex flex-col flex-1 min-h-0">
          <div className="p-3 border-b border-border bg-card flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500 animate-pulse" />
                <h3 className="text-sm font-black tracking-tight uppercase">图谱工作台</h3>
              </div>
              {selectedEntity && (
                <div className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-black flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-primary animate-ping" />
                  已选中: {selectedEntity.name}
                </div>
              )}
            </div>
            <TabsList className="grid w-full grid-cols-2 h-10 rounded-xl bg-muted/60 p-1 border border-border/40">
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
            <TabsContent value="details" className="mt-0 outline-none h-full data-[state=active]:flex flex-col">
              <ScrollArea className="flex-1 h-full">
                <div className="p-4">
                  {selectedEntity ? (
                    <EntityDetail
                      entity={selectedEntity}
                      relatedEntities={relatedEntities}
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
                    entities={filteredEntities}
                    crossReferences={filteredCrossReferences}
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
