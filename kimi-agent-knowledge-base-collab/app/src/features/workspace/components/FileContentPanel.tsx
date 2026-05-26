import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Maximize2, Hash, ChevronRight, Folder, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface FileContentPanelProps {
  selectedFile: string;
  fileContent: unknown;
  loading?: boolean;
  onRefresh: () => void | Promise<void>;
  onNavigate?: (path: string) => void;
}

function formatContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value, null, 2);
}

export function FileContentPanel({ selectedFile, fileContent, loading = false, onRefresh, onNavigate }: FileContentPanelProps) {
  const [viewContent, setViewContent] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const breadcrumbs = useMemo(() => {
    if (!selectedFile) return [];
    const parts = selectedFile.split('/');
    return parts.map((part, index) => ({
      name: part,
      path: parts.slice(0, index + 1).join('/'),
      isLast: index === parts.length - 1
    }));
  }, [selectedFile]);

  useEffect(() => {
    if (fileContent) {
      setViewContent(formatContent(fileContent));
    } else {
      setViewContent('');
    }
  }, [fileContent]);

  return (
    <Card className="border-border/40 bg-card shadow-2xl overflow-hidden flex flex-col h-[600px] rounded-3xl">
      <CardHeader className="bg-muted/10 border-b border-border/20 flex flex-row items-center justify-between px-6 py-4 group gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 overflow-hidden">
            <span className="text-[12.5px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 shrink-0">当前内容</span>
            <div className="h-4 w-[1px] bg-border/40 mx-1 shrink-0" />
            <ScrollArea className="flex-1 min-w-0">
              <div className="flex items-center gap-1 py-1 pr-4">
                {breadcrumbs.length === 0 ? (
                    <Badge variant="outline" className="font-mono text-[12.5px] rounded-md border-border/40 px-2 bg-muted/20">未选择文件</Badge>
                  ) : (
                    breadcrumbs.map((bc, i) => (
                      <div key={bc.path} className="flex items-center gap-1 shrink-0">
                        {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/30" />}
                        <button
                          onClick={() => onNavigate?.(bc.isLast ? bc.path : bc.path + '/')}
                          className={cn(
                            "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[12.5px] font-mono transition-all",
                            bc.isLast 
                              ? "bg-primary/10 text-primary border border-primary/20 font-bold" 
                              : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent hover:border-border/40"
                          )}
                          title={bc.path}
                        >
                          {!bc.isLast && <Folder className="h-2.5 w-2.5 opacity-60" />}
                          {bc.name}
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <ScrollBar orientation="horizontal" className="h-1.5" />
              </ScrollArea>
          </div>
          <CardDescription className="text-[12px] font-medium text-muted-foreground/60 truncate">读取 XiaoGuGit 存储的最新版本</CardDescription>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" size="icon" onClick={onRefresh} disabled={loading || !selectedFile} className="rounded-full hover:bg-muted/50 h-8 w-8">
            <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', loading && 'animate-spin')} />
          </Button>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted/50 transition-all h-8 w-8">
                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[85vw] w-[85vw] h-[90vh] rounded-3xl border border-border/40 p-0 bg-background flex flex-col gap-0 overflow-hidden shadow-3xl sm:max-w-[85vw]">
              {/* White Canvas Content - Read Only */}
              <div className="flex-1 relative flex flex-col min-h-0">
                <Textarea 
                  readOnly
                  value={viewContent}
                  className="flex-1 w-full border-none focus:ring-0 focus:outline-none bg-transparent font-mono text-base p-6 md:p-10 lg:px-16 lg:py-12 resize-none leading-relaxed text-zinc-900 dark:text-zinc-100 selection:bg-primary/20"
                  placeholder="无内容"
                />
                
                {/* Floating Indicator Only */}
                <div className="absolute top-10 right-10 flex flex-col gap-4 pointer-events-none">
                  <div className="px-4 py-1.5 bg-zinc-100 dark:bg-zinc-900 rounded-full border border-border/40 backdrop-blur-md opacity-40">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      View Mode Only
                    </p>
                  </div>
                </div>

                <div className="absolute bottom-10 left-20 right-20 flex items-center justify-center pointer-events-auto">
                  <div className="flex items-center gap-10 text-[10px] text-zinc-400 font-black uppercase tracking-[0.3em] whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Hash className="w-3 h-3 text-zinc-500" />
                      总字符量: {viewContent.length}
                    </div>
                    <div className="h-4 w-[1px] bg-border/20" />
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]" />
                      全屏查看模式 (Immersive View)
                    </div>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="flex-1 px-6 pt-1 pb-6 bg-muted/5 dark:bg-zinc-950/10 overflow-hidden border-t border-border/10">
        <div className="h-full w-full rounded-2xl border border-border/40 bg-muted/10 dark:bg-zinc-950/40 overflow-hidden">
          <ScrollArea className="h-full w-full">
            {loading ? (
              <div className="flex h-full min-h-[220px] items-center justify-center gap-3 p-6 text-[12px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载当前项目内容
              </div>
            ) : (
              <pre className="p-6 text-[13px] text-foreground/80 dark:text-primary/70 font-mono leading-relaxed selection:bg-primary/20">
                {fileContent ? formatContent(fileContent) : '// 选择文件以查看内容'}
              </pre>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
