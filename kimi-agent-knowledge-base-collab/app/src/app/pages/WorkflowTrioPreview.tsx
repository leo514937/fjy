import React, { type ReactNode } from 'react';
import { ChevronDown, GitBranchPlus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  extractWorkflowEnsembleView,
  type WorkflowEnsembleFinalResult,
  type WorkflowEnsembleJudgeResult,
  type WorkflowEnsemblePane,
  type WorkflowEnsembleResolvedConflict,
  type WorkflowEnsembleRound,
  type WorkflowEnsembleView,
} from './fileWorkflowEnsemble';

void React;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const FIELD_LABEL_MAP: Record<string, string> = {
  object: '对象描述',
  object_id: '对象',
  object_name: '对象名称',
  normalized_name: '规范名称',
  aliases: '别名',
  core_function: '核心功能',
  reason: '判断理由',
  summary: '摘要',
  round_summary: '本轮摘要',
  relation: '关系',
  relations: '关系列表',
  target_name: '目标名称',
  target_object_name: '目标对象',
  source_id: '源对象',
  target_id: '目标对象',
  confidence: '置信度',
  citation: '引用依据',
  citations: '引用依据',
  suggestion: '修改建议',
  decision: '裁决结论',
  selected_model: '采纳模型',
  preferred_model: '建议保留模型',
  target_model: '被评价模型',
  stance: '立场',
  object_level: '对象层级',
  item_key: '冲突项',
  final_value: '裁决结果',
  resolved_conflicts: '已解决冲突',
  selected_action: '处理动作',
  source_window_ids: '来源窗口',
  merge_reasons: '融合依据',
  observation: '观察',
  impact_reason: '影响原因',
};

function prettifyKey(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function getDisplayLabel(label?: string) {
  const text = asText(label);
  if (!text || text === '__root__') {
    return '';
  }
  if (/^item\s+(\d+)$/i.test(text)) {
    const match = text.match(/^item\s+(\d+)$/i);
    return match ? `第 ${match[1]} 项` : '条目';
  }
  if (FIELD_LABEL_MAP[text]) {
    return FIELD_LABEL_MAP[text];
  }
  return prettifyKey(text);
}

function getDisplayText(value: unknown, options?: { rootFallback?: string; keepArrayItemLabel?: boolean }) {
  const text = asText(value).trim();
  if (!text) {
    return '';
  }
  if (text === '__root__') {
    return options?.rootFallback || '';
  }
  const itemMatch = text.match(/^item\s+(\d+)$/i);
  if (itemMatch) {
    if (options?.keepArrayItemLabel) {
      return `第 ${itemMatch[1]} 项`;
    }
    return '';
  }
  return text;
}

function normalizeComparableText(value: unknown) {
  return asText(value).replace(/\s+/g, ' ').trim();
}

function getDisplayModelName(value: unknown) {
  const text = asText(value).trim();
  if (!text) {
    return '';
  }
  if (text === 'model_a') {
    return '模型 A';
  }
  if (text === 'model_b') {
    return '模型 B';
  }
  if (text === 'judge') {
    return 'Judge';
  }
  return text;
}

function getDisplayConflictKey(value: string, index: number) {
  const text = getDisplayText(value, { rootFallback: '整体结果', keepArrayItemLabel: true });
  if (!text || text === '__root__') {
    return '整体结果';
  }
  return text || `冲突项 ${index + 1}`;
}

function streamStatusLabel(status: string | null | undefined) {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'streaming') return '生成中';
  return '等待中';
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function primitiveText(value: unknown) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function tryParseRawText(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function getObjectTitle(record: Record<string, unknown>, fallback: string) {
  return getDisplayText(record.object_name)
    || getDisplayText(record.parent_object_name)
    || getDisplayText(record.child_object_name)
    || getDisplayText(record.ablated_child_object_name)
    || getDisplayText(record.target_sibling_object_name)
    || getDisplayText(record.object)
    || getDisplayText(record.name)
    || getDisplayText(record.normalized_name)
    || getDisplayText(record.item_key, { rootFallback: '整体结果', keepArrayItemLabel: true })
    || getDisplayText(record.target_name)
    || getDisplayText(record.target_object_name)
    || getDisplayText(record.parent_object_id)
    || getDisplayText(record.child_object_id)
    || getDisplayText(record.ablated_child_object_id)
    || getDisplayText(record.target_sibling_object_id)
    || getDisplayText(record.source_id)
    || getDisplayText(fallback)
    || '条目';
}

function getObjectSummary(record: Record<string, unknown>) {
  return asText(record.core_function)
    || asText(record.reason)
    || asText(record.summary)
    || asText(record.round_summary)
    || asText(record.observation)
    || asText(record.impact_reason);
}

function getObjectBadges(record: Record<string, unknown>) {
  const badges = [
    asText(record.relation),
    asText(record.decision),
    asText(record.object_level),
    getDisplayModelName(record.selected_model),
    getDisplayModelName(record.preferred_model),
    getDisplayModelName(record.target_model),
    asText(record.stance),
  ].filter(Boolean);

  const confidence = record.confidence;
  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    badges.push(`置信度 ${(confidence * 100).toFixed(confidence >= 0.1 ? 0 : 1)}%`);
  }

  return badges.slice(0, 4);
}

function getIdReplacementValue(key: string, record: Record<string, unknown>) {
  if (key === 'object_id') {
    return getDisplayText(record.object_name)
      || getDisplayText(record.parent_object_name)
      || getDisplayText(record.child_object_name)
      || getDisplayText(record.target_object_name)
      || getDisplayText(record.target_name);
  }
  if (key === 'source_id') {
    return getDisplayText(record.source_name)
      || getDisplayText(record.source_object_name)
      || getDisplayText(record.object_name)
      || getDisplayText(record.parent_object_name);
  }
  if (key === 'target_id') {
    return getDisplayText(record.target_name)
      || getDisplayText(record.target_object_name)
      || getDisplayText(record.child_object_name)
      || getDisplayText(record.target_sibling_object_name);
  }
  if (key === 'parent_object_id') {
    return getDisplayText(record.parent_object_name);
  }
  if (key === 'child_object_id') {
    return getDisplayText(record.child_object_name);
  }
  if (key === 'ablated_child_object_id') {
    return getDisplayText(record.ablated_child_object_name);
  }
  if (key === 'target_sibling_object_id') {
    return getDisplayText(record.target_sibling_object_name);
  }
  return '';
}

function shouldHideIdField(key: string, record: Record<string, unknown>) {
  return false;
}

function WorkflowStructuredPrimitive({
  label,
  value,
  record,
}: {
  label?: string;
  value: string | number | boolean | null;
  record?: Record<string, unknown>;
}) {
  const replacement = label ? getIdReplacementValue(label, record ?? {}) : '';
  const displayValue = replacement || primitiveText(value);
  return (
    <div className="space-y-1">
      {getDisplayLabel(label) ? (
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          {getDisplayLabel(label)}
        </div>
      ) : null}
      <div className="rounded-2xl border border-black/5 bg-black/5 px-3 py-2 text-sm leading-6 text-foreground/90">
        {displayValue}
      </div>
    </div>
  );
}

function WorkflowStructuredArray({
  label,
  value,
  depth,
}: {
  label?: string;
  value: unknown[];
  depth: number;
}) {
  if (value.length === 0) {
    return (
      <div className="space-y-1">
        {getDisplayLabel(label) ? (
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {getDisplayLabel(label)}
          </div>
        ) : null}
        <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          空数组
        </div>
      </div>
    );
  }

  const primitiveItems = value.every((item) => isPrimitive(item));
  return (
    <div className="space-y-2">
      {getDisplayLabel(label) ? (
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          {getDisplayLabel(label)} · {value.length}
        </div>
      ) : null}
      {primitiveItems ? (
        <div className="flex flex-wrap gap-2">
          {value.map((item, index) => (
            <Badge key={`${label || 'item'}-${index}`} variant="secondary" className="rounded-full bg-background/85">
              {primitiveText(item)}
            </Badge>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {value.map((item, index) => (
            <div key={`${label || 'item'}-${index}`} className="rounded-2xl border border-border/60 bg-background/75 p-3">
              <WorkflowStructuredValue value={item} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowStructuredObject({
  label,
  value,
  depth,
}: {
  label?: string;
  value: Record<string, unknown>;
  depth: number;
}) {
  const entries = Object.entries(value);
  const summary = getObjectSummary(value);
  const badges = getObjectBadges(value);
  const title = getObjectTitle(value, label ? prettifyKey(label) : '对象');
  const preferredOrder = [
    'object_name',
    'normalized_name',
    'core_function',
    'reason',
    'summary',
    'relation',
    'target_object_name',
    'target_name',
    'confidence',
    'citation',
    'citations',
  ];
  const orderedEntries = [
    ...preferredOrder
      .filter((key) => key in value)
      .map((key) => [key, value[key]] as const),
    ...entries.filter(([key]) => !preferredOrder.includes(key)),
  ];
  const summaryText = normalizeComparableText(summary);
  const titleText = normalizeComparableText(title);

  return (
    <div className={cn(
      'rounded-3xl border bg-background/90 p-3 shadow-sm',
      depth <= 1 ? 'border-border/60' : 'border-border/40 bg-background/70',
    )}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {getDisplayLabel(label) ? (
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              {getDisplayLabel(label)}
            </div>
          ) : null}
          <div className="mt-1 break-all text-sm font-black leading-6">{title}</div>
          {summary ? (
            <div className="mt-2 rounded-2xl border border-primary/10 bg-primary/5 px-3 py-2 text-xs leading-6 text-foreground/85">
              {summary}
            </div>
          ) : null}
        </div>
        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {badges.map((badge, index) => (
              <Badge key={`${badge}-${index}`} variant="outline" className="rounded-full bg-background/85">
                {badge}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3 space-y-3">
        {orderedEntries.map(([key, entryValue]) => {
          const entryText = normalizeComparableText(
            getDisplayText(entryValue, { rootFallback: '整体结果', keepArrayItemLabel: true }) || asText(entryValue),
          );
          const isSummaryDuplicate = summaryText && entryText === summaryText;
          const isTitleDuplicate = titleText && entryText === titleText;
          const isTitleSourceField = ['object_name', 'object', 'name', 'normalized_name', 'item_key', 'target_name', 'target_object_name', 'source_id'].includes(key);

          if (key === 'reason' && entryValue === summary) {
            return null;
          }
          if (key === 'summary' && entryValue === summary) {
            return null;
          }
          if (key === 'core_function' && entryValue === summary) {
            return null;
          }
          if (key === 'round_summary' && isSummaryDuplicate) {
            return null;
          }
          if (key === 'object' && isSummaryDuplicate) {
            return null;
          }
          if (isTitleSourceField && isTitleDuplicate) {
            return null;
          }
          if ((key === 'object' || key === 'observation') && isSummaryDuplicate) {
            return null;
          }
          if (shouldHideIdField(key, value)) {
            return null;
          }
          return (
            <WorkflowStructuredValue
              key={key}
              label={key}
              value={entryValue}
              depth={depth + 1}
              parentRecord={value}
            />
          );
        })}
      </div>
    </div>
  );
}

function WorkflowStructuredValue({
  label,
  value,
  depth = 0,
  parentRecord,
}: {
  label?: string;
  value: unknown;
  depth?: number;
  parentRecord?: Record<string, unknown>;
}) {
  if (isPrimitive(value)) {
    return <WorkflowStructuredPrimitive label={label} value={value} record={parentRecord} />;
  }

  if (Array.isArray(value)) {
    return <WorkflowStructuredArray label={label} value={value} depth={depth} />;
  }

  const record = asRecord(value);
  if (Object.keys(record).length > 0) {
    return <WorkflowStructuredObject label={label} value={record} depth={depth} />;
  }

  return (
    <div className="space-y-1">
      {getDisplayLabel(label) ? (
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          {getDisplayLabel(label)}
        </div>
      ) : null}
      <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        暂无结构化数据
      </div>
    </div>
  );
}

function WorkflowResolvedConflictList({
  conflicts,
}: {
  conflicts: WorkflowEnsembleResolvedConflict[];
}) {
  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        裁决记录
      </div>
      {conflicts.map((conflict, index) => (
        <div key={`${conflict.itemKey}-${index}`} className="rounded-2xl border border-border/60 bg-background/75 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full bg-background/85">
              {getDisplayConflictKey(conflict.itemKey, index) || `冲突项 ${index + 1}`}
            </Badge>
            <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary">
              {conflict.decision || '待判定'}
            </Badge>
          </div>
          {conflict.summary ? (
            <div className="mt-2 text-sm leading-6 text-foreground/85">{conflict.summary}</div>
          ) : null}
          {conflict.finalValue !== undefined ? (
            <div className="mt-3">
              <WorkflowStructuredValue label="final_value" value={conflict.finalValue} depth={1} />
            </div>
          ) : null}
          {conflict.citations.length > 0 ? (
            <div className="mt-3 space-y-2">
              {conflict.citations.map((citation, citationIndex) => (
                <div key={`${citation.targetModel}-${citationIndex}`} className="rounded-2xl border border-border/50 bg-muted/20 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full">
                      {getDisplayModelName(citation.targetModel) || 'unknown'}
                    </Badge>
                    <Badge variant="secondary" className="rounded-full">
                      {citation.stance || '修改'}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs leading-6 text-muted-foreground">
                    原因：{citation.reason || '未说明'}
                  </div>
                  <div className="text-xs leading-6 text-muted-foreground">
                    建议：{citation.suggestion || '未说明'}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

type WorkflowChatTone = 'modelA' | 'modelB' | 'judge' | 'system' | 'final';

function toneMeta(tone: WorkflowChatTone) {
  if (tone === 'modelA') {
    return {
      align: 'justify-start',
      bubble: 'border-sky-500/25 bg-sky-500/8',
      avatar: 'bg-sky-500 text-white',
      header: 'text-sky-700',
      icon: 'A',
    };
  }
  if (tone === 'modelB') {
    return {
      align: 'justify-end',
      bubble: 'border-violet-500/25 bg-violet-500/8',
      avatar: 'bg-violet-500 text-white',
      header: 'text-violet-700',
      icon: 'B',
    };
  }
  if (tone === 'judge') {
    return {
      align: 'justify-center',
      bubble: 'border-amber-500/25 bg-amber-500/8',
      avatar: 'bg-amber-500 text-white',
      header: 'text-amber-700',
      icon: 'J',
    };
  }
  if (tone === 'final') {
    return {
      align: 'justify-center',
      bubble: 'border-emerald-500/25 bg-emerald-500/8',
      avatar: 'bg-emerald-500 text-white',
      header: 'text-emerald-700',
      icon: 'F',
    };
  }
  return {
    align: 'justify-center',
    bubble: 'border-border/60 bg-background/90',
    avatar: 'bg-foreground text-background',
    header: 'text-muted-foreground',
    icon: '系',
  };
}

function WorkflowChatBubble({
  tone,
  title,
  modelName,
  status,
  rawText,
  children,
  footer,
}: {
  tone: WorkflowChatTone;
  title: string;
  modelName?: string;
  status?: string;
  rawText?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const meta = toneMeta(tone);
  const showRawText = Boolean(rawText?.trim());

  return (
    <div className={cn('flex w-full', meta.align)}>
      <div className={cn('flex max-w-[min(100%,1520px)] items-start gap-3', tone === 'modelB' ? 'flex-row-reverse' : '')}>
        <div className={cn('mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black shadow-sm', meta.avatar)}>
          {meta.icon}
        </div>
        <div className={cn('min-w-0 overflow-hidden rounded-[24px] border px-4 py-3 shadow-sm', meta.bubble)}>
          <div className={cn('flex flex-wrap items-center gap-2 text-xs font-bold', meta.header)}>
            <span>{title}</span>
            {modelName ? (
              <Badge variant="outline" className="rounded-full bg-background/85">
                {modelName}
              </Badge>
            ) : null}
            {status ? (
              <Badge variant="secondary" className="rounded-full bg-background/85">
                {streamStatusLabel(status)}
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {children}
          </div>
          {footer ? (
            <div className="mt-3">
              {footer}
            </div>
          ) : null}
          {showRawText ? (
            <Collapsible className="mt-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs text-muted-foreground">
                  查看原始文本
                  <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-2xl border border-border/60 bg-slate-950/95 p-3 text-xs leading-6 text-slate-100">
                  {rawText}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorkflowPaneMessage({
  pane,
  tone,
  title,
}: {
  pane: WorkflowEnsemblePane;
  tone: WorkflowChatTone;
  title: string;
}) {
  const parsedRaw = tryParseRawText(pane.rawText);
  const structuredValue = pane.data ?? parsedRaw ?? pane.rawText;

  return (
    <WorkflowChatBubble
      tone={tone}
      title={title}
      modelName={pane.modelName}
      status={pane.status}
      rawText={pane.rawText}
    >
      <WorkflowStructuredValue value={structuredValue} />
    </WorkflowChatBubble>
  );
}

function WorkflowRoundMessage({ round, index }: { round: WorkflowEnsembleRound; index: number }) {
  const tone: WorkflowChatTone = round.reviewerModelKey === 'model_b' ? 'modelB' : 'modelA';
  const structuredValue = round.resolvedConflicts.length > 0 ? round.data : (round.data ?? tryParseRawText(round.rawText) ?? round.rawText);

  return (
    <WorkflowChatBubble
      tone="system"
      title={`第 ${round.round || index + 1} 轮互评`}
      modelName={getDisplayModelName(round.reviewerModel || round.reviewerModelKey)}
      status={round.status}
      rawText={round.rawText}
      footer={round.resolvedConflicts.length > 0 ? <WorkflowResolvedConflictList conflicts={round.resolvedConflicts} /> : null}
    >
      <div className="rounded-2xl border border-border/50 bg-background/75 px-3 py-2 text-sm leading-6 text-foreground/85">
        {round.roundSummary || '该轮没有给出额外摘要，下面保留结构化输出。'}
      </div>
      <div className="rounded-2xl border border-dashed border-border/50 bg-background/65 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          <GitBranchPlus className="h-3.5 w-3.5" />
          {tone === 'modelB' ? '模型 B 的互评意见' : '模型 A 的互评意见'}
        </div>
        <WorkflowStructuredValue value={structuredValue} />
      </div>
    </WorkflowChatBubble>
  );
}

function WorkflowJudgeMessage({ judgeResult }: { judgeResult: WorkflowEnsembleJudgeResult }) {
  const structuredValue = judgeResult.data ?? tryParseRawText(judgeResult.rawText) ?? judgeResult.rawText;
  return (
    <WorkflowChatBubble
      tone="judge"
      title="Judge 裁决"
      modelName={judgeResult.modelName}
      status={judgeResult.status}
      rawText={judgeResult.rawText}
    >
      <WorkflowStructuredValue value={structuredValue} />
    </WorkflowChatBubble>
  );
}

function WorkflowFinalMessage({ finalResult }: { finalResult: WorkflowEnsembleFinalResult }) {
  const structuredValue = finalResult.data ?? tryParseRawText(finalResult.rawText) ?? finalResult.rawText;
  return (
    <WorkflowChatBubble
      tone="final"
      title="最终保留结果"
      modelName={finalResult.source || 'final'}
      status={finalResult.status}
      rawText={finalResult.rawText}
    >
      <WorkflowStructuredValue value={structuredValue} />
    </WorkflowChatBubble>
  );
}

export function WorkflowTrioPreview({
  title,
  ensemble,
  summary,
  defaultOpen = false,
}: {
  title: string;
  ensemble: unknown;
  summary?: string;
  defaultOpen?: boolean;
}) {
  const view = extractWorkflowEnsembleView(ensemble);
  if (!view) {
    return null;
  }

  return (
    <Dialog defaultOpen={defaultOpen}>
      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary/80">A / B / Judge</div>
            <div className="mt-1 text-sm font-black">{title}</div>
            {summary ? (
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{summary}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full">Shared {view.sharedCount}</Badge>
            <Badge variant="outline" className="rounded-full">Conflict {view.conflictCount}</Badge>
            <Badge variant="outline" className="rounded-full">Rounds {view.rounds.length}</Badge>
            <Badge variant="secondary" className="rounded-full">{view.judgeResult ? 'Judge 已输出' : 'Judge 未触发/未完成'}</Badge>
            <DialogTrigger asChild>
              <Button type="button" size="sm" className="rounded-full">
                查看群聊
              </Button>
            </DialogTrigger>
          </div>
        </div>
      </div>
      <DialogContent className="grid h-[min(94vh,1040px)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:w-[min(99vw,1920px)] sm:max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[28px] border-border/60 bg-background/95 p-0 shadow-2xl">
        <DialogHeader className="border-b border-border/50 px-6 py-5">
          <DialogTitle className="text-2xl font-black tracking-tight">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {summary || '在这里查看该步骤的模型 A、模型 B、judge、互评轮次与最终保留结果。'}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 px-6 py-5">
          <WorkflowTrioConversationBody view={view} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowTrioConversationBody({ view }: { view: WorkflowEnsembleView }) {
  return (
    <div className="space-y-4 pb-2">
      <div className="rounded-3xl border border-border/60 bg-muted/15 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full">群聊式对话流</Badge>
          <Badge variant="secondary" className="rounded-full">Shared {view.sharedCount}</Badge>
          <Badge variant="secondary" className="rounded-full">Conflict {view.conflictCount}</Badge>
          <Badge variant="secondary" className="rounded-full">Rounds {view.rounds.length}</Badge>
        </div>
        <div className="mt-2 text-sm leading-6 text-muted-foreground">
          每条消息都先显示可读字段卡片；需要排障时，再展开底部的原始文本。
        </div>
      </div>

      {view.modelA ? (
        <WorkflowPaneMessage pane={view.modelA} tone="modelA" title="模型 A" />
      ) : null}
      {view.modelB ? (
        <WorkflowPaneMessage pane={view.modelB} tone="modelB" title="模型 B" />
      ) : null}

      {view.rounds.map((round, index) => (
        <WorkflowRoundMessage key={`${round.reviewerModelKey}-${round.round}-${index}`} round={round} index={index} />
      ))}

      {view.judgeResult ? (
        <WorkflowJudgeMessage judgeResult={view.judgeResult} />
      ) : (
        <WorkflowChatBubble tone="system" title="Judge 状态">
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-3 py-2 text-sm leading-6 text-muted-foreground">
            {view.conflictCount === 0 ? '这一轮没有冲突，shared 直接收敛，没有触发 judge。' : 'Judge 结果暂未返回。'}
          </div>
        </WorkflowChatBubble>
      )}

      {view.finalResult ? (
        <WorkflowFinalMessage finalResult={view.finalResult} />
      ) : (
        <WorkflowChatBubble tone="system" title="最终结果">
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-3 py-2 text-sm leading-6 text-muted-foreground">
            最终保留结果暂未生成。
          </div>
        </WorkflowChatBubble>
      )}
    </div>
  );
}
