import type { Dispatch, SetStateAction } from 'react';
import { Network, RefreshCw, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { ProbabilityResult } from '@/features/workspace/api';

interface ProbabilityPanelProps {
  probInput: string;
  setProbInput: Dispatch<SetStateAction<string>>;
  probResult: ProbabilityResult | null;
  analyzing: boolean;
  onAnalyze: () => void | Promise<void>;
}

export function ProbabilityPanel({ probInput, setProbInput, probResult, analyzing, onAnalyze }: ProbabilityPanelProps) {
  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-lg h-80 flex flex-col rounded-3xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/20 bg-muted/10 px-6 py-4">
        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 text-muted-foreground/80">
          <Sparkles className="h-4 w-4 text-amber-500/70" />
          API 概率推理实验室 (Reasoner)
        </CardTitle>
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
