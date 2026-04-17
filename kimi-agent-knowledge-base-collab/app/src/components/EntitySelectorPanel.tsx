import { Search, Sparkles, BookOpen, Link2 } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Entity, CrossReference, KnowledgeLayer } from '@/types/ontology';

const layerLabels: Record<KnowledgeLayer, string> = {
  common: 'Common',
  domain: 'Domain',
  private: 'Private',
};

interface EntitySelectorPanelProps {
  entities: Entity[];
  crossReferences: CrossReference[];
  selectedEntityId?: string;
  onSelectEntity: (entity: Entity) => void;
}

export function EntitySelectorPanel({
  entities,
  crossReferences,
  selectedEntityId,
  onSelectEntity,
}: EntitySelectorPanelProps) {
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

  return (
    <div className="space-y-4">
      {/* Search Header */}
      <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
        <Input
          placeholder="搜索本体实体..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-10 pl-10 rounded-xl bg-muted/50 border-border focus:bg-background transition-all shadow-sm"
        />
      </div>

      {/* Stats Summary */}
      <div className="flex items-center justify-between px-1 text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
        <span>{searchQuery ? '查询结果' : '本体名录'} ({filteredEntities.length})</span>
        <div className="h-px flex-1 bg-border/60 ml-3" />
      </div>

      {/* List Container */}
      <div className="grid grid-cols-1 gap-3">
        {filteredEntities.map((entity) => {
          const isSelected = entity.id === selectedEntityId;
          const relationCount = crossReferences.filter(
            (ref) => ref.source === entity.id || ref.target === entity.id
          ).length;

          return (
            <div
              key={entity.id}
              onClick={() => onSelectEntity(entity)}
              className={cn(
                "group relative rounded-2xl border p-4 cursor-pointer transition-all duration-300",
                isSelected
                  ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20"
                  : "border-border/40 bg-card/40 hover:border-primary/40 hover:bg-card hover:shadow-sm"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-black tracking-tight transition-colors truncate",
                      isSelected ? "text-primary text-base" : "text-foreground group-hover:text-primary text-sm"
                    )}>
                      {entity.name}
                    </span>
                    {isSelected && (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
                  
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[9px] h-4 bg-muted/50 border-none font-bold">
                      {entity.domain}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] h-4 border-none font-black uppercase",
                        entity.layer === 'common' && "bg-[#99AF91]/20 text-[#6a7d64]",
                        entity.layer === 'domain' && "bg-[#4F83C3]/20 text-[#345C8F]",
                        entity.layer === 'private' && "bg-[#C19292]/20 text-[#9B6D6D]"
                      )}
                    >
                      {layerLabels[entity.layer]}
                    </Badge>
                    <div className="flex items-center gap-1 text-[10px] text-emerald-600/80 font-bold ml-1">
                      <Link2 className="w-3 h-3" />
                      {relationCount}
                    </div>
                  </div>
                </div>
              </div>

              {entity.definition && (
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground line-clamp-2 italic">
                  {entity.definition}
                </p>
              )}

              {isSelected && (
                <div className="absolute top-4 right-4 text-primary opacity-40">
                  <Sparkles className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}

        {filteredEntities.length === 0 && (
          <div className="py-12 flex flex-col items-center text-center">
            <div className="p-4 bg-muted rounded-full mb-4">
              <Search className="w-8 h-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-bold text-muted-foreground">未找到匹配实体</p>
            <p className="text-xs text-muted-foreground/60 mt-1">请尝试调整搜索条件</p>
          </div>
        )}
      </div>

      {/* Footer Info */}
      {!searchQuery && (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/10 p-4 text-center">
          <BookOpen className="w-4 h-4 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-[10px] text-muted-foreground/60 leading-normal">
            列表展现了当前过滤层级下的所有本体单元。点击任意项即可在左侧图谱中同步定位并查看详情。
          </p>
        </div>
      )}
    </div>
  );
}
