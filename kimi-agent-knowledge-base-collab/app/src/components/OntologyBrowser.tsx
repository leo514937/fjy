import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Atom, BookOpen, Layers, Link2, Search, Sparkles, TreePine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CrossReference, Entity, KnowledgeLayer } from '@/types/ontology';

interface OntologyBrowserProps {
  entities: Entity[];
  crossReferences: CrossReference[];
  onSelectEntity: (entity: Entity) => void;
  selectedEntityId?: string;
}

const layerLabels: Record<KnowledgeLayer, string> = {
  common: 'Common',
  domain: 'Domain',
  private: 'Private',
};

export function OntologyBrowser({
  entities,
  crossReferences,
  onSelectEntity,
  selectedEntityId,
}: OntologyBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;
    const query = searchQuery.toLowerCase();
    return entities.filter(entity =>
      entity.name.toLowerCase().includes(query) ||
      entity.domain.toLowerCase().includes(query) ||
      (entity.definition && entity.definition.toLowerCase().includes(query))
    );
  }, [entities, searchQuery]);

  const domainCount = new Set(entities.map((entity) => entity.domain)).size;
  const layerCount = new Set(entities.map((entity) => entity.layer)).size;
  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId) ?? entities[0];

  const selectedRelations = selectedEntity
    ? crossReferences.filter(
      (reference) =>
        reference.source === selectedEntity.id || reference.target === selectedEntity.id,
    )
    : [];

  return (
    <Card className="h-full flex flex-col overflow-hidden border-border shadow-sm">
      <CardHeader className="border-b bg-card pb-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg text-foreground">
              <TreePine className="h-5 w-5 text-primary" />
              概念速览
            </CardTitle>
            <CardDescription className="text-[10px]">
              展示当前过滤范围内的全部节点，支持搜索查询。
            </CardDescription>
          </div>
          <div className="relative group flex-1 max-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="搜索实体..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 rounded-xl bg-muted/50 border-border text-xs focus:bg-muted transition-all shadow-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 transition-all hover:bg-blue-500/10 group">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-blue-500/70 uppercase tracking-widest">领域数</span>
              <BookOpen className="h-4 w-4 text-blue-500/50 group-hover:scale-110 transition-transform" />
            </div>
            <div className="text-2xl font-black text-blue-600 dark:text-blue-100 tracking-tighter">{domainCount}</div>
          </div>
          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4 transition-all hover:bg-purple-500/10 group">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-purple-500/70 uppercase tracking-widest">存储层</span>
              <Layers className="h-4 w-4 text-purple-500/50 group-hover:scale-110 transition-transform" />
            </div>
            <div className="text-2xl font-black text-purple-600 dark:text-purple-100 tracking-tighter">{layerCount}</div>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 transition-all hover:bg-amber-500/10 group">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-amber-500/70 uppercase tracking-widest">实体数</span>
              <Atom className="h-4 w-4 text-amber-500/50 group-hover:scale-110 transition-transform" />
            </div>
            <div className="text-2xl font-black text-amber-600 dark:text-amber-100 tracking-tighter">{entities.length}</div>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 transition-all hover:bg-emerald-500/10 group">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-emerald-500/70 uppercase tracking-widest">关系数</span>
              <Link2 className="h-4 w-4 text-emerald-500/50 group-hover:scale-110 transition-transform" />
            </div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-100 tracking-tighter">{crossReferences.length}</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 overflow-hidden min-h-0 bg-background/50">
        <ScrollArea className="h-full">
          <div className="space-y-4 p-4">
            {selectedEntity && !searchQuery ? (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-sm ring-1 ring-primary/10">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  当前主阅读
                </div>
                <div className="mt-2 text-lg font-bold text-foreground">{selectedEntity.name}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-3">
                  {selectedEntity.definition}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-none">
                    {selectedEntity.domain}
                  </Badge>
                  <Badge variant="outline" className="bg-background border-primary/20 text-primary">
                    {layerLabels[selectedEntity.layer]}
                  </Badge>
                  <Badge variant="outline" className="bg-background border-primary/20 text-primary">
                    {selectedRelations.length} 关系
                  </Badge>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="px-1 text-[11px] font-bold text-muted-foreground uppercase tracking-widest flex items-center justify-between">
                <span>{searchQuery ? '搜索结果' : '所有候选节点'} ({filteredEntities.length})</span>
                <div className="h-px flex-1 bg-border ml-3" />
              </div>

              {filteredEntities.map((entity) => {
                const isSelected = entity.id === selectedEntityId;
                const relationCount = crossReferences.filter(
                  (reference) =>
                    reference.source === entity.id || reference.target === entity.id,
                ).length;

                return (
                  <div
                    key={entity.id}
                    className={`rounded-2xl border p-4 transition-all duration-200 ${isSelected
                      ? 'border-primary shadow-md bg-card ring-1 ring-primary/20 scale-[1.02]'
                      : 'bg-card hover:border-border/80 hover:shadow-sm border-border/40'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`font-bold transition-colors ${isSelected ? 'text-primary text-base' : 'text-foreground/90 text-sm'}`}>
                            {entity.name}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="outline" className="text-[10px] h-5 bg-muted/30 border-border/40">
                            {entity.domain}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] h-5 border-none font-bold",
                              entity.layer === 'common' && "bg-[#99AF91]/10 text-[#768A6F]",
                              entity.layer === 'domain' && "bg-[#939FB0]/10 text-[#6D7A8D]",
                              entity.layer === 'private' && "bg-[#C19292]/10 text-[#9B6D6D]"
                            )}
                          >
                            {layerLabels[entity.layer]}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] h-5 bg-emerald-50 text-emerald-600 border-none font-bold">
                            {relationCount} 关系
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground line-clamp-2 italic">
                      {entity.definition}
                    </p>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                        <Link2 className="h-3 w-3" />
                        分析关联
                      </div>
                      {!isSelected ? (
                        <button
                          type="button"
                          onClick={() => onSelectEntity(entity)}
                          className="rounded-full bg-slate-100 dark:bg-zinc-700 px-5 py-2 text-[11px] font-black uppercase tracking-widest text-slate-900 dark:text-zinc-100 transition-all hover:bg-slate-200 dark:hover:bg-zinc-600 hover:shadow-lg active:scale-95 shadow-sm border border-slate-200 dark:border-zinc-600"
                        >
                          设为主阅读
                        </button>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] font-bold text-primary">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-1" />
                          阅读中
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 flex flex-col items-center justify-center text-center">
              <div className="p-2 bg-card rounded-full shadow-sm mb-3">
                <BookOpen className="h-5 w-5 text-muted-foreground" />
              </div>
              <h4 className="text-sm font-bold text-foreground/80">探索完毕</h4>
              <p className="mt-1 text-xs text-muted-foreground max-w-[200px]">
                以上是当前存储层下所有的本体节点。您可以切换过滤器查看更多层级。
              </p>
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
