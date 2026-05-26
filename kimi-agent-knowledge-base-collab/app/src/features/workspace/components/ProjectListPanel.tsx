import { useState } from 'react';
import { CheckCircle2, GitBranch, Loader2, PencilLine, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { XgProject } from '@/features/workspace/api';

interface ProjectListPanelProps {
  projects: XgProject[];
  selectedProjectId: string;
  loading: boolean;
  switchingProjectId?: string;
  newProjectId: string;
  newProjectName: string;
  isNewProjectOpen: boolean;
  onSelectProject: (projectId: string) => void;
  onRefresh: () => void | Promise<void>;
  onDeleteProject: (projectId: string) => void | Promise<void>;
  onRenameProject: (projectId: string, name: string) => boolean | Promise<boolean>;
  className?: string;
}

export function ProjectListPanel(props: ProjectListPanelProps) {
  const {
    projects,
    selectedProjectId,
    loading,
    switchingProjectId,
    newProjectId,
    newProjectName,
    isNewProjectOpen,
    onSelectProject,
    onRefresh,
    onDeleteProject,
    onRenameProject,
    className,
  } = props;

  const [renamingProject, setRenamingProject] = useState<XgProject | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  const openRenameDialog = (project: XgProject) => {
    setRenamingProject(project);
    setRenameValue(project.name || project.id);
  };

  const closeRenameDialog = () => {
    setRenamingProject(null);
    setRenameValue('');
  };

  const handleConfirmRename = async () => {
    if (!renamingProject) {
      return;
    }

    const nextName = renameValue.trim();
    if (!nextName) {
      return;
    }

    setRenameSaving(true);
    try {
      const saved = await onRenameProject(renamingProject.id, nextName);
      if (saved) {
        closeRenameDialog();
      }
    } finally {
      setRenameSaving(false);
    }
  };

  return (
    <Card className={cn("border-border/40 bg-card/60 backdrop-blur-md shadow-lg overflow-hidden flex flex-col", className)}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 border-b border-border/20">
        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 text-muted-foreground/80">
          <GitBranch className="h-4 w-4 text-primary/70" />
          所有项目
        </CardTitle>
        <Dialog
          open={Boolean(renamingProject)}
          onOpenChange={(open) => {
            if (!open) {
              closeRenameDialog();
            }
          }}
        >
          <DialogContent className="rounded-3xl border-border/40 bg-card/95 backdrop-blur-xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-black">更改项目名称</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                只修改项目显示名称，不会改变项目 ID 或文件夹路径。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <label className="text-xs font-black uppercase tracking-widest text-muted-foreground/60">项目名称</label>
              <Input
                className="rounded-xl border-border/40 bg-muted/20"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleConfirmRename();
                  }
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-full px-6 font-bold"
                onClick={closeRenameDialog}
              >
                取消
              </Button>
              <Button
                onClick={() => void handleConfirmRename()}
                disabled={renameSaving || !renameValue.trim()}
                className="rounded-full px-6 font-bold"
              >
                {renameSaving ? '保存中...' : '保存名称'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-3 flex-1 flex flex-col min-h-0">
        {!isNewProjectOpen && !newProjectId && !newProjectName ? (
          <p className="mb-3 px-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
            界面右上角可直接新建项目
          </p>
        ) : null}
        <ScrollArea className="flex-1 min-h-0 mb-4">
          <div className="space-y-1.5 pr-2">
            {loading && projects.length === 0 ? (
              <div className="space-y-2 py-1">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center justify-between gap-3 rounded-xl border border-border/20 bg-muted/10 px-4 py-3">
                    <Skeleton className="h-4 flex-1 rounded-lg" />
                    <Skeleton className="h-4 w-4 rounded-full" />
                  </div>
                ))}
                <p className="px-2 pt-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                  正在加载项目列表...
                </p>
              </div>
            ) : projects.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">暂无项目</p>
              </div>
            ) : projects.map((project) => (
              <div
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectProject(project.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    onSelectProject(project.id);
                  }
                }}
                className={`group w-full flex items-center justify-between gap-2 px-4 py-3 text-[13px] rounded-xl transition-all font-black uppercase tracking-tight cursor-pointer outline-none ${
                  selectedProjectId === project.id
                    ? 'bg-zinc-200 dark:bg-primary text-zinc-900 dark:text-primary-foreground shadow-sm ring-1 ring-zinc-300 dark:ring-primary-foreground/20'
                    : 'text-muted-foreground hover:bg-zinc-100 dark:hover:bg-primary/5 hover:text-foreground focus-visible:bg-muted/10'
                }`}
              >
                <span className="min-w-0 truncate">{project.id}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {switchingProjectId === project.id && <Loader2 className="h-4 w-4 animate-spin" />}
                  {selectedProjectId === project.id && <CheckCircle2 className="h-4 w-4" />}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-full text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-colors"
                        title="项目设置"
                        aria-label={`项目设置：${project.id}`}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-44 rounded-lg border-border/40"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <DropdownMenuLabel className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/60">
                        项目设置
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 text-xs font-bold"
                        onSelect={() => openRenameDialog(project)}
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                        更改名称
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="cursor-pointer gap-2 text-xs font-bold"
                        onSelect={() => {
                          void onDeleteProject(project.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除项目
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
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
