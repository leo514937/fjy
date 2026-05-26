import React, { type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import type { WorkflowAblationPanels, WorkflowField, WorkflowPanelCard } from './fileWorkflowAblation';

void React;

function findFieldValue(fields: WorkflowField[], label: string): string {
  return fields.find((field) => field.label === label)?.value ?? '';
}

function buildCandidatePreview(card: WorkflowPanelCard): Record<string, string> {
  return {
    entity_name: card.title,
    保留作用: findFieldValue(card.fields, '保留作用'),
    去除影响: findFieldValue(card.fields, '去除影响'),
  };
}

function buildJudgePreview(card: WorkflowPanelCard): Record<string, string> {
  return {
    entity_name: card.title,
    判定: card.badge || '继续观察',
    概率差: findFieldValue(card.fields, '概率差'),
    判定依据: findFieldValue(card.fields, '判定依据'),
  };
}

export function buildWorkflowStagePreview(
  stageKey: string,
  stageOutput: Record<string, unknown> | null | undefined,
  ablationPanels: WorkflowAblationPanels,
): unknown {
  if (!stageOutput) {
    return null;
  }

  if (stageKey === 'ablation_candidate' && ablationPanels.candidates.length > 0) {
    return {
      candidate_count: ablationPanels.candidates.length,
      sample: ablationPanels.candidates.slice(0, 1).map(buildCandidatePreview),
    };
  }

  if (stageKey === 'ablation_judge' && ablationPanels.judges.length > 0) {
    return {
      judge_count: ablationPanels.judges.length,
      hit_count: ablationPanels.judges.filter((card) => card.badge === '命中小故').length,
      sample: ablationPanels.judges.slice(0, 1).map(buildJudgePreview),
    };
  }

  return stageOutput;
}

interface WorkflowInsightCardProps {
  card: WorkflowPanelCard;
  badge?: ReactNode;
  tone?: 'default' | 'destructive';
  highlightedFieldLabels?: string[];
  valueAccentFieldLabels?: string[];
}

export function WorkflowInsightCard({
  card,
  badge,
  tone = 'default',
  highlightedFieldLabels = [],
  valueAccentFieldLabels = [],
}: WorkflowInsightCardProps) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-border/50 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg',
        tone === 'destructive' && 'border-destructive/30',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-black">{card.title}</div>
          <div className="mt-1 text-[11px] font-mono text-muted-foreground">{card.id}</div>
        </div>
        {badge ?? (
          <Badge variant="outline" className="rounded-full">
            {card.id.slice(-4)}
          </Badge>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {card.fields.map((field) => {
          const isHighlighted = highlightedFieldLabels.includes(field.label);
          const accentValue = valueAccentFieldLabels.includes(field.label);
          return (
            <div
              key={`${card.id}-${field.label}`}
              className={cn(
                'rounded-2xl border border-border/40 bg-muted/20 p-3',
                isHighlighted && tone === 'destructive' && 'border-destructive/20 bg-destructive/5',
                isHighlighted && tone === 'default' && 'border-primary/20 bg-primary/5',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {field.label}
                </div>
                {accentValue ? (
                  <div
                    className={cn(
                      'text-[11px] font-black',
                      tone === 'destructive' ? 'text-destructive' : 'text-primary',
                    )}
                  >
                    {field.value}
                  </div>
                ) : null}
              </div>
              <div
                className={cn(
                  'mt-2 text-xs leading-6 text-foreground/90',
                  field.label === '判定依据' && 'italic',
                )}
              >
                {field.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
