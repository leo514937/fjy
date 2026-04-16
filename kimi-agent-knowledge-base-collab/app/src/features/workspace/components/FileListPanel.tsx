import { FileJson, History } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { XgTimeline } from '@/features/workspace/api';

interface FileListPanelProps {
  timelines: XgTimeline[];
  selectedFile: string;
  onSelectFile: (filename: string) => void;
}

export function FileListPanel({ timelines, selectedFile, onSelectFile }: FileListPanelProps) {
  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-lg overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/20">
        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 text-muted-foreground/80">
          <History className="h-4 w-4 text-purple-500/70" />
          文件列表
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <ScrollArea className="h-64">
          <div className="space-y-1.5 pr-2">
            {timelines.map((timeline) => (
              <button
                key={timeline.filename}
                onClick={() => onSelectFile(timeline.filename)}
                className={`w-full flex flex-col items-start px-4 py-3 text-sm rounded-xl transition-all font-black uppercase tracking-tight ${
                  selectedFile === timeline.filename 
                    ? 'bg-zinc-200 dark:bg-primary text-zinc-900 dark:text-primary-foreground shadow-md' 
                    : 'text-muted-foreground hover:bg-zinc-100 dark:hover:bg-primary/5 hover:text-foreground border border-transparent hover:border-border/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4" />
                  <span className="tracking-tight">{timeline.filename}</span>
                </div>
                <span className={`text-[9px] uppercase font-black tracking-widest mt-1.5 ${selectedFile === timeline.filename ? 'text-zinc-500 dark:text-primary-foreground/60' : 'text-muted-foreground/50'}`}>
                  {timeline.commits.length} Versions
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
