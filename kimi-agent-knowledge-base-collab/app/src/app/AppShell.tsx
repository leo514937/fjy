import { useState } from 'react';
import {
  BookOpen,
  Database,
  GitBranch,
  Menu,
  MessageSquareText,
  Network,
  Sparkles,
  Sun,
  Moon,
  Zap,
  Activity,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchPanel } from '@/components/SearchPanel';
import { OntologyBrowser } from '@/components/OntologyBrowser';
import { Sidebar as AssistantSidebar } from '@/components/assistant/Sidebar';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useOntologyAssistantState } from '@/hooks/useOntologyAssistantState';
import { OntologyProvider } from '@/features/ontology/context';
import { LAYER_FILTERS } from '@/features/ontology/layerFilters';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import { BrowsePage } from '@/app/pages/BrowsePage';
import { ExplorerPage } from '@/app/pages/ExplorerPage';
import { AssistantPage } from '@/app/pages/AssistantPage';
import { LabPage } from '@/app/pages/LabPage';
import { GraphPage } from '@/app/pages/GraphPage';
import { WorkspacePage } from '@/app/pages/WorkspacePage';

function AppShellContent() {
  const [activeTab, setActiveTab] = useState('browse');
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
    selectedEntityId,
    selectedLayer,
    setSelectedLayer,
    selectEntity,
    searchInLayer,
  } = useOntologyContext();
  const assistantState = useOntologyAssistantState(selectedEntity);

  const handleSelectEntity = (entity: NonNullable<typeof selectedEntity>) => {
    selectEntity(entity);
    setSidebarOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">正在加载 WiKiMG 多层知识图谱...</p>
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
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <header className="border-b bg-card text-card-foreground sticky top-0 z-40">
        <div className="flex min-h-16 w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 sm:px-4 lg:px-6">
          <div className="flex min-w-0 max-w-full items-center gap-2 sm:gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Database className="w-6 h-6 text-primary" />
            </div>
            <div className="min-w-0 max-w-[60vw] sm:max-w-none">
              <h1 className="truncate text-base font-bold sm:text-lg lg:text-xl">本体论知识库</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">Ontology Knowledge Base</p>
            </div>
          </div>

          <div className="flex min-w-0 max-w-full items-center gap-2 sm:gap-3">
            <div className="hidden lg:flex items-center gap-1 bg-muted/50 p-1 rounded-2xl border border-border/60 mr-2">
              {LAYER_FILTERS.map((option) => (
                <Button
                  key={option.value}
                  variant={selectedLayer === option.value ? 'default' : 'ghost'}
                  size="sm"
                  className={cn(
                    'h-8 px-3 rounded-xl text-xs font-bold transition-all',
                    selectedLayer === option.value
                      ? 'bg-background shadow-md text-primary hover:bg-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                  onClick={() => setSelectedLayer(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <div className="hidden xl:flex items-center gap-2">
              <Badge variant="outline" className="flex items-center gap-1 rounded-full px-2 py-0.5 border-border text-[10px] font-bold">
                <GitBranch className="w-3 h-3 text-primary/70" />
                {filteredEntities.length} 实体
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1 rounded-full px-2 py-0.5 border-border text-[10px] font-bold">
                <Network className="w-3 h-3 text-primary/70" />
                {filteredCrossReferences.length} 关系
              </Badge>
            </div>

            <div className="hidden xl:block w-64 2xl:w-72">
              <SearchPanel
                onSearch={searchInLayer}
                onSelectEntity={handleSelectEntity}
              />
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-9 w-9 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all ml-1"
              title={theme === 'dark' ? "切换到浅色模式" : "切换到深色模式"}
            >
              {theme === 'dark' ? (
                <Sun className="h-[1.2rem] w-[1.2rem] text-yellow-500 rotate-0 scale-100 transition-all dark:rotate-0 dark:scale-100" />
              ) : (
                <Moon className="h-[1.2rem] w-[1.2rem] transition-all rotate-0 scale-100" />
              )}
            </Button>

            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <div className="p-4 border-b">
                  <h2 className="font-semibold">{activeTab === 'assistant' ? '助手会话' : '本体浏览器'}</h2>
                </div>
                <div className="p-4 h-full min-h-0">
                  {activeTab === 'assistant' ? (
                    <AssistantSidebar
                      sessions={assistantState.sessions}
                      activeSessionId={assistantState.activeSessionId}
                      onSelectSession={assistantState.setActiveSessionId}
                      onNewSession={assistantState.onNewSession}
                      onDeleteSession={assistantState.onDeleteSession}
                      isBusy={assistantState.isBusy}
                    />
                  ) : (
                    <div className="h-full rounded-3xl border border-border/60 bg-muted/20 p-6 flex flex-col items-center justify-center text-center backdrop-blur-sm shadow-sm">
                      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                        <Sparkles className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <h3 className="text-sm font-bold text-foreground/80 mb-1">当前模块未开启侧栏</h3>
                      <p className="text-xs text-slate-400">
                        该功能模块的核心操作区位于主视图中。
                      </p>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="w-full flex-1 min-h-0 overflow-hidden bg-background">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full min-h-0 gap-0 lg:flex-row">
          <div className="flex w-full shrink-0 flex-col overflow-hidden border-r bg-muted/10 lg:h-full lg:w-[208px] xl:w-[240px]">
            <div className="p-3 sm:p-4 flex flex-col h-full min-h-0 gap-4">
              <TabsList className="grid h-auto w-full grid-cols-1 gap-1 rounded-3xl border bg-card/10 p-1.5 shadow-sm sm:grid-cols-2 lg:flex lg:flex-col shrink-0">
                <TabsTrigger value="browse" className="w-full justify-start rounded-2xl px-3 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <BookOpen className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">库管理</span>
                </TabsTrigger>
                <TabsTrigger value="workspace" className="w-full justify-start rounded-2xl px-3 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <GitBranch className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">小故Git</span>
                </TabsTrigger>
                <TabsTrigger value="assistant" className="w-full justify-start rounded-2xl px-3 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <MessageSquareText className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">问答助手</span>
                </TabsTrigger>
                <TabsTrigger value="lab" className="w-full justify-start rounded-2xl px-3 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <Sparkles className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">本体实验室</span>
                </TabsTrigger>
                <TabsTrigger value="explorer" className="w-full justify-start rounded-2xl px-3 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <Zap className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">全景图谱</span>
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 min-h-0">
                {activeTab === 'assistant' ? (
                  <AssistantSidebar
                    sessions={assistantState.sessions}
                    activeSessionId={assistantState.activeSessionId}
                    onSelectSession={assistantState.setActiveSessionId}
                    onNewSession={assistantState.onNewSession}
                    onDeleteSession={assistantState.onDeleteSession}
                    isBusy={assistantState.isBusy}
                  />
                ) : (
                  <div className="h-full rounded-3xl border border-border/60 bg-muted/20 p-6 flex flex-col items-center justify-center text-center backdrop-blur-sm shadow-sm">
                    <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                      <Sparkles className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-bold text-foreground/80 mb-1">当前模块未开启侧栏</h3>
                    <p className="text-xs text-muted-foreground">
                      该功能模块的核心操作区位于主视图中。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <TabsContent value="browse" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <BrowsePage onSelectEntity={handleSelectEntity} />
          </TabsContent>
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
              onStop={assistantState.onStop}
              selectedEntityName={selectedEntity?.name}
            />
          </TabsContent>
          <TabsContent value="lab" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <LabPage onSelectEntity={handleSelectEntity} />
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




