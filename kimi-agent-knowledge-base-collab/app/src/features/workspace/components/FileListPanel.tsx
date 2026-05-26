import { FileJson, History, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRef, useState, useMemo } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { XgTimeline } from '@/features/workspace/api';

interface FileListPanelProps {
  timelines: XgTimeline[];
  selectedFile: string;
  loading?: boolean;
  onSelectFile: (filename: string) => void;
  className?: string;
  fileSearch: string;
  onSearchChange: (value: string) => void;
}

export function FileListPanel({ 
  timelines, 
  selectedFile, 
  loading = false,
  onSelectFile, 
  className,
  fileSearch,
  onSearchChange
}: FileListPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const filteredTimelines = useMemo(() => {
    if (!fileSearch) return timelines;
    const keywords = fileSearch.toLowerCase().split(/\s+/).filter(k => k.length > 0);
    if (keywords.length === 0) return timelines;
    
    return timelines.filter(t => {
      const filename = t.filename.toLowerCase();
      return keywords.every(k => filename.includes(k));
    });
  }, [timelines, fileSearch]);

  const highlightText = (text: string, search: string) => {
    if (!search) return text;
    const keywords = search.split(/\s+/).filter(k => k.length > 0);
    if (keywords.length === 0) return text;

    const pattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(pattern);

    return (
      <>
        {parts.map((part, i) => 
          pattern.test(part) ? (
            <span key={i} className="bg-primary/20 text-primary rounded-sm px-0.5 font-black">
              {part}
            </span>
          ) : (
            part
          )
        )}
      </>
    );
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const container = scrollRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
    if (!container) return;

    setIsDragging(true);
    setStartX(e.pageX - (container as HTMLElement).offsetLeft);
    setScrollLeft((container as HTMLElement).scrollLeft);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    
    const container = scrollRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
    if (!container) return;

    const x = e.pageX - (container as HTMLElement).offsetLeft;
    const walkX = (x - startX) * 2;
    (container as HTMLElement).scrollLeft = scrollLeft - walkX;
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  return (
    <Card className={cn("border-border/40 bg-card/60 backdrop-blur-md shadow-lg overflow-hidden flex flex-col", className)}>
      <CardHeader className="pb-3 border-b border-border/20 shrink-0 space-y-3">
        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 text-muted-foreground/80">
          <History className="h-4 w-4 text-purple-500/70" />
          文件列表
        </CardTitle>
        
        <div className="relative group">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 group-focus-within:text-primary/60 transition-colors" />
          <Input 
            value={fileSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索文件或路径..."
            className="h-8 pl-8 pr-8 text-[11px] font-bold bg-muted/20 border-border/20 rounded-lg focus-visible:ring-1 focus-visible:ring-primary/30"
          />
          {fileSearch && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSearchChange('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 hover:bg-transparent text-muted-foreground/40 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 pt-1 pb-3 flex-1 flex flex-col min-h-0">
        <ScrollArea 
          ref={scrollRef}
          className={cn("flex-1 min-h-0 w-full", isDragging ? "cursor-grabbing" : "cursor-default")} 
          type="auto"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <div className="space-y-1.5 pr-2 pb-4 min-w-full w-max select-none">
            {loading ? (
              <div className="py-10 px-4 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">正在切换项目...</p>
              </div>
            ) : filteredTimelines.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">无匹配文件</p>
              </div>
            ) : (
              filteredTimelines.map((timeline) => (
                <button
                  key={timeline.filename}
                  onClick={() => {
                    const container = scrollRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
                    const currentScrollLeft = container ? (container as HTMLElement).scrollLeft : 0;
                    
                    if (Math.abs(currentScrollLeft - scrollLeft) > 5) {
                      return;
                    }
                    onSelectFile(timeline.filename);
                  }}
                  className={`w-full flex flex-col items-start px-3 py-2.5 text-xs rounded-xl transition-all font-bold uppercase tracking-tight ${
                    selectedFile === timeline.filename 
                      ? 'bg-zinc-200 dark:bg-primary text-zinc-900 dark:text-primary-foreground shadow-md' 
                      : 'text-muted-foreground hover:bg-zinc-100 dark:hover:bg-primary/5 hover:text-foreground border border-transparent hover:border-border/40'
                  }`}
                >
                <div className="flex items-center gap-2 w-full pointer-events-none">
                  <FileJson className="h-4 w-4 shrink-0" />
                  <span className="tracking-tight whitespace-nowrap text-left" title={timeline.filename}>
                    {highlightText(timeline.filename, fileSearch)}
                  </span>
                </div>
                              <span className={`text-[9px] uppercase font-black tracking-widest mt-1.5 pointer-events-none ${selectedFile === timeline.filename ? 'text-zinc-500 dark:text-primary-foreground/60' : 'text-muted-foreground/50'}`}>
                                {timeline.commits.length} Versions
                              </span>
                </button>
              ))
            )}
          </div>
          <ScrollBar orientation="horizontal" className="h-2" />
          <ScrollBar orientation="vertical" className="w-2" />
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
