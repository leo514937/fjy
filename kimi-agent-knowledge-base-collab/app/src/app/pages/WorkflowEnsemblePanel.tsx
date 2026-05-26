import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  BrainCircuit,
  CheckCircle2,
  FileSearch,
  Gavel,
  Loader2,
  Radar,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  extractWorkflowEnsembleView,
  extractWorkflowJudgeEnsembleItems,
  type WorkflowEnsemblePane,
  type WorkflowEnsembleRound,
  type WorkflowEnsembleView,
  type WorkflowJudgeEnsembleItem,
} from './fileWorkflowEnsemble';

interface WorkflowStageResult {
  stage: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  output: Record<string, unknown> | null;
}

interface WorkflowEnsemblePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageResults: WorkflowStageResult[];
  statusMessage: string;
  isRunning: boolean;
}

type EnsembleStageKey = 'observe' | 'relations' | 'ablation_candidate' | 'ablation_judge';

interface EnsembleStageSpec {
  key: EnsembleStageKey;
  title: string;
  short: string;
  description: string;
  icon: typeof Radar;
}

const ENSEMBLE_STAGE_SPECS: EnsembleStageSpec[] = [
  {
    key: 'observe',
    title: '节点1 · 观察',
    short: '观察',
    description: '左右展示模型 A 与模型 B 的实体抽取结果，底部保留交叉后的最终实体集。',
    icon: Radar,
  },
  {
    key: 'relations',
    title: '节点2 · 关系',
    short: '关系',
    description: '并排查看两个模型各自抽出的关系网络，再向下对比辩论过程与最终合成结果。',
    icon: BrainCircuit,
  },
  {
    key: 'ablation_candidate',
    title: '节点3 · 消融预选',
    short: '消融预选',
    description: '候选实体的消融预选过程同样双路并行，便于对照两个模型为何把实体列入候选。',
    icon: FileSearch,
  },
  {
    key: 'ablation_judge',
    title: '节点4 · 小故命中',
    short: '小故命中',
    description: '按实体展开保留版与去除版两条推理链，流式展示双模型过程与最终交叉结论。',
    icon: Gavel,
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function renderJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hasStructuredData(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function renderStructuredOrRaw(data: unknown, rawText: string): string {
  if (hasStructuredData(data)) {
    return renderJson(data);
  }
  if (rawText.trim()) {
    return rawText;
  }
  return renderJson({ empty: true });
}

function getStageOutput(stageResults: WorkflowStageResult[], stageName: string): Record<string, unknown> {
  const stage = stageResults.find((item) => item.stage === stageName);
  return asRecord(stage?.output);
}

function getStageLlmEnsemble(stageResults: WorkflowStageResult[], stageName: string): unknown {
  return getStageOutput(stageResults, stageName).llm_ensemble;
}

function mapStageToPanelTab(stageName: string | null | undefined): EnsembleStageKey {
  switch (stageName) {
    case 'relations':
      return 'relations';
    case 'ablation_candidate':
      return 'ablation_candidate';
    case 'ablation_judge':
      return 'ablation_judge';
    default:
      return 'observe';
  }
}

function getStageStatusBadge(status: WorkflowStageResult['status']) {
  if (status === 'running') {
    return {
      label: '流式生成中',
      className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
      dotClassName: 'bg-sky-500',
    };
  }

  if (status === 'success') {
    return {
      label: '已完成',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      dotClassName: 'bg-emerald-500',
    };
  }

  if (status === 'failed') {
    return {
      label: '失败',
      className: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
      dotClassName: 'bg-red-500',
    };
  }

  return {
    label: '待开始',
    className: 'border-border/50 bg-background/80 text-muted-foreground',
    dotClassName: 'bg-muted-foreground/50',
  };
}

function isCompletedStatus(status: string | null | undefined): boolean {
  return (status || "").trim() === "completed";
}

function getViewProgressSummary(view: WorkflowEnsembleView | null, stageStatus: WorkflowStageResult['status']) {
  if (!view) {
    if (stageStatus === 'running') {
      return '正在等待第一个模型返回。';
    }
    return '当前阶段还没有双模型过程数据。';
  }

  const roundTotal = view.debateRounds || 0;
  const roundDone = view.rounds.length;
  const readyModels = [view.modelA, view.modelB].filter(Boolean).length;

  if (view.finalResult && isCompletedStatus(view.finalResult.status)) {
    return '最终交叉结果已生成，页面会继续跟随后续快照刷新。';
  }

  if (roundDone > 0) {
    return `已完成 ${roundDone}/${roundTotal || roundDone} 轮交叉辩论。`;
  }

  if (view.judgeResult && isCompletedStatus(view.judgeResult.status)) {
    return 'judge 已完成选边，正在准备最终保留结果。';
  }

  if (readyModels === 2) {
    return '模型 A 与模型 B 已输出，正在等待互评或 judge 结果。';
  }

  if (readyModels === 1) {
    return '已收到一路模型结果，另一路仍在生成。';
  }

  if (stageStatus === 'running') {
    return '阶段已启动，正在等待模型开始返回。';
  }

  return '过程数据尚未就绪。';
}

function WorkflowEnsembleWindow({
  pane,
  eyebrow,
  isActive,
}: {
  pane: WorkflowEnsemblePane;
  eyebrow: string;
  isActive: boolean;
}) {
  return (
    <div className={cn(
      'overflow-hidden rounded-3xl border bg-background/80',
      isActive ? 'border-sky-500/35 shadow-[0_0_0_1px_rgba(14,165,233,0.12)]' : 'border-border/50',
    )}>
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/20 px-4 py-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div>
          <div className="mt-1 text-sm font-black">{pane.title}</div>
        </div>
        <Badge variant="outline" className="rounded-full">
          {pane.modelName}
        </Badge>
      </div>
      <pre className="max-h-[300px] overflow-auto bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
        {renderStructuredOrRaw(pane.data, pane.rawText)}
      </pre>
    </div>
  );
}

function WorkflowEnsembleRoundCard({
  round,
  isLatest,
}: {
  round: WorkflowEnsembleRound;
  isLatest: boolean;
}) {
  return (
    <div className={cn(
      'overflow-hidden rounded-3xl border bg-background/80',
      isLatest ? 'border-primary/30 shadow-[0_0_0_1px_rgba(59,130,246,0.12)]' : 'border-border/50',
    )}>
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/20 px-4 py-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">交叉辩论</div>
          <div className="mt-1 text-sm font-black">第 {round.round || 1} 轮</div>
        </div>
        <Badge variant="secondary" className="rounded-full">
          {round.reviewerModel || round.reviewerModelKey || 'reviewer'}
        </Badge>
      </div>
      <div className="space-y-3 bg-slate-950/95 p-4 text-slate-100">
        {round.roundSummary ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs leading-6 text-slate-200">
            {round.roundSummary}
          </div>
        ) : null}

        {round.resolvedConflicts.length > 0 ? (
          <div className="space-y-3">
            {round.resolvedConflicts.map((conflict, index) => (
              <div key={`${conflict.itemKey}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-white/15 bg-white/5 text-slate-100">
                    {conflict.itemKey || `冲突项 ${index + 1}`}
                  </Badge>
                  <Badge variant="secondary" className="rounded-full bg-white/10 text-slate-100">
                    {conflict.decision || '待定'}
                  </Badge>
                </div>
                {conflict.summary ? (
                  <div className="mt-2 text-xs leading-6 text-slate-300">{conflict.summary}</div>
                ) : null}
                {conflict.citations.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {conflict.citations.map((citation, citationIndex) => (
                      <div key={`${citation.targetModel}-${citationIndex}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-6 text-slate-200">
                        <div className="font-bold text-slate-100">
                          {citation.targetModel || 'unknown'} · {citation.stance || '修改'}
                        </div>
                        <div>原因：{citation.reason || '未说明'}</div>
                        <div>修改建议：{citation.suggestion || '未说明'}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <pre className="max-h-[220px] overflow-auto text-xs leading-6 text-slate-100">
            {renderStructuredOrRaw(round.data, round.rawText)}
          </pre>
        )}
      </div>
    </div>
  );
}

function WorkflowEnsembleViewBody({
  view,
  stageStatus,
  statusMessage,
}: {
  view: WorkflowEnsembleView | null;
  stageStatus: WorkflowStageResult['status'];
  statusMessage: string;
}) {
  const summary = getViewProgressSummary(view, stageStatus);
  const rounds = view?.rounds ?? [];
  const roundCount = rounds.length;
  const roundTotal = view?.debateRounds || 0;
  const latestRoundIndex = roundCount - 1;
  const isStreaming = stageStatus === 'running';

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border/50 bg-background/75 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full">A / B / Judge</Badge>
          <Badge variant="secondary" className="rounded-full">每模型 {view?.parallelCount || 1} 次</Badge>
          <Badge variant="secondary" className="rounded-full">辩论 {roundTotal} 轮</Badge>
          {isStreaming ? (
            <Badge className="rounded-full border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              流式更新
            </Badge>
          ) : null}
        </div>
        <div className="mt-3 text-sm font-semibold">{summary}</div>
        <div className="mt-2 text-xs leading-6 text-muted-foreground">
          {isStreaming ? statusMessage : '阶段已结束，下面保留的是该阶段最后一次快照。'}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">模型 A</div>
          <div className="mt-2 text-lg font-black">
            {view?.modelA ? (isCompletedStatus(view.modelA.status) ? '已返回' : '流式中') : isStreaming ? '生成中' : '暂无'}
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">模型 B</div>
          <div className="mt-2 text-lg font-black">
            {view?.modelB ? (isCompletedStatus(view.modelB.status) ? '已返回' : '流式中') : isStreaming ? '生成中' : '暂无'}
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Judge</div>
          <div className="mt-2 text-lg font-black">
            {view?.judgeResult ? (isCompletedStatus(view.judgeResult.status) ? '已判决' : '流式中') : view?.conflictCount ? (isStreaming ? '等待中' : '未完成') : '未触发'}
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">一致 / 冲突</div>
          <div className="mt-2 text-lg font-black">{view?.sharedCount || 0} / {view?.conflictCount || 0}</div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">最终结果</div>
          <div className="mt-2 text-lg font-black">
            {view?.finalResult ? (isCompletedStatus(view.finalResult.status) ? '已保留' : '流式中') : isStreaming ? '等待中' : '暂无'}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-border/50 bg-background/75 p-4 text-sm text-muted-foreground">
        这里按 A、B、Judge 三栏展开；相同关键字段会直接收敛为 shared，只有冲突项才会进入互评和 judge。
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {view?.modelA ? (
          <WorkflowEnsembleWindow pane={view.modelA} eyebrow="模型 A" isActive={isStreaming && !view.finalResult} />
        ) : (
          <div className="rounded-3xl border border-dashed border-border/60 bg-muted/10 p-6 text-sm text-muted-foreground">
            模型 A 结果暂不可用。
          </div>
        )}
        {view?.modelB ? (
          <WorkflowEnsembleWindow pane={view.modelB} eyebrow="模型 B" isActive={isStreaming && Boolean(view.modelA) && !view.finalResult} />
        ) : (
          <div className="rounded-3xl border border-dashed border-border/60 bg-muted/10 p-6 text-sm text-muted-foreground">
            模型 B 结果暂不可用。
          </div>
        )}
        {view?.judgeResult ? (
          <WorkflowEnsembleWindow
            pane={{
              title: view.judgeResult.title,
              modelKey: view.judgeResult.modelKey,
              modelName: view.judgeResult.modelName,
              data: view.judgeResult.data,
              rawText: view.judgeResult.rawText,
              status: view.judgeResult.status,
            }}
            eyebrow="Judge"
            isActive={isStreaming && Boolean(view.modelA || view.modelB) && !view.finalResult}
          />
        ) : (
          <div className="rounded-3xl border border-dashed border-amber-500/30 bg-amber-500/5 p-6 text-sm text-muted-foreground">
            {view?.conflictCount ? 'Judge 结果暂不可用。' : '当前没有冲突项，因此未触发 judge。'}
          </div>
        )}
      </div>

      {roundCount > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">辩论过程</div>
            {isStreaming && !isCompletedStatus(view?.finalResult?.status) ? (
              <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/5 text-primary">
                最新轮次高亮中
              </Badge>
            ) : null}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {rounds.map((round, index) => (
              <WorkflowEnsembleRoundCard
                key={`${round.reviewerModelKey}-${round.round}-${index}`}
                round={round}
                isLatest={index === latestRoundIndex}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-primary/20 bg-primary/5">
        <div className="flex items-center justify-between gap-3 border-b border-primary/15 bg-primary/10 px-4 py-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary/80">底部结果</div>
            <div className="mt-1 text-sm font-black">最终交叉结果</div>
          </div>
          <Badge variant="outline" className="rounded-full border-primary/30 bg-background/80">
            {view?.finalResult?.source || 'final'}
          </Badge>
        </div>
        <pre className="max-h-[320px] overflow-auto bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
          {renderStructuredOrRaw(view?.finalResult?.data, view?.finalResult?.rawText || "")}
        </pre>
      </div>
    </div>
  );
}

function WorkflowJudgeEnsembleSection({
  items,
  stageStatus,
  statusMessage,
}: {
  items: WorkflowJudgeEnsembleItem[];
  stageStatus: WorkflowStageResult['status'];
  statusMessage: string;
}) {
  const finishedItems = items.filter((item) => item.keep?.finalResult || item.remove?.finalResult).length;

  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
        {stageStatus === 'running' ? `${statusMessage} 当前还没有流入可展示的实体过程。` : '小故命中阶段还没有可展示的双模型过程数据。'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">已流入实体</div>
          <div className="mt-2 text-lg font-black">{items.length}</div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">已完成实体</div>
          <div className="mt-2 text-lg font-black">{finishedItems}</div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">阶段状态</div>
          <div className="mt-2 text-lg font-black">{stageStatus === 'running' ? '流式判断中' : '快照已稳定'}</div>
        </div>
      </div>

      {items.map((item) => (
        <div key={item.id} className="rounded-3xl border border-border/50 bg-background/75 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-black tracking-tight">{item.entityName}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {stageStatus === 'running' ? statusMessage : '展示该实体在保留版与去除版判定中的双模型过程。'}
              </div>
            </div>
            <Badge variant="outline" className="rounded-full">
              {item.id}
            </Badge>
          </div>
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-black">
                <Bot className="h-4 w-4 text-primary" />
                保留概率过程
              </div>
              <WorkflowEnsembleViewBody view={item.keep} stageStatus={stageStatus} statusMessage={statusMessage} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-black">
                <Activity className="h-4 w-4 text-primary" />
                去除概率过程
              </div>
              <WorkflowEnsembleViewBody view={item.remove} stageStatus={stageStatus} statusMessage={statusMessage} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkflowEnsemblePanel({
  open,
  onOpenChange,
  stageResults,
  statusMessage,
  isRunning,
}: WorkflowEnsemblePanelProps) {
  const activeStage = stageResults.find((stage) => stage.status === 'running') ?? null;
  const activeStageKey = activeStage?.stage ?? null;
  const preferredTab = useMemo(() => mapStageToPanelTab(activeStageKey), [activeStageKey]);
  const [activeTab, setActiveTab] = useState<EnsembleStageKey>(preferredTab);

  useEffect(() => {
    if (open) {
      setActiveTab(preferredTab);
    }
  }, [open, preferredTab]);

  const observeView = useMemo(
    () => extractWorkflowEnsembleView(getStageLlmEnsemble(stageResults, 'observe')),
    [stageResults],
  );
  const relationsView = useMemo(
    () => extractWorkflowEnsembleView(getStageLlmEnsemble(stageResults, 'relations')),
    [stageResults],
  );
  const ablationCandidateView = useMemo(
    () => extractWorkflowEnsembleView(getStageLlmEnsemble(stageResults, 'ablation_candidate')),
    [stageResults],
  );
  const ablationJudgeItems = useMemo(
    () => extractWorkflowJudgeEnsembleItems(
      getStageLlmEnsemble(stageResults, 'ablation_judge'),
      getStageOutput(stageResults, 'ablation_judge').ablation_judges,
    ),
    [stageResults],
  );

  const stageStatusMap = new Map(stageResults.map((stage) => [stage.stage, stage]));
  const totalAvailableStages = [observeView, relationsView, ablationCandidateView].filter(Boolean).length
    + (ablationJudgeItems.length > 0 ? 1 : 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-l border-border/60 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.1),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent)] p-0 sm:max-w-none lg:w-[min(94vw,1180px)]"
      >
        <SheetHeader className="border-b border-border/50 px-6 py-5 pr-14">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                <Bot className="h-3.5 w-3.5" />
                独立双模型过程台
              </div>
              <div>
                <SheetTitle className="text-2xl font-black tracking-tight">A / B 并行与交叉辩论全程可视化</SheetTitle>
                <SheetDescription className="mt-2 max-w-3xl text-sm leading-6">
                  左右分别展示模型 A 与模型 B 的单次结果，向下追踪交叉辩论轮次，底部固定展示最终保留下来的结果。
                </SheetDescription>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/50 bg-background/75 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">实时播报</div>
                <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
                  {isRunning ? <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  <span>{statusMessage}</span>
                </div>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/75 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">过程覆盖</div>
                <div className="mt-2 text-2xl font-black">{totalAvailableStages}/4</div>
                <div className="mt-1 text-xs text-muted-foreground">已出现可视化过程的阶段数</div>
              </div>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EnsembleStageKey)} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border/50 px-6 py-4">
            <div className="grid gap-3 xl:grid-cols-4">
              {ENSEMBLE_STAGE_SPECS.map((spec) => {
                const stage = stageStatusMap.get(spec.key) ?? {
                  stage: spec.key,
                  status: 'pending' as const,
                  output: null,
                };
                const statusBadge = getStageStatusBadge(stage.status);
                const Icon = spec.icon;
                const summary = spec.key === 'ablation_judge'
                  ? (
                    ablationJudgeItems.length > 0
                      ? `已流入 ${ablationJudgeItems.length} 个实体过程`
                      : stage.status === 'running'
                        ? '正在等待实体判断流入'
                        : '尚未生成过程'
                  )
                  : getViewProgressSummary(
                    spec.key === 'observe'
                      ? observeView
                      : spec.key === 'relations'
                        ? relationsView
                        : ablationCandidateView,
                    stage.status,
                  );

                return (
                  <Button
                    key={spec.key}
                    type="button"
                    variant="ghost"
                    onClick={() => setActiveTab(spec.key)}
                    className={cn(
                      'h-auto min-h-[128px] flex-col items-start justify-start rounded-3xl border px-4 py-4 text-left transition-all',
                      activeTab === spec.key
                        ? 'border-primary/30 bg-primary/10 shadow-[0_18px_40px_rgba(59,130,246,0.12)]'
                        : 'border-border/50 bg-background/75 hover:bg-background',
                    )}
                  >
                    <div className="flex w-full items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
                          <Icon className="h-4 w-4" />
                          {spec.short}
                        </div>
                        <div className="text-sm font-black">{spec.title}</div>
                      </div>
                      <Badge variant="outline" className={cn('rounded-full', statusBadge.className)}>
                        <span className={cn('mr-1.5 h-2 w-2 rounded-full', statusBadge.dotClassName)} />
                        {statusBadge.label}
                      </Badge>
                    </div>
                    <div className="mt-3 line-clamp-3 text-xs leading-6 text-muted-foreground">{summary}</div>
                  </Button>
                );
              })}
            </div>

            <TabsList className="mt-4 grid h-auto w-full grid-cols-4 rounded-2xl border border-border/40 bg-muted/30 p-1">
              {ENSEMBLE_STAGE_SPECS.map((spec) => (
                <TabsTrigger key={spec.key} value={spec.key} className="rounded-xl text-xs">
                  {spec.short}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="min-h-0 flex-1 px-6 py-5">
            <TabsContent value="observe" className="mt-0 pb-8">
              <div className="space-y-4">
                <div className="rounded-3xl border border-border/50 bg-background/75 p-4">
                  <div className="text-lg font-black tracking-tight">节点1 · 观察</div>
                  <div className="mt-1 text-xs leading-6 text-muted-foreground">
                    左右两个窗口分别显示模型 A 与模型 B 的单次实体抽取结果，底部显示交叉辩论后保留下来的最终实体集。
                  </div>
                </div>
                <WorkflowEnsembleViewBody
                  view={observeView}
                  stageStatus={(stageStatusMap.get('observe')?.status ?? 'pending')}
                  statusMessage={statusMessage}
                />
              </div>
            </TabsContent>

            <TabsContent value="relations" className="mt-0 pb-8">
              <div className="space-y-4">
                <div className="rounded-3xl border border-border/50 bg-background/75 p-4">
                  <div className="text-lg font-black tracking-tight">节点2 · 关系</div>
                  <div className="mt-1 text-xs leading-6 text-muted-foreground">
                    这里并排展示两个模型各自抽出的关系网络，再往下可以看到辩论轮次与最终合成后的关系结果。
                  </div>
                </div>
                <WorkflowEnsembleViewBody
                  view={relationsView}
                  stageStatus={(stageStatusMap.get('relations')?.status ?? 'pending')}
                  statusMessage={statusMessage}
                />
              </div>
            </TabsContent>

            <TabsContent value="ablation_candidate" className="mt-0 pb-8">
              <div className="space-y-4">
                <div className="rounded-3xl border border-border/50 bg-background/75 p-4">
                  <div className="text-lg font-black tracking-tight">节点3 · 消融预选</div>
                  <div className="mt-1 text-xs leading-6 text-muted-foreground">
                    候选实体的消融预选过程也按左右双窗口展开，便于对比两个模型为何把某个实体纳入候选。
                  </div>
                </div>
                <WorkflowEnsembleViewBody
                  view={ablationCandidateView}
                  stageStatus={(stageStatusMap.get('ablation_candidate')?.status ?? 'pending')}
                  statusMessage={statusMessage}
                />
              </div>
            </TabsContent>

            <TabsContent value="ablation_judge" className="mt-0 pb-8">
              <div className="space-y-4">
                <div className="rounded-3xl border border-border/50 bg-background/75 p-4">
                  <div className="text-lg font-black tracking-tight">节点4 · 小故命中</div>
                  <div className="mt-1 text-xs leading-6 text-muted-foreground">
                    这一阶段按实体展开，并分别展示“保留概率”和“去除概率”两条推理链路的双模型结果与最终交叉结论。
                  </div>
                </div>
                <WorkflowJudgeEnsembleSection
                  items={ablationJudgeItems}
                  stageStatus={(stageStatusMap.get('ablation_judge')?.status ?? 'pending')}
                  statusMessage={statusMessage}
                />
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
