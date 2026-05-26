export const WORKFLOW_V2_STAGE_DEFINITIONS = [
  {
    key: "chunk_parse",
    short: "01",
    title: "分块",
    detail: "自然段切块与短块归并",
    retryable: false,
    entryCriteria: ["文件文本可读取"],
    exitCriteria: ["chunks 已生成", "offset 已记录"],
  },
  {
    key: "window_extract",
    short: "02",
    title: "窗口抽取",
    detail: "滑动窗口并行抽取对象",
    retryable: true,
    entryCriteria: ["chunks 已生成"],
    exitCriteria: ["windows 已生成", "window objects 已生成"],
  },
  {
    key: "object_fusion",
    short: "03",
    title: "对象融合",
    detail: "同名直合并，近义对象裁决",
    retryable: true,
    entryCriteria: ["window objects 已生成"],
    exitCriteria: ["fused objects 已生成"],
  },
  {
    key: "function_analysis",
    short: "04",
    title: "功能分析",
    detail: "基于 citation 提取对象核心功能",
    retryable: true,
    entryCriteria: ["fused objects 已生成"],
    exitCriteria: ["function objects 已生成"],
  },
  {
    key: "object_decompose",
    short: "05",
    title: "对象拆解",
    detail: "基于 citation 提取直接组成关系",
    retryable: true,
    entryCriteria: ["function objects 已生成"],
    exitCriteria: ["decomposition edges 已生成"],
  },
  {
    key: "graph_build",
    short: "06",
    title: "图构建",
    detail: "构建 contains DAG 并消解环",
    retryable: true,
    entryCriteria: ["decomposition edges 已生成"],
    exitCriteria: ["edges 已生成", "图已 DAG 化"],
  },
  {
    key: "ablation_analysis",
    short: "07",
    title: "消融",
    detail: "按核心功能标准做兄弟/父级影响分析",
    retryable: true,
    entryCriteria: ["DAG 已生成"],
    exitCriteria: ["ablation summaries 已生成"],
  },
];

export const WORKFLOW_V2_STAGE_KEYS = WORKFLOW_V2_STAGE_DEFINITIONS.map((stage) => stage.key);

export function getWorkflowV2StageDefinition(stageKey) {
  return WORKFLOW_V2_STAGE_DEFINITIONS.find((stage) => stage.key === stageKey) ?? null;
}
