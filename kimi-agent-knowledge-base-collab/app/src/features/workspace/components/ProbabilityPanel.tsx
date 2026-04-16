import { useState, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Network, RefreshCw, Sparkles, Maximize2, Check, Hash } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ProbabilityResult } from '@/features/workspace/api';

interface ProbabilityPanelProps {
  probInput: string;
  setProbInput: Dispatch<SetStateAction<string>>;
  probResult: ProbabilityResult | null;
  analyzing: boolean;
  onAnalyze: () => void | Promise<void>;
}

export function ProbabilityPanel({ probInput, setProbInput, probResult, analyzing, onAnalyze }: ProbabilityPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const isInvalid = useMemo(() => {
    if (!probInput) return false;
    try {
      JSON.parse(probInput);
      return false;
    } catch (e) {
      return true;
    }
  }, [probInput]);

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-lg h-80 flex flex-col rounded-3xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/20 bg-muted/10 px-6 py-4 flex flex-row items-center justify-between group">
        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 text-muted-foreground/80">
          <Sparkles className="h-4 w-4 text-amber-500/70" />
          API 概率推理实验室 (Reasoner)
        </CardTitle>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md hover:bg-amber-500/10 text-muted-foreground hover:text-amber-500 transition-all opacity-0 group-hover:opacity-100">
              <Maximize2 className="h-3 w-3" />
            </Button>
          </DialogTrigger>
          <DialogContent className={cn(
            "max-w-full w-screen h-screen flex flex-col rounded-none border-none p-0 gap-0 overflow-hidden shadow-none transition-colors duration-300",
            isInvalid ? "bg-[#FFF5F5] dark:bg-[#2D1616]" : "bg-white dark:bg-zinc-950"
          )}>
            <div className="flex-1 min-h-0 relative">
              <Textarea 
                value={probInput} 
                onChange={(event) => setProbInput(event.target.value)} 
                className={cn(
                  "w-full h-full font-mono text-lg resize-none border-none focus:ring-0 focus:outline-none leading-relaxed p-12 pr-12 rounded-none transition-all",
                  isInvalid ? "bg-[#FFF5F5] dark:bg-[#2D1616] text-red-900 dark:text-red-100" : "bg-white dark:bg-zinc-950"
                )}
                placeholder='{ "name": "发动机", "type": "topic", ... }' 
              />
              {/* Floating Top Indicator */}
              <div className="absolute top-6 left-12 flex items-center gap-2 pointer-events-none">
                <div className={cn(
                  "px-4 py-1.5 rounded-full border shadow-sm transition-all",
                  isInvalid ? "bg-red-100 border-red-200" : "bg-amber-100 border-amber-200 dark:bg-zinc-900 dark:border-zinc-800"
                )}>
                  <p className={cn(
                    "text-[10px] font-black uppercase tracking-widest",
                    isInvalid ? "text-red-600" : "text-amber-600 dark:text-amber-400"
                  )}>
                    {isInvalid ? "⚠️ JSON 语法错误" : "正在编辑推理输入 (Reasoning Lab)"}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-12 py-6 border-t border-border/20 bg-muted/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-10 text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em] whitespace-nowrap">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full transition-all",
                    isInvalid ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" : "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]"
                  )} />
                  {isInvalid ? "输入校验未通过" : "建模方案实时同步"}
                </div>
                <div className="h-4 w-[1px] bg-border/40" />
                <div>字符数: {probInput.length}</div>
              </div>
              <div className="flex items-center gap-4">
                <DialogTrigger asChild>
                  <Button 
                    size="lg" 
                    variant="outline" 
                    disabled={isInvalid}
                    className={cn(
                      "rounded-2xl px-10 h-12 font-black uppercase tracking-widest text-xs gap-3 shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]",
                      isInvalid ? "bg-zinc-200 text-zinc-400 border-none cursor-not-allowed shadow-none" : "hover:bg-amber-500 hover:text-white hover:border-amber-500"
                    )}
                  >
                    <Check className="h-5 w-5" />
                    {isInvalid ? "无法同步" : "完成并返回"}
                  </Button>
                </DialogTrigger>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-6 flex flex-col gap-4 flex-1 overflow-hidden bg-muted/5 dark:bg-zinc-950/10 border-t border-border/10">
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <Textarea
            className="flex-1 font-mono text-[13px] resize-none border-border/40 bg-muted/10 focus:bg-muted/20 transition-all rounded-xl p-4 leading-relaxed"
            placeholder='{ "name": "发动机", "type": "topic", ... }'
            value={probInput}
            onChange={(event) => setProbInput(event.target.value)}
          />
          <Button 
            className="w-full bg-zinc-200 hover:bg-zinc-300 dark:bg-primary dark:hover:bg-primary/90 text-zinc-900 dark:text-primary-foreground gap-2 border-none font-black uppercase tracking-widest text-[10px] h-10 rounded-xl shadow-md transition-all active:scale-[0.98]" 
            onClick={onAnalyze} 
            disabled={analyzing}
          >
            {analyzing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
            分析知识点置信度
          </Button>
        </div>
        {probResult && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 animate-in fade-in slide-in-from-bottom-2 duration-500 shadow-inner">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/70">推理概率 (Confidence)</span>
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 font-black px-2.5 py-1">{(probResult.probability * 100).toFixed(1)}%</Badge>
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/80 italic border-l-2 border-amber-500/40 pl-4 py-1">
              "{probResult.reason}"
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
