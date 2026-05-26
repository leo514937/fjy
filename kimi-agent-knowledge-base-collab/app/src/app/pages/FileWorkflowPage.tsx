import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Database,
  Eye,
  FileJson,
  FileSearch,
  Gavel,
  GitBranchPlus,
  Loader2,
  Play,
  Radar,
  RefreshCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchKnowledgeGraph } from '@/features/ontology/api';
import { subscribeRepositorySync } from '@/shared/events/repositorySync';
import {
  activateWorkflowSession,
  getAllWorkflowSessions,
  getLatestWorkflowSession,
  removeWorkflowSession,
  retryWorkflowRunFromStage,
  startWorkflowRun,
  subscribeWorkflowSession,
  subscribeWorkflowSessions,
  terminateWorkflowRun,
  type WorkflowRunSession,
} from '@/features/workflow/runtime';
import {
  fetchWorkflowConfig,
  fetchXgProjects,
  softDeleteXgProject,
  updateWorkflowConfig,
  type XgProject,
} from '@/features/workspace/api';
import {
  getStoredSelectedProjectId,
  setStoredSelectedProjectId,
  subscribeSelectedProjectIdChange,
} from '@/features/workspace/selectedProject';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { WORKFLOW_STAGE_DEFINITIONS } from '../../shared/workflowStages.js';
import { extractAblationPanels } from './fileWorkflowAblation';
import {
  extractWorkflowEnsembleView,
  extractWorkflowJudgeEnsembleItems,
} from './fileWorkflowEnsemble';
import { buildWorkflowStagePreview, WorkflowInsightCard } from './fileWorkflowPanels';
import { WorkflowLiveGraph } from './WorkflowLiveGraph';
import { WorkflowEnsemblePanel } from './WorkflowEnsemblePanel';

interface WorkflowStageResult {
  stage: string;
  order: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  started_at?: string | null;
  finished_at?: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
}

interface IngestResult {
  entity_id: string;
  entity_name: string;
  filename: string;
  status: string;
  commit_id: string;
  version_id: number | null;
  error?: string;
}

interface FileWorkflowRunResponse {
  ok: boolean;
  workflow: {
    mode: string;
    status: string;
    steps: string[];
  };
  input_file?: {
    originalName?: string;
    storedName?: string;
    size?: number;
    path?: string;
  };
  stage_results: WorkflowStageResult[];
  ingest_results: IngestResult[];
  errors: Array<{ stage: string; message: string }>;
  runtime_root: string;
  started_at?: string;
  finished_at?: string;
}

interface WorkflowEntity {
  id: string;
  name: string;
  summary: string;
  citations: string[];
  properties: Record<string, unknown>;
}

interface WorkflowRelation {
  source_name: string;
  target_name: string;
  relation_type: string;
  evidence: string;
}

interface WorkflowLogItem {
  id: string;
  level: 'info' | 'success' | 'error';
  message: string;
  stage?: string;
  createdAt: string;
}

type StageMeta = (typeof WORKFLOW_STAGE_DEFINITIONS)[number] & {
  icon: ReactNode;
};

const STAGE_ICONS: Record<string, ReactNode> = {
  auth_precheck: <Radar className="h-4 w-4" />,
  observe: <Eye className="h-4 w-4" />,
  relations: <GitBranchPlus className="h-4 w-4" />,
  ablation_candidate: <FileSearch className="h-4 w-4" />,
  ablation_judge: <Gavel className="h-4 w-4" />,
  ontology: <FileJson className="h-4 w-4" />,
  probability_precheck: <BrainCircuit className="h-4 w-4" />,
  ingest: <Database className="h-4 w-4" />,
};

const STAGE_META: StageMeta[] = WORKFLOW_STAGE_DEFINITIONS.map((stage) => ({
  ...stage,
  icon: STAGE_ICONS[stage.key] ?? <Activity className="h-4 w-4" />,
}));

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStageOutput(stageResults: WorkflowStageResult[], stageName: string): Record<string, unknown> {
  const stage = stageResults.find((item) => item.stage === stageName);
  return asRecord(stage?.output);
}

function extractEntities(stageResults: WorkflowStageResult[]): WorkflowEntity[] {
  const output = getStageOutput(stageResults, 'observe');
  const entities = Array.isArray(output.entities) ? output.entities : [];
  return entities.map((item) => {
    const record = asRecord(item);
    return {
      id: asText(record.id),
      name: asText(record.name),
      summary: asText(record.summary),
      citations: asStringArray(record.citations),
      properties: asPlainObject(record.properties),
    };
  }).filter((item) => item.id && item.name);
}

function extractRelations(stageResults: WorkflowStageResult[]): WorkflowRelation[] {
  const output = getStageOutput(stageResults, 'relations');
  const relations = Array.isArray(output.relations) ? output.relations : [];
  return relations.map((item) => {
    const record = asRecord(item);
    return {
      source_name: asText(record.source_name),
      target_name: asText(record.target_name),
      relation_type: asText(record.relation_type),
      evidence: asText(record.evidence),
    };
  }).filter((item) => item.source_name && item.target_name && item.relation_type);
}

function extractStageCount(
  stageResults: WorkflowStageResult[],
  stageName: string,
  field: string,
): number | null {
  const stage = stageResults.find((item) => item.stage === stageName);
  const value = stage?.output?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatDuration(startedAt?: string | null, finishedAt?: string | null): string {
  if (!startedAt) return '--';
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '--';
  const duration = end - start;
  if (duration < 1000) return `${duration} ms`;
  return `${(duration / 1000).toFixed(1)} s`;
}

function statusTone(status: WorkflowStageResult['status']): string {
  if (status === 'success') return 'text-emerald-500';
  if (status === 'failed') return 'text-red-500';
  if (status === 'running') return 'text-sky-500';
  return 'text-muted-foreground';
}

function stageSurfaceClass(status: WorkflowStageResult['status']): string {
  if (status === 'success') return 'border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]';
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 shadow-[0_0_0_1px_rgba(239,68,68,0.12)]';
  if (status === 'running') return 'border-sky-500/35 bg-sky-500/10 shadow-[0_0_24px_rgba(14,165,233,0.16)]';
  return 'border-border/50 bg-background/60';
}

function renderJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pickAvailableProjectId(projects: XgProject[], candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const normalized = typeof candidate === 'string' ? candidate.trim() : '';
    if (normalized && projects.some((project) => project.id === normalized)) {
      return normalized;
    }
  }

  return projects[0]?.id || '';
}

function formatWorkflowHistoryTime(value: string | null | undefined): string {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

const LIVE_MONITOR_STAGE_KEYS = new Set(['observe', 'relations', 'ablation_judge']);

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(asRecord(value)).length > 0;
  }

  return true;
}

function renderStructuredOrRaw(data: unknown, rawText: string): string {
  if (hasMeaningfulValue(data)) {
    return renderJson(data);
  }

  if (rawText.trim()) {
    return rawText;
  }

  return renderJson({ empty: true });
}

function isCompletedStreamStatus(status: string | null | undefined): boolean {
  return (status || '').trim() === 'completed';
}

function WorkflowMiniModelPane({
  title,
  modelName,
  status,
  data,
  rawText,
}: {
  title: string;
  modelName: string;
  status: string;
  data: unknown;
  rawText: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border/40 bg-background/70">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
          <div className="mt-1 break-all text-sm font-black">{modelName}</div>
        </div>
        <Badge variant="outline" className="rounded-full">
          {isCompletedStreamStatus(status) ? '已返回' : '流式中'}
        </Badge>
      </div>
      <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-all bg-slate-950/95 p-3 text-[11px] leading-6 text-slate-100">
        {renderStructuredOrRaw(data, rawText)}
      </pre>
    </div>
  );
}

function WorkflowLiveMonitorCard({
  meta,
  stage,
  stageResults,
  statusMessage,
  onOpenEnsemblePanel,
}: {
  meta: StageMeta;
  stage: WorkflowStageResult;
  stageResults: WorkflowStageResult[];
  statusMessage: string;
  onOpenEnsemblePanel: () => void;
}) {
  const output = asRecord(stage.output);
  const rawText = asText(output.llm_raw_text);
  const structuredPayload = output.llm_raw ?? output.llm_response ?? output;
  const llmEnsemble = output.llm_ensemble;
  const ensembleView = meta.key === 'ablation_judge' ? null : extractWorkflowEnsembleView(llmEnsemble);
  const judgeItems = meta.key === 'ablation_judge'
    ? extractWorkflowJudgeEnsembleItems(llmEnsemble, output.ablation_judges)
    : [];
  const processReady = Boolean(ensembleView || judgeItems.length > 0);
  const isStreaming = stage.status === 'running';
  const rawTextLength = rawText.trim().length;

  return (
    <div className={cn('min-w-0 rounded-3xl border p-4', stageSurfaceClass(stage.status))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
            <span>{meta.short}</span>
            <span className={cn('inline-flex items-center gap-1', statusTone(stage.status))}>
              {meta.icon}
              {meta.title}
            </span>
          </div>
          <div className="break-words text-sm font-semibold">{meta.detail}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="outline" className="rounded-full bg-background/80">
            {stage.status}
          </Badge>
          {rawTextLength > 0 ? (
            <Badge variant="secondary" className="rounded-full">
              文本 {rawTextLength} chars
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>耗时：{formatDuration(stage.started_at, stage.finished_at)}</span>
        <span>阶段序号：{stage.order}</span>
        {isStreaming ? <span>当前状态：{statusMessage}</span> : null}
      </div>

      <div className="mt-4 min-w-0 rounded-2xl border border-border/40 bg-slate-950/95">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Live Graph</div>
          <div className="mt-1 text-sm font-black text-slate-100">流式图谱视图</div>
        </div>
        <div className="bg-background/70 p-4">
          <WorkflowLiveGraph
            stageKey={meta.key as 'observe' | 'relations' | 'ablation_judge'}
            stageResults={stageResults}
            stageStatus={stage.status}
          />
        </div>
      </div>

      <div className="mt-4 min-w-0 rounded-2xl border border-border/40 bg-slate-950/95">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Live Output</div>
            <div className="mt-1 text-sm font-black text-slate-100">模型原文流</div>
          </div>
          {isStreaming ? (
            <Badge className="rounded-full border-sky-500/30 bg-sky-500/10 text-sky-200">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              实时刷新
            </Badge>
          ) : null}
        </div>
        <ScrollArea className="h-[220px]">
          {rawText.trim() ? (
            <pre className="p-4 whitespace-pre-wrap break-all text-xs leading-6 text-slate-100">{rawText}</pre>
          ) : (
            <div className="p-4 text-xs leading-6 text-slate-400">
              {isStreaming
                ? '阶段已经开始，正在等待模型吐出首段文本...'
                : '这个阶段没有可直接展示的原文流，下面保留结构化快照与双模型过程摘要。'}
            </div>
          )}
        </ScrollArea>
      </div>

      {ensembleView ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">候选数</div>
              <div className="mt-2 text-lg font-black">{ensembleView.parallelCount || 1}</div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">辩论轮次</div>
              <div className="mt-2 text-lg font-black">{ensembleView.rounds.length}/{ensembleView.debateRounds || 0}</div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">一致 / 冲突</div>
              <div className="mt-2 text-lg font-black">{ensembleView.sharedCount} / {ensembleView.conflictCount}</div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">最终结果</div>
              <div className="mt-2 text-lg font-black">
                {ensembleView.finalResult
                  ? (isCompletedStreamStatus(ensembleView.finalResult.status) ? '已收敛' : '生成中')
                  : isStreaming
                    ? '等待中'
                    : '暂无'}
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            {ensembleView.modelA ? (
              <WorkflowMiniModelPane
                title="模型 A"
                modelName={ensembleView.modelA.modelName}
                status={ensembleView.modelA.status}
                data={ensembleView.modelA.data}
                rawText={ensembleView.modelA.rawText}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
                模型 A 结果暂未流入。
              </div>
            )}

            {ensembleView.modelB ? (
              <WorkflowMiniModelPane
                title="模型 B"
                modelName={ensembleView.modelB.modelName}
                status={ensembleView.modelB.status}
                data={ensembleView.modelB.data}
                rawText={ensembleView.modelB.rawText}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
                模型 B 结果暂未流入。
              </div>
            )}
          </div>
        </div>
      ) : null}

      {judgeItems.length > 0 ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">实体过程</div>
              <div className="mt-2 text-lg font-black">{judgeItems.length}</div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">保留链完成</div>
              <div className="mt-2 text-lg font-black">
                {judgeItems.filter((item) => item.keep?.finalResult).length}
              </div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">去除链完成</div>
              <div className="mt-2 text-lg font-black">
                {judgeItems.filter((item) => item.remove?.finalResult).length}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">已流入实体</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {judgeItems.slice(0, 10).map((item) => (
                <Badge key={item.id} variant="outline" className="rounded-full bg-background/80">
                  {item.entityName}
                </Badge>
              ))}
              {judgeItems.length > 10 ? (
                <Badge variant="secondary" className="rounded-full">
                  +{judgeItems.length - 10}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 min-w-0 rounded-2xl border border-border/40 bg-background/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Snapshot</div>
            <div className="mt-1 text-sm font-black">结构化快照</div>
          </div>
          {processReady ? (
            <Button type="button" variant="outline" className="max-w-full rounded-xl" onClick={onOpenEnsemblePanel}>
              <BrainCircuit className="mr-2 h-4 w-4" />
              查看完整过程台
            </Button>
          ) : null}
        </div>
        <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all bg-background/60 p-4 text-xs leading-6 text-foreground/90">
          {renderJson(structuredPayload)}
        </pre>
      </div>
    </div>
  );
}

function WorkflowLiveMonitor({
  stageResults,
  statusMessage,
  isRunning,
  onOpenEnsemblePanel,
}: {
  stageResults: WorkflowStageResult[];
  statusMessage: string;
  isRunning: boolean;
  onOpenEnsemblePanel: () => void;
}) {
  const liveStages = useMemo(() => (
    STAGE_META
      .filter((meta) => LIVE_MONITOR_STAGE_KEYS.has(meta.key))
      .map((meta) => {
        const stage = stageResults.find((item) => item.stage === meta.key) ?? {
          stage: meta.key,
          order: Number(meta.short),
          status: 'pending' as const,
          started_at: null,
          finished_at: null,
          output: null,
          error: null,
        };
        const output = asRecord(stage.output);
        const hasPayload = (
          stage.status !== 'pending'
          || hasMeaningfulValue(output.llm_raw_text)
          || hasMeaningfulValue(output.llm_raw)
          || hasMeaningfulValue(output.llm_ensemble)
        );
        return {
          meta,
          stage,
          hasPayload,
        };
      })
      .filter((item) => item.hasPayload)
  ), [stageResults]);

  return (
    <Card className="border-border/60 bg-card/90">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-black">大模型实时输出</CardTitle>
            <CardDescription>
              直接在主界面追踪模型原文流、结构化快照和双模型并行过程，不再只看最终结果。
            </CardDescription>
          </div>
          <Badge variant={isRunning ? 'outline' : 'secondary'} className="rounded-full">
            {isRunning ? '直播中' : '快照模式'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {liveStages.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/60 bg-muted/10 p-6 text-sm text-muted-foreground">
            {isRunning
              ? `${statusMessage} 当前还没收到可展示的模型输出，首段文本返回后会立即出现在这里。`
              : '启动工作流后，这里会按阶段持续显示大模型正在输出的内容。'}
          </div>
        ) : (
        <ScrollArea className="h-[780px] pr-4">
            <div className="space-y-4">
              {liveStages.map(({ meta, stage }) => (
                <WorkflowLiveMonitorCard
                  key={meta.key}
                  meta={meta}
                  stage={stage}
                  stageResults={stageResults}
                  statusMessage={statusMessage}
                  onOpenEnsemblePanel={onOpenEnsemblePanel}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export function FileWorkflowPage() {
  const initialSelectedProjectId = getStoredSelectedProjectId();
  const latestSession = getLatestWorkflowSession();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(latestSession?.conversationId ?? null);
  const [projectId, setProjectId] = useState(latestSession?.projectId || initialSelectedProjectId);
  const [currentWorkspaceProjectId, setCurrentWorkspaceProjectId] = useState(initialSelectedProjectId);
  const [workspaceProjects, setWorkspaceProjects] = useState<XgProject[]>([]);
  const [workflowSessions, setWorkflowSessions] = useState<WorkflowRunSession[]>(() => getAllWorkflowSessions());
  const [workspaceProjectsLoading, setWorkspaceProjectsLoading] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [workflowModel, setWorkflowModel] = useState('deepseek/deepseek-v4-flash');
  const [workflowConfigLoading, setWorkflowConfigLoading] = useState(false);
  const [workflowConfigSaving, setWorkflowConfigSaving] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('等待文件输入');
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<FileWorkflowRunResponse | null>(null);
  const [, setLogs] = useState<WorkflowLogItem[]>([]);
  const [isEnsemblePanelOpen, setIsEnsemblePanelOpen] = useState(false);
  const completedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    return subscribeSelectedProjectIdChange((nextProjectId) => {
      setCurrentWorkspaceProjectId(nextProjectId);
    });
  }, []);

  useEffect(() => subscribeWorkflowSessions((sessions) => {
    setWorkflowSessions(sessions);
  }), []);

  const loadWorkspaceProjects = useEffectEvent(async (): Promise<XgProject[]> => {
    setWorkspaceProjectsLoading(true);
    try {
      const data = await fetchXgProjects();
      setWorkspaceProjects(data);
      return data;
    } catch (error) {
      setWorkspaceProjects([]);
      throw error;
    } finally {
      setWorkspaceProjectsLoading(false);
    }
  });

  useEffect(() => {
    void loadWorkspaceProjects().catch((error) => {
      toast.error(error instanceof Error ? error.message : '读取项目列表失败');
    });
  }, []);

  useEffect(() => subscribeRepositorySync(() => {
    void loadWorkspaceProjects().catch(() => undefined);
  }), []);

  useEffect(() => {
    const loadWorkflowConfig = async () => {
      setWorkflowConfigLoading(true);
      try {
        const config = await fetchWorkflowConfig();
        if (config.workflowModel) {
          setWorkflowModel(config.workflowModel);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '读取工作流模型失败');
      } finally {
        setWorkflowConfigLoading(false);
      }
    };

    void loadWorkflowConfig();
  }, []);

  useEffect(() => {
    if (!latestSession) return;
    setConversationId(latestSession.conversationId);
    setProjectId(latestSession.projectId || initialSelectedProjectId);
    setLastRunAt(latestSession.lastRunAt);
    setStatusMessage(latestSession.statusMessage);
    setIsRunning(latestSession.isRunning);
    setRunResult(latestSession.runResult);
    setLogs(latestSession.logs);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeWorkflowSession(conversationId, (session) => {
      setProjectId(session.projectId || initialSelectedProjectId);
      setLastRunAt(session.lastRunAt);
      setStatusMessage(session.statusMessage);
      setIsRunning(session.isRunning);
      setRunResult(session.runResult);
      setLogs(session.logs);
    });
  }, [conversationId]);

  useEffect(() => {
    if (conversationId || isRunning) {
      return;
    }

    if (!selectedFile && !runResult) {
      setProjectId(currentWorkspaceProjectId);
      return;
    }

    setProjectId((current) => current || currentWorkspaceProjectId);
  }, [conversationId, currentWorkspaceProjectId, isRunning, runResult, selectedFile]);

  useEffect(() => {
    if (workspaceProjects.length === 0) {
      return;
    }

    setProjectId((current) => {
      if (workspaceProjects.some((project) => project.id === current)) {
        return current;
      }
      if (workspaceProjects.some((project) => project.id === currentWorkspaceProjectId)) {
        return currentWorkspaceProjectId;
      }
      return workspaceProjects[0]?.id || current;
    });
  }, [currentWorkspaceProjectId, workspaceProjects]);

  useEffect(() => {
    if (!conversationId || !runResult || isRunning) return;
    if (completedSessionRef.current === conversationId) return;
    completedSessionRef.current = conversationId;
    if (runResult.ok && projectId.trim()) {
      void fetchKnowledgeGraph({ refresh: true, projectId: projectId.trim() }).catch(() => undefined);
    }
  }, [conversationId, isRunning, projectId, runResult]);

  const fileMeta = useMemo(() => {
    if (selectedFile) {
      return {
        name: selectedFile.name,
        type: selectedFile.type || 'application/octet-stream',
        size: formatFileSize(selectedFile.size),
        updatedAt: new Date(selectedFile.lastModified).toLocaleString(),
      };
    }
    if (!runResult?.input_file?.originalName) return null;
    return {
      name: runResult.input_file.originalName,
      type: 'application/octet-stream',
      size: formatFileSize(Number(runResult.input_file.size || 0)),
      updatedAt: '--',
    };
  }, [runResult?.input_file?.originalName, runResult?.input_file?.size, selectedFile]);

  const resetState = () => {
    if (conversationId && !isRunning) {
      removeWorkflowSession(conversationId);
    }
    setSelectedFile(null);
    setProjectId(currentWorkspaceProjectId);
    setLastRunAt(null);
    setStatusMessage('等待文件输入');
    setRunResult(null);
    setLogs([]);
    if (!isRunning) {
      setConversationId(null);
      completedSessionRef.current = null;
    }
  };

  const handleRunWorkflow = async () => {
    if (!selectedFile) {
      setStatusMessage('请先选择文件后再执行工作流');
      return;
    }
    if (!projectId.trim()) {
      setStatusMessage('请先选择目标 project_id');
      return;
    }

    try {
      completedSessionRef.current = null;
      const nextConversationId = startWorkflowRun({
        file: selectedFile,
        projectId: projectId.trim(),
      });
      setConversationId(nextConversationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件直传失败';
      setStatusMessage(message);
    }
  };

  const handleRetryFromStage = async (startStage: string) => {
    if (!runResult || !projectId.trim() || !conversationId) {
      return;
    }

    try {
      completedSessionRef.current = null;
      retryWorkflowRunFromStage({
        startStage,
        conversationId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '阶段重试失败';
      setStatusMessage(message);
    }
  };

  const handleTerminate = () => {
    if (conversationId) {
      void terminateWorkflowRun(conversationId);
    }
  };

  const handleSaveWorkflowModel = async () => {
    const nextModel = workflowModel.trim();
    if (!nextModel) {
      toast.error('请先填写 workflow 模型名称');
      return;
    }

    setWorkflowConfigSaving(true);
    try {
      const config = await updateWorkflowConfig(nextModel);
      setWorkflowModel(config.workflowModel);
      toast.success(`工作流模型已更新为 ${config.workflowModel}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新工作流模型失败');
    } finally {
      setWorkflowConfigSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    const targetProjectId = projectId.trim();
    if (!targetProjectId) {
      toast.error('请先选择要删除的项目');
      return;
    }

    if (isRunning) {
      toast.error('工作流执行中，暂不支持删除当前项目');
      return;
    }

    const confirmationText = `I CHOOSE DELETE PROJECT ${targetProjectId}`;
    const typedConfirmation = window.prompt(
      `即将软删除项目 ${targetProjectId}。\n项目不会被物理清除，但会从当前项目列表中隐藏。\n请输入以下文本确认：\n${confirmationText}`,
      '',
    );

    if (typedConfirmation === null) {
      return;
    }

    if (typedConfirmation.trim() !== confirmationText) {
      toast.error('确认文本不匹配，已取消删除');
      return;
    }

    setDeletingProject(true);
    try {
      softDeleteXgProject(targetProjectId);
      const nextProjects = await loadWorkspaceProjects();
      const nextProjectId = pickAvailableProjectId(nextProjects, [
        currentWorkspaceProjectId === targetProjectId ? '' : currentWorkspaceProjectId,
        initialSelectedProjectId === targetProjectId ? '' : initialSelectedProjectId,
      ]);

      setProjectId(nextProjectId);
      if (currentWorkspaceProjectId === targetProjectId) {
        setCurrentWorkspaceProjectId(nextProjectId);
        if (nextProjectId) {
          setStoredSelectedProjectId(nextProjectId);
        }
      }

      setStatusMessage(
        nextProjectId
          ? `项目 ${targetProjectId} 已软删除，已切换到 ${nextProjectId}`
          : `项目 ${targetProjectId} 已软删除，请先新建项目`,
      );
      toast.success(`项目 ${targetProjectId} 已软删除`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '软删除项目失败');
    } finally {
      setDeletingProject(false);
    }
  };

  const handleSelectWorkflowSession = (session: WorkflowRunSession) => {
    activateWorkflowSession(session.conversationId);
    setConversationId(session.conversationId);
    setProjectId(session.projectId || initialSelectedProjectId);
    setStatusMessage(session.statusMessage);
    setRunResult(session.runResult);
    setLogs(session.logs);
    setLastRunAt(session.lastRunAt);
    setIsRunning(session.isRunning);
    setSelectedFile(null);
  };

  const currentResult = runResult;
  const stageResults = currentResult?.stage_results ?? [];
  const entityCount = currentResult ? extractStageCount(stageResults, 'observe', 'entity_count') : null;
  const relationCount = currentResult ? extractStageCount(stageResults, 'relations', 'relation_count') : null;
  const ablationCount = currentResult 
    ? (extractStageCount(stageResults, 'ablation_candidate', 'candidate_count') || extractStageCount(stageResults, 'ablation_judge', 'ablation_count'))
    : null;
  const precheckStage = currentResult?.stage_results.find((item) => item.stage === 'probability_precheck');
  const precheckItems = Array.isArray(precheckStage?.output?.prechecks) ? precheckStage.output.prechecks : [];
  const firstPrecheck = precheckItems[0] as Record<string, unknown> | undefined;
  const entities = useMemo(() => extractEntities(stageResults), [stageResults]);
  const relations = useMemo(() => extractRelations(stageResults), [stageResults]);
  const ablationPanels = useMemo(() => {
    const candidateOutput = getStageOutput(stageResults, 'ablation_candidate');
    const judgeOutput = getStageOutput(stageResults, 'ablation_judge');
    const legacyOutput = getStageOutput(stageResults, 'ablation');

    const merged = {
      ablation_candidates: candidateOutput.candidates || candidateOutput.ablation_candidates || legacyOutput.ablation_candidates || [],
      ablation_judges: judgeOutput.ablation_judges || judgeOutput.judges || legacyOutput.ablation_judges || [],
      ablation: judgeOutput.ablation || legacyOutput.ablation || [],
    };
    return extractAblationPanels(merged);
  }, [stageResults]);
  const completedStages = stageResults.filter((stage) => stage.status === 'success').length;
  const failedStages = stageResults.filter((stage) => stage.status === 'failed').length;
  const activeStage = stageResults.find((stage) => stage.status === 'running') ?? null;
  const progressValue = stageResults.length > 0 ? Math.round((completedStages / stageResults.length) * 100) : 0;

  return (
    <div className="h-full w-full overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <Card className="overflow-hidden border-border/60 bg-card/80 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <CardHeader className="border-b border-border/40 bg-[linear-gradient(135deg,rgba(59,130,246,0.12),rgba(139,92,246,0.08),transparent)]">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  实时工作流驾驶舱
                </div>
                <div>
                  <CardTitle className="text-2xl font-black tracking-tight">文件直传八阶段工作流</CardTitle>
                  <CardDescription className="mt-2 max-w-2xl text-sm leading-6">
                    现在不再等待最终结果统一渲染，而是按阶段实时显示抽取进度、状态变化和中间结果，便于观察实体、关系、消融和入库全过程。
                  </CardDescription>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:min-w-[320px]">
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">总进度</div>
                  <div className="mt-2 text-2xl font-black">{progressValue}%</div>
                  <Progress value={progressValue} className="mt-3 h-2.5 bg-primary/10" />
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">当前阶段</div>
                  <div className="mt-2 flex items-center gap-2 text-base font-black">
                    {activeStage ? <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    <span>{activeStage ? (STAGE_META.find(m => m.key === activeStage.stage)?.title || activeStage.stage) : currentResult ? '已完成' : '待开始'}</span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{statusMessage}</div>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-5 p-6 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-5">
              <div className="rounded-2xl border border-border/50 bg-background/80 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground">工作流模型</div>
                    <div className="text-[11px] text-muted-foreground/70">修改后会影响本页与后端的工作流 LLM 调用</div>
                  </div>
                  <Badge variant="outline">{workflowConfigLoading ? '加载中' : '已连接'}</Badge>
                </div>
                <div className="flex flex-col gap-3 md:flex-row">
                  <Input
                    value={workflowModel}
                    onChange={(event) => setWorkflowModel(event.target.value)}
                    placeholder="deepseek/deepseek-v4-flash"
                    className="h-11 rounded-xl border-border/50 bg-background/80 md:flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl"
                    onClick={() => void handleSaveWorkflowModel()}
                    disabled={workflowConfigLoading || workflowConfigSaving}
                  >
                    {workflowConfigSaving ? '保存中...' : '保存模型'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">目标 project_id</div>
                  <div className="flex gap-2">
                    <Select
                      value={projectId}
                      onValueChange={setProjectId}
                      disabled={workspaceProjectsLoading || workspaceProjects.length === 0}
                    >
                      <SelectTrigger className="h-11 flex-1 rounded-xl border-border/50 bg-background/80">
                        <SelectValue placeholder={workspaceProjectsLoading ? '正在加载项目...' : '选择目标项目'} />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {workspaceProjects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name && project.name !== project.id ? `${project.name} (${project.id})` : project.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 shrink-0 rounded-xl border-red-500/20 px-3 text-red-600 hover:bg-red-500/10 hover:text-red-700"
                      onClick={() => void handleDeleteProject()}
                      disabled={workspaceProjectsLoading || workspaceProjects.length === 0 || !projectId.trim() || deletingProject || isRunning}
                    >
                      {deletingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      <span className="hidden sm:inline">软删除</span>
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">输入文件</div>
                  <Input
                    type="file"
                    className="h-11 rounded-xl border-border/50 bg-background/80"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setSelectedFile(file);
                      setStatusMessage(file ? '文件已选择，可开始流式执行' : '等待文件输入');
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">实体</div>
                  <div className="mt-2 text-2xl font-black">{entityCount ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">观察阶段实时累积</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">关系</div>
                  <div className="mt-2 text-2xl font-black">{relationCount ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">结构边与证据</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">消融</div>
                  <div className="mt-2 text-2xl font-black">{ablationCount ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">系统影响评估</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">预判概率</div>
                  <div className="mt-2 truncate text-lg font-black">
                    {typeof firstPrecheck?.precheck_probability === 'string' ? firstPrecheck.precheck_probability : '--'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">第一个实体评分快照</div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border/50 bg-background/75 p-5 shadow-inner">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black">运行摘要</div>
                  <div className="mt-1 text-xs leading-6 text-muted-foreground">
                    展示当前活跃阶段、失败告警和最近一次运行时间。
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {currentResult?.workflow.status || 'idle'}
                </Badge>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {failedStages > 0 ? <TriangleAlert className="h-4 w-4 text-red-500" /> : activeStage ? <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    {failedStages > 0 ? '存在失败阶段' : activeStage ? '流程正在推进' : currentResult ? '流程已结束' : '等待启动'}
                  </div>
                  <div className="mt-2 text-xs leading-6 text-muted-foreground">{statusMessage}</div>
                </div>

                <div className="rounded-2xl border border-border/50 bg-muted/20 p-4 text-xs leading-7">
                  <div><span className="text-muted-foreground">最近执行：</span>{lastRunAt ?? '--'}</div>
                  <div><span className="text-muted-foreground">成功阶段：</span>{completedStages}/{STAGE_META.length}</div>
                  <div><span className="text-muted-foreground">失败阶段：</span>{failedStages}</div>
                  <div><span className="text-muted-foreground">输入文件：</span>{fileMeta?.name ?? '--'}</div>
                </div>

                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black">双模型过程台</div>
                      <div className="mt-1 text-xs leading-6 text-muted-foreground">
                        从右侧独立打开流式过程界面，同时查看模型 A、模型 B、交叉辩论和最终保留结果。
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-full border-primary/30 bg-background/80 text-primary">
                      侧边打开
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    className="mt-4 w-full rounded-xl"
                    variant="outline"
                    onClick={() => setIsEnsemblePanelOpen(true)}
                  >
                    <BrainCircuit className="mr-2 h-4 w-4" />
                    打开双模型过程台
                  </Button>
                </div>

                <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black">工作流历史</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        保留当前浏览器会话中的全部运行记录，可切换查看历史结果。
                      </div>
                    </div>
                    <Badge variant="secondary" className="rounded-full">
                      {workflowSessions.length} 条
                    </Badge>
                  </div>

                  <div className="mt-3 space-y-2">
                    {workflowSessions.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/50 bg-background/60 px-3 py-4 text-xs text-muted-foreground">
                        还没有工作流执行记录。
                      </div>
                    ) : workflowSessions.map((session) => {
                      const sessionFileName = session.runResult?.input_file?.originalName || '--';
                      const isActiveSession = session.conversationId === conversationId;
                      return (
                        <button
                          key={session.conversationId}
                          type="button"
                          onClick={() => handleSelectWorkflowSession(session)}
                          className={cn(
                            'w-full rounded-2xl border px-3 py-3 text-left transition-all',
                            isActiveSession
                              ? 'border-primary/30 bg-primary/10 shadow-sm'
                              : 'border-border/50 bg-background/60 hover:bg-background',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold">{sessionFileName}</div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {session.projectId || '--'} · {formatWorkflowHistoryTime(session.lastRunAt || session.updatedAt)}
                              </div>
                            </div>
                            <Badge variant={session.runResult?.ok ? 'secondary' : session.isRunning ? 'outline' : 'destructive'} className="shrink-0 rounded-full">
                              {session.isRunning ? '进行中' : session.runResult?.ok ? '成功' : '失败'}
                            </Badge>
                          </div>
                          <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                            {session.statusMessage}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col items-start gap-4 border-t border-border/40 bg-muted/10 px-6 py-5 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full">{statusMessage}</Badge>
              {fileMeta ? <Badge variant="secondary" className="rounded-full">{fileMeta.size}</Badge> : null}
              {lastRunAt ? <Badge variant="secondary" className="rounded-full">最近执行：{lastRunAt}</Badge> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={resetState}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                重置
              </Button>
              {isRunning ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="rounded-xl px-5 shadow-lg shadow-red-500/20"
                  onClick={handleTerminate}
                >
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  终止执行
                </Button>
              ) : (
                <Button
                  type="button"
                  className="rounded-xl px-5 shadow-lg shadow-primary/20"
                  onClick={handleRunWorkflow}
                  disabled={!selectedFile || !projectId.trim()}
                >
                  <Play className="mr-2 h-4 w-4" />
                  启动实时工作流
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>

        <div className="grid gap-6 2xl:grid-cols-[1.55fr_0.95fr]">
          <div className="space-y-6">
            <Card className="border-border/60 bg-card/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
              <CardHeader>
                <CardTitle className="text-lg font-black">阶段进度总览</CardTitle>
                <CardDescription>每个阶段都会在开始与完成时即时刷新，支持中间结果先展示、最终结果后补全。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {STAGE_META.map((meta) => {
                    const stage = stageResults.find((item) => item.stage === meta.key) ?? {
                      stage: meta.key,
                      order: Number(meta.short),
                      status: 'pending' as const,
                      started_at: null,
                      finished_at: null,
                      output: null,
                      error: null,
                    };
                    const previewOutput = buildWorkflowStagePreview(meta.key, stage.output, ablationPanels);
                    return (
                      <div
                        key={meta.key}
                        className={cn(
                          'group relative overflow-hidden rounded-3xl border p-4 transition-all duration-300',
                          'before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-primary/50 before:to-transparent',
                          stageSurfaceClass(stage.status),
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
                              <span>{meta.short}</span>
                              <span className={cn('inline-flex items-center gap-1', statusTone(stage.status))}>
                                {meta.icon}
                                {meta.title}
                              </span>
                            </div>
                            <div className="text-sm font-semibold">{meta.detail}</div>
                          </div>
                          <div className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full border',
                            stage.status === 'running' && 'border-sky-500/40 bg-sky-500/15',
                            stage.status === 'success' && 'border-emerald-500/40 bg-emerald-500/15',
                            stage.status === 'failed' && 'border-red-500/40 bg-red-500/15',
                            stage.status === 'pending' && 'border-border/50 bg-background/80',
                          )}>
                            {stage.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> : null}
                            {stage.status === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}
                            {stage.status === 'failed' ? <TriangleAlert className="h-4 w-4 text-red-500" /> : null}
                            {stage.status === 'pending' ? <Activity className="h-4 w-4 text-muted-foreground" /> : null}
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between text-xs">
                          <span className={cn('font-semibold', statusTone(stage.status))}>状态：{stage.status}</span>
                          <span className="text-muted-foreground">耗时：{formatDuration(stage.started_at, stage.finished_at)}</span>
                        </div>

                        {stage.error ? (
                          <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs leading-6 text-red-600">
                            {stage.error}
                          </div>
                        ) : null}

                        {previewOutput ? (
                          <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 p-3 text-xs text-muted-foreground">
                            <div className="line-clamp-4 whitespace-pre-wrap break-all">
                              {renderJson(previewOutput)}
                            </div>
                          </div>
                        ) : null}

                        {!isRunning && currentResult && (stage.status === 'failed' || (failedStages > 0 && stage.status === 'pending')) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-3 rounded-xl"
                            onClick={() => void handleRetryFromStage(stage.stage)}
                          >
                            从这一步重试
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle className="text-lg font-black">中间结果面板</CardTitle>
                <CardDescription>观察、关系、消融、本体和入库结果会在阶段完成后立即出现在这里，双模型过程则移到右侧独立过程台。</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="entities" className="space-y-4">
                  <TabsList className="grid h-auto w-full grid-cols-6 rounded-2xl border border-border/40 bg-muted/30 p-1">
                    <TabsTrigger value="entities" className="rounded-xl text-xs">实体</TabsTrigger>
                    <TabsTrigger value="relations" className="rounded-xl text-xs">关系</TabsTrigger>
                    <TabsTrigger value="ablation_candidates" className="rounded-xl text-xs">消融预选</TabsTrigger>
                    <TabsTrigger value="ablation_judges" className="rounded-xl text-xs">小故命中</TabsTrigger>
                    <TabsTrigger value="ingest" className="rounded-xl text-xs">入库</TabsTrigger>
                    <TabsTrigger value="raw" className="rounded-xl text-xs">原始 JSON</TabsTrigger>
                  </TabsList>

                  <TabsContent value="entities" className="mt-0">
                    {entities.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        观察阶段尚未完成，实体抽取结果会实时出现在这里。
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {entities.map((entity) => (
                          <div key={entity.id} className="rounded-3xl border border-border/50 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-base font-black">{entity.name}</div>
                                <div className="mt-1 text-xs leading-6 text-muted-foreground">{entity.summary || '无摘要'}</div>
                              </div>
                              <Badge variant="outline" className="rounded-full">{Object.keys(entity.properties).length} 属性</Badge>
                            </div>
                            <div className="mt-4 space-y-2">
                              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">引用片段</div>
                              {entity.citations.length === 0 ? (
                                <div className="text-xs text-muted-foreground">暂无引用</div>
                              ) : (
                                <div className="space-y-2 text-xs leading-6">
                                  {entity.citations.slice(0, 3).map((citation, index) => (
                                    <div key={`${entity.id}-${index}`} className="rounded-2xl border border-border/40 bg-muted/20 p-3">
                                      {citation}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="relations" className="mt-0">
                    {relations.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        关系阶段尚未完成，结构边与证据会在这里更新。
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {relations.map((relation, index) => (
                          <div key={`${relation.source_name}-${relation.target_name}-${index}`} className="rounded-3xl border border-border/50 bg-background/80 p-4">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                              <span>{relation.source_name}</span>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              <Badge variant="secondary" className="rounded-full">{relation.relation_type}</Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              <span>{relation.target_name}</span>
                            </div>
                            <div className="mt-3 text-xs leading-6 text-muted-foreground">
                              {relation.evidence || '暂无证据说明'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="ablation_candidates" className="mt-0">
                    {ablationPanels.candidates.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        消融预选阶段尚未完成，候选列表会在这里出现。
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-3xl border border-border/50 bg-background/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-lg font-black tracking-tight">消融预选清单</div>
                              <div className="mt-1 text-xs text-muted-foreground">提取文档中所有潜在实体的保留/去除影响分析。</div>
                            </div>
                            <Badge variant="secondary" className="rounded-full px-3 py-1 font-bold">
                              {ablationPanels.candidates.length} 个候选
                            </Badge>
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {ablationPanels.candidates.map((item) => (
                            <WorkflowInsightCard
                              key={item.id}
                              card={item}
                              badge={(
                                <Badge variant="outline" className="rounded-full">
                                  {item.id.slice(-4)}
                                </Badge>
                              )}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="ablation_judges" className="mt-0">
                    {ablationPanels.judges.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        小故命中阶段尚未完成，命中卡片会在这里出现。
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-3xl border border-border/50 bg-background/70 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-lg font-black tracking-tight">小故深度命中分析</div>
                              <div className="mt-1 text-xs text-muted-foreground">基于 LLM 计算的概率差值，识别对系统功能有关键影响的“小故”。</div>
                            </div>
                            <div className="flex gap-2">
                              <Badge variant="outline" className="rounded-full px-3 py-1 font-bold text-destructive border-destructive/30 bg-destructive/5">
                                {ablationPanels.judges.filter((judge) => judge.badge === '命中小故').length} 命中
                              </Badge>
                              <Badge variant="secondary" className="rounded-full px-3 py-1 font-bold">
                                {ablationPanels.judges.length} 总计
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {ablationPanels.judges.map((item) => {
                            const isHit = item.badge === '命中小故';
                            return (
                              <WorkflowInsightCard
                                key={item.id}
                                card={item}
                                tone={isHit ? 'destructive' : 'default'}
                                highlightedFieldLabels={isHit ? ['概率差', '判定依据'] : []}
                                valueAccentFieldLabels={['概率差']}
                                badge={(
                                  <Badge
                                    variant={isHit ? 'destructive' : 'secondary'}
                                    className="rounded-full"
                                  >
                                    {item.badge}
                                  </Badge>
                                )}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="ingest" className="mt-0">
                    {currentResult?.ingest_results.length ? (
                      <div className="overflow-hidden rounded-3xl border border-border/50">
                        <div className="grid grid-cols-[1.2fr_1.2fr_0.8fr_1fr_0.8fr] bg-muted/20 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                          <div>实体</div>
                          <div>文件</div>
                          <div>状态</div>
                          <div>commit</div>
                          <div>version</div>
                        </div>
                        {currentResult.ingest_results.map((item) => (
                          <div
                            key={`${item.entity_id}-${item.filename}`}
                            className="grid grid-cols-[1.2fr_1.2fr_0.8fr_1fr_0.8fr] items-center border-t border-border/40 bg-background/80 px-4 py-3 text-xs"
                          >
                            <div>{item.entity_name}</div>
                            <div className="truncate">{item.filename}</div>
                            <div className={cn(item.status === 'failed' ? 'text-red-500' : 'text-emerald-600')}>{item.status}</div>
                            <div className="truncate">{item.commit_id || '-'}</div>
                            <div>{item.version_id ?? '-'}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        入库阶段尚未完成，写入结果会在这里出现。
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="raw" className="mt-0">
                    <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-all rounded-3xl border border-border/50 bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
                      {renderJson(currentResult || { empty: true })}
                    </pre>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <WorkflowLiveMonitor
              stageResults={stageResults}
              statusMessage={statusMessage}
              isRunning={isRunning}
              onOpenEnsemblePanel={() => setIsEnsemblePanelOpen(true)}
            />
          </div>
        </div>
      </div>
      <WorkflowEnsemblePanel
        open={isEnsemblePanelOpen}
        onOpenChange={setIsEnsemblePanelOpen}
        stageResults={stageResults}
        statusMessage={statusMessage}
        isRunning={isRunning}
      />
    </div>
  );
}
