import React from 'react';
import { Terminal, Activity, CheckCircle2, Clock, ChevronDown, ChevronRight, Info, AlertTriangle, Sparkles, BrainCircuit, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ConversationExecutionStage } from './types';

interface ExecutionFlowProps {
  executionStages: ConversationExecutionStage[];
}

export function ExecutionFlow({ executionStages }: ExecutionFlowProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-slate-50/30">
      <div className="flex shrink-0 items-center gap-2 border-b bg-white p-4">
        <Activity className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold tracking-tight">执行流 (Execution Flow)</h3>
        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-mono">
          {executionStages.length} Steps
        </span>
      </div>

      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-4 space-y-4">
          {executionStages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
              <Terminal className="w-8 h-8 mb-2" />
              <p className="text-xs">暂无执行阶段</p>
            </div>
          ) : (
            <div className="relative pl-1 space-y-4">
              {/* Timeline Connector */}
              <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-200" />

              {executionStages.map((stage, index) => (
                <StepItem key={stage.id || index} stage={stage} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StepItem({ stage }: { stage: ConversationExecutionStage }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const toolRun = stage.toolRun;

  const getStatusIcon = () => {
    if (stage.phaseState !== 'completed') return <LoaderIcon />;

    switch (stage.semanticStatus) {
      case 'thinking': return <Sparkles className="w-4 h-4 text-violet-500 fill-white" />;
      case 'executing': return <Activity className="w-4 h-4 text-blue-500 fill-white" />;
      case 'reasoning': return <BrainCircuit className="w-4 h-4 text-indigo-500 fill-white" />;
      case 'observing': return <Eye className="w-4 h-4 text-cyan-500 fill-white" />;
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500 fill-white" />;
      case 'interrupted': return <Info className="w-4 h-4 text-amber-500 fill-white" />;
      default: return <Clock className="w-4 h-4 text-slate-400 fill-white" />;
    }
  };

  return (
    <div className="relative pl-7 group">
      {/* Node Dot */}
      <div className="absolute left-1.5 top-1 z-10 -translate-x-1/2 bg-slate-50 p-0.5 rounded-full">
        {getStatusIcon()}
      </div>

      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
        <div
          className={cn(
            "p-3 rounded-xl border bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden relative",
            stage.semanticStatus === 'interrupted' ? 'border-amber-100' : 'border-slate-100',
            isOpen ? 'ring-2 ring-blue-500/10' : ''
          )}
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className={cn(
                "text-[10px] font-bold tracking-wider px-1.5 rounded",
                stage.semanticStatus === 'completed' ? 'bg-green-100 text-green-700' :
                  stage.semanticStatus === 'interrupted' ? 'bg-amber-100 text-amber-700' :
                    stage.phaseState === 'active' ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
              )}>
                {stage.label}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {stage.startedAt
                  ? new Date(stage.startedAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : '--:--:--'}
              </span>
            </div>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </div>

          {stage.detail ? (
            <div className="text-[11px] font-medium text-slate-700 truncate leading-tight">
              {stage.detail}
            </div>
          ) : null}

          {toolRun?.durationMs ? (
            <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              <span>{(toolRun.durationMs / 1000).toFixed(2)}s</span>
            </div>
          ) : null}
        </div>

        <CollapsibleContent forceMount className={cn("space-y-2 animate-in slide-in-from-top-1 duration-200", !isOpen && "hidden")}>
          {toolRun && (
            <div className="bg-slate-900 rounded-xl p-3 font-mono text-[10px] leading-relaxed overflow-auto max-h-[300px] shadow-inner border border-slate-800">
              {toolRun.command && (
                <div className="text-slate-300 mb-2">
                  <div className="text-[9px] uppercase tracking-widest font-bold text-slate-500 mb-1">Command</div>
                  <pre className="whitespace-pre-wrap">{toolRun.command}</pre>
                </div>
              )}
              {toolRun.stdout && (
                <div className="text-slate-300">
                  <div className="text-[9px] uppercase tracking-widest font-bold text-slate-500 mb-1">Stdout</div>
                  <pre className="whitespace-pre-wrap">{toolRun.stdout}</pre>
                </div>
              )}
              {toolRun.stderr && (
                <div className="text-red-400 mt-2">
                  <div className="text-[9px] uppercase tracking-widest font-bold text-red-900 mb-1">Stderr</div>
                  <pre className="whitespace-pre-wrap">{toolRun.stderr}</pre>
                </div>
              )}
              {(toolRun.exitCode !== null || toolRun.cwd) && (
                <div className="text-slate-400 mt-2 border-t border-white/5 pt-2 space-y-1">
                  {toolRun.exitCode !== null ? <div>exitCode: {toolRun.exitCode}</div> : null}
                  {toolRun.cwd ? <div>cwd: {toolRun.cwd}</div> : null}
                </div>
              )}
              {toolRun.truncated && (
                <div className="text-amber-500 mt-2 border-t border-white/5 pt-1 text-[9px] italic flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  日志过长已截断
                </div>
              )}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function LoaderIcon() {
  return (
    <div className="w-4 h-4 flex items-center justify-center">
      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
