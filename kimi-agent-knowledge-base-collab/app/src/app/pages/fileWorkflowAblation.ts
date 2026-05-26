export type WorkflowField = {
  label: string;
  value: string;
};

export type WorkflowPanelCard = {
  id: string;
  title: string;
  badge?: string;
  fields: WorkflowField[];
};

export type WorkflowAblationPanels = {
  candidates: WorkflowPanelCard[];
  judges: WorkflowPanelCard[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildFields(entries: Array<[string, unknown]>): WorkflowField[] {
  return entries
    .map(([label, value]) => ({ label, value: asText(value) }))
    .filter((item) => item.value);
}

function buildCandidateCard(record: Record<string, unknown>, index: number): WorkflowPanelCard {
  return {
    id: asText(record.entity_id) || `candidate-${index + 1}`,
    title: asText(record.entity_name) || asText(record.remove_target) || `候选 ${index + 1}`,
    fields: buildFields([
      ['去除对象', record.remove_target],
      ['保留对象', record.retain_target],
      ['保留作用', record.keep_role],
      ['去除影响', record.remove_impact],
      ['观察点', record.observation],
      ['依据', record.evidence],
      ['影响等级', record.impact_level],
      ['影响说明', record.impact_reason],
      ['系统风险', record.system_risk],
    ]),
  };
}

function buildJudgeCard(
  record: Record<string, unknown>,
  candidateRecord: Record<string, unknown>,
  index: number,
): WorkflowPanelCard {
  const isHit = record.small_reason === true;
  return {
    id: asText(record.entity_id) || `judge-${index + 1}`,
    title: asText(record.entity_name) || `判定 ${index + 1}`,
    badge: isHit ? '命中小故' : '继续观察',
    fields: buildFields([
      ['保留版概率', record.keep_probability],
      ['去除版概率', record.remove_probability],
      ['概率差', record.probability_gap],
      ['兄弟节点状态', record.sibling_summary],
      ['判定依据', record.judge_reason],
      ['去除对象', candidateRecord.remove_target],
      ['保留对象', candidateRecord.retain_target],
      ['保留作用', candidateRecord.keep_role],
      ['去除影响', candidateRecord.remove_impact],
      ['观察点', candidateRecord.observation],
      ['依据', candidateRecord.evidence],
    ]),
  };
}

export function extractAblationPanels(value: unknown): WorkflowAblationPanels {
  const output = asRecord(value);
  const rawCandidates = Array.isArray(output.ablation_candidates) ? output.ablation_candidates : [];
  const rawJudges = Array.isArray(output.ablation_judges) ? output.ablation_judges : [];
  const rawLegacy = Array.isArray(output.ablation) ? output.ablation : [];
  const candidateSource = rawCandidates.length > 0 ? rawCandidates : rawLegacy;
  const judgeSource = rawJudges.length > 0 ? rawJudges : rawLegacy;
  const candidateMap = new Map(
    candidateSource.map((item, index) => {
      const record = asRecord(item);
      const key = asText(record.entity_id) || asText(record.entity_name) || `candidate-${index + 1}`;
      return [key, record] as const;
    }),
  );

  return {
    // 兼容历史快照：旧版只输出 ablation 合并数组，没有 candidates/judges 双数组。
    candidates: candidateSource
      .map((item, index) => buildCandidateCard(asRecord(item), index))
      .filter((item) => item.title && item.fields.length > 0),
    judges: judgeSource
      .map((item, index) => {
        const record = asRecord(item);
        const candidateRecord = candidateMap.get(asText(record.entity_id))
          || candidateMap.get(asText(record.entity_name))
          || record;
        return buildJudgeCard(record, candidateRecord, index);
      })
      .filter((item, index) => item.title && (item.fields.length > 0 || asRecord(judgeSource[index]).small_reason === true)),
  };
}
