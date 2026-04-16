import { useState } from 'react';
import { ArrowLeftRight, History, ShieldCheck, Maximize2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { XgTimeline } from '@/features/workspace/api';

interface TimelinePanelProps {
  selectedFile: string;
  timelines: XgTimeline[];
  onViewDiff: (commitId: string) => void | Promise<void>;
  onSetOfficial: (commitId: string) => void | Promise<void>;
  onRollback: (commitId: string) => void | Promise<void>;
}

export function TimelinePanel({ selectedFile, timelines, onViewDiff, onSetOfficial, onRollback }: TimelinePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const commits = timelines.find((timeline) => timeline.filename === selectedFile)?.commits ?? [];

  const TimelineList = ({ isFull = false }: { isFull?: boolean }) => (
    <div className={cn("p-6 space-y-2", isFull && "max-w-4xl mx-auto p-20")}>
      {selectedFile ? commits.map((commit, index) => (
        <div key={commit.id} className="relative pl-8 pb-8 group">
          {index !== commits.length - 1 && <div className="absolute left-[11px] top-3 bottom-0 w-[1px] bg-border/20" />}
          <div className="absolute left-0 top-1.5 h-6 w-6 rounded-full border border-border/40 bg-muted flex items-center justify-center group-hover:border-primary/50 group-hover:bg-primary/10 transition-all shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 group-hover:bg-primary transition-colors" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={cn("font-mono font-black text-primary/80 uppercase tracking-tighter", isFull ? "text-sm" : "text-[11px]")}>{commit.id.slice(0, 7)}</span>
                {index === 0 && <Badge variant="secondary" className="text-[8px] font-black uppercase px-2 py-0 h-4 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Current</Badge>}
              </div>
              <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/40">{new Date(commit.timestamp).toLocaleString()}</span>
            </div>
            <p className={cn("leading-relaxed font-bold text-foreground/90", isFull ? "text-lg py-2" : "text-[13px]")}>{commit.message}</p>
            <div className="flex items-center gap-4 mt-1.5">
              <Badge variant="outline" className="text-[9px] px-1.5 font-black uppercase tracking-widest bg-muted/20 border-border/20">{commit.author}</Badge>
              <div className={cn("flex items-center gap-6 transition-all", isFull ? "opacity-100 mt-2" : "opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0")}>
                <button onClick={() => onViewDiff(commit.id)} className="text-[10px] font-black uppercase tracking-widest text-emerald-500/70 hover:text-emerald-500 flex items-center gap-1.5 transition-all">
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Diff
                </button>
                <button onClick={() => onSetOfficial(commit.id)} className="text-[10px] font-black uppercase tracking-widest text-amber-500/70 hover:text-amber-500 flex items-center gap-1.5 transition-all">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Official
                </button>
                <button 
                  onClick={() => onRollback(commit.id)} 
                  disabled={index === 0}
                  title={index === 0 ? "当前已是此版本，无需回滚" : "回滚到该版本"}
                  className="text-[10px] font-black uppercase tracking-widest text-primary/70 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all"
                >
                  Rollback
                </button>
              </div>
            </div>
          </div>
        </div>
      )) : <div className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 py-20 flex flex-col items-center gap-4">
             <div className="w-12 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
             Select a file to view history
             <div className="w-12 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
           </div>}
    </div>
  );

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-lg h-80 flex flex-col rounded-3xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/20 bg-muted/10 px-6 py-4 flex flex-row items-center justify-between group">
        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 text-muted-foreground/80">
          <History className="h-4 w-4 text-purple-500/70" />
          版本时间线 (Git Commits)
        </CardTitle>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md hover:bg-purple-500/10 text-muted-foreground hover:text-purple-500 transition-all opacity-0 group-hover:opacity-100">
              <Maximize2 className="h-3 w-3" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-full w-screen h-screen flex flex-col rounded-none border-none bg-white dark:bg-zinc-950 p-0 gap-0 overflow-hidden shadow-none transition-colors duration-300">
            <div className="flex-1 min-h-0 relative">
              <ScrollArea className="h-full w-full">
                <TimelineList isFull />
              </ScrollArea>
              
              {/* Floating Top Indicator */}
              <div className="absolute top-10 left-20 flex items-center gap-2 pointer-events-none">
                <div className="px-4 py-1.5 rounded-full border border-purple-100 bg-purple-50 dark:bg-zinc-900 dark:border-zinc-800 shadow-sm transition-all">
                  <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400">
                    全屏历史溯源模式 (Timeline Explorer)
                  </p>
                </div>
              </div>
            </div>

            <div className="px-12 py-6 border-t border-border/20 bg-muted/5 flex items-center justify-center shrink-0">
              <div className="flex items-center gap-10 text-[10px] text-zinc-400 font-black uppercase tracking-[0.3em] whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <History className="w-3 h-3 text-purple-500" />
                  溯源深度: {commits.length} 个提交版本
                </div>
                <div className="h-4 w-[1px] bg-border/20" />
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.3)] animate-pulse" />
                  实时版本同步中
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-hidden bg-muted/10 dark:bg-zinc-950/20 border-t border-border/10">
        <ScrollArea className="h-full">
          <TimelineList />
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
