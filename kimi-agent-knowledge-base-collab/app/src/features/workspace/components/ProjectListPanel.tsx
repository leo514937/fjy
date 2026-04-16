import type { Dispatch, SetStateAction } from 'react';
import { CheckCircle2, GitBranch, Plus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { XgProject } from '@/features/workspace/api';

interface ProjectListPanelProps {
  projects: XgProject[];
  selectedProjectId: string;
  loading: boolean;
  newProjectId: string;
  setNewProjectId: Dispatch<SetStateAction<string>>;
  newProjectName: string;
  setNewProjectName: Dispatch<SetStateAction<string>>;
  isNewProjectOpen: boolean;
  setIsNewProjectOpen: Dispatch<SetStateAction<boolean>>;
  onSelectProject: (projectId: string) => void;
  onRefresh: () => void | Promise<void>;
  onInitProject: () => void | Promise<void>;
}

export function ProjectListPanel(props: ProjectListPanelProps) {
  const {
    projects,
    selectedProjectId,
    loading,
    newProjectId,
    setNewProjectId,
    newProjectName,
    setNewProjectName,
    isNewProjectOpen,
    setIsNewProjectOpen,
    onSelectProject,
    onRefresh,
    onInitProject,
  } = props;

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-lg overflow-hidden">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 border-b border-border/20">
        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 text-muted-foreground/80">
          <GitBranch className="h-4 w-4 text-primary/70" />
          所有项目
        </CardTitle>
        <Dialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-primary/10">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-3xl border-border/40 bg-card/95 backdrop-blur-xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-black">新建本体项目</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                创建一个新的 Git 存储库用于管理本体版本。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-muted-foreground/60">项目 ID (唯一标识)</label>
                <Input placeholder="my-new-project" className="rounded-xl border-border/40 bg-muted/20" value={newProjectId} onChange={(event) => setNewProjectId(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-muted-foreground/60">项目名称 (显示名)</label>
                <Input placeholder="智能引擎本体项目" className="rounded-xl border-border/40 bg-muted/20" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={onInitProject} disabled={!newProjectId} className="rounded-full px-6 font-bold">初始化项目</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-3">
        <ScrollArea className="h-48 mb-4">
          <div className="space-y-1.5 pr-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-[13px] rounded-xl transition-all font-black uppercase tracking-tight ${
                  selectedProjectId === project.id 
                    ? 'bg-zinc-200 dark:bg-primary text-zinc-900 dark:text-primary-foreground shadow-sm ring-1 ring-zinc-300 dark:ring-primary-foreground/20' 
                    : 'text-muted-foreground hover:bg-zinc-100 dark:hover:bg-primary/5 hover:text-foreground'
                }`}
              >
                <span>{project.name || project.id}</span>
                {selectedProjectId === project.id && <CheckCircle2 className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </ScrollArea>
        <Button variant="outline" size="sm" className="w-full gap-2 rounded-xl border-border/20 hover:bg-muted/50 font-bold" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新列表
        </Button>
      </CardContent>
    </Card>
  );
}
