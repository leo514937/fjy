import { useState, useEffect } from 'react';
import { RefreshCw, Maximize2, Hash } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface FileContentPanelProps {
  selectedFile: string;
  fileContent: unknown;
  onRefresh: () => void | Promise<void>;
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

export function FileContentPanel({ selectedFile, fileContent, onRefresh }: FileContentPanelProps) {
  const [viewContent, setViewContent] = useState('');
  const [isOpen, setIsOpen] = useState(false);

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
          <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-3 text-muted-foreground/80">
            <span className="shrink-0">当前内容</span>
            <Badge variant="outline" className="font-mono text-[10px] rounded-md border-border/40 px-2 bg-muted/20 truncate max-w-[400px] block" title={selectedFile || ''}>
              {selectedFile || '未选择文件'}
            </Badge>
          </CardTitle>
          <CardDescription className="text-[11px] font-medium text-muted-foreground/60 mt-1">读取 XiaoGuGit 存储的最新版本</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={onRefresh} className="rounded-full hover:bg-muted/50">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </Button>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted/50 transition-all">
                <Maximize2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-full w-screen h-screen m-0 rounded-none border-none p-0 bg-background flex flex-col gap-0 overflow-hidden outline-none">
              {/* White Canvas Content - Read Only */}
              <div className="flex-1 relative">
                <Textarea 
                  readOnly
                  value={viewContent}
                  className="w-full h-full border-none focus:ring-0 focus:outline-none bg-transparent font-mono text-lg p-20 resize-none leading-relaxed text-zinc-900 dark:text-zinc-100 selection:bg-primary/20"
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
      <CardContent className="flex-1 p-6 bg-muted/5 dark:bg-zinc-950/10 overflow-hidden border-t border-border/10">
        <div className="h-full w-full rounded-2xl border border-border/40 bg-muted/10 dark:bg-zinc-950/40 overflow-hidden">
          <ScrollArea className="h-full w-full">
            <pre className="p-6 text-[13px] text-foreground/80 dark:text-primary/70 font-mono leading-relaxed selection:bg-primary/20">
              {fileContent ? formatContent(fileContent) : '// 选择文件以查看内容'}
            </pre>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
