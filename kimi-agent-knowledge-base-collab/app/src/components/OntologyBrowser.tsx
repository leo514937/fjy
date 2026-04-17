import { Atom, BookOpen, Layers, Link2, Search, TreePine } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CrossReference, Entity } from '@/types/ontology';

interface OntologyBrowserProps {
  entities: Entity[];
  crossReferences: CrossReference[];
  onSelectEntity?: (entity: Entity) => void;
  selectedEntityId?: string;
}

export function OntologyBrowser({
  entities,
  crossReferences,
  onSelectEntity,
  selectedEntityId,
}: OntologyBrowserProps) {
  const domainCount = new Set(entities.map((entity) => entity.domain)).size;
  const layerCount = new Set(entities.map((entity) => entity.layer)).size;

  return (
    <Card className="overflow-hidden border-border shadow-sm">
      <CardHeader className="bg-card pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg text-foreground">
              <TreePine className="h-5 w-5 text-primary" />
              概念快报
            </CardTitle>
            <CardDescription className="text-[10px]">
              实时分析当前 WiKiMG 存储层模型的状态与规模。
            </CardDescription>
          </div>
          <div className="relative group flex-1 max-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="搜索实体..."
              disabled
              className="h-8 pl-8 rounded-xl bg-muted/50 border-border text-xs focus:bg-muted transition-all shadow-none cursor-not-allowed opacity-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 transition-all hover:bg-blue-500/10 group">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-black text-blue-500/70 uppercase tracking-widest">领域数</span>
              <BookOpen className="h-6 w-6 text-blue-500/50 group-hover:scale-110 transition-transform" />
            </div>
            <div className="text-3xl font-black text-blue-600 dark:text-blue-100 tracking-tighter">{domainCount}</div>
          </div>
          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4 transition-all hover:bg-purple-500/10 group">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-black text-purple-500/70 uppercase tracking-widest">存储层</span>
              <Layers className="h-6 w-6 text-purple-500/50 group-hover:scale-110 transition-transform" />
            </div>
            <div className="text-3xl font-black text-purple-600 dark:text-purple-100 tracking-tighter">{layerCount}</div>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 transition-all hover:bg-amber-500/10 group">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-black text-amber-500/70 uppercase tracking-widest">实体数</span>
              <Atom className="h-6 w-6 text-amber-500/50 group-hover:scale-110 transition-transform" />
            </div>
            <div className="text-3xl font-black text-amber-600 dark:text-amber-100 tracking-tighter">{entities.length}</div>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 transition-all hover:bg-emerald-500/10 group">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-black text-emerald-500/70 uppercase tracking-widest">关系数</span>
              <Link2 className="h-6 w-6 text-emerald-500/50 group-hover:scale-110 transition-transform" />
            </div>
            <div className="text-3xl font-black text-emerald-600 dark:text-emerald-100 tracking-tighter">{crossReferences.length}</div>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
