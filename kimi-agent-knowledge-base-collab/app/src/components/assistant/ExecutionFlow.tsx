import React from 'react';
import { Terminal, Activity, CheckCircle2, Clock, AlertTriangle, Sparkles, BrainCircuit, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationExecutionStage } from './types';
import { clampExecutionFlowText } from './executionFlowText';

interface ExecutionFlowProps {
  executionStages: ConversationExecutionStage[];
}

export function ExecutionFlow({
  executionStages,
}: ExecutionFlowProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [executionStages]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background border-l border-border">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground/90">
            执行流程
          </h3>
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            {executionStages.length}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar-thin">
        <div className="flex min-h-full flex-col justify-end space-y-3 p-3">
          {executionStages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-30 my-auto">
              <Terminal className="w-8 h-8 mb-2" />
              <p className="text-xs">暂无执行阶段</p>
            </div>
          ) : (
            <div className="relative pl-1 space-y-3">
              {executionStages.map((stage, index) => (
                <StepItem key={stage.id || index} stage={stage} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepItem({ stage }: { stage: ConversationExecutionStage }) {
  const toolRun = stage.toolRun;
  const compactLabel = clampExecutionFlowText(stage.label, 10);

  const getStatusIcon = () => {
    if (stage.phaseState !== 'completed') return <LoaderIcon />;

    switch (stage.semanticStatus) {
      case 'thinking': return <Sparkles className="w-3.5 h-3.5 text-violet-500" />;
      case 'executing': return <Activity className="w-3.5 h-3.5 text-blue-500" />;
      case 'reasoning': return <BrainCircuit className="w-3.5 h-3.5 text-indigo-500" />;
      case 'observing': return <Eye className="w-3.5 h-3.5 text-cyan-500" />;
      case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case 'interrupted': return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
      default: return <Clock className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="relative pl-7 group">
      {/* Node Dot */}
      <div className="absolute left-3 top-1 z-10 -translate-x-1/2 flex items-center justify-center bg-background p-1 rounded-full border border-border/40 shadow-sm transition-colors dark:bg-zinc-950 dark:border-zinc-800">
        {getStatusIcon()}
      </div>

      <div
        className={cn(
          "relative h-auto min-h-[78px] overflow-hidden rounded-xl border bg-card p-2.5 shadow-sm transition-all duration-200",
          stage.semanticStatus === 'interrupted' ? 'border-red-500/20' : 'border-border/40'
        )}
      >
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cn(
              "max-w-[5rem] truncate rounded px-1.5 text-[10px] font-black tracking-wider uppercase",
              stage.semanticStatus === 'completed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                stage.semanticStatus === 'interrupted' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' :
                  stage.phaseState === 'active' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                    'bg-muted/50 text-muted-foreground'
            )}>
              {compactLabel}
            </span>
            <span className="shrink-0 text-[10px] font-mono font-bold text-muted-foreground/50">
              {stage.startedAt
                ? new Date(stage.startedAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '--:--:--'}
            </span>
          </div>
        </div>

        {stage.detail ? (
          <div className="max-w-full text-[11px] font-bold leading-relaxed text-foreground/80 dark:text-zinc-400">
            {stage.detail}
          </div>
        ) : null}

        {toolRun?.durationMs ? (
          <div className="mt-2 text-[10px] font-black text-muted-foreground/60 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            <span>{(toolRun.durationMs / 1000).toFixed(2)}s</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LoaderIcon() {
  return (
    <div className="w-4 h-4 flex items-center justify-center">
      <div className="w-2.5 h-2.5 bg-foreground/60 rounded-full animate-pulse" />
    </div>
  );
}
