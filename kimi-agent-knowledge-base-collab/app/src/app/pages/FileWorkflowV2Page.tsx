import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  Blocks,
  BrainCircuit,
  Check,
  ChevronDown,
  Copy,
  FileJson,
  FileSearch,
  GitBranchPlus,
  Loader2,
  Play,
  RefreshCcw,
  Route,
  ScissorsLineDashed,
  Settings2,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { copyCodeToClipboard } from '@/components/assistant/AssistantMarkdown';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  activateWorkflowV2Session,
  getAllWorkflowV2Sessions,
  getLatestWorkflowV2Session,
  getWorkflowV2Session,
  removeWorkflowV2Session,
  retryWorkflowV2RunFromStage,
  startWorkflowV2Run,
  subscribeWorkflowV2Session,
  subscribeWorkflowV2Sessions,
  terminateWorkflowV2Run,
  type WorkflowV2RunSession,
} from '@/features/workflow/runtimeV2';
import {
  fetchWorkflowV2Config,
  fetchXgProjects,
  updateWorkflowV2Config,
  writeWorkflowV2SessionToOntoGit,
  type WorkflowV2Config,
  type WorkflowV2WritebackResponse,
  type XgProject,
} from '@/features/workspace/api';
import {
  getStoredSelectedProjectId,
  setStoredSelectedProjectId,
  subscribeSelectedProjectIdChange,
} from '@/features/workspace/selectedProject';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { WORKFLOW_V2_STAGE_DEFINITIONS } from '../../shared/workflowV2Stages.js';
import {
  buildWorkflowV2GraphLayout,
  buildWorkflowV2GraphLayoutFromStageData,
  buildWorkflowV2Mermaid,
  buildWorkflowV2MermaidFromStageData,
  buildWorkflowV2DisplayObjects,
  buildWorkflowV2SystemDecompositionView,
  canWriteWorkflowV2Session,
  extractWorkflowV2SiblingImpactEdges,
  extractWorkflowV2Summary,
  extractWorkflowV2WritebackSummary,
  getWorkflowV2ImpactEdgeStyle,
} from './fileWorkflowV2View';
import { WorkflowTrioPreview } from './WorkflowTrioPreview';
import { WorkflowV2SystemDecompositionPanel } from './WorkflowV2SystemDecompositionPanel';

const STAGE_ICONS: Record<string, ReactNode> = {
  chunk_parse: <ScissorsLineDashed className="h-4 w-4" />,
  chunk_filter: <FileSearch className="h-4 w-4" />,
  system_scope_identify: <FileSearch className="h-4 w-4" />,
  window_extract: <FileSearch className="h-4 w-4" />,
  object_fusion: <Blocks className="h-4 w-4" />,
  granularity_align: <Blocks className="h-4 w-4" />,
  function_analysis: <BrainCircuit className="h-4 w-4" />,
  object_decompose: <GitBranchPlus className="h-4 w-4" />,
  graph_build: <Route className="h-4 w-4" />,
  structure_quality_gate: <Check className="h-4 w-4" />,
  ablation_analysis: <Activity className="h-4 w-4" />,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function statusClass(status: string) {
  if (status === 'success') return 'border-emerald-500/30 bg-emerald-500/10';
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10';
  if (status === 'running') return 'border-sky-500/30 bg-sky-500/10';
  return 'border-border/60 bg-muted/20';
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asCount(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.floor(next) : fallback;
}

function extractErrorDiagnosticEntries(value: unknown) {
  const record = asRecord(value);
  const entries: Array<{ label: string; value: string }> = [];
  const append = (label: string, nextValue: unknown) => {
    const text = asText(nextValue);
    if (text) {
      entries.push({ label, value: text });
    }
  };

  append('HTTP', record.error_http_status);
  append('Code', record.error_code);
  append('Cause', record.error_cause_code);
  append('Name', record.error_name);

  return entries;
}

function ErrorDiagnosticBadges({ value }: { value: unknown }) {
  const entries = extractErrorDiagnosticEntries(value);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {entries.map((entry) => (
        <Badge key={`${entry.label}-${entry.value}`} variant="outline" className="rounded-full border-red-500/20 bg-red-500/5 text-red-700">
          {entry.label} {entry.value}
        </Badge>
      ))}
    </div>
  );
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '未返回';
  }
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function getSessionStatusMeta(session: WorkflowV2RunSession | null, failedStages: number) {
  if (session?.isRunning) {
    return {
      label: '运行中',
      badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
      description: '工作流正在持续产出阶段结果',
    };
  }

  if (failedStages > 0) {
    return {
      label: '有失败',
      badgeClass: 'border-red-500/30 bg-red-500/10 text-red-700',
      description: '至少有一个阶段执行失败，可从时间线重试',
    };
  }

  if (session?.runResult) {
    return {
      label: '已完成',
      badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
      description: '当前会话已有可阅读结果，可继续写回 OntoGit',
    };
  }

  return {
    label: '待启动',
    badgeClass: 'border-border/60 bg-muted/30 text-muted-foreground',
    description: '先选择项目与文件，再启动一次完整 V2 流程',
  };
}

function CitationPreview({ citation }: { citation: string }) {
  if (!citation) {
    return null;
  }
  return (
    <div className="mt-2 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700/80">Citation</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/85">{citation}</div>
    </div>
  );
}

type WorkflowV2ObjectDecompositionItem = {
  parentName: string;
  childName: string;
  relation: string;
  reason: string;
  citation: string;
  confidence: number | null;
};

type WorkflowV2ObjectImportanceItem = {
  parentName: string;
  childName: string;
  importanceLevel: string;
  judgement: string;
  reason: string;
};

type WorkflowV2ObjectImpactItem = {
  parentName: string;
  sourceName: string;
  targetName: string;
  impactLevel: string;
  judgement: string;
  reason: string;
};

type WorkflowV2ObjectFailureItem = {
  label: string;
  error: string;
  payload: Record<string, unknown>;
};

type WorkflowV2ObjectStageInsight = {
  finalReason: string;
  mergeReasons: string[];
  functionReason: string;
  functionConfidence: number | null;
  functionError: string;
  functionErrorPayload: Record<string, unknown> | null;
  decompositionReason: string;
  outgoingDecompositions: WorkflowV2ObjectDecompositionItem[];
  incomingDecompositions: WorkflowV2ObjectDecompositionItem[];
  decompositionError: string;
  decompositionFailureAttempts: WorkflowV2ObjectFailureItem[];
  parentAblationReason: string;
  importanceAsParent: WorkflowV2ObjectImportanceItem[];
  importanceAsChild: WorkflowV2ObjectImportanceItem[];
  impactAsSource: WorkflowV2ObjectImpactItem[];
  impactAsTarget: WorkflowV2ObjectImpactItem[];
  ablationFailures: WorkflowV2ObjectFailureItem[];
};

function normalizeWorkflowV2IdentityValue(value: unknown) {
  return asText(value).trim().toLowerCase();
}

function buildWorkflowV2ObjectIdentitySet(record: Record<string, unknown>) {
  const identities = new Set<string>();
  const append = (value: unknown) => {
    const normalized = normalizeWorkflowV2IdentityValue(value);
    if (normalized) {
      identities.add(normalized);
    }
  };

  append(record.object_id);
  append(record.object_name);
  append(record.normalized_name);
  for (const alias of asStringArray(record.aliases)) {
    append(alias);
  }
  return identities;
}

function matchesWorkflowV2Identity(value: unknown, identities: Set<string>) {
  const normalized = normalizeWorkflowV2IdentityValue(value);
  return Boolean(normalized) && identities.has(normalized);
}

function matchesWorkflowV2ObjectRecord(
  record: Record<string, unknown>,
  identities: Set<string>,
  keys: string[],
) {
  for (const key of keys) {
    if (key === 'aliases') {
      if (asStringArray(record.aliases).some((value) => matchesWorkflowV2Identity(value, identities))) {
        return true;
      }
      continue;
    }
    if (matchesWorkflowV2Identity(record[key], identities)) {
      return true;
    }
  }
  return false;
}

function asOptionalNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function getWorkflowV2ObjectDisplayName(
  objectMap: Map<string, Record<string, unknown>>,
  objectId: string,
  fallback = '',
) {
  return asText(asRecord(objectMap.get(objectId)).object_name) || fallback || objectId;
}

function buildWorkflowV2ObjectStageInsight(input: {
  objectRecord: Record<string, unknown>;
  functionObjects: unknown[];
  failedFunctionObjects: unknown[];
  decompositionGroups: unknown[];
  failedObjectItems: unknown[];
  ablationItems: unknown[];
  failedAblationParentItems: unknown[];
  failedAblationChildItems: unknown[];
}): WorkflowV2ObjectStageInsight {
  const identities = buildWorkflowV2ObjectIdentitySet(input.objectRecord);
  const functionRecord = input.functionObjects
    .map((item) => asRecord(item))
    .find((item) => matchesWorkflowV2ObjectRecord(item, identities, ['object_id', 'object_name', 'normalized_name', 'aliases'])) ?? null;
  const functionFailure = input.failedFunctionObjects
    .map((item) => asRecord(item))
    .find((item) => matchesWorkflowV2ObjectRecord(item, identities, ['object_id', 'object_name', 'normalized_name'])) ?? null;
  const decompositionGroup = input.decompositionGroups
    .map((item) => asRecord(item))
    .find((item) => matchesWorkflowV2ObjectRecord(item, identities, ['object_id', 'object_name'])) ?? null;
  const outgoingDecompositions = Array.isArray(decompositionGroup?.decompositions)
    ? decompositionGroup.decompositions.map((item) => {
      const record = asRecord(item);
      return {
        parentName: asText(record.parent_object_name) || asText(input.objectRecord.object_name),
        childName: asText(record.child_object_name) || asText(record.child_object_id),
        relation: asText(record.relation) || 'contains',
        reason: asText(record.reason),
        citation: asText(record.citation),
        confidence: asOptionalNumber(record.confidence),
      };
    })
    : [];
  const incomingDecompositions = input.decompositionGroups
    .map((item) => asRecord(item))
    .flatMap((group) => {
      const decompositions = Array.isArray(group.decompositions) ? group.decompositions : [];
      return decompositions
        .map((item) => asRecord(item))
        .filter((item) => matchesWorkflowV2ObjectRecord(item, identities, ['child_object_id', 'child_object_name']))
        .map((item) => ({
          parentName: asText(item.parent_object_name) || asText(group.object_name) || asText(group.object_id),
          childName: asText(item.child_object_name) || asText(item.child_object_id),
          relation: asText(item.relation) || 'contains',
          reason: asText(item.reason),
          citation: asText(item.citation),
          confidence: asOptionalNumber(item.confidence),
        }));
    });
  const decompositionFailure = input.failedObjectItems
    .map((item) => asRecord(item))
    .find((item) => matchesWorkflowV2ObjectRecord(item, identities, ['object_id', 'object_name'])) ?? null;
  const decompositionFailureAttempts = Array.isArray(decompositionFailure?.attempts)
    ? decompositionFailure.attempts.map((item, index) => {
      const record = asRecord(item);
      return {
        label: `第 ${asCount(record.attempt, index + 1)} 次`,
        error: asText(record.error) || asText(record.reason) || '对象拆解失败',
        payload: record,
      };
    })
    : [];
  const parentAblation = input.ablationItems
    .map((item) => asRecord(item))
    .find((item) => matchesWorkflowV2ObjectRecord(item, identities, ['parent_object_id', 'parent_object_name'])) ?? null;
  const importanceAsParent = Array.isArray(parentAblation?.child_importance_list)
    ? parentAblation.child_importance_list.map((item) => {
      const record = asRecord(item);
      return {
        parentName: asText(parentAblation.parent_object_name) || asText(parentAblation.parent_object_id),
        childName: asText(record.ablated_child_object_name) || asText(record.ablated_child_object_id),
        importanceLevel: asText(record.importance_level),
        judgement: asText(record.judgement),
        reason: asText(record.reason),
      };
    })
    : [];
  const importanceAsChild = input.ablationItems
    .map((item) => asRecord(item))
    .flatMap((summary) => {
      const childImportanceList = Array.isArray(summary.child_importance_list) ? summary.child_importance_list : [];
      return childImportanceList
        .map((item) => asRecord(item))
        .filter((item) => matchesWorkflowV2ObjectRecord(item, identities, ['ablated_child_object_id', 'ablated_child_object_name']))
        .map((item) => ({
          parentName: asText(summary.parent_object_name) || asText(summary.parent_object_id),
          childName: asText(item.ablated_child_object_name) || asText(item.ablated_child_object_id),
          importanceLevel: asText(item.importance_level),
          judgement: asText(item.judgement),
          reason: asText(item.reason),
        }));
    });
  const impactAsSource = input.ablationItems
    .map((item) => asRecord(item))
    .flatMap((summary) => {
      const siblingDependencyTable = Array.isArray(summary.sibling_dependency_table) ? summary.sibling_dependency_table : [];
      return siblingDependencyTable
        .map((item) => asRecord(item))
        .filter((item) => matchesWorkflowV2ObjectRecord(item, identities, ['ablated_child_object_id', 'ablated_child_object_name']))
        .map((item) => ({
          parentName: asText(summary.parent_object_name) || asText(summary.parent_object_id),
          sourceName: asText(item.ablated_child_object_name) || asText(item.ablated_child_object_id),
          targetName: asText(item.target_sibling_object_name) || asText(item.target_sibling_object_id),
          impactLevel: asText(item.impact_level),
          judgement: asText(item.judgement),
          reason: asText(item.reason),
        }));
    });
  const impactAsTarget = input.ablationItems
    .map((item) => asRecord(item))
    .flatMap((summary) => {
      const siblingDependencyTable = Array.isArray(summary.sibling_dependency_table) ? summary.sibling_dependency_table : [];
      return siblingDependencyTable
        .map((item) => asRecord(item))
        .filter((item) => matchesWorkflowV2ObjectRecord(item, identities, ['target_sibling_object_id', 'target_sibling_object_name']))
        .map((item) => ({
          parentName: asText(summary.parent_object_name) || asText(summary.parent_object_id),
          sourceName: asText(item.ablated_child_object_name) || asText(item.ablated_child_object_id),
          targetName: asText(item.target_sibling_object_name) || asText(item.target_sibling_object_id),
          impactLevel: asText(item.impact_level),
          judgement: asText(item.judgement),
          reason: asText(item.reason),
        }));
    });
  const ablationFailures: WorkflowV2ObjectFailureItem[] = [];
  for (const item of input.failedAblationParentItems.map((entry) => asRecord(entry))) {
    if (matchesWorkflowV2ObjectRecord(item, identities, ['parent_object_id', 'parent_object_name'])) {
      ablationFailures.push({
        label: '父节点消融',
        error: asText(item.error) || asText(item.reason) || '父节点消融失败',
        payload: item,
      });
    }
  }
  for (const item of input.failedAblationChildItems.map((entry) => asRecord(entry))) {
    if (matchesWorkflowV2ObjectRecord(item, identities, ['parent_object_id', 'parent_object_name', 'child_object_id', 'child_object_name'])) {
      ablationFailures.push({
        label: asText(item.step) || '子任务消融',
        error: asText(item.error) || asText(item.reason) || '子任务消融失败',
        payload: item,
      });
    }
  }

  return {
    finalReason: asText(input.objectRecord.reason),
    mergeReasons: asStringArray(input.objectRecord.merge_reasons),
    functionReason: asText(functionRecord?.reason),
    functionConfidence: asOptionalNumber(functionRecord?.confidence),
    functionError: asText(functionFailure?.error) || asText(functionFailure?.reason),
    functionErrorPayload: functionFailure,
    decompositionReason: asText(decompositionGroup?.reason),
    outgoingDecompositions,
    incomingDecompositions,
    decompositionError: asText(decompositionFailure?.reason) || asText(decompositionFailure?.error),
    decompositionFailureAttempts,
    parentAblationReason: asText(parentAblation?.reason),
    importanceAsParent,
    importanceAsChild,
    impactAsSource,
    impactAsTarget,
    ablationFailures,
  };
}

function WorkflowV2StageSummaryCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function WorkflowV2ObjectProcessSections({
  insight,
}: {
  insight: WorkflowV2ObjectStageInsight;
}) {
  const hasFunctionSummary = insight.functionReason || insight.functionError;
  const hasFusionSummary = insight.finalReason || insight.mergeReasons.length > 0;
  const hasDecompositionSummary = insight.decompositionReason
    || insight.outgoingDecompositions.length > 0
    || insight.incomingDecompositions.length > 0
    || insight.decompositionError
    || insight.decompositionFailureAttempts.length > 0;
  const hasAblationSummary = insight.parentAblationReason
    || insight.importanceAsParent.length > 0
    || insight.importanceAsChild.length > 0
    || insight.impactAsSource.length > 0
    || insight.impactAsTarget.length > 0
    || insight.ablationFailures.length > 0;

  if (!hasFunctionSummary && !hasFusionSummary && !hasDecompositionSummary && !hasAblationSummary) {
    return null;
  }

  return (
    <div className="space-y-3">
      {hasFunctionSummary ? (
        <WorkflowV2StageSummaryCard title="功能分析">
          <div className="space-y-3 text-sm">
            {insight.functionConfidence !== null ? (
              <Badge variant="outline">置信度 {insight.functionConfidence.toFixed(2)}</Badge>
            ) : null}
            {insight.functionReason ? (
              <div className="leading-6 text-foreground/90">{insight.functionReason}</div>
            ) : null}
            {insight.functionError ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-amber-900">
                <div className="font-black">分析失败</div>
                <div className="mt-2 leading-6">{insight.functionError}</div>
                <ErrorDiagnosticBadges value={insight.functionErrorPayload} />
              </div>
            ) : null}
          </div>
        </WorkflowV2StageSummaryCard>
      ) : null}

      {hasFusionSummary ? (
        <WorkflowV2StageSummaryCard title="融合 / 归并">
          <div className="space-y-3 text-sm">
            {insight.finalReason ? (
              <div className="leading-6 text-foreground/90">{insight.finalReason}</div>
            ) : null}
            {insight.mergeReasons.length > 0 ? (
              <div className="space-y-2">
                {insight.mergeReasons.map((reason, index) => (
                  <div key={`merge-reason-${index}`} className="rounded-xl border border-border/50 bg-muted/15 px-3 py-2 text-sm leading-6 text-foreground/85">
                    {reason}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </WorkflowV2StageSummaryCard>
      ) : null}

      {hasDecompositionSummary ? (
        <WorkflowV2StageSummaryCard title="对象拆解">
          <div className="space-y-3 text-sm">
            {insight.decompositionReason ? (
              <div className="leading-6 text-foreground/90">{insight.decompositionReason}</div>
            ) : null}
            {insight.outgoingDecompositions.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">向下拆解</div>
                {insight.outgoingDecompositions.map((item, index) => (
                  <div key={`outgoing-${index}`} className="rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
                    <div className="font-medium">{item.parentName} → {item.childName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.relation}{item.confidence !== null ? ` · 置信度 ${item.confidence.toFixed(2)}` : ''}</div>
                    {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                    {item.citation ? <CitationPreview citation={item.citation} /> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {insight.incomingDecompositions.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">作为子部件被引用</div>
                {insight.incomingDecompositions.map((item, index) => (
                  <div key={`incoming-${index}`} className="rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
                    <div className="font-medium">{item.parentName} → {item.childName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.relation}{item.confidence !== null ? ` · 置信度 ${item.confidence.toFixed(2)}` : ''}</div>
                    {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                    {item.citation ? <CitationPreview citation={item.citation} /> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {insight.decompositionError || insight.decompositionFailureAttempts.length > 0 ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-amber-900">
                <div className="font-black">拆解失败</div>
                {insight.decompositionError ? <div className="mt-2 text-sm leading-6">{insight.decompositionError}</div> : null}
                {insight.decompositionFailureAttempts.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {insight.decompositionFailureAttempts.map((attempt, index) => (
                      <div key={`decompose-attempt-${index}`} className="rounded-xl border border-amber-500/20 bg-background/80 px-3 py-2">
                        <div className="text-xs font-black">{attempt.label}</div>
                        <div className="mt-1 text-xs leading-5">{attempt.error}</div>
                        <ErrorDiagnosticBadges value={attempt.payload} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </WorkflowV2StageSummaryCard>
      ) : null}

      {hasAblationSummary ? (
        <WorkflowV2StageSummaryCard title="消融 / 作用关系">
          <div className="space-y-3 text-sm">
            {insight.parentAblationReason ? (
              <div className="leading-6 text-foreground/90">{insight.parentAblationReason}</div>
            ) : null}
            {insight.importanceAsParent.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">作为父节点的子部件重要性</div>
                {insight.importanceAsParent.map((item, index) => (
                  <div key={`importance-parent-${index}`} className="rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
                    <div className="font-medium">{item.childName} · {item.importanceLevel || '未标级'}</div>
                    {item.judgement ? <div className="mt-1 text-xs text-muted-foreground">{item.judgement}</div> : null}
                    {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {insight.importanceAsChild.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">作为子部件被消融的结论</div>
                {insight.importanceAsChild.map((item, index) => (
                  <div key={`importance-child-${index}`} className="rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
                    <div className="font-medium">{item.parentName} · {item.importanceLevel || '未标级'}</div>
                    {item.judgement ? <div className="mt-1 text-xs text-muted-foreground">{item.judgement}</div> : null}
                    {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {insight.impactAsSource.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">该对象移除后影响到的同级</div>
                {insight.impactAsSource.map((item, index) => (
                  <div key={`impact-source-${index}`} className="rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
                    <div className="font-medium">{item.sourceName} 影响 {item.targetName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.parentName} · {item.impactLevel || '未标级'}{item.judgement ? ` · ${item.judgement}` : ''}</div>
                    {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {insight.impactAsTarget.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">其他同级移除后对该对象的影响</div>
                {insight.impactAsTarget.map((item, index) => (
                  <div key={`impact-target-${index}`} className="rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
                    <div className="font-medium">{item.sourceName} 影响 {item.targetName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.parentName} · {item.impactLevel || '未标级'}{item.judgement ? ` · ${item.judgement}` : ''}</div>
                    {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {insight.ablationFailures.length > 0 ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-amber-900">
                <div className="font-black">消融失败</div>
                <div className="mt-3 space-y-2">
                  {insight.ablationFailures.map((item, index) => (
                    <div key={`ablation-failure-${index}`} className="rounded-xl border border-amber-500/20 bg-background/80 px-3 py-2">
                      <div className="text-xs font-black">{item.label}</div>
                      <div className="mt-1 text-xs leading-5">{item.error}</div>
                      <ErrorDiagnosticBadges value={item.payload} />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </WorkflowV2StageSummaryCard>
      ) : null}
    </div>
  );
}

function canRetryWorkflowV2Stage(session: WorkflowV2RunSession | null, stageKey: string, retryable: boolean) {
  if (!session || session.isRunning || !retryable) {
    return false;
  }
  const runResult = session.runResult;
  if (!runResult) {
    return false;
  }
  const targetIndex = WORKFLOW_V2_STAGE_DEFINITIONS.findIndex((stage) => stage.key === stageKey);
  if (targetIndex === -1) {
    return false;
  }
  const targetStage = runResult.stage_results.find((stage) => stage.stage === stageKey);
  if (!targetStage || !['success', 'failed'].includes(targetStage.status)) {
    return false;
  }
  for (let index = 0; index < targetIndex; index += 1) {
    const previousStage = runResult.stage_results.find((stage) => stage.stage === WORKFLOW_V2_STAGE_DEFINITIONS[index]?.key);
    if (!previousStage || previousStage.status !== 'success') {
      return false;
    }
  }
  return true;
}

function SectionCard({
  title,
  description,
  children,
  className,
  action,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className={cn('rounded-3xl border-border/60 bg-background/85 shadow-sm', className)}>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-black tracking-tight">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MetricCard({
  title,
  value,
  hint,
  accent,
}: {
  title: string;
  value: ReactNode;
  hint: string;
  accent?: string;
}) {
  return (
    <Card className={cn('rounded-[28px] border-border/60 bg-background/90 shadow-sm', accent)}>
      <CardContent className="p-5">
        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">{title}</div>
        <div className="mt-3 text-3xl font-black tracking-tight text-foreground">{value}</div>
        <div className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

type WorkflowV2ShellSection =
  | 'overview-status'
  | 'overview-system'
  | 'analysis-objects'
  | 'analysis-graph'
  | 'analysis-stages'
  | 'analysis-effects'
  | 'analysis-experts'
  | 'debug';

type WorkflowV2ObjectLibraryFilter = {
  search: string;
  level: 'all' | string;
  structure: 'all' | 'structured' | 'isolated';
};

type WorkflowV2AnalysisSectionState = {
  graph: boolean;
  stageProducts: boolean;
  effects: boolean;
  experts: boolean;
  debug: boolean;
};

export function FileWorkflowV2Page() {
  const [projects, setProjects] = useState<XgProject[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState(() => getStoredSelectedProjectId() || 'demo');
  const [session, setSession] = useState<WorkflowV2RunSession | null>(() => getLatestWorkflowV2Session());
  const [sessions, setSessions] = useState<WorkflowV2RunSession[]>(() => getAllWorkflowV2Sessions());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [config, setConfig] = useState<WorkflowV2Config>({
    workflowModel: 'deepseek/deepseek-v4-flash',
    workflowModelA: 'deepseek/deepseek-v4-flash',
    workflowModelB: 'deepseek/deepseek-v4-flash',
    workflowJudgeModel: 'deepseek/deepseek-v4-flash',
    chunkMaxChars: 600,
    chunkMinChars: 80,
    windowSize: 5,
    windowStep: 2,
    parallelWindows: 4,
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [configSheetOpen, setConfigSheetOpen] = useState(false);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [expandedPanels, setExpandedPanels] = useState<WorkflowV2AnalysisSectionState>({
    graph: false,
    stageProducts: false,
    effects: false,
    experts: false,
    debug: false,
  });
  const [objectLibraryFilter, setObjectLibraryFilter] = useState<WorkflowV2ObjectLibraryFilter>({
    search: '',
    level: 'all',
    structure: 'all',
  });
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [objectLibraryOpen, setObjectLibraryOpen] = useState(false);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState('');
  const [systemViewOpen, setSystemViewOpen] = useState(false);
  const [graphViewOpen, setGraphViewOpen] = useState(false);
  const [hideIsolatedNodes, setHideIsolatedNodes] = useState(true);
  const [graphZoom, setGraphZoom] = useState(1);
  const [mermaidCopied, setMermaidCopied] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writebackPayload, setWritebackPayload] = useState<WorkflowV2WritebackResponse | null>(null);
  const [writebackError, setWritebackError] = useState('');
  const configDirtyRef = useRef(false);

  useEffect(() => {
    configDirtyRef.current = configDirty;
  }, [configDirty]);

  const markConfigDirty = () => {
    configDirtyRef.current = true;
    setConfigDirty(true);
  };

  useEffect(() => {
    void fetchXgProjects()
      .then((items) => {
        setProjects(items);
        if (!selectedProjectId && items[0]?.id) {
          setSelectedProjectIdState(items[0].id);
        }
      })
      .catch(() => {});
  }, [selectedProjectId]);

  useEffect(() => {
    const unsubscribeSessionList = subscribeWorkflowV2Sessions(setSessions);
    const unsubscribeProject = subscribeSelectedProjectIdChange((projectId) => {
      if (projectId) {
        setSelectedProjectIdState(projectId);
      }
    });
    return () => {
      unsubscribeSessionList();
      unsubscribeProject();
    };
  }, []);

  const activeConversationId = session?.conversationId ?? '';
  useEffect(() => {
    if (!activeConversationId) return undefined;
    return subscribeWorkflowV2Session(activeConversationId, setSession);
  }, [activeConversationId]);

  useEffect(() => {
    if (!session) {
      return;
    }
    if (!sessions.some((item) => item.conversationId === session.conversationId)) {
      setSession(null);
    }
  }, [session, sessions]);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setConfigLoading(true);
      try {
        const next = await fetchWorkflowV2Config();
        if (cancelled || configDirtyRef.current) {
          return;
        }
        const primaryModel = next.workflowModelA || next.workflowModel || 'deepseek/deepseek-v4-flash';
        setConfig({
          ...next,
          workflowModel: next.workflowModel || primaryModel,
          workflowModelA: primaryModel,
          workflowModelB: next.workflowModelB || primaryModel,
          workflowJudgeModel: next.workflowJudgeModel || primaryModel,
        });
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : '读取 V2 配置失败');
        }
      } finally {
        if (!cancelled) {
          setConfigLoading(false);
        }
      }
    };

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setExpandedPanels((current) => ({ ...current, debug: false }));
    setWritebackPayload(null);
    setWritebackError('');
  }, [session?.conversationId]);

  const stageResults = session?.runResult?.stage_results ?? [];
  const totalStages = WORKFLOW_V2_STAGE_DEFINITIONS.length;
  const completedStages = stageResults.filter((item) => item.status === 'success').length;
  const failedStages = stageResults.filter((item) => item.status === 'failed').length;
  const activeStage = stageResults.find((item) => item.status === 'running') ?? null;
  const latestFinishedStage = [...stageResults].reverse().find((item) => item.status === 'success' || item.status === 'failed') ?? null;
  const rawProgressValue = totalStages > 0
    ? Math.round((((completedStages + (activeStage ? 0.5 : 0)) / totalStages) * 100))
    : 0;
  const progressValue = Math.max(0, Math.min(100, rawProgressValue));
  const activeStageMeta = activeStage
    ? WORKFLOW_V2_STAGE_DEFINITIONS.find((item) => item.key === activeStage.stage) ?? null
    : null;
  const latestStageMeta = latestFinishedStage
    ? WORKFLOW_V2_STAGE_DEFINITIONS.find((item) => item.key === latestFinishedStage.stage) ?? null
    : null;
  const result = session?.runResult?.result ?? null;
  const summary = extractWorkflowV2Summary(result);

  const chunkOutput = asRecord(stageResults.find((item) => item.stage === 'chunk_parse')?.output);
  const chunkFilterOutput = asRecord(stageResults.find((item) => item.stage === 'chunk_filter')?.output);
  const windowOutput = asRecord(stageResults.find((item) => item.stage === 'window_extract')?.output);
  const fusionOutput = asRecord(stageResults.find((item) => item.stage === 'object_fusion')?.output);
  const functionOutput = asRecord(stageResults.find((item) => item.stage === 'function_analysis')?.output);
  const decomposeOutput = asRecord(stageResults.find((item) => item.stage === 'object_decompose')?.output);
  const graphOutput = asRecord(stageResults.find((item) => item.stage === 'graph_build')?.output);
  const ablationOutput = asRecord(stageResults.find((item) => item.stage === 'ablation_analysis')?.output);
  const chunkItems = Array.isArray(chunkOutput.chunks) ? chunkOutput.chunks : [];
  const selectedChunkItems = Array.isArray(chunkFilterOutput.selected_chunks) ? chunkFilterOutput.selected_chunks : [];
  const selectedChunkIds = asStringArray(chunkFilterOutput.selected_chunk_ids);
  const windowItems = Array.isArray(windowOutput.window_results) ? windowOutput.window_results : [];
  const failedWindowItems = Array.isArray(windowOutput.failed_windows) ? windowOutput.failed_windows : [];
  const fusionJudgeItems = Array.isArray(fusionOutput.judge_results) ? fusionOutput.judge_results : [];
  const fusedObjectItems = Array.isArray(functionOutput.function_objects) && functionOutput.function_objects.length > 0
    ? functionOutput.function_objects
    : (Array.isArray(fusionOutput.fused_objects) ? fusionOutput.fused_objects : []);
  const failedFunctionItems = Array.isArray(functionOutput.failed_function_objects) ? functionOutput.failed_function_objects : [];
  const decompositionGroups = Array.isArray(decomposeOutput.decomposition_results) ? decomposeOutput.decomposition_results : [];
  const failedObjectItems = Array.isArray(decomposeOutput.failed_objects) ? decomposeOutput.failed_objects : [];
  const removedCycleEdgeItems = Array.isArray(graphOutput.removed_cycle_edges) ? graphOutput.removed_cycle_edges : [];
  const ablationItems = Array.isArray(ablationOutput.parent_summaries) ? ablationOutput.parent_summaries : [];
  const failedAblationParentItems = Array.isArray(ablationOutput.failed_parent_analyses) ? ablationOutput.failed_parent_analyses : [];
  const failedAblationChildItems = ablationItems.flatMap((item) => {
    const record = asRecord(item);
    return Array.isArray(record.failed_child_analyses) ? record.failed_child_analyses : [];
  });
  const shownDecompositionCount = decompositionGroups.reduce((sum, group) => {
    const record = asRecord(group);
    return sum + (Array.isArray(record.decompositions) ? record.decompositions.length : 0);
  }, 0);
  const stageGraphObjects = Array.isArray(functionOutput.function_objects) && functionOutput.function_objects.length > 0
    ? functionOutput.function_objects
    : (Array.isArray(fusionOutput.fused_objects) ? fusionOutput.fused_objects : []);
  const stageGraphEdges = Array.isArray(graphOutput.edges) ? graphOutput.edges : [];
  const prefersStageGraphData = stageGraphObjects.length > 0
    && (stageGraphEdges.length > 0 || stageResults.some((item) => item.stage === 'graph_build' && item.status === 'success'));

  const graphLayout = useMemo(() => {
    if (prefersStageGraphData) {
      return buildWorkflowV2GraphLayoutFromStageData({
        objects: stageGraphObjects,
        edges: stageGraphEdges,
        options: { hideIsolatedNodes },
      });
    }
    return buildWorkflowV2GraphLayout(result, { hideIsolatedNodes });
  }, [hideIsolatedNodes, prefersStageGraphData, result, stageGraphEdges, stageGraphObjects]);

  const mermaidCode = useMemo(() => {
    if (prefersStageGraphData) {
      return buildWorkflowV2MermaidFromStageData({
        objects: stageGraphObjects,
        edges: stageGraphEdges,
        options: { hideIsolatedNodes },
      });
    }
    return buildWorkflowV2Mermaid(result, { hideIsolatedNodes });
  }, [hideIsolatedNodes, prefersStageGraphData, result, stageGraphEdges, stageGraphObjects]);
  const systemDecompositionView = useMemo(() => (
    buildWorkflowV2SystemDecompositionView({
      objects: prefersStageGraphData ? stageGraphObjects : result?.objects,
      edges: prefersStageGraphData ? stageGraphEdges : result?.edges,
      maxDepth: 2,
    })
  ), [prefersStageGraphData, result?.edges, result?.objects, stageGraphEdges, stageGraphObjects]);

  const windowProgressRecord = asRecord(windowOutput.progress);
  const decomposeProgressRecord = asRecord(decomposeOutput.progress);
  const ablationProgressRecord = asRecord(ablationOutput.progress);
  const windowExtractProgress = session?.windowExtractProgress ?? (
    typeof windowProgressRecord.completed === 'number' && typeof windowProgressRecord.total === 'number'
      ? {
        completed: windowProgressRecord.completed,
        total: windowProgressRecord.total,
        parallel: typeof windowProgressRecord.parallel === 'number' ? windowProgressRecord.parallel : 1,
        lastWindowId: null,
      }
      : null
  );
  const objectDecomposeProgress = session?.objectDecomposeProgress ?? (
    typeof decomposeProgressRecord.completed === 'number' && typeof decomposeProgressRecord.total === 'number'
      ? {
        completed: decomposeProgressRecord.completed,
        total: decomposeProgressRecord.total,
        failed: typeof decomposeProgressRecord.failed === 'number' ? decomposeProgressRecord.failed : 0,
        lastObjectName: null,
        lastFailedObjectName: null,
      }
      : null
  );
  const ablationAnalysisProgress = session?.ablationAnalysisProgress ?? (
    typeof ablationProgressRecord.completed === 'number' && typeof ablationProgressRecord.total === 'number'
      ? {
        completed: ablationProgressRecord.completed,
        total: ablationProgressRecord.total,
        lastParentObjectId: null,
        lastParentObjectName: null,
        currentParentObjectId: null,
        currentParentObjectName: null,
        currentChildObjectId: null,
        currentChildObjectName: null,
        processedChildCount: 0,
        totalChildCount: 0,
      }
      : null
  );

  const objectDecomposeProgressValue = objectDecomposeProgress && objectDecomposeProgress.total > 0
    ? Math.round((objectDecomposeProgress.completed / objectDecomposeProgress.total) * 100)
    : 0;
  const ablationAnalysisProgressValue = ablationAnalysisProgress && ablationAnalysisProgress.total > 0
    ? Math.round((ablationAnalysisProgress.completed / ablationAnalysisProgress.total) * 100)
    : 0;
  const chunkTotalCount = asCount(chunkOutput.total_chunks, summary.chunkCount);
  const selectedChunkTotalCount = asCount(chunkFilterOutput.total_selected_chunks, selectedChunkItems.length);
  const selectedChunkInputCount = asCount(chunkFilterOutput.total_input_chunks, chunkTotalCount);
  const windowTotalCount = windowExtractProgress?.total ?? asCount(windowOutput.total_windows, summary.windowCount);
  const failedWindowTotalCount = asCount(asRecord(windowOutput.progress).failed, failedWindowItems.length);
  const fusedObjectTotalCount = asCount(
    functionOutput.total_function_objects,
    asCount(fusionOutput.total_fused_objects, summary.objectCount),
  );
  const failedFunctionTotalCount = asCount(asRecord(functionOutput.progress).failed, failedFunctionItems.length);
  const decompositionTotalCount = asCount(decomposeOutput.total_decompositions, shownDecompositionCount);
  const failedObjectTotalCount = asCount(decomposeOutput.total_failed_objects, failedObjectItems.length);
  const graphNodeTotalCount = Math.max(summary.objectCount, fusedObjectTotalCount);
  const graphEdgeTotalCount = asCount(graphOutput.total_edges, summary.edgeCount);
  const removedCycleEdgeTotalCount = asCount(graphOutput.total_removed_cycle_edges, removedCycleEdgeItems.length);
  const ablationTotalCount = ablationAnalysisProgress?.total ?? asCount(ablationOutput.total_parent_summaries, ablationItems.length);
  const failedAblationParentTotalCount = asCount(asRecord(ablationOutput.progress).failed, failedAblationParentItems.length);
  const siblingImpactEdges = useMemo(() => extractWorkflowV2SiblingImpactEdges(ablationItems), [ablationItems]);
  const sessionStatusMeta = getSessionStatusMeta(session, failedStages);
  const selectedProjectName = projects.find((item) => item.id === selectedProjectId)?.name || selectedProjectId || '未选择项目';
  const objectLibraryItems = useMemo(
    () => buildWorkflowV2DisplayObjects(
      Array.isArray(result?.objects) && result.objects.length > 0 ? result.objects : fusedObjectItems,
      Array.isArray(result?.edges) && result.edges.length > 0 ? result.edges : stageGraphEdges,
    ),
    [fusedObjectItems, result?.edges, result?.objects, stageGraphEdges],
  );
  const objectLibraryItemMap = useMemo(() => {
    return new Map(
      objectLibraryItems
        .map((item) => {
          const record = asRecord(item);
          return [asText(record.object_id), record] as const;
        })
        .filter(([objectId]) => Boolean(objectId)),
    );
  }, [objectLibraryItems]);
  const latestFocusTarget = ablationAnalysisProgress?.currentParentObjectName
    || ablationAnalysisProgress?.lastParentObjectName
    || objectDecomposeProgress?.lastObjectName
    || objectDecomposeProgress?.lastFailedObjectName
    || windowExtractProgress?.lastWindowId
    || '';
  const canWriteback = canWriteWorkflowV2Session(session) && !session?.isRunning && !writing;
  const writebackSummary = useMemo(
    () => (writebackPayload ? extractWorkflowV2WritebackSummary(writebackPayload) : null),
    [writebackPayload],
  );
  const objectLevelOptions = useMemo(() => {
    return [...new Set(objectLibraryItems.map((item) => asText(asRecord(item).object_level)).filter(Boolean))];
  }, [objectLibraryItems]);
  const filteredObjectItems = useMemo(() => {
    const keyword = objectLibraryFilter.search.trim().toLowerCase();
    return objectLibraryItems.filter((item) => {
      const record = asRecord(item);
      const name = asText(record.object_name);
      const normalized = asText(record.normalized_name);
      const level = asText(record.object_level);
      const structureStatus = asText(record.structure_status);
      const matchesKeyword = !keyword
        || name.toLowerCase().includes(keyword)
        || normalized.toLowerCase().includes(keyword);
      const matchesLevel = objectLibraryFilter.level === 'all' || level === objectLibraryFilter.level;
      const matchesStructure = objectLibraryFilter.structure === 'all'
        || (objectLibraryFilter.structure === 'isolated' ? structureStatus === 'isolated' : structureStatus !== 'isolated');
      return matchesKeyword && matchesLevel && matchesStructure;
    });
  }, [objectLibraryFilter.level, objectLibraryFilter.search, objectLibraryFilter.structure, objectLibraryItems]);
  const selectedObjectRecord = useMemo(() => {
    const explicit = filteredObjectItems.find((item) => asText(asRecord(item).object_id) === selectedObjectId);
    return asRecord(explicit ?? filteredObjectItems[0] ?? null);
  }, [filteredObjectItems, selectedObjectId]);
  const selectedObjectIdValue = asText(selectedObjectRecord.object_id);
  const rawGraphEdges = Array.isArray(result?.edges) ? result.edges : stageGraphEdges;
  const selectedObjectEdges = useMemo(() => {
    return (Array.isArray(rawGraphEdges) ? rawGraphEdges : []).filter((item) => {
      const record = asRecord(item);
      return asText(record.source_object_id) === selectedObjectIdValue || asText(record.target_object_id) === selectedObjectIdValue;
    });
  }, [rawGraphEdges, selectedObjectIdValue]);
  const graphNodeMap = useMemo(() => {
    return new Map(graphLayout.nodes.map((node) => [node.id, node] as const));
  }, [graphLayout.nodes]);
  const graphRenderableImpactEdges = useMemo(() => {
    return siblingImpactEdges.filter((edge) => graphNodeMap.has(edge.sourceId) && graphNodeMap.has(edge.targetId));
  }, [graphNodeMap, siblingImpactEdges]);
  const selectedGraphNodeIdValue = graphNodeMap.has(graphFocusNodeId) ? graphFocusNodeId : '';
  const selectedGraphNode = selectedGraphNodeIdValue ? graphNodeMap.get(selectedGraphNodeIdValue) ?? null : null;
  const selectedGraphNodeRecord = useMemo(() => {
    return asRecord(selectedGraphNodeIdValue ? objectLibraryItemMap.get(selectedGraphNodeIdValue) ?? null : null);
  }, [objectLibraryItemMap, selectedGraphNodeIdValue]);
  const selectedGraphRawEdges = useMemo(() => {
    if (!selectedGraphNodeIdValue) {
      return [];
    }
    return (Array.isArray(rawGraphEdges) ? rawGraphEdges : []).filter((item) => {
      const record = asRecord(item);
      return asText(record.source_object_id) === selectedGraphNodeIdValue || asText(record.target_object_id) === selectedGraphNodeIdValue;
    });
  }, [rawGraphEdges, selectedGraphNodeIdValue]);
  const selectedGraphStructureEdges = useMemo(() => {
    if (!selectedGraphNodeIdValue) {
      return [];
    }
    return graphLayout.edges.filter((edge) => edge.sourceId === selectedGraphNodeIdValue || edge.targetId === selectedGraphNodeIdValue);
  }, [graphLayout.edges, selectedGraphNodeIdValue]);
  const selectedGraphImpactEdges = useMemo(() => {
    if (!selectedGraphNodeIdValue) {
      return [];
    }
    return graphRenderableImpactEdges.filter((edge) => edge.sourceId === selectedGraphNodeIdValue || edge.targetId === selectedGraphNodeIdValue);
  }, [graphRenderableImpactEdges, selectedGraphNodeIdValue]);
  const graphFocusedNeighborIds = useMemo(() => {
    const relatedIds = new Set<string>();
    if (!selectedGraphNodeIdValue) {
      return relatedIds;
    }
    relatedIds.add(selectedGraphNodeIdValue);
    for (const edge of selectedGraphStructureEdges) {
      relatedIds.add(edge.sourceId);
      relatedIds.add(edge.targetId);
    }
    for (const edge of selectedGraphImpactEdges) {
      relatedIds.add(edge.sourceId);
      relatedIds.add(edge.targetId);
    }
    return relatedIds;
  }, [selectedGraphImpactEdges, selectedGraphNodeIdValue, selectedGraphStructureEdges]);
  const selectedObjectInsight = useMemo(() => (
    buildWorkflowV2ObjectStageInsight({
      objectRecord: selectedObjectRecord,
      functionObjects: Array.isArray(functionOutput.function_objects) ? functionOutput.function_objects : [],
      failedFunctionObjects: failedFunctionItems,
      decompositionGroups,
      failedObjectItems,
      ablationItems,
      failedAblationParentItems,
      failedAblationChildItems,
    })
  ), [
    ablationItems,
    decompositionGroups,
    failedAblationChildItems,
    failedAblationParentItems,
    failedFunctionItems,
    failedObjectItems,
    functionOutput.function_objects,
    selectedObjectRecord,
  ]);
  const selectedGraphNodeInsight = useMemo(() => (
    buildWorkflowV2ObjectStageInsight({
      objectRecord: selectedGraphNodeRecord,
      functionObjects: Array.isArray(functionOutput.function_objects) ? functionOutput.function_objects : [],
      failedFunctionObjects: failedFunctionItems,
      decompositionGroups,
      failedObjectItems,
      ablationItems,
      failedAblationParentItems,
      failedAblationChildItems,
    })
  ), [
    ablationItems,
    decompositionGroups,
    failedAblationChildItems,
    failedAblationParentItems,
    failedFunctionItems,
    failedObjectItems,
    functionOutput.function_objects,
    selectedGraphNodeRecord,
  ]);
  const recentSessions = sessions.slice(0, 3);
  const stageNavigationItems = useMemo(() => {
    return WORKFLOW_V2_STAGE_DEFINITIONS.map((stage) => {
      const resultItem = stageResults.find((item) => item.stage === stage.key) ?? null;
      return {
        stage,
        resultItem,
        retryEnabled: canRetryWorkflowV2Stage(session, stage.key, stage.retryable !== false),
      };
    });
  }, [session, stageResults]);
  useEffect(() => {
    if (!selectedObjectId && filteredObjectItems.length > 0) {
      setSelectedObjectId(asText(asRecord(filteredObjectItems[0]).object_id));
      return;
    }
    if (selectedObjectId && filteredObjectItems.every((item) => asText(asRecord(item).object_id) !== selectedObjectId)) {
      setSelectedObjectId(asText(asRecord(filteredObjectItems[0]).object_id));
    }
  }, [filteredObjectItems, selectedObjectId]);

  useEffect(() => {
    if (graphFocusNodeId && !graphNodeMap.has(graphFocusNodeId)) {
      setGraphFocusNodeId('');
    }
  }, [graphFocusNodeId, graphNodeMap]);

  const handleStart = () => {
    if (!selectedFile) {
      toast.error('请先选择文件');
      return;
    }
    if (!selectedProjectId) {
      toast.error('请先选择 project_id');
      return;
    }
    try {
      const conversationId = startWorkflowV2Run({
        file: selectedFile,
        projectId: selectedProjectId,
      });
      activateWorkflowV2Session(conversationId);
      setSession(getLatestWorkflowV2Session());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动 V2 工作流失败');
    }
  };

  const handleEnterFreshView = () => {
    setSession(null);
    setExpandedPanels({
      graph: false,
      stageProducts: false,
      effects: false,
      experts: false,
      debug: false,
    });
    setWritebackPayload(null);
    setWritebackError('');
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      const next = await updateWorkflowV2Config(config);
      setConfig(next);
      configDirtyRef.current = false;
      setConfigDirty(false);
      toast.success('V2 配置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 V2 配置失败');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectIdState(projectId);
    setStoredSelectedProjectId(projectId);
  };

  const handleRetryStage = (stageKey: string) => {
    if (!session) {
      return;
    }
    try {
      retryWorkflowV2RunFromStage({
        conversationId: session.conversationId,
        startStage: stageKey,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '触发 V2 阶段重试失败');
    }
  };

  const handleCopyMermaid = async () => {
    if (!mermaidCode.trim()) {
      toast.error('当前还没有可复制的 Mermaid 图');
      return;
    }
    try {
      await copyCodeToClipboard(mermaidCode);
      setMermaidCopied(true);
      toast.success('Mermaid 已复制到剪贴板');
      if (typeof window !== 'undefined') {
        window.setTimeout(() => setMermaidCopied(false), 1800);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制 Mermaid 失败');
    }
  };

  const handleWriteback = async () => {
    if (!session?.conversationId) {
      toast.error('当前没有可写回的 V2 会话');
      return;
    }

    setWriting(true);
    setWritebackPayload(null);
    setWritebackError('');

    try {
      const payload = await writeWorkflowV2SessionToOntoGit({
        conversationId: session.conversationId,
        projectId: selectedProjectId || session.projectId || undefined,
      });
      const summaryInfo = extractWorkflowV2WritebackSummary(payload);
      setWritebackPayload(payload);
      toast.success(
        summaryInfo.lastCommitId
          ? `已写入 OntoGit，commit ${summaryInfo.lastCommitId}`
          : '已写入 OntoGit 并完成推理',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '写入 OntoGit 失败';
      setWritebackError(message);
      toast.error(message);
    } finally {
      setWriting(false);
    }
  };

  const togglePanel = (panelKey: keyof WorkflowV2AnalysisSectionState) => {
    setExpandedPanels((current) => ({ ...current, [panelKey]: !current[panelKey] }));
  };

  const scrollToSection = (sectionId: WorkflowV2ShellSection) => {
    setExpandedPanels((current) => ({
      ...current,
      graph: sectionId === 'analysis-graph' ? true : current.graph,
      stageProducts: sectionId === 'analysis-stages' ? true : current.stageProducts,
      effects: sectionId === 'analysis-effects' ? true : current.effects,
      experts: sectionId === 'analysis-experts' ? true : current.experts,
      debug: sectionId === 'debug' ? true : current.debug,
    }));
    const target = typeof document !== 'undefined' ? document.getElementById(sectionId) : null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const stageSectionMap: Record<string, WorkflowV2ShellSection> = {
    chunk_parse: 'analysis-stages',
    chunk_filter: 'analysis-stages',
    system_scope_identify: 'overview-system',
    window_extract: 'analysis-stages',
    object_fusion: 'analysis-objects',
    granularity_align: 'analysis-objects',
    function_analysis: 'analysis-objects',
    object_decompose: 'analysis-stages',
    graph_build: 'analysis-graph',
    structure_quality_gate: 'analysis-graph',
    ablation_analysis: 'analysis-effects',
  };
  const expertPreviewSummary = {
    fusionJudge: fusionJudgeItems.length,
    windows: windowItems.filter((item) => asRecord(item).llm_ensemble).length,
    functions: fusedObjectItems.filter((item) => Boolean(asRecord(item).llm_ensemble ?? asRecord(item).function_llm_ensemble)).length,
    decompositions: decompositionGroups.filter((item) => asRecord(item).llm_ensemble).length + removedCycleEdgeItems.filter((item) => asRecord(item).llm_ensemble).length,
    effects: ablationItems.reduce((sum, item) => {
      const record = asRecord(item);
      const siblingCount = (Array.isArray(record.sibling_dependency_table) ? record.sibling_dependency_table : [])
        .filter((impact) => Boolean(asRecord(impact).llm_ensemble)).length;
      const importanceCount = (Array.isArray(record.child_importance_list) ? record.child_importance_list : [])
        .filter((impact) => Boolean(asRecord(impact).llm_ensemble)).length;
      return sum + siblingCount + importanceCount;
    }, 0),
  };
  const hasAnyExpertPreview = Object.values(expertPreviewSummary).some((count) => count > 0);

  const graphCanvasWidth = graphLayout.nodes.length > 0
    ? Math.max(720, ...graphLayout.nodes.map((node) => node.x + 160))
    : 720;
  const graphCanvasHeight = graphLayout.nodes.length > 0
    ? Math.max(420, ...graphLayout.nodes.map((node) => node.y + 80))
    : 420;
  const graphScaledWidth = Math.round(graphCanvasWidth * graphZoom);
  const graphScaledHeight = Math.round(graphCanvasHeight * graphZoom);

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.1),transparent_24%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] p-4 sm:p-6">
      <div className="mx-auto grid max-w-[1680px] gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card className="rounded-[30px] border-border/60 bg-background/90 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-black tracking-tight">当前会话</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge className={cn('rounded-full border px-3 py-1 font-semibold', sessionStatusMeta.badgeClass)}>
                  {sessionStatusMeta.label}
                </Badge>
                <Badge variant="outline" className="rounded-full">项目 {selectedProjectName}</Badge>
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div>文件：{selectedFile?.name || '尚未选择文件'}</div>
                <div>会话：{session?.conversationId ? session.conversationId.slice(-12) : '当前无会话'}</div>
                <div>最近完成：{session?.lastRunAt || '暂无'}</div>
                <div>写回：{writebackSummary?.lastCommitId || (writebackError ? '最近失败' : '尚未写回')}</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/15 p-3 text-xs leading-5 text-muted-foreground">
                {session?.statusMessage || '当前暂无状态信息。'}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[30px] border-border/60 bg-background/90 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-black tracking-tight">流程阶段</CardTitle>
              <CardDescription>按 10 个阶段收纳状态、跳转和重试入口。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {stageNavigationItems.map(({ stage, resultItem, retryEnabled }) => {
                const stageProgress = resultItem?.status === 'success' ? 100 : resultItem?.status === 'running' ? 55 : resultItem?.status === 'failed' ? 100 : 0;
                return (
                  <div key={stage.key} className={cn('rounded-2xl border p-3 transition-colors', statusClass(resultItem?.status || 'pending'))}>
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => scrollToSection(stageSectionMap[stage.key] || 'overview-status')}
                      >
                        <div className="flex items-center gap-2">
                          <div className="rounded-xl border border-border/60 bg-background/80 p-2 text-primary">
                            {STAGE_ICONS[stage.key] ?? <Activity className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground">{stage.short}</div>
                            <div className="truncate text-sm font-black">{stage.title}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-xs leading-5 text-muted-foreground">{stage.detail}</div>
                      </button>
                      <Badge variant="outline" className="rounded-full">{resultItem?.status || 'pending'}</Badge>
                    </div>
                    <Progress value={stageProgress} className="mt-3 h-1.5 bg-background/70" />
                    {resultItem?.error ? (
                      <div className="mt-2">
                        <div className="text-xs leading-5 text-red-600">{resultItem.error}</div>
                        <ErrorDiagnosticBadges value={resultItem.output} />
                      </div>
                    ) : null}
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-full"
                        disabled={!retryEnabled}
                        onClick={() => handleRetryStage(stage.key)}
                      >
                        <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                        重试
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="rounded-[30px] border-border/60 bg-background/90 shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-black tracking-tight">最近会话</CardTitle>
                  <CardDescription>默认只保留最近 3 个摘要入口。</CardDescription>
                </div>
                <Sheet open={historySheetOpen} onOpenChange={setHistorySheetOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="rounded-full">
                      查看全部
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-full max-w-[560px] overflow-y-auto border-l border-border/60 bg-background/95">
                    <SheetHeader className="border-b border-border/50 px-6 py-5">
                      <SheetTitle className="text-2xl font-black tracking-tight">历史会话</SheetTitle>
                      <SheetDescription>回看结果、附着会话或清理本地缓存。</SheetDescription>
                    </SheetHeader>
                    <div className="space-y-3 px-6 py-5">
                      {sessions.length > 0 ? sessions.map((item) => (
                        <div key={item.conversationId} className="rounded-2xl border border-border/60 bg-background/80 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black">{item.projectId}</div>
                              <div className="truncate text-xs text-muted-foreground">{item.conversationId}</div>
                            </div>
                            <Badge variant="outline">{item.runResult?.workflow.status || 'idle'}</Badge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {item.lastRunAt ? `最近完成：${item.lastRunAt}` : (item.statusMessage || '暂无进度信息')}
                          </div>
                          <div className="mt-3 flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="rounded-full"
                              onClick={() => {
                                activateWorkflowV2Session(item.conversationId);
                                setSession(getWorkflowV2Session(item.conversationId) ?? item);
                                setHistorySheetOpen(false);
                              }}
                            >
                              <FileJson className="mr-2 h-3.5 w-3.5" />
                              查看
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="rounded-full"
                              onClick={() => {
                                removeWorkflowV2Session(item.conversationId);
                                setSession((current) => current?.conversationId === item.conversationId ? null : current);
                              }}
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              删除
                            </Button>
                          </div>
                        </div>
                      )) : (
                        <div className="text-sm text-muted-foreground">还没有 V2 会话历史。</div>
                      )}
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentSessions.length > 0 ? recentSessions.map((item) => (
                <button
                  key={item.conversationId}
                  type="button"
                  onClick={() => {
                    activateWorkflowV2Session(item.conversationId);
                    setSession(getWorkflowV2Session(item.conversationId) ?? item);
                  }}
                  className="w-full rounded-2xl border border-border/60 bg-background/70 p-3 text-left hover:bg-muted/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black">{item.projectId}</div>
                      <div className="truncate text-xs text-muted-foreground">{item.conversationId}</div>
                    </div>
                    <Badge variant="outline">{item.runResult?.workflow.status || 'idle'}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{item.lastRunAt || item.statusMessage || '暂无进度信息'}</div>
                </button>
              )) : (
                <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 p-3 text-sm text-muted-foreground">
                  还没有 V2 会话历史。
                </div>
              )}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 space-y-6">
          <Card className="overflow-hidden rounded-[32px] border-border/60 bg-background/90 shadow-xl">
            <div className="border-b border-border/50 bg-[linear-gradient(135deg,rgba(14,165,233,0.08),rgba(16,185,129,0.08))]">
              <CardHeader className="gap-6 pb-6">
                <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-4xl">
                    <div className="text-xs font-black uppercase tracking-[0.24em] text-muted-foreground">Workflow V2</div>
                    <CardTitle className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">文件工作流 V2 分析页</CardTitle>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge className={cn('rounded-full border px-4 py-1.5 font-semibold', sessionStatusMeta.badgeClass)}>
                        {sessionStatusMeta.label}
                      </Badge>
                      <Badge variant="outline" className="rounded-full px-4 py-1.5">项目 {selectedProjectName}</Badge>
                      <Badge variant="outline" className="rounded-full px-4 py-1.5">
                        {writebackSummary?.lastCommitId ? `commit ${writebackSummary.lastCommitId}` : '尚未写回'}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid w-full gap-3 sm:grid-cols-2 xl:max-w-[520px]">
                    <MetricCard
                      title="阶段进度"
                      value={`${progressValue}%`}
                      hint={`${completedStages}/${totalStages} 已完成，${failedStages} 个失败`}
                      accent="border-sky-500/20"
                    />
                    <MetricCard
                      title="写回状态"
                      value={writebackSummary?.lastCommitId || (writebackError ? '失败' : '未写回')}
                      hint={writebackSummary ? `版本 ${writebackSummary.lastVersionId ?? '未返回'} · ${formatPercent(writebackSummary.inferenceProbability)}` : (writebackError || '当前会话尚未执行写回')}
                      accent="border-violet-500/20"
                    />
                  </div>
                </div>
              </CardHeader>
            </div>

            <CardContent className="space-y-5 p-5 sm:p-6">
              <div className="rounded-[28px] border border-border/60 bg-muted/20 p-4 sm:p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(240px,280px)_minmax(260px,1fr)]">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">项目选择</div>
                      <Select value={selectedProjectId} onValueChange={handleProjectChange}>
                        <SelectTrigger className="rounded-2xl bg-background/90">
                          <SelectValue placeholder="选择 project_id" />
                        </SelectTrigger>
                        <SelectContent>
                          {(projects.length === 0 ? [{ id: 'demo', name: 'demo' } as XgProject] : projects).map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name || project.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">上传文件</div>
                      <Input
                        type="file"
                        className="rounded-2xl bg-background/90"
                        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button type="button" onClick={handleStart} disabled={!selectedFile || !selectedProjectId || session?.isRunning} className="rounded-2xl">
                      {session?.isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                      启动
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => session && void terminateWorkflowV2Run(session.conversationId)}
                      disabled={!session?.isRunning}
                      className="rounded-2xl"
                    >
                      <Square className="mr-2 h-4 w-4" />
                      终止
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleWriteback()}
                      disabled={!canWriteback}
                      className="rounded-2xl"
                    >
                      {writing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranchPlus className="mr-2 h-4 w-4" />}
                      写入 OntoGit
                    </Button>
                    <Sheet open={configSheetOpen} onOpenChange={setConfigSheetOpen}>
                      <SheetTrigger asChild>
                        <Button type="button" variant="outline" className="rounded-2xl">
                          <Settings2 className="mr-2 h-4 w-4" />
                          高级配置
                        </Button>
                      </SheetTrigger>
                      <SheetContent side="right" className="w-full max-w-[560px] overflow-y-auto border-l border-border/60 bg-background/95">
                        <SheetHeader className="border-b border-border/50 px-6 py-5">
                          <SheetTitle className="text-2xl font-black tracking-tight">高级配置</SheetTitle>
                          <SheetDescription>模型和 chunk/window 参数统一收进这里，避免首屏被表单淹没。</SheetDescription>
                        </SheetHeader>
                        <div className="space-y-5 px-6 py-5">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline" className="rounded-full">A {config.workflowModelA}</Badge>
                            <Badge variant="outline" className="rounded-full">B {config.workflowModelB}</Badge>
                            <Badge variant="outline" className="rounded-full">Judge {config.workflowJudgeModel}</Badge>
                            <Badge variant="secondary" className="rounded-full">Chunk {config.chunkMinChars}-{config.chunkMaxChars}</Badge>
                            <Badge variant="secondary" className="rounded-full">Window {config.windowSize}/{config.windowStep}</Badge>
                            <Badge variant="secondary" className="rounded-full">Parallel {config.parallelWindows}</Badge>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-muted-foreground">Workflow Model A</div>
                              <Input
                                value={config.workflowModelA}
                                onChange={(event) => {
                                  markConfigDirty();
                                  setConfig((prev) => ({
                                    ...prev,
                                    workflowModel: event.target.value,
                                    workflowModelA: event.target.value,
                                  }));
                                }}
                                className="rounded-2xl"
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-muted-foreground">Workflow Model B</div>
                              <Input
                                value={config.workflowModelB}
                                onChange={(event) => {
                                  markConfigDirty();
                                  setConfig((prev) => ({ ...prev, workflowModelB: event.target.value }));
                                }}
                                className="rounded-2xl"
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-muted-foreground">Judge Model</div>
                              <Input
                                value={config.workflowJudgeModel}
                                onChange={(event) => {
                                  markConfigDirty();
                                  setConfig((prev) => ({ ...prev, workflowJudgeModel: event.target.value }));
                                }}
                                className="rounded-2xl"
                              />
                            </div>
                            {[
                              ['chunkMaxChars', 'Chunk Max'],
                              ['chunkMinChars', 'Chunk Min'],
                              ['windowSize', 'Window Size'],
                              ['windowStep', 'Window Step'],
                              ['parallelWindows', 'Parallel Windows'],
                            ].map(([key, label]) => (
                              <div key={key} className="space-y-2">
                                <div className="text-xs font-semibold text-muted-foreground">{label}</div>
                                <Input
                                  type="number"
                                  value={config[key as keyof WorkflowV2Config] as number}
                                  className="rounded-2xl"
                                  onChange={(event) => {
                                    markConfigDirty();
                                    setConfig((prev) => ({
                                      ...prev,
                                      [key]: Number(event.target.value) || 0,
                                    }));
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <Button type="button" variant="outline" onClick={handleSaveConfig} disabled={configSaving || configLoading} className="rounded-2xl">
                              <RefreshCcw className={cn('mr-2 h-4 w-4', configSaving ? 'animate-spin' : '')} />
                              保存配置
                            </Button>
                            <Button type="button" variant="ghost" onClick={handleEnterFreshView} className="rounded-2xl">
                              <RefreshCcw className="mr-2 h-4 w-4" />
                              新建视图
                            </Button>
                          </div>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{sessionStatusMeta.description}</span>
                  <span>·</span>
                  <span>{session?.statusMessage || '当前是全新界面，可直接启动工作流。'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div id="overview-status" className="scroll-mt-6">
            <SectionCard title="运行态摘要" description="查看当前会话与阶段状态。">
              <div className="space-y-4">
                <div className="rounded-3xl border border-border/60 bg-muted/15 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-muted-foreground">Workflow Pulse</div>
                      <div className="mt-2 text-3xl font-black tracking-tight">{progressValue}%</div>
                      <div className="mt-2 text-sm text-muted-foreground">{session?.statusMessage || '当前还没有运行中的会话。'}</div>
                    </div>
                    <div className="grid gap-2 text-sm text-muted-foreground sm:text-right">
                      <div>已完成 {completedStages} / {totalStages}</div>
                      <div>当前阶段：{activeStageMeta?.title || '无'}</div>
                      <div>最近阶段：{latestStageMeta?.title || '暂无'}</div>
                      <div>失败阶段：{failedStages}</div>
                      <div>当前对象：{latestFocusTarget || '暂无'}</div>
                    </div>
                  </div>
                  <Progress value={progressValue} className="mt-4 h-2.5 bg-primary/10" />
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricCard title="对象库" value={filteredObjectItems.length} hint={`总对象 ${objectLibraryItems.length}`} accent="border-cyan-500/20" />
                  <MetricCard title="窗口数" value={summary.windowCount || 0} hint={`chunks ${summary.chunkCount || 0}`} accent="border-emerald-500/20" />
                  <MetricCard title="结构边" value={summary.edgeCount || 0} hint={`孤点 ${summary.orphanCount || 0}`} accent="border-sky-500/20" />
                  <MetricCard title="写回状态" value={writebackSummary?.successCount ?? 0} hint={writebackSummary ? `最近 ${writebackSummary.lastCommitId}` : '尚未写回'} accent="border-violet-500/20" />
                </div>
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-muted-foreground">
                  内容导航
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => scrollToSection('overview-system')}>
                    查看系统拆解
                  </Button>
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => scrollToSection('analysis-objects')}>
                    查看对象库
                  </Button>
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => scrollToSection('analysis-graph')}>
                    查看结构验证图
                  </Button>
                </div>
                {writebackSummary ? (
                  <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700/80">
                      Write And Infer
                      <Badge variant="secondary" className="rounded-full">commit {writebackSummary.lastCommitId || '未返回'}</Badge>
                      <Badge variant="outline" className="rounded-full">version {writebackSummary.lastVersionId ?? '未返回'}</Badge>
                      <Badge variant="outline" className="rounded-full">{formatPercent(writebackSummary.inferenceProbability)}</Badge>
                    </div>
                    <div className="mt-3 text-sm leading-6 text-foreground/85">
                      {writebackSummary.inferenceReason || '后端已返回写回结果，但没有提供概率理由。'}
                    </div>
                  </div>
                ) : writebackError ? (
                  <div className="rounded-3xl border border-red-500/20 bg-red-500/5 p-4 text-sm leading-6 text-red-700">
                    写回失败：{writebackError}
                  </div>
                ) : null}
              </div>
            </SectionCard>
          </div>

          <div id="overview-system" className="scroll-mt-6">
            <SectionCard
              title="系统拆解视图"
              description="查看结构树与系统拆解。"
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">拆解簇 {systemDecompositionView.summary.clusterCount || '待生成'}</Badge>
                  <Badge variant="outline">包含边 {systemDecompositionView.summary.containmentCount}</Badge>
                  <Badge variant="outline">叶子节点 {systemDecompositionView.summary.leafCount}</Badge>
                  <Button type="button" size="sm" variant="default" className="rounded-full" onClick={() => setSystemViewOpen(true)}>
                    打开系统拆解视图
                  </Button>
                </div>
              )}
            >
              {systemDecompositionView.summary.hiddenDescendantCount > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">折叠下级 {systemDecompositionView.summary.hiddenDescendantCount}</Badge>
                </div>
              ) : null}
            </SectionCard>
            <Dialog open={systemViewOpen} onOpenChange={setSystemViewOpen}>
              <DialogContent className="grid h-[min(94vh,1080px)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[28px] border-border/60 bg-background/95 p-0 shadow-2xl sm:w-[min(96vw,1800px)] sm:max-w-none">
                <DialogHeader className="border-b border-border/50 px-6 py-5">
                  <DialogTitle className="text-2xl font-black tracking-tight">系统拆解视图</DialogTitle>
                  <DialogDescription className="text-sm leading-6">
                    在大视图中阅读结构树，按“包含 / 下级 / 叶子”关系查看对象拆解。
                  </DialogDescription>
                </DialogHeader>
                <div className="overflow-auto px-6 py-5">
                  <WorkflowV2SystemDecompositionPanel view={systemDecompositionView} />
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div id="analysis-objects" className="scroll-mt-6">
            <SectionCard
              title="对象库"
              description="查看对象列表与详情。"
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">对象 {objectLibraryItems.length}</Badge>
                  <Badge variant="outline">筛选后 {filteredObjectItems.length}</Badge>
                  <Button type="button" variant="default" size="sm" className="rounded-full" onClick={() => setObjectLibraryOpen(true)}>
                    打开对象库
                  </Button>
                </div>
              )}
            >
              <div className="flex flex-wrap gap-2">
                {selectedObjectIdValue ? (
                  <Badge variant="secondary">当前对象 {asText(selectedObjectRecord.object_name)}</Badge>
                ) : null}
                {failedFunctionItems.length > 0 ? (
                  <Badge variant="outline">失败对象 {failedFunctionTotalCount}</Badge>
                ) : null}
              </div>
            </SectionCard>
            <Dialog open={objectLibraryOpen} onOpenChange={setObjectLibraryOpen}>
              <DialogContent className="grid h-[min(96vh,1120px)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[28px] border-border/60 bg-background/95 p-0 shadow-2xl sm:w-[min(97vw,1900px)] sm:max-w-none">
                <DialogHeader className="border-b border-border/50 px-6 py-5">
                  <DialogTitle className="text-2xl font-black tracking-tight">对象库</DialogTitle>
                  <DialogDescription className="text-sm leading-6">
                    在大视图中筛选对象，并查看核心功能、结构关系、别名和引用。
                  </DialogDescription>
                </DialogHeader>
                <div className="overflow-auto px-6 py-5">
                  <div className="space-y-4">
                    {failedFunctionItems.length > 0 ? (
                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                        <div className="text-sm font-black text-amber-900">核心功能分析有 {failedFunctionTotalCount} 个对象失败，已自动跳过并保留其余结果。</div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_200px_200px]">
                      <Input
                        value={objectLibraryFilter.search}
                        onChange={(event) => setObjectLibraryFilter((current) => ({ ...current, search: event.target.value }))}
                        placeholder="搜索 object_name / normalized_name"
                        className="rounded-2xl bg-background/90"
                      />
                      <Select value={objectLibraryFilter.level} onValueChange={(value) => setObjectLibraryFilter((current) => ({ ...current, level: value }))}>
                        <SelectTrigger className="rounded-2xl bg-background/90">
                          <SelectValue placeholder="粒度筛选" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部粒度</SelectItem>
                          {objectLevelOptions.map((level) => (
                            <SelectItem key={level} value={level}>{level}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={objectLibraryFilter.structure} onValueChange={(value) => setObjectLibraryFilter((current) => ({ ...current, structure: value as WorkflowV2ObjectLibraryFilter['structure'] }))}>
                        <SelectTrigger className="rounded-2xl bg-background/90">
                          <SelectValue placeholder="结构状态筛选" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部结构状态</SelectItem>
                          <SelectItem value="structured">结构内对象</SelectItem>
                          <SelectItem value="isolated">孤立对象</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
                      <ScrollArea className="h-[640px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-black">Object Library</div>
                            <Badge variant="outline">筛选后 {filteredObjectItems.length} / 总 {objectLibraryItems.length}</Badge>
                          </div>
                          {filteredObjectItems.length > 0 ? filteredObjectItems.map((item) => {
                            const record = asRecord(item);
                            const objectId = asText(record.object_id);
                            const selected = objectId === selectedObjectIdValue;
                            return (
                              <button
                                key={objectId}
                                type="button"
                                onClick={() => setSelectedObjectId(objectId)}
                                className={cn(
                                  'w-full rounded-2xl border p-4 text-left transition-colors',
                                  selected
                                    ? 'border-primary/30 bg-primary/10'
                                    : 'border-border/60 bg-background/80 hover:bg-muted/20',
                                )}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-base font-black">{asText(record.object_name)}</div>
                                    <div className="truncate text-xs text-muted-foreground">{asText(record.normalized_name)}</div>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    {asText(record.object_level) ? <Badge variant="secondary">{asText(record.object_level)}</Badge> : null}
                                    <Badge variant="outline">{asText(record.structure_status) || 'unknown'}</Badge>
                                  </div>
                                </div>
                                <div className="mt-3 text-sm leading-6 text-foreground/85">{asText(record.core_function) || '当前还没有核心功能摘要。'}</div>
                                {asText(record.error) ? (
                                  <div className="mt-2 text-xs leading-5 text-amber-700">{asText(record.error)}</div>
                                ) : null}
                                <ErrorDiagnosticBadges value={record} />
                                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <span>深度 {String(record.structure_depth ?? 0)}</span>
                                  <span>·</span>
                                  <span>{asText(record.structural_role) || '未标记'}</span>
                                </div>
                              </button>
                            );
                          }) : (
                            <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                              当前筛选条件下没有对象。
                            </div>
                          )}
                        </div>
                      </ScrollArea>

                      <div className="rounded-3xl border border-border/60 bg-muted/15 p-4">
                        {selectedObjectIdValue ? (
                          <div className="space-y-4">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-xl font-black">{asText(selectedObjectRecord.object_name)}</div>
                                {asText(selectedObjectRecord.object_level) ? <Badge variant="secondary">{asText(selectedObjectRecord.object_level)}</Badge> : null}
                                <Badge variant="outline">{asText(selectedObjectRecord.structure_status) || 'unknown'}</Badge>
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">{asText(selectedObjectRecord.normalized_name)}</div>
                            </div>
                            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-6 text-foreground/90">
                              {asText(selectedObjectRecord.core_function) || '当前对象还没有核心功能摘要。'}
                            </div>
                            {selectedObjectInsight.functionReason ? (
                              <div className="text-sm leading-6 text-muted-foreground">
                                {selectedObjectInsight.functionReason}
                              </div>
                            ) : null}
                            {asText(selectedObjectRecord.error) ? (
                              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-900">
                                <div className="font-black">功能分析失败</div>
                                <div className="mt-2 leading-6">{asText(selectedObjectRecord.error)}</div>
                                <ErrorDiagnosticBadges value={selectedObjectRecord} />
                              </div>
                            ) : null}
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                                <div className="text-xs font-semibold text-muted-foreground">别名</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {asStringArray(selectedObjectRecord.aliases).length > 0 ? asStringArray(selectedObjectRecord.aliases).map((alias) => (
                                    <Badge key={alias} variant="secondary">{alias}</Badge>
                                  )) : <span className="text-sm text-muted-foreground">暂无别名</span>}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                                <div className="text-xs font-semibold text-muted-foreground">结构关系</div>
                                <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                                  {selectedObjectEdges.length > 0 ? selectedObjectEdges.map((edge, index) => {
                                    const edgeRecord = asRecord(edge);
                                    const sourceId = asText(edgeRecord.source_object_id);
                                    const targetId = asText(edgeRecord.target_object_id);
                                    const sourceName = getWorkflowV2ObjectDisplayName(objectLibraryItemMap, sourceId, sourceId);
                                    const targetName = getWorkflowV2ObjectDisplayName(objectLibraryItemMap, targetId, targetId);
                                    return (
                                      <div key={`${selectedObjectIdValue}-edge-${index}`} className="rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
                                        <div className="font-medium text-foreground/90">{sourceName} → {targetName}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {asText(edgeRecord.relation) || 'contains'}
                                        </div>
                                        {asText(edgeRecord.reason) ? (
                                          <div className="mt-2 text-sm leading-6 text-foreground/85">{asText(edgeRecord.reason)}</div>
                                        ) : null}
                                        {asText(edgeRecord.citation) ? <CitationPreview citation={asText(edgeRecord.citation)} /> : null}
                                      </div>
                                    );
                                  }) : <span>当前没有直接结构边</span>}
                                </div>
                              </div>
                            </div>
                            <WorkflowV2ObjectProcessSections insight={selectedObjectInsight} />
                            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                              <div className="text-xs font-semibold text-muted-foreground">引用</div>
                              <div className="mt-3 space-y-3">
                                {asStringArray(selectedObjectRecord.citations ?? selectedObjectRecord.citation).length > 0 ? asStringArray(selectedObjectRecord.citations ?? selectedObjectRecord.citation).map((citation, index) => (
                                  <CitationPreview key={`${selectedObjectIdValue}-citation-${index}`} citation={citation} />
                                )) : (
                                  <div className="text-sm text-muted-foreground">暂无引用。</div>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                            选择左侧对象后，在这里查看详情。
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div id="analysis-graph" className="scroll-mt-6">
            <SectionCard
              title="结构验证图"
              description="查看图结构与节点关系。"
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">节点 {graphNodeTotalCount}</Badge>
                  <Badge variant="outline">主边 {graphEdgeTotalCount}</Badge>
                  <Button type="button" variant="default" size="sm" className="rounded-full" onClick={() => setGraphViewOpen(true)}>
                    打开结构验证图
                  </Button>
                </div>
              )}
            >
              {selectedGraphNode ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">已聚焦 {selectedGraphNode.label}</Badge>
                </div>
              ) : null}
            </SectionCard>
            <Dialog open={graphViewOpen} onOpenChange={setGraphViewOpen}>
              <DialogContent className="grid h-[min(96vh,1120px)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[28px] border-border/60 bg-background/95 p-0 shadow-2xl sm:w-[min(97vw,1900px)] sm:max-w-none">
                <DialogHeader className="border-b border-border/50 px-6 py-5">
                  <DialogTitle className="text-2xl font-black tracking-tight">结构验证图</DialogTitle>
                  <DialogDescription className="text-sm leading-6">
                    在大视图中验证图结构，支持节点聚焦、缩放、孤立节点切换和 Mermaid 复制。
                  </DialogDescription>
                </DialogHeader>
                <div className="overflow-auto px-6 py-5">
                  <div className="rounded-3xl border border-border/60 bg-muted/15 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant={hideIsolatedNodes ? 'default' : 'outline'}
                          size="sm"
                          className="rounded-full"
                          onClick={() => setHideIsolatedNodes((current) => !current)}
                        >
                          {hideIsolatedNodes ? '显示孤立节点' : '隐藏孤立节点'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => setGraphZoom((current) => Math.max(0.6, Number((current - 0.2).toFixed(2))))}
                          disabled={graphLayout.nodes.length === 0}
                        >
                          <ZoomOut className="mr-2 h-4 w-4" />
                          缩小
                        </Button>
                        <Badge variant="outline" className="rounded-full px-3">{Math.round(graphZoom * 100)}%</Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => setGraphZoom((current) => Math.min(2.4, Number((current + 0.2).toFixed(2))))}
                          disabled={graphLayout.nodes.length === 0}
                        >
                          <ZoomIn className="mr-2 h-4 w-4" />
                          放大
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => setGraphZoom(1)}
                          disabled={graphLayout.nodes.length === 0}
                        >
                          还原
                        </Button>
                        {selectedGraphNode ? (
                          <Badge variant="secondary" className="rounded-full px-3">
                            已聚焦 {selectedGraphNode.label}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedGraphNode ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onClick={() => setGraphFocusNodeId('')}
                          >
                            清除聚焦
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => void handleCopyMermaid()}
                          disabled={!mermaidCode.trim()}
                        >
                          {mermaidCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                          {mermaidCopied ? '已复制 Mermaid' : '复制 Mermaid'}
                        </Button>
                      </div>
                    </div>

                    {graphLayout.nodes.length > 0 ? (
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                        <div className="overflow-auto rounded-2xl border border-border/50 bg-background/60">
                          <svg
                            viewBox={`0 0 ${graphCanvasWidth} ${graphCanvasHeight}`}
                            className="block"
                            style={{
                              width: `${graphScaledWidth}px`,
                              height: `${graphScaledHeight}px`,
                              minWidth: `${graphScaledWidth}px`,
                              minHeight: `${graphScaledHeight}px`,
                            }}
                          >
                            <defs>
                              <marker id="workflow-v2-dag-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(14,165,233,0.75)" />
                              </marker>
                              <marker id="workflow-v2-impact-arrow-high" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(239,68,68,0.9)" />
                              </marker>
                              <marker id="workflow-v2-impact-arrow-medium" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(245,158,11,0.9)" />
                              </marker>
                              <marker id="workflow-v2-impact-arrow-low" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(14,165,233,0.82)" />
                              </marker>
                              <marker id="workflow-v2-impact-arrow-none" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.72)" />
                              </marker>
                            </defs>
                            {graphLayout.edges.map((edge) => {
                              const source = graphNodeMap.get(edge.sourceId);
                              const target = graphNodeMap.get(edge.targetId);
                              if (!source || !target) return null;
                              const isFocusedEdge = selectedGraphNodeIdValue
                                ? edge.sourceId === selectedGraphNodeIdValue || edge.targetId === selectedGraphNodeIdValue
                                : false;
                              const isDimmed = selectedGraphNodeIdValue ? !isFocusedEdge : false;
                              return (
                                <path
                                  key={edge.id}
                                  d={`M ${source.x + 90} ${source.y + 24} C ${source.x + 150} ${source.y + 24}, ${target.x - 60} ${target.y + 24}, ${target.x} ${target.y + 24}`}
                                  fill="none"
                                  stroke={isFocusedEdge ? 'rgba(14,165,233,0.88)' : 'rgba(14,165,233,0.45)'}
                                  strokeWidth={isFocusedEdge ? 3.4 : 2.5}
                                  opacity={isDimmed ? 0.12 : 1}
                                  markerEnd="url(#workflow-v2-dag-arrow)"
                                />
                              );
                            })}
                            {graphRenderableImpactEdges.map((edge) => {
                              const source = graphNodeMap.get(edge.sourceId);
                              const target = graphNodeMap.get(edge.targetId);
                              if (!source || !target) return null;
                              const style = getWorkflowV2ImpactEdgeStyle(edge.impactLevel);
                              const isFocusedEdge = selectedGraphNodeIdValue
                                ? edge.sourceId === selectedGraphNodeIdValue || edge.targetId === selectedGraphNodeIdValue
                                : false;
                              const isDimmed = selectedGraphNodeIdValue ? !isFocusedEdge : false;
                              return (
                                <path
                                  key={`impact-${edge.id}`}
                                  d={`M ${source.x + 90} ${source.y + 24} C ${source.x + 150} ${source.y + 24}, ${target.x - 60} ${target.y + 24}, ${target.x} ${target.y + 24}`}
                                  fill="none"
                                  stroke={style.stroke}
                                  strokeWidth={isFocusedEdge ? style.strokeWidth + 0.8 : style.strokeWidth}
                                  strokeDasharray={style.strokeDasharray}
                                  strokeLinecap="round"
                                  opacity={isDimmed ? 0.12 : 0.95}
                                  markerEnd={`url(#workflow-v2-impact-arrow-${edge.impactLevel})`}
                                />
                              );
                            })}
                            {graphLayout.nodes.map((node) => {
                              const isSelected = node.id === selectedGraphNodeIdValue;
                              const isConnected = selectedGraphNodeIdValue ? graphFocusedNeighborIds.has(node.id) : true;
                              const isDimmed = selectedGraphNodeIdValue ? !isConnected : false;
                              return (
                                <g
                                  key={node.id}
                                  className="cursor-pointer"
                                  onClick={() => {
                                    setGraphFocusNodeId((current) => current === node.id ? '' : node.id);
                                    setSelectedObjectId(node.id);
                                  }}
                                >
                                  <rect
                                    x={node.x}
                                    y={node.y}
                                    rx="18"
                                    width="120"
                                    height="48"
                                    fill={isSelected ? 'rgba(14,165,233,0.18)' : node.isIsolated ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.96)'}
                                    stroke={isSelected ? 'rgba(14,165,233,0.9)' : node.isIsolated ? 'rgba(148,163,184,0.38)' : 'rgba(15,23,42,0.12)'}
                                    strokeWidth={isSelected ? 2.5 : 1.2}
                                    strokeDasharray={node.isIsolated ? '6 6' : undefined}
                                    opacity={isDimmed ? 0.22 : 1}
                                  />
                                  <text
                                    x={node.x + 60}
                                    y={node.y + 26}
                                    textAnchor="middle"
                                    fontSize="14"
                                    fontWeight="700"
                                    fill={isSelected ? '#0369a1' : node.isIsolated ? 'rgba(71,85,105,0.72)' : '#0f172a'}
                                    opacity={isDimmed ? 0.3 : 1}
                                  >
                                    {node.label}
                                  </text>
                                  {node.isIsolated ? (
                                    <text
                                      x={node.x + 60}
                                      y={node.y + 39}
                                      textAnchor="middle"
                                      fontSize="9"
                                      fontWeight="700"
                                      letterSpacing="0.08em"
                                      fill="rgba(100,116,139,0.82)"
                                      opacity={isDimmed ? 0.3 : 1}
                                    >
                                      孤立
                                    </text>
                                  ) : null}
                                </g>
                              );
                            })}
                          </svg>
                        </div>

                        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                          {selectedGraphNode ? (
                            <div className="space-y-4">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-lg font-black">{selectedGraphNode.label}</div>
                                  {asText(selectedGraphNodeRecord.object_level) ? (
                                    <Badge variant="secondary">{asText(selectedGraphNodeRecord.object_level)}</Badge>
                                  ) : null}
                                  <Badge variant={selectedGraphNode.isIsolated ? 'outline' : 'default'}>
                                    {selectedGraphNode.isIsolated ? '孤立节点' : '结构节点'}
                                  </Badge>
                                </div>
                                <div className="mt-1 text-sm text-muted-foreground">
                                  {asText(selectedGraphNodeRecord.normalized_name) || '当前没有 normalized_name'}
                                </div>
                              </div>

                              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-6 text-foreground/90">
                                {asText(selectedGraphNodeRecord.core_function) || '当前节点还没有核心功能摘要。'}
                              </div>
                              {selectedGraphNodeInsight.functionReason ? (
                                <div className="text-sm leading-6 text-muted-foreground">
                                  {selectedGraphNodeInsight.functionReason}
                                </div>
                              ) : null}

                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                  <div className="text-xs font-semibold text-muted-foreground">结构状态</div>
                                  <div className="mt-2 text-sm font-black text-foreground">
                                    {selectedGraphNode.structureStatus || asText(selectedGraphNodeRecord.structure_status) || '未标注'}
                                  </div>
                                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                                    {selectedGraphNode.structureReason || asText(selectedGraphNodeRecord.structure_reason) || '当前没有结构状态说明。'}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                  <div className="text-xs font-semibold text-muted-foreground">关联摘要</div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Badge variant="outline">结构边 {selectedGraphStructureEdges.length}</Badge>
                                    <Badge variant="outline">影响边 {selectedGraphImpactEdges.length}</Badge>
                                    <Badge variant="outline">相邻节点 {Math.max(graphFocusedNeighborIds.size - 1, 0)}</Badge>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                <div className="text-xs font-semibold text-muted-foreground">直接结构关系</div>
                                <div className="mt-3 space-y-2 text-sm text-foreground/85">
                                  {selectedGraphRawEdges.length > 0 ? selectedGraphRawEdges.map((edge, index) => {
                                    const edgeRecord = asRecord(edge);
                                    const sourceId = asText(edgeRecord.source_object_id);
                                    const targetId = asText(edgeRecord.target_object_id);
                                    const sourceLabel = getWorkflowV2ObjectDisplayName(objectLibraryItemMap, sourceId, sourceId);
                                    const targetLabel = getWorkflowV2ObjectDisplayName(objectLibraryItemMap, targetId, targetId);
                                    const direction = sourceId === selectedGraphNodeIdValue ? '包含' : '被包含于';
                                    return (
                                      <div key={`graph-structure-${index}`} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                                        <div className="font-medium">{sourceLabel} → {targetLabel}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{direction}</div>
                                        {asText(edgeRecord.reason) ? (
                                          <div className="mt-2 text-sm leading-6 text-foreground/85">{asText(edgeRecord.reason)}</div>
                                        ) : null}
                                        {asText(edgeRecord.citation) ? <CitationPreview citation={asText(edgeRecord.citation)} /> : null}
                                      </div>
                                    );
                                  }) : (
                                    <div className="text-sm text-muted-foreground">当前节点没有直接结构边。</div>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                <div className="text-xs font-semibold text-muted-foreground">消融 / 作用关系</div>
                                <div className="mt-3 space-y-2 text-sm text-foreground/85">
                                  {selectedGraphNodeInsight.impactAsSource.length > 0 ? selectedGraphNodeInsight.impactAsSource.map((item, index) => (
                                    <div key={`graph-impact-source-${index}`} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                                      <div className="font-medium">{item.sourceName} 影响 {item.targetName}</div>
                                      <div className="mt-1 text-xs text-muted-foreground">{item.parentName} · {item.impactLevel || '未标级'}{item.judgement ? ` · ${item.judgement}` : ''}</div>
                                      {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                                    </div>
                                  )) : null}
                                  {selectedGraphNodeInsight.impactAsTarget.length > 0 ? selectedGraphNodeInsight.impactAsTarget.map((item, index) => (
                                    <div key={`graph-impact-target-${index}`} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                                      <div className="font-medium">{item.sourceName} 影响 {item.targetName}</div>
                                      <div className="mt-1 text-xs text-muted-foreground">{item.parentName} · {item.impactLevel || '未标级'}{item.judgement ? ` · ${item.judgement}` : ''}</div>
                                      {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                                    </div>
                                  )) : null}
                                  {selectedGraphNodeInsight.importanceAsChild.length > 0 ? selectedGraphNodeInsight.importanceAsChild.map((item, index) => (
                                    <div key={`graph-importance-child-${index}`} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                                      <div className="font-medium">{item.parentName} · {item.importanceLevel || '未标级'}</div>
                                      {item.judgement ? <div className="mt-1 text-xs text-muted-foreground">{item.judgement}</div> : null}
                                      {item.reason ? <div className="mt-2 text-sm leading-6 text-foreground/85">{item.reason}</div> : null}
                                    </div>
                                  )) : null}
                                  {selectedGraphNodeInsight.impactAsSource.length === 0
                                  && selectedGraphNodeInsight.impactAsTarget.length === 0
                                  && selectedGraphNodeInsight.importanceAsChild.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">当前节点没有直接 sibling impact 或消融结论。</div>
                                  ) : null}
                                </div>
                              </div>
                              <WorkflowV2ObjectProcessSections insight={selectedGraphNodeInsight} />

                              <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                <div className="text-xs font-semibold text-muted-foreground">引用</div>
                                <div className="mt-3 space-y-3">
                                  {asStringArray(selectedGraphNodeRecord.citations ?? selectedGraphNodeRecord.citation).length > 0 ? (
                                    asStringArray(selectedGraphNodeRecord.citations ?? selectedGraphNodeRecord.citation).slice(0, 3).map((citation, index) => (
                                      <CitationPreview key={`graph-citation-${selectedGraphNodeIdValue}-${index}`} citation={citation} />
                                    ))
                                  ) : (
                                    <div className="text-sm text-muted-foreground">暂无引用。</div>
                                  )}
                                </div>
                              </div>

                              <Button
                                type="button"
                                variant="outline"
                                className="w-full rounded-full"
                                onClick={() => {
                                  setGraphViewOpen(false);
                                  setSelectedObjectId(selectedGraphNodeIdValue);
                                  scrollToSection('analysis-objects');
                                }}
                              >
                                在对象库中查看该节点
                              </Button>
                            </div>
                          ) : (
                            <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/10 p-6 text-center text-sm leading-6 text-muted-foreground">
                              点击图中的节点后，这里会显示该节点的功能、结构关系与作用关系，
                              同时图中只保留与它直接相连的节点和边。
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
                        图构建阶段完成后，会在这里显示 DAG 校验图。
                      </div>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div id="analysis-stages" className="scroll-mt-6">
            <Collapsible open={expandedPanels.stageProducts} onOpenChange={() => togglePanel('stageProducts')}>
              <SectionCard
                title="阶段产物"
                description="Chunks、Windows、拆解候选和删环结果统一收进 Accordion，不再平铺成多张大卡。"
                action={(
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="rounded-full">
                      {expandedPanels.stageProducts ? '收起' : '展开'}
                      <ChevronDown className={cn('ml-2 h-4 w-4 transition-transform', expandedPanels.stageProducts ? 'rotate-180' : '')} />
                    </Button>
                  </CollapsibleTrigger>
                )}
              >
                <CollapsibleContent>
                  <Accordion type="multiple" defaultValue={['chunks', 'windows']} className="space-y-3">
                    <AccordionItem value="chunks" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                      <AccordionTrigger className="py-4 text-sm font-black">Chunks</AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <ScrollArea className="h-[260px] rounded-2xl border border-border/60 bg-background/80 p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-black">总览</div>
                              <Badge variant="outline">总 {chunkTotalCount} / 展示 {chunkItems.length}</Badge>
                            </div>
                            {chunkItems.length > 0 ? chunkItems.map((chunk) => {
                              const record = asRecord(chunk);
                              return (
                                <div key={asText(record.chunk_id)} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                  <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{asText(record.chunk_id)}</div>
                                  <div className="mt-2 text-sm leading-6">{asText(record.text)}</div>
                                  <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason)}</div>
                                </div>
                              );
                            }) : (
                              <div className="text-sm text-muted-foreground">启动后会在这里显示 chunk 列表。</div>
                            )}
                          </div>
                        </ScrollArea>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="chunk-filter" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                      <AccordionTrigger className="py-4 text-sm font-black">Chunk Filter</AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <ScrollArea className="h-[260px] rounded-2xl border border-border/60 bg-background/80 p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-black">预筛结果</div>
                              <Badge variant="outline">输入 {selectedChunkInputCount} / 保留 {selectedChunkTotalCount}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {asText(chunkFilterOutput.reason) || '完成 chunk 预筛后，会在这里显示保留结果。'}
                            </div>
                            {chunkFilterOutput.used_fallback === true ? (
                              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-900">
                                当前使用回退结果：预筛未能稳定收敛，因此暂时保留全量 chunk 继续后续流程。
                              </div>
                            ) : null}
                            {asText(chunkFilterOutput.error) ? (
                              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                                <div className="text-xs leading-5 text-amber-900">{asText(chunkFilterOutput.error)}</div>
                                <ErrorDiagnosticBadges value={chunkFilterOutput} />
                              </div>
                            ) : null}
                            {selectedChunkIds.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {selectedChunkIds.map((chunkId) => (
                                  <Badge key={chunkId} variant="secondary">{chunkId}</Badge>
                                ))}
                              </div>
                            ) : null}
                            {selectedChunkItems.length > 0 ? selectedChunkItems.map((chunk) => {
                              const record = asRecord(chunk);
                              return (
                                <div key={asText(record.chunk_id)} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                  <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{asText(record.chunk_id)}</div>
                                  <div className="mt-2 text-sm leading-6">{asText(record.text)}</div>
                                  <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason)}</div>
                                </div>
                              );
                            }) : (
                              <div className="text-sm text-muted-foreground">启动后会在这里显示筛后保留的 chunk。</div>
                            )}
                          </div>
                        </ScrollArea>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="windows" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                      <AccordionTrigger className="py-4 text-sm font-black">Windows</AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <ScrollArea className="h-[260px] rounded-2xl border border-border/60 bg-background/80 p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-black">总览</div>
                              <Badge variant="outline">总 {windowTotalCount} / 展示 {windowItems.length}</Badge>
                            </div>
                            {windowExtractProgress ? (
                              <div className="text-xs text-muted-foreground">
                                第三阶段已完成 {windowExtractProgress.completed} / {windowTotalCount} 个滑动窗口
                                {windowExtractProgress.parallel ? `，并发 ${windowExtractProgress.parallel}` : ''}
                                {failedWindowTotalCount > 0 ? `，失败 ${failedWindowTotalCount}` : ''}
                              </div>
                            ) : null}
                            {windowItems.length > 0 ? windowItems.map((windowResult) => {
                              const record = asRecord(windowResult);
                              const objects = Array.isArray(record.objects) ? record.objects : [];
                              return (
                                <div key={asText(record.window_id)} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{asText(record.window_id)}</div>
                                    <Badge variant="outline">{objects.length} objects</Badge>
                                  </div>
                                  <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason)}</div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {objects.slice(0, 8).map((object, index) => (
                                      <Badge key={`${asText(record.window_id)}-${index}`} variant="secondary">{asText(asRecord(object).object_name)}</Badge>
                                    ))}
                                  </div>
                                </div>
                              );
                            }) : (
                              <div className="text-sm text-muted-foreground">启动后会在这里显示窗口抽取结果。</div>
                            )}
                            {failedWindowItems.length > 0 ? (
                              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                                <div className="text-sm font-black text-amber-900">失败窗口 {failedWindowTotalCount} 个</div>
                                <div className="mt-3 space-y-3">
                                  {failedWindowItems.map((item, index) => {
                                    const record = asRecord(item);
                                    return (
                                      <div key={`${asText(record.window_id)}-${index}`} className="rounded-2xl border border-amber-500/20 bg-background/80 p-3">
                                        <div className="text-sm font-black">{asText(record.window_id) || `窗口 ${index + 1}`}</div>
                                        <div className="mt-2 text-xs leading-5 text-amber-900">{asText(record.error) || asText(record.reason) || '窗口抽取失败'}</div>
                                        <ErrorDiagnosticBadges value={record} />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </ScrollArea>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="decompose" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                      <AccordionTrigger className="py-4 text-sm font-black">Object Decompose</AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <ScrollArea className="h-[280px] rounded-2xl border border-border/60 bg-background/80 p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-black">候选边</div>
                              <Badge variant="outline">总 {decompositionTotalCount} / 展示 {shownDecompositionCount}</Badge>
                            </div>
                            {objectDecomposeProgress ? (
                              <div className="rounded-2xl border border-border/60 bg-muted/15 p-3">
                                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                  <div>已完成 {objectDecomposeProgress.completed} / {objectDecomposeProgress.total}，失败 {objectDecomposeProgress.failed}</div>
                                  <div>{objectDecomposeProgressValue}%</div>
                                </div>
                                <Progress value={objectDecomposeProgressValue} className="mt-2 h-2 bg-amber-500/15" />
                              </div>
                            ) : null}
                            {decompositionGroups.length > 0 ? decompositionGroups.map((group, groupIndex) => {
                              const record = asRecord(group);
                              const decompositions = Array.isArray(record.decompositions) ? record.decompositions : [];
                              return (
                                <div key={`${asText(record.object_id)}-${groupIndex}`} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-black">Group {groupIndex + 1}</div>
                                    <Badge variant="outline">候选边 {decompositions.length}</Badge>
                                  </div>
                                  <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                                    <div>object_id：{asText(record.object_id) || '未提供'}</div>
                                    <div>group reason：{asText(record.reason) || '未提供'}</div>
                                  </div>
                                </div>
                              );
                            }) : (
                              <div className="text-sm text-muted-foreground">对象拆解结果会显示在这里。</div>
                            )}
                            {failedObjectItems.length > 0 ? (
                              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-900">
                                <div className="font-black">失败对象 {failedObjectTotalCount} 个</div>
                                <div className="mt-3 space-y-3">
                                  {failedObjectItems.map((item, index) => {
                                    const record = asRecord(item);
                                    const attempts = Array.isArray(record.attempts) ? record.attempts : [];
                                    return (
                                      <div key={`${asText(record.object_id)}-${index}`} className="rounded-2xl border border-amber-500/20 bg-background/80 p-3">
                                        <div className="text-sm font-black">{asText(record.object_name) || asText(record.object_id) || `对象 ${index + 1}`}</div>
                                        <div className="mt-2 text-xs leading-5 text-amber-900">{asText(record.reason) || '对象拆解失败'}</div>
                                        <div className="mt-3 space-y-2">
                                          {attempts.map((attempt, attemptIndex) => {
                                            const attemptRecord = asRecord(attempt);
                                            return (
                                              <div key={`${asText(record.object_id)}-attempt-${attemptIndex}`} className="rounded-2xl border border-border/50 bg-muted/15 p-3">
                                                <div className="text-xs font-black">第 {asCount(attemptRecord.attempt, attemptIndex + 1)} 次</div>
                                                <div className="mt-1 text-xs leading-5 text-muted-foreground">{asText(attemptRecord.error) || '拆解失败'}</div>
                                                <ErrorDiagnosticBadges value={attemptRecord} />
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </ScrollArea>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="removed-cycles" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                      <AccordionTrigger className="py-4 text-sm font-black">Removed Cycle Edges</AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <ScrollArea className="h-[220px] rounded-2xl border border-border/60 bg-background/80 p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-black">删环结果</div>
                              <Badge variant="outline">总 {removedCycleEdgeTotalCount} / 展示 {removedCycleEdgeItems.length}</Badge>
                            </div>
                            {removedCycleEdgeItems.length > 0 ? removedCycleEdgeItems.map((edge) => {
                              const record = asRecord(edge);
                              return (
                                <div key={asText(record.edge_id)} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                                  <div className="text-sm font-black">{asText(record.edge_id)}</div>
                                  <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason)}</div>
                                </div>
                              );
                            }) : (
                              <div className="text-sm text-muted-foreground">如果图中出现环，被删除的弱边会显示在这里。</div>
                            )}
                          </div>
                        </ScrollArea>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CollapsibleContent>
              </SectionCard>
            </Collapsible>
          </div>

          <div id="analysis-effects" className="scroll-mt-6">
            <Collapsible open={expandedPanels.effects} onOpenChange={() => togglePanel('effects')}>
              <SectionCard
                title="作用关系"
                description="把 Ablation 和 sibling impacts 单独成段，默认只看父系统分组后的摘要。"
                action={(
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">父系统 {ablationItems.length}</Badge>
                    <Badge variant="outline">兄弟影响边 {siblingImpactEdges.length}</Badge>
                    <Badge variant="outline">总 {ablationTotalCount}</Badge>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="rounded-full">
                        {expandedPanels.effects ? '收起' : '展开'}
                        <ChevronDown className={cn('ml-2 h-4 w-4 transition-transform', expandedPanels.effects ? 'rotate-180' : '')} />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                )}
              >
                <CollapsibleContent>
                  <ScrollArea className="h-[460px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                    <div className="space-y-4">
                      {failedAblationParentItems.length > 0 || failedAblationChildItems.length > 0 ? (
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-900">
                          已跳过部分消融子任务：父节点失败 {failedAblationParentTotalCount} 个，子任务失败 {failedAblationChildItems.length} 个。
                        </div>
                      ) : null}
                      {ablationAnalysisProgress ? (
                        <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <div>
                              已完成 {ablationAnalysisProgress.completed} / {ablationAnalysisProgress.total}
                              {ablationAnalysisProgress.currentParentObjectName ? `，当前 ${ablationAnalysisProgress.currentParentObjectName}` : ''}
                            </div>
                            <div>{ablationAnalysisProgressValue}%</div>
                          </div>
                          <Progress value={ablationAnalysisProgressValue} className="mt-2 h-2 bg-fuchsia-500/15" />
                        </div>
                      ) : null}
                      {ablationItems.length > 0 ? ablationItems.map((item) => {
                        const record = asRecord(item);
                        const siblingDependencyTable = Array.isArray(record.sibling_dependency_table) ? record.sibling_dependency_table : [];
                        const childImportanceList = Array.isArray(record.child_importance_list) ? record.child_importance_list : [];
                        const failedChildAnalyses = Array.isArray(record.failed_child_analyses) ? record.failed_child_analyses : [];
                        return (
                          <div key={asText(record.parent_object_id)} className="rounded-3xl border border-border/60 bg-background/80 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="text-base font-black">{asText(record.parent_object_name) || asText(record.parent_object_id)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{asText(record.reason)}</div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">兄弟影响 {siblingDependencyTable.length}</Badge>
                                <Badge variant="secondary">重要性 {childImportanceList.length}</Badge>
                                {failedChildAnalyses.length > 0 ? <Badge variant="outline">失败子任务 {failedChildAnalyses.length}</Badge> : null}
                              </div>
                            </div>
                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                              <div className="rounded-2xl border border-border/60 bg-muted/15 p-4">
                                <div className="text-sm font-black">兄弟影响</div>
                                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                                  {siblingDependencyTable.length > 0 ? siblingDependencyTable.map((impact, index) => {
                                    const impactRecord = asRecord(impact);
                                    return (
                                      <div key={`${asText(record.parent_object_id)}-sibling-${index}`}>
                                        移除 {asText(impactRecord.ablated_child_object_name) || asText(impactRecord.ablated_child_object_id)}
                                        {' -> '}
                                        影响 {asText(impactRecord.target_sibling_object_name) || asText(impactRecord.target_sibling_object_id)}
                                      </div>
                                    );
                                  }) : <span>当前父系统下没有兄弟影响关系。</span>}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-border/60 bg-muted/15 p-4">
                                <div className="text-sm font-black">子节点重要性</div>
                                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                                  {childImportanceList.length > 0 ? childImportanceList.map((impact, index) => {
                                    const impactRecord = asRecord(impact);
                                    return (
                                      <div key={`${asText(record.parent_object_id)}-importance-${index}`}>
                                        {asText(impactRecord.ablated_child_object_name) || asText(impactRecord.ablated_child_object_id)} · {asText(impactRecord.importance_level)}
                                      </div>
                                    );
                                  }) : <span>当前父系统下没有重要性记录。</span>}
                                </div>
                              </div>
                            </div>
                            {failedChildAnalyses.length > 0 ? (
                              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                                <div className="text-sm font-black text-amber-900">失败子任务</div>
                                <div className="mt-3 space-y-3">
                                  {failedChildAnalyses.map((failure, index) => {
                                    const failureRecord = asRecord(failure);
                                    return (
                                      <div key={`${asText(record.parent_object_id)}-failed-child-${index}`} className="rounded-2xl border border-amber-500/20 bg-background/80 p-3">
                                        <div className="text-sm font-black">
                                          {asText(failureRecord.child_object_name) || asText(failureRecord.child_object_id) || `子节点 ${index + 1}`}
                                          {' · '}
                                          {asText(failureRecord.step) || 'unknown'}
                                        </div>
                                        <div className="mt-2 text-xs leading-5 text-amber-900">{asText(failureRecord.error) || '子任务失败'}</div>
                                        <ErrorDiagnosticBadges value={failureRecord} />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      }) : (
                        <div className="text-sm text-muted-foreground">消融结果会显示在这里。</div>
                      )}
                      {failedAblationParentItems.length > 0 ? (
                        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                          <div className="text-sm font-black text-amber-900">失败父节点 {failedAblationParentTotalCount} 个</div>
                          <div className="mt-3 space-y-3">
                            {failedAblationParentItems.map((item, index) => {
                              const record = asRecord(item);
                              return (
                                <div key={`${asText(record.parent_object_id)}-${index}`} className="rounded-2xl border border-amber-500/20 bg-background/80 p-3">
                                  <div className="text-sm font-black">{asText(record.parent_object_name) || asText(record.parent_object_id) || `父节点 ${index + 1}`}</div>
                                  <div className="mt-2 text-xs leading-5 text-amber-900">{asText(record.error) || '父节点消融分析失败'}</div>
                                  <ErrorDiagnosticBadges value={record} />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </ScrollArea>
                </CollapsibleContent>
              </SectionCard>
            </Collapsible>
          </div>

          <div id="analysis-experts" className="scroll-mt-6">
            <Collapsible open={expandedPanels.experts} onOpenChange={() => togglePanel('experts')}>
              <SectionCard
                title="专家过程"
                description="A/B/Judge 不再散落在页面各处，统一收进这一段，平时只看摘要标签。"
                action={(
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Fusion {expertPreviewSummary.fusionJudge}</Badge>
                    <Badge variant="outline">Functions {expertPreviewSummary.functions}</Badge>
                    <Badge variant="outline">Effects {expertPreviewSummary.effects}</Badge>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="rounded-full">
                        {expandedPanels.experts ? '收起' : '展开'}
                        <ChevronDown className={cn('ml-2 h-4 w-4 transition-transform', expandedPanels.experts ? 'rotate-180' : '')} />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                )}
              >
                <CollapsibleContent>
                  {hasAnyExpertPreview ? (
                    <Accordion type="multiple" defaultValue={['function-experts']} className="space-y-3">
                      <AccordionItem value="function-experts" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                        <AccordionTrigger className="py-4 text-sm font-black">核心功能分析</AccordionTrigger>
                        <AccordionContent className="pb-4">
                          <div className="space-y-3">
                            {fusedObjectItems
                              .filter((item) => Boolean(asRecord(item).llm_ensemble ?? asRecord(item).function_llm_ensemble))
                              .map((item) => {
                                const record = asRecord(item);
                                return (
                                  <WorkflowTrioPreview
                                    key={`function-expert-${asText(record.object_id)}`}
                                    title={`${asText(record.object_name) || '对象'} 的核心功能分析`}
                                    ensemble={record.llm_ensemble ?? record.function_llm_ensemble}
                                    summary="核心功能阶段的 A/B/judge 过程。"
                                  />
                                );
                              })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="fusion-experts" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                        <AccordionTrigger className="py-4 text-sm font-black">融合裁决</AccordionTrigger>
                        <AccordionContent className="pb-4">
                          <div className="space-y-3">
                            {fusionJudgeItems.map((item, index) => {
                              const record = asRecord(item);
                              return (
                                <WorkflowTrioPreview
                                  key={`fusion-preview-${index}`}
                                  title={`${asText(record.existing_object_name) || '对象'} 与 ${asText(record.candidate_object_name) || '候选'} 的融合判定`}
                                  ensemble={record.llm_ensemble}
                                  summary={asText(record.reason) || '融合裁决过程。'}
                                />
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="stage-experts" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                        <AccordionTrigger className="py-4 text-sm font-black">窗口 / 拆解 / 去环</AccordionTrigger>
                        <AccordionContent className="pb-4">
                          <div className="space-y-3">
                            {windowItems.filter((item) => asRecord(item).llm_ensemble).map((item) => {
                              const record = asRecord(item);
                              return (
                                <WorkflowTrioPreview
                                  key={`window-preview-${asText(record.window_id)}`}
                                  title={`窗口 ${asText(record.window_id) || '未命名'} 的对象抽取过程`}
                                  ensemble={record.llm_ensemble}
                                  summary="窗口抽取的 A/B/judge 过程。"
                                />
                              );
                            })}
                            {decompositionGroups.filter((item) => asRecord(item).llm_ensemble).map((item, index) => {
                              const record = asRecord(item);
                              return (
                                <WorkflowTrioPreview
                                  key={`decompose-preview-${asText(record.object_id)}-${index}`}
                                  title={`${asText(record.object_name) || asText(record.parent_object_name) || asText(record.object_id) || `Group ${index + 1}`} 的对象拆解`}
                                  ensemble={record.llm_ensemble}
                                  summary="对象拆解阶段的 A/B/judge 过程。"
                                />
                              );
                            })}
                            {removedCycleEdgeItems.filter((item) => asRecord(item).llm_ensemble).map((item) => {
                              const record = asRecord(item);
                              return (
                                <WorkflowTrioPreview
                                  key={`cycle-preview-${asText(record.edge_id)}`}
                                  title={`${asText(record.edge_id) || '边'} 的去环裁决`}
                                  ensemble={record.llm_ensemble}
                                  summary="删环判定过程。"
                                />
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="effect-experts" className="rounded-3xl border border-border/60 bg-muted/15 px-4">
                        <AccordionTrigger className="py-4 text-sm font-black">作用关系分析</AccordionTrigger>
                        <AccordionContent className="pb-4">
                          <div className="space-y-3">
                            {ablationItems.flatMap((item) => {
                              const record = asRecord(item);
                              const siblingPreviews = (Array.isArray(record.sibling_dependency_table) ? record.sibling_dependency_table : [])
                                .filter((impact) => Boolean(asRecord(impact).llm_ensemble))
                                .map((impact, index) => {
                                  const impactRecord = asRecord(impact);
                                  return (
                                    <WorkflowTrioPreview
                                      key={`${asText(record.parent_object_id)}-sibling-preview-${index}`}
                                      title={`${asText(impactRecord.ablated_child_object_name) || asText(impactRecord.ablated_child_object_id) || '子节点'} 对兄弟 ${asText(impactRecord.target_sibling_object_name) || asText(impactRecord.target_sibling_object_id) || '对象'} 的影响`}
                                      ensemble={impactRecord.llm_ensemble}
                                      summary="兄弟影响分析过程。"
                                    />
                                  );
                                });
                              const importancePreviews = (Array.isArray(record.child_importance_list) ? record.child_importance_list : [])
                                .filter((impact) => Boolean(asRecord(impact).llm_ensemble))
                                .map((impact, index) => {
                                  const impactRecord = asRecord(impact);
                                  return (
                                    <WorkflowTrioPreview
                                      key={`${asText(record.parent_object_id)}-importance-preview-${index}`}
                                      title={`${asText(impactRecord.ablated_child_object_name) || asText(impactRecord.ablated_child_object_id) || '子节点'} 对父节点的重要性`}
                                      ensemble={impactRecord.llm_ensemble}
                                      summary="父节点重要性分析过程。"
                                    />
                                  );
                                });
                              return [...siblingPreviews, ...importancePreviews];
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                      当前还没有可展示的 A/B/Judge 过程。
                    </div>
                  )}
                </CollapsibleContent>
              </SectionCard>
            </Collapsible>
          </div>

          <div id="debug" className="scroll-mt-6">
            <Collapsible open={expandedPanels.debug} onOpenChange={() => togglePanel('debug')}>
              <SectionCard
                title="调试区"
                description="Raw JSON、原始 stage output 和完整历史会话统一下沉到最后一层。"
                action={(
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="rounded-full">
                      {expandedPanels.debug ? '收起' : '展开'}
                      <ChevronDown className={cn('ml-2 h-4 w-4 transition-transform', expandedPanels.debug ? 'rotate-180' : '')} />
                    </Button>
                  </CollapsibleTrigger>
                )}
              >
                <CollapsibleContent>
                  <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                    <SectionCard title="Raw JSON" description="保留完整 runResult，便于比对结构化输出和页面摘要。">
                      <ScrollArea className="h-[520px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                        <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-foreground/80">
                          {session?.runResult ? formatJson(session.runResult) : '运行完成后会在这里显示完整 JSON。'}
                        </pre>
                      </ScrollArea>
                    </SectionCard>
                    <SectionCard title="历史会话详情" description="完整历史列表已移入侧边抽屉，这里只保留调试视角下的详细回看。">
                      <ScrollArea className="h-[520px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                        <div className="space-y-3">
                          {sessions.length > 0 ? sessions.map((item) => (
                            <div key={item.conversationId} className="rounded-2xl border border-border/60 bg-background/80 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black">{item.projectId}</div>
                                  <div className="truncate text-xs text-muted-foreground">{item.conversationId}</div>
                                </div>
                                <Badge variant="outline">{item.runResult?.workflow.status || 'idle'}</Badge>
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">
                                {item.lastRunAt ? `最近完成：${item.lastRunAt}` : (item.statusMessage || '暂无进度信息')}
                              </div>
                            </div>
                          )) : (
                            <div className="text-sm text-muted-foreground">还没有 V2 会话历史。</div>
                          )}
                        </div>
                      </ScrollArea>
                    </SectionCard>
                  </div>
                </CollapsibleContent>
              </SectionCard>
            </Collapsible>
          </div>
        </main>
      </div>
    </div>
  );
}
