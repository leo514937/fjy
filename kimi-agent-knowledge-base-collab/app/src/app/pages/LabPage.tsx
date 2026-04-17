import { Boxes, FlaskConical, GraduationCap, Sparkles } from 'lucide-react';

import { EducationHub } from '@/components/EducationHub';
import { OntologyAnalyzer } from '@/components/OntologyAnalyzer';
import { SystemsOntologyView } from '@/components/SystemsOntologyView';
import { OntologyBrowser } from '@/components/OntologyBrowser';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import type { Entity } from '@/types/ontology';

interface LabPageProps {
  onSelectEntity: (entity: Entity) => void;
}

export function LabPage({ onSelectEntity }: LabPageProps) {
  const { filteredEntities, filteredCrossReferences, selectedEntity } = useOntologyContext();

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-8">
        {/* 1. 概念快报面板 (Fig 2) - 始终显示在顶部作为数据概览 */}
        <div className="w-full animate-in fade-in slide-in-from-top-4 duration-500">
          <OntologyBrowser
            entities={filteredEntities}
            crossReferences={filteredCrossReferences}
          />
        </div>

        {/* 2. 深度知识实验室 - 垂直紧随其后 */}
        <div className="w-full rounded-3xl border border-border/40 bg-muted/10 p-1 shadow-inner backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Tabs defaultValue="analyzer" className="w-full">
            <div className="flex flex-col gap-4 border-b border-border/40 bg-card/60 px-6 py-4 lg:flex-row lg:items-center lg:justify-between rounded-t-3xl">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <FlaskConical className="w-5 h-5 text-blue-500" />
                </div>
                <h2 className="text-xl font-black tracking-tight text-foreground/90">本体知识实验室</h2>
              </div>
              <TabsList className="h-auto w-full flex-wrap justify-start bg-muted/30 p-1 rounded-xl lg:w-auto border border-border/20">
                <TabsTrigger value="analyzer" className="rounded-lg px-4 py-2 font-bold text-xs uppercase tracking-tight data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <Sparkles className="w-4 h-4 mr-2 text-primary" /> 语义解构
                </TabsTrigger>
                <TabsTrigger value="systems" className="rounded-lg px-4 py-2 font-bold text-xs uppercase tracking-tight data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <Boxes className="w-4 h-4 mr-2 text-primary" /> 系统分析
                </TabsTrigger>
                <TabsTrigger value="education" className="rounded-lg px-4 py-2 font-bold text-xs uppercase tracking-tight data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <GraduationCap className="w-4 h-4 mr-2 text-primary" /> 科普导读
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="mt-0">
              <TabsContent value="analyzer" className="mt-0">
                <OntologyAnalyzer
                  entities={filteredEntities}
                  selectedEntity={selectedEntity}
                  onSelectEntity={onSelectEntity}
                />
              </TabsContent>
              <TabsContent value="systems" className="mt-0">
                <SystemsOntologyView
                  entities={filteredEntities}
                  selectedEntity={selectedEntity}
                  onSelectEntity={onSelectEntity}
                />
              </TabsContent>
              <TabsContent value="education" className="mt-0">
                <EducationHub selectedEntity={selectedEntity} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </ScrollArea>
  );
}
