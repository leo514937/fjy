import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  newProjectId: string;
  onProjectIdChange: Dispatch<SetStateAction<string>>;
  newProjectName: string;
  onProjectNameChange: Dispatch<SetStateAction<string>>;
  onSubmit: () => void | Promise<void>;
  trigger?: ReactNode;
}

export function NewProjectDialog({
  open,
  onOpenChange,
  newProjectId,
  onProjectIdChange,
  newProjectName,
  onProjectNameChange,
  onSubmit,
  trigger,
}: NewProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
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
            <Input
              placeholder="my-new-project"
              className="rounded-xl border-border/40 bg-muted/20"
              value={newProjectId}
              onChange={(event) => onProjectIdChange(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-muted-foreground/60">项目名称 (显示名)</label>
            <Input
              placeholder="智能引擎本体项目"
              className="rounded-xl border-border/40 bg-muted/20"
              value={newProjectName}
              onChange={(event) => onProjectNameChange(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={!newProjectId} className="rounded-full px-6 font-bold">
            初始化项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
