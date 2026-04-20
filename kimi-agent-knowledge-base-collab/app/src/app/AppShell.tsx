import { useState } from 'react';
import {
  BookOpen,
  Blocks,
  GitBranch,
  Menu,
  MessageSquareText,
  Network,
  Sparkles,
  Sun,
  Moon,
  Zap,
  Layers,
  Atom,
  Link2,
  TreePine,
} from 'lucide-react';

import { Separator } from '@/components/ui/separator';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sidebar as AssistantSidebar } from '@/components/assistant/Sidebar';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useOntologyAssistantState } from '@/hooks/useOntologyAssistantState';
import { OntologyProvider } from '@/features/ontology/context';
import { LAYER_FILTERS } from '@/features/ontology/layerFilters';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import { ExplorerPage } from '@/app/pages/ExplorerPage';
import { AssistantPage } from '@/app/pages/AssistantPage';
import { LabPage } from '@/app/pages/LabPage';
import { WorkspacePage } from '@/app/pages/WorkspacePage';
import { EnterGateIntro } from '@/components/EnterGateIntro';
import { SearchPanel } from '@/components/SearchPanel';
import type { Entity } from '@/types/ontology';

const GlobalSidebar = ({
  domainCount,
  layerCount,
  entityCount,
  relationCount,
  selectedLayer,
  setSelectedLayer,
  onSearch,
  onSelectEntity,
  filteredEntityCount,
  filteredRelationCount
}: {
  domainCount: number;
  layerCount: number;
  entityCount: number;
  relationCount: number;
  filteredEntityCount: number;
  filteredRelationCount: number;
  selectedLayer: string;
  setSelectedLayer: (layer: any) => void;
  onSearch: (query: string) => Promise<any[]>;
  onSelectEntity: (entity: any) => void;
}) => (
  <div className="flex flex-col gap-4">
    {/* 1. 标题与搜索 */}
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 px-1">
        <Sparkles className="w-4 h-4 text-primary/70" />
        <h3 className="text-[11px] font-black uppercase tracking-widest text-foreground/70">视图工厂控制台</h3>
      </div>

      <div className="mx-0.5">
        <SearchPanel
          onSearch={onSearch}
          onSelectEntity={onSelectEntity}
        />
      </div>
    </div>

    {/* 2. 四个功能按钮 (全部层, Common, Domain, Private) */}
    <div className="flex flex-wrap items-center gap-1 bg-muted/40 p-1 rounded-2xl border border-border/40">
      {LAYER_FILTERS.map((option) => (
        <Button
          key={option.value}
          variant={selectedLayer === option.value ? 'default' : 'ghost'}
          size="sm"
          className={cn(
            'flex-1 min-w-[65px] h-8 rounded-xl text-[10px] font-bold transition-all px-1 active:scale-95',
            selectedLayer === option.value
              ? 'bg-background shadow-sm text-primary hover:bg-background'
              : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/50',
          )}
          onClick={() => setSelectedLayer(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>

    {/* 3. 实时状态小图标 */}
    <div className="flex flex-wrap items-center gap-2 px-1">
      <Badge variant="outline" className="min-w-0 flex-1 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 border-border/60 text-[10px] font-bold bg-muted/20">
        <GitBranch className="w-3 h-3 text-primary/70 shrink-0" />
        <span className="truncate">{filteredEntityCount} 实体</span>
      </Badge>
      <Badge variant="outline" className="min-w-0 flex-1 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 border-border/60 text-[10px] font-bold bg-muted/20">
        <Network className="w-3 h-3 text-primary/70 shrink-0" />
        <span className="truncate">{filteredRelationCount} 关系</span>
      </Badge>
    </div>

    <Separator className="bg-border/40" />

    {/* 4. 底部四个彩色大框框 */}
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 px-1">
        <TreePine className="w-4 h-4 text-primary/70" />
        <h3 className="text-[11px] font-black uppercase tracking-widest text-foreground/70">概念速览</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 px-0.5">
        {[
          { label: '领域数', value: domainCount, icon: BookOpen, color: 'blue' },
          { label: '层级数', value: layerCount, icon: Layers, color: 'purple' },
          { label: '实体数', value: entityCount, icon: Atom, color: 'amber' },
          { label: '关系数', value: relationCount, icon: Link2, color: 'emerald' },
        ].map((stat) => (
          <div
            key={stat.label}
            className={cn(
              "rounded-xl border p-3.5 transition-all active:scale-95 group",
              stat.color === 'blue' && "border-blue-500/20 bg-blue-500/5 hover:border-blue-500/50 hover:bg-blue-500/10 hover:shadow-[0_0_12px_rgba(59,130,246,0.1)]",
              stat.color === 'purple' && "border-purple-500/20 bg-purple-500/5 hover:border-purple-500/50 hover:bg-purple-500/10 hover:shadow-[0_0_12px_rgba(168,85,247,0.1)]",
              stat.color === 'amber' && "border-amber-500/20 bg-amber-500/5 hover:border-amber-500/50 hover:bg-amber-500/10 hover:shadow-[0_0_12px_rgba(245,158,11,0.1)]",
              stat.color === 'emerald' && "border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:shadow-[0_0_12px_rgba(16,185,129,0.1)]"
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={cn(
                "text-[9px] font-bold uppercase tracking-tight opacity-70",
                stat.color === 'blue' && "text-blue-600 dark:text-blue-300",
                stat.color === 'purple' && "text-purple-600 dark:text-purple-300",
                stat.color === 'amber' && "text-amber-600 dark:text-amber-300",
                stat.color === 'emerald' && "text-emerald-600 dark:text-emerald-300"
              )}>{stat.label}</span>
              <stat.icon className={cn(
                "h-3.5 w-3.5 opacity-40 group-hover:opacity-80 transition-opacity",
                stat.color === 'blue' && "text-blue-500",
                stat.color === 'purple' && "text-purple-500",
                stat.color === 'amber' && "text-amber-500",
                stat.color === 'emerald' && "text-emerald-500"
              )} />
            </div>
            <div className={cn(
              "text-xl font-black tracking-tighter",
              stat.color === 'blue' && "text-blue-700 dark:text-blue-100",
              stat.color === 'purple' && "text-purple-700 dark:text-purple-100",
              stat.color === 'amber' && "text-amber-700 dark:text-amber-100",
              stat.color === 'emerald' && "text-emerald-700 dark:text-emerald-100"
            )}>{stat.value}</div>
          </div>
        ))}
      </div>
    </section>
  </div>
);

function AppShellContent() {
  const [activeTab, setActiveTab] = useState('lab');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'light';
  });

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const {
    loading,
    error,
    filteredEntities,
    filteredCrossReferences,
    selectedEntity,
    selectedLayer,
    setSelectedLayer,
    selectEntity,
    searchInLayer,
  } = useOntologyContext();
  const assistantState = useOntologyAssistantState(selectedEntity);

  const handleSelectEntity = (entity: Entity) => {
    selectEntity(entity);
    setSidebarOpen(false);
    setActiveTab('explorer');
  };

  const commonSidebarProps = {
    domainCount: new Set((filteredEntities || []).map(e => e.domain)).size,
    layerCount: new Set((filteredEntities || []).map(e => e.layer)).size,
    entityCount: (filteredEntities || []).length,
    relationCount: (filteredCrossReferences || []).length,
    filteredEntityCount: (filteredEntities || []).length,
    filteredRelationCount: (filteredCrossReferences || []).length,
    selectedLayer,
    setSelectedLayer,
    onSearch: searchInLayer,
    onSelectEntity: handleSelectEntity,
  };

  // 只有在完全没有数据（初次启动）且正在加载时，才显示全屏 Loading
  // 之后的后台刷新（refreshKnowledgeGraph）将不再导致整页闪烁
  if (loading && !filteredEntities?.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">正在加载 本体知识库 多层知识图谱...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center text-destructive">
          <p className="text-lg font-semibold mb-2">加载失败</p>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-y-auto lg:h-screen lg:overflow-hidden">
      <EnterGateIntro />
      <header className="border-b bg-card text-card-foreground sticky top-0 z-40">
        <div className="flex min-h-16 w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 sm:px-4 lg:px-6">
          <div className="flex min-w-0 max-w-full items-center gap-2 sm:gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Blocks className="w-6 h-6 text-primary" />
            </div>
            <div className="min-w-0 max-w-[60vw] sm:max-w-none">
              <h1 className="truncate text-base font-bold sm:text-lg lg:text-xl">本体工厂</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">Ontology Factory</p>
            </div>
          </div>



          <div className="flex min-w-0 items-center gap-2 sm:gap-3 ml-auto">
            <div className="hidden w-64 md:block">
              <SearchPanel
                onSearch={searchInLayer}
                onSelectEntity={handleSelectEntity}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-9 w-9 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all ml-1 relative overflow-hidden"
              title={theme === 'dark' ? "切换到浅色模式" : "切换到深色模式"}
            >
              <div className="relative h-full w-full flex items-center justify-center">
                <Sun className={cn(
                  "h-[1.2rem] w-[1.2rem] text-yellow-500 transition-all duration-500 absolute",
                  theme === 'dark' ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
                )} />
                <Moon className={cn(
                  "h-[1.2rem] w-[1.2rem] transition-all duration-500 absolute",
                  theme === 'dark' ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
                )} />
              </div>
            </Button>

            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0 border-r shadow-2xl bg-background">
                <div className="p-4 border-b flex items-center justify-between bg-muted/20">
                  <h2 className="text-xs font-black uppercase tracking-widest text-primary">本体工厂 | 控制台</h2>
                  <Badge variant="outline" className="text-[10px] font-bold">STAT LIVE</Badge>
                </div>
                <div className="p-4 h-full min-h-0">
                  {activeTab === 'assistant' ? (
                    <AssistantSidebar
                      sessions={assistantState.sessions}
                      activeSessionId={assistantState.activeSessionId}
                      onSelectSession={assistantState.setActiveSessionId}
                      onNewSession={assistantState.onNewSession}
                      onDeleteSession={assistantState.onDeleteSession}
                      onDeleteSessions={assistantState.onDeleteSessions}
                      isBusy={assistantState.isBusy}
                    />
                  ) : (
                    <GlobalSidebar {...commonSidebarProps} />
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="w-full flex-1 min-h-0 bg-background overflow-y-auto lg:overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full min-h-0 gap-0 lg:flex-row">
          <div className="flex w-full shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r bg-muted/10 lg:h-full lg:w-[208px] xl:w-[240px]">
            <div className="p-3 sm:p-4 flex flex-col min-h-full gap-4">
              <TabsList className="flex h-auto w-full flex-col gap-1 rounded-3xl border bg-card/10 p-2 shadow-sm shrink-0 min-h-0">
                <TabsTrigger value="lab" className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <BookOpen className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">本体库</span>
                </TabsTrigger>
                <TabsTrigger value="assistant" className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <MessageSquareText className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">问答助手</span>
                </TabsTrigger>
                <TabsTrigger value="explorer" className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <Zap className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">本体图谱</span>
                </TabsTrigger>
                <TabsTrigger value="workspace" className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <GitBranch className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">小故Git</span>
                </TabsTrigger>
              </TabsList>

              <div className="flex flex-col gap-6 pb-2">
                {activeTab === 'assistant' ? (
                  <AssistantSidebar
                    sessions={assistantState.sessions}
                    activeSessionId={assistantState.activeSessionId}
                    onSelectSession={assistantState.setActiveSessionId}
                    onNewSession={assistantState.onNewSession}
                    onDeleteSession={assistantState.onDeleteSession}
                    onDeleteSessions={assistantState.onDeleteSessions}
                    isBusy={assistantState.isBusy}
                  />
                ) : (
                  <GlobalSidebar {...commonSidebarProps} />
                )}
              </div>
            </div>
          </div>


          <TabsContent value="assistant" className="mt-0 h-full min-h-0 min-w-0 flex-1 animate-in fade-in duration-300">
            <AssistantPage
              activeSession={assistantState.activeSession}
              businessPrompt={assistantState.businessPrompt}
              executionStages={assistantState.currentExecutionStages}
              isBusy={assistantState.isBusy}
              modelName={assistantState.modelName}
              onAsk={assistantState.onAsk}
              onBusinessPromptChange={assistantState.setBusinessPrompt}
              onDraftChange={assistantState.onDraftChange}
              onModelNameChange={assistantState.setModelName}
              onUploadFile={assistantState.onUploadFile}
              onStop={assistantState.onStop}
              selectedEntityName={selectedEntity?.name}
            />
          </TabsContent>
          <TabsContent value="lab" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <LabPage onSelectEntity={(e) => selectEntity(e)} />
          </TabsContent>
          <TabsContent value="explorer" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <ExplorerPage onSelectEntity={handleSelectEntity} />
          </TabsContent>
          <TabsContent value="workspace" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <WorkspacePage />
          </TabsContent>
        </Tabs>
      </main>

      <Toaster />
    </div>
  );
}

export function AppShell() {
  return (
    <OntologyProvider>
      <AppShellContent />
    </OntologyProvider>
  );
}


