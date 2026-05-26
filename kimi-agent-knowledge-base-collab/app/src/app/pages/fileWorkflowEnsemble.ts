function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface WorkflowEnsemblePane {
  title: string;
  modelName: string;
  modelKey: string;
  data: unknown;
  rawText: string;
  status: string;
}

export interface WorkflowEnsembleRound {
  round: number;
  reviewerModel: string;
  reviewerModelKey: string;
  data: unknown;
  rawText: string;
  status: string;
  roundSummary: string;
  resolvedConflicts: WorkflowEnsembleResolvedConflict[];
}

export interface WorkflowEnsembleFinalResult {
  source: string;
  data: unknown;
  rawText: string;
  status: string;
}

export interface WorkflowEnsembleJudgeResult {
  title: string;
  modelName: string;
  modelKey: string;
  data: unknown;
  rawText: string;
  status: string;
}

export interface WorkflowEnsembleCitation {
  targetModel: string;
  stance: string;
  reason: string;
  suggestion: string;
}

export interface WorkflowEnsembleResolvedConflict {
  itemKey: string;
  decision: string;
  summary: string;
  finalValue: unknown;
  citations: WorkflowEnsembleCitation[];
}

export interface WorkflowEnsembleView {
  strategy: string;
  parallelCount: number;
  debateRounds: number;
  sharedCount: number;
  conflictCount: number;
  modelA: WorkflowEnsemblePane | null;
  modelB: WorkflowEnsemblePane | null;
  judgeResult: WorkflowEnsembleJudgeResult | null;
  rounds: WorkflowEnsembleRound[];
  finalResult: WorkflowEnsembleFinalResult | null;
}

export interface WorkflowJudgeEnsembleItem {
  id: string;
  entityName: string;
  keep: WorkflowEnsembleView | null;
  remove: WorkflowEnsembleView | null;
}

function normalizePane(value: unknown, title: string, modelKey: string, fallbackModelName: string): WorkflowEnsemblePane | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }

  return {
    title,
    modelKey,
    modelName: asText(record.model) || fallbackModelName || modelKey,
    data: record.data,
    rawText: asText(record.raw_text),
    status: asText(record.status) || 'completed',
  };
}

function pickLatestPaneCandidate(value: unknown): unknown {
  const candidates = asArray(value)
    .map((item) => asRecord(item))
    .filter((item) => Object.keys(item).length > 0);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate && Object.keys(candidate).length > 0) {
      return candidate;
    }
  }

  return null;
}

function normalizeResolvedConflicts(value: unknown): WorkflowEnsembleResolvedConflict[] {
  return asArray(value)
    .map((item) => {
      const record = asRecord(item);
      if (Object.keys(record).length === 0) {
        return null;
      }

      const citations = asArray(record.citations)
        .map((citation) => {
          const citationRecord = asRecord(citation);
          if (Object.keys(citationRecord).length === 0) {
            return null;
          }
          return {
            targetModel: asText(citationRecord.target_model),
            stance: asText(citationRecord.stance),
            reason: asText(citationRecord.reason),
            suggestion: asText(citationRecord.suggestion),
          } satisfies WorkflowEnsembleCitation;
        })
        .filter((item): item is WorkflowEnsembleCitation => item !== null);

      return {
        itemKey: asText(record.item_key),
        decision: asText(record.decision),
        summary: asText(record.summary),
        finalValue: record.final_value,
        citations,
      } satisfies WorkflowEnsembleResolvedConflict;
    })
    .filter((item): item is WorkflowEnsembleResolvedConflict => item !== null);
}

export function extractWorkflowEnsembleView(value: unknown): WorkflowEnsembleView | null {
  const root = asRecord(value);
  if (Object.keys(root).length === 0) {
    return null;
  }

  const models = asRecord(root.models);
  const modelARecord = asRecord(models.model_a);
  const modelBRecord = asRecord(models.model_b);
  const modelAName = asText(modelARecord.model) || 'model_a';
  const modelBName = asText(modelBRecord.model) || 'model_b';
  const modelASingleSource = modelARecord.single_result ?? pickLatestPaneCandidate(modelARecord.candidates);
  const modelBSingleSource = modelBRecord.single_result ?? pickLatestPaneCandidate(modelBRecord.candidates);
  const judgeResultRecord = asRecord(root.judge_result);
  const judgeModelName = asText(judgeResultRecord.model) || asText(root.judge_model) || 'judge';
  const rounds = asArray(root.cross_rounds)
    .map((item) => {
      const record = asRecord(item);
      if (Object.keys(record).length === 0) {
        return null;
      }
      return {
        round: asNumber(record.round),
        reviewerModel: asText(record.reviewer_model) || asText(record.reviewer_model_key),
        reviewerModelKey: asText(record.reviewer_model_key),
        data: record.data,
        rawText: asText(record.raw_text),
        status: asText(record.status) || 'completed',
        roundSummary: asText(asRecord(record.data).round_summary),
        resolvedConflicts: normalizeResolvedConflicts(asRecord(record.data).resolved_conflicts),
      } satisfies WorkflowEnsembleRound;
    })
    .filter((item): item is WorkflowEnsembleRound => item !== null);

  const finalResultRecord = asRecord(root.final_result);

  return {
    strategy: asText(root.strategy),
    parallelCount: asNumber(root.parallel_count),
    debateRounds: asNumber(root.debate_rounds),
    sharedCount: asArray(root.shared_items).length,
    conflictCount: asArray(root.conflicts).length,
    modelA: normalizePane(modelASingleSource, '模型 A 单次结果', 'model_a', modelAName),
    modelB: normalizePane(modelBSingleSource, '模型 B 单次结果', 'model_b', modelBName),
    judgeResult: Object.keys(judgeResultRecord).length > 0
      ? {
        title: 'Judge 二选一',
        modelName: judgeModelName,
        modelKey: 'judge',
        data: judgeResultRecord.data,
        rawText: asText(judgeResultRecord.raw_text),
        status: asText(judgeResultRecord.status) || 'completed',
      }
      : null,
    rounds,
    finalResult: Object.keys(finalResultRecord).length > 0
      ? {
        source: asText(finalResultRecord.source),
        data: finalResultRecord.data,
        rawText: asText(finalResultRecord.raw_text),
        status: asText(finalResultRecord.status) || 'completed',
      }
      : null,
  };
}

export function extractWorkflowJudgeEnsembleItems(value: unknown, judgesValue: unknown): WorkflowJudgeEnsembleItem[] {
  const root = asRecord(value);
  const judgeResults = asArray(root.judge_results);
  const judgeList = asArray(judgesValue);
  const judgeNameMap = new Map(
    judgeList.map((item) => {
      const record = asRecord(item);
      return [asText(record.entity_id), asText(record.entity_name)] as const;
    }).filter(([id, name]) => id && name),
  );

  return judgeResults.map((item, index) => {
    const record = asRecord(item);
    const entityId = asText(record.entity_id) || `judge-${index + 1}`;
    const nested = asRecord(record.llm_ensemble);
    return {
      id: entityId,
      entityName: judgeNameMap.get(entityId) || entityId,
      keep: extractWorkflowEnsembleView(nested.keep_result),
      remove: extractWorkflowEnsembleView(nested.remove_result),
    };
  }).filter((item) => item.keep || item.remove);
}
