import { BookOpen, Layers } from 'lucide-react';

import { OntologyBrowser } from '@/components/OntologyBrowser';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import type { Entity } from '@/types/ontology';

interface BrowsePageProps {
  onSelectEntity: (entity: Entity) => void;
}

export function BrowsePage({ onSelectEntity }: BrowsePageProps) {
  const {
    selectedEntity,
    filteredEntities,
    filteredCrossReferences,
  } = useOntologyContext();

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-10">


        {/* Concept Browser (New Section) */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-75">
          <OntologyBrowser
            entities={filteredEntities}
            crossReferences={filteredCrossReferences}
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntity?.id}
          />
        </div>



        {!selectedEntity && (
          <div className="space-y-6">
            <div className="rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white overflow-hidden shadow-2xl">
              <div className="grid gap-6 px-8 py-10 lg:grid-cols-[1.6fr_1fr]">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] uppercase tracking-wider font-bold">
                    <BookOpen className="w-3.5 h-3.5" />
                    WiKiMG 知识全景
                  </div>
                  <h2 className="mt-6 text-3xl font-bold lg:text-5xl leading-tight">
                    从左侧侧栏选取概念<br />开启深度语义阅读
                  </h2>
                  <p className="mt-4 max-w-2xl text-slate-300 text-sm lg:text-base leading-relaxed">
                    左侧本体树已整合全量节点，在此处您将看到节点的工业级定义、跨层关联关系以及多维度的属性特征。
                  </p>
                </div>
                <div className="flex items-center justify-center">
                  <div className="grid grid-cols-2 gap-4 w-full max-w-[320px]">
                    <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-center backdrop-blur-md">
                      <div className="text-[10px] text-slate-400 uppercase font-black">Total Nodes</div>
                      <div className="mt-1 text-2xl font-black tracking-tighter">{filteredEntities.length}</div>
                    </div>
                    <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-center backdrop-blur-md">
                      <div className="text-[10px] text-slate-400 uppercase font-black">References</div>
                      <div className="mt-1 text-2xl font-black tracking-tighter">{filteredCrossReferences.length}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-card border border-border rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-primary/10 text-primary rounded-2xl group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-foreground">哲学本体</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">涵盖存在论、范畴论、属性论等形而上学核心。从传统哲学到现代分析的演进脉络。</p>
              </div>
              <div className="bg-card border border-border rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-primary/10 text-primary rounded-2xl group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <Layers className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-foreground">形式本体</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">BFO, DOLCE 等顶层本体，以及 OWL/RDF 等形式化逻辑。支撑语义网的骨干。</p>
              </div>
              <div className="bg-card border border-border rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-primary/10 text-primary rounded-2xl group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-foreground">科学本体</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">从物质探测到认知涌现的层次结构，跨越物理、生物与社会系统的集成模型。</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
