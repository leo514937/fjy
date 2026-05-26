import { lazy, Suspense, useEffect, useEffectEvent, useState } from 'react';
import {
  BookOpen,
  Blocks,
  ChevronDown,
  GitBranch,
  Plus,
  Menu,
  MessageSquareText,
  Network,
  Loader2,
  Sparkles,
  Sun,
  Moon,
  RefreshCcw,
  Zap,
  Layers,
  Atom,
  Link2,
  TreePine,
  FileUp,
} from 'lucide-react';

import { Separator } from '@/components/ui/separator';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sidebar as AssistantSidebar } from '@/components/assistant/Sidebar';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useOntologyAssistantState } from '@/hooks/useOntologyAssistantState';
import { OntologyProvider } from '@/features/ontology/context';
import { LAYER_FILTERS } from '@/features/ontology/layerFilters';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import { EnterGateIntro } from '@/components/EnterGateIntro';
import { SearchPanel } from '@/components/SearchPanel';
import { NewProjectDialog } from '@/features/workspace/components/NewProjectDialog';
import { fetchXgProjects, initXgProject, type XgProject } from '@/features/workspace/api';
import { getStoredSelectedProjectId, setStoredSelectedProjectId, subscribeSelectedProjectIdChange } from '@/features/workspace/selectedProject';
import { subscribeRepositorySync } from '@/shared/events/repositorySync';
import type { Entity } from '@/types/ontology';
import { toast } from 'sonner';

const loadAssistantPage = () => import('@/app/pages/AssistantPage').then((module) => ({ default: module.AssistantPage }));
const loadExplorerPage = () => import('@/app/pages/ExplorerPage').then((module) => ({ default: module.ExplorerPage }));
const loadFileWorkflowPage = () => import('@/app/pages/FileWorkflowPage').then((module) => ({ default: module.FileWorkflowPage }));
const loadFileWorkflowV2Page = () => import('@/app/pages/FileWorkflowV2Page').then((module) => ({ default: module.FileWorkflowV2Page }));
const loadLabPage = () => import('@/app/pages/LabPage').then((module) => ({ default: module.LabPage }));
const loadWorkspacePage = () => import('@/app/pages/WorkspacePage').then((module) => ({ default: module.WorkspacePage }));

const AssistantPage = lazy(loadAssistantPage);
const ExplorerPage = lazy(loadExplorerPage);
const FileWorkflowPage = lazy(loadFileWorkflowPage);
const FileWorkflowV2Page = lazy(loadFileWorkflowV2Page);
const LabPage = lazy(loadLabPage);
const WorkspacePage = lazy(loadWorkspacePage);

function PageLoader({ label }: { label: string }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function formatRefreshTime(value: string | null): string {
  if (!value) {
    return '最后刷新：暂无';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '最后刷新：暂无';
  }

  return `最后刷新：${new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)}`;
}

function formatProjectLabel(fallbackProjectId: string): string {
  if (fallbackProjectId.trim()) {
    return fallbackProjectId.trim();
  }
  return 'demo';
}

type OntologyTabKey = 'assistant' | 'lab' | 'explorer';

function prefetchOntologyTab(tab: OntologyTabKey) {
  switch (tab) {
    case 'assistant':
      void loadAssistantPage();
      break;
    case 'lab':
      void loadLabPage();
      break;
    case 'explorer':
      void loadExplorerPage();
      break;
    default:
      break;
  }
}

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

interface AppShellContentProps {
  activeTab: string;
  setActiveTab: (value: string) => void;
}

function AppShellContent({ activeTab, setActiveTab }: AppShellContentProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceProjects, setWorkspaceProjects] = useState<XgProject[]>([]);
  const [workspaceProjectsLoading, setWorkspaceProjectsLoading] = useState(false);
  const [selectedWorkspaceProjectId, setSelectedWorkspaceProjectId] = useState<string>(() => getStoredSelectedProjectId());
  const [newProjectId, setNewProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

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
    refreshing,
    lastRefreshAt,
    error,
    filteredEntities,
    filteredCrossReferences,
    selectedEntity,
    selectedLayer,
    setSelectedLayer,
    selectEntity,
    searchInLayer,
    refreshKnowledgeGraph,
  } = useOntologyContext();
  const assistantState = useOntologyAssistantState(selectedEntity);
  const shouldLoadOntologyData = activeTab === 'lab' || activeTab === 'explorer';

  useEffect(() => subscribeSelectedProjectIdChange((projectId) => {
    setSelectedWorkspaceProjectId(projectId);
  }), []);

  useEffect(() => {
    const selectedProject = workspaceProjects.find((project) => project.id === selectedWorkspaceProjectId);
    if (!selectedProject && workspaceProjects.length > 0) {
      setSelectedWorkspaceProjectId(workspaceProjects[0].id);
    }
  }, [selectedWorkspaceProjectId, workspaceProjects]);

  const loadWorkspaceProjects = useEffectEvent(async () => {
    setWorkspaceProjectsLoading(true);
    try {
      const data = await fetchXgProjects();
      setWorkspaceProjects(data);
    } catch {
      setWorkspaceProjects([]);
    } finally {
      setWorkspaceProjectsLoading(false);
    }
  });

  useEffect(() => subscribeRepositorySync(() => {
    void loadWorkspaceProjects();
  }), []);

  const handleSelectEntity = (entity: Entity) => {
    selectEntity(entity);
    setSidebarOpen(false);
    setActiveTab('explorer');
  };

  const handleWorkspaceProjectChange = (projectId: string) => {
    const nextProjectId = projectId.trim();
    if (!nextProjectId || nextProjectId === selectedWorkspaceProjectId) {
      return;
    }
    setSelectedWorkspaceProjectId(nextProjectId);
    setStoredSelectedProjectId(nextProjectId);
  };

  const handleGlobalInitProject = async () => {
    const nextProjectId = newProjectId.trim();
    if (!nextProjectId) {
      return;
    }

    try {
      await initXgProject({
        project_id: nextProjectId,
        name: newProjectName.trim() || nextProjectId,
      });
      toast.success('项目初始化完成');
      setSelectedWorkspaceProjectId(nextProjectId);
      setStoredSelectedProjectId(nextProjectId);
      setIsNewProjectOpen(false);
      setNewProjectId('');
      setNewProjectName('');
      await loadWorkspaceProjects();
    } catch (error) {
      toast.error('初始化失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
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
  const showLoadingBadge = loading && !filteredEntities?.length;
  const statusBadge = showLoadingBadge
    ? '图谱加载中'
    : refreshing
      ? '图谱刷新中'
      : error
        ? '数据更新失败'
        : null;
  const refreshTimeLabel = formatRefreshTime(lastRefreshAt);
  const handleGlobalRefresh = () => {
    if (!shouldLoadOntologyData) {
      return;
    }
    void refreshKnowledgeGraph({ silent: true, forceRefresh: true });
  };

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
            <DropdownMenu onOpenChange={(open) => {
              if (open && !workspaceProjectsLoading) {
                void loadWorkspaceProjects();
              }
            }}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="hidden h-9 min-w-[180px] justify-between rounded-xl border-border/40 bg-background/70 px-3 text-left text-[10px] font-bold text-foreground/80 sm:inline-flex"
                  title="切换工作区项目"
                >
                  <span className="min-w-0 truncate">
                    {formatProjectLabel(selectedWorkspaceProjectId)}
                  </span>
                  <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 rounded-2xl border-border/40 p-2">
                <DropdownMenuLabel className="px-2 pb-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground/60">
                  工作区项目
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="max-h-80 space-y-1 overflow-y-auto pt-2">
                  {workspaceProjectsLoading && workspaceProjects.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">正在加载项目列表...</div>
                  ) : workspaceProjects.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">暂无可切换项目</div>
                  ) : workspaceProjects.map((project) => {
                    const active = project.id === selectedWorkspaceProjectId;
                    return (
                      <DropdownMenuItem
                        key={project.id}
                        className={cn(
                          'cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-all',
                          active
                            ? 'border-primary/25 bg-primary/10 text-primary'
                            : 'border-border/40 bg-background/70 hover:bg-muted/60',
                        )}
                        onSelect={() => handleWorkspaceProjectChange(project.id)}
                      >
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <div className="min-w-0 truncate text-sm font-bold">{project.id}</div>
                          {active && (
                            <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 px-2 py-0 text-[10px] font-black text-primary">
                              当前
                            </Badge>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {statusBadge && (
              <Badge
                variant={error ? 'destructive' : 'outline'}
                className={cn(
                  "hidden h-9 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest sm:inline-flex",
                  !error && "border-primary/20 bg-primary/5 text-primary",
                )}
              >
                {showLoadingBadge || refreshing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {statusBadge}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn(
                "hidden h-9 rounded-xl border-border/40 bg-background/70 px-3 text-[10px] font-bold text-muted-foreground sm:inline-flex",
                refreshing && "border-primary/20 text-primary",
              )}
            >
              {refreshing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {refreshTimeLabel}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleGlobalRefresh}
              disabled={!shouldLoadOntologyData || loading || refreshing}
              className="h-9 w-9 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all ml-1 relative overflow-hidden"
              title="刷新图谱与概念速览"
            >
              {refreshing ? <Loader2 className="h-[1.05rem] w-[1.05rem] animate-spin" /> : <RefreshCcw className="h-[1.05rem] w-[1.05rem]" />}
            </Button>
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
            <NewProjectDialog
              open={isNewProjectOpen}
              onOpenChange={setIsNewProjectOpen}
              newProjectId={newProjectId}
              onProjectIdChange={setNewProjectId}
              newProjectName={newProjectName}
              onProjectNameChange={setNewProjectName}
              onSubmit={handleGlobalInitProject}
              trigger={(
                <Button
                  size="sm"
                  className="h-9 rounded-xl px-4 font-black tracking-wide shadow-sm"
                  title="新建项目"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  新建项目
                </Button>
              )}
            />

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
                <TabsTrigger
                  value="lab"
                  className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all"
                  onMouseEnter={() => prefetchOntologyTab('lab')}
                  onFocus={() => prefetchOntologyTab('lab')}
                >
                  <BookOpen className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">本体库</span>
                </TabsTrigger>
                <TabsTrigger
                  value="assistant"
                  className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all"
                  onMouseEnter={() => prefetchOntologyTab('assistant')}
                  onFocus={() => prefetchOntologyTab('assistant')}
                >
                  <MessageSquareText className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">问答助手</span>
                </TabsTrigger>
                <TabsTrigger
                  value="explorer"
                  className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all"
                  onMouseEnter={() => prefetchOntologyTab('explorer')}
                  onFocus={() => prefetchOntologyTab('explorer')}
                >
                  <Zap className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">本体图谱</span>
                </TabsTrigger>
                <TabsTrigger value="file-workflow" className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <FileUp className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">文件工作流</span>
                </TabsTrigger>
                <TabsTrigger value="file-workflow-v2" className="w-full justify-start rounded-2xl px-3 py-4 data-[state=active]:bg-background data-[state=active]:shadow-md transition-all">
                  <Blocks className="mr-3 h-5 w-5 text-primary" />
                  <span className="font-black text-sm uppercase tracking-tight">文件工作流 V2</span>
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
            <Suspense fallback={<PageLoader label="正在加载问答助手..." />}>
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
            </Suspense>
          </TabsContent>
          <TabsContent value="lab" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <Suspense fallback={<PageLoader label="正在加载本体实验室..." />}>
              <LabPage onSelectEntity={(e) => selectEntity(e)} />
            </Suspense>
          </TabsContent>
          <TabsContent value="explorer" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <Suspense fallback={<PageLoader label="正在加载本体图谱..." />}>
              <ExplorerPage onSelectEntity={handleSelectEntity} isActive={activeTab === 'explorer'} />
            </Suspense>
          </TabsContent>
          <TabsContent value="workspace" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <Suspense fallback={<PageLoader label="正在加载工作台..." />}>
              <WorkspacePage />
            </Suspense>
          </TabsContent>
          <TabsContent value="file-workflow" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <Suspense fallback={<PageLoader label="正在加载文件工作流..." />}>
              <FileWorkflowPage />
            </Suspense>
          </TabsContent>
          <TabsContent value="file-workflow-v2" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-300">
            <Suspense fallback={<PageLoader label="正在加载文件工作流 V2..." />}>
              <FileWorkflowV2Page />
            </Suspense>
          </TabsContent>
        </Tabs>
      </main>

      <Toaster />
    </div>
  );
}

export function AppShell() {
  const [activeTab, setActiveTab] = useState('assistant');
  const shouldLoadOntologyData = activeTab === 'lab' || activeTab === 'explorer';

  return (
    <OntologyProvider enabled={shouldLoadOntologyData}>
      <AppShellContent activeTab={activeTab} setActiveTab={setActiveTab} />
    </OntologyProvider>
  );
}
