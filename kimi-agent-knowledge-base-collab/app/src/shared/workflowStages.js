export const WORKFLOW_STAGE_DEFINITIONS = [
  {
    key: "auth_precheck",
    short: "01",
    title: "验证",
    detail: "登录校验与上下文准备",
    retryable: false,
    entryCriteria: ["project_id 可用", "工作流模型可用"],
    exitCriteria: ["认证结果可用", "上下文已就绪"],
  },
  {
    key: "observe",
    short: "02",
    title: "观察",
    detail: "抽取实体与证据片段",
    retryable: true,
    entryCriteria: ["文件内容可读", "文档文本非空"],
    exitCriteria: ["entities 已生成", "每个实体具备摘要与引用"],
  },
  {
    key: "relations",
    short: "03",
    title: "关系",
    detail: "组织结构边与依赖",
    retryable: true,
    entryCriteria: ["entities 已生成", "实体之间可建立映射"],
    exitCriteria: ["relations 已生成", "关系可回溯到已有实体"],
  },
  {
    key: "ablation_candidate",
    short: "04",
    title: "消融预选",
    detail: "识别潜在影响实体",
    retryable: true,
    entryCriteria: ["entities 已生成", "relations 已生成"],
    exitCriteria: ["候选实体列表已生成", "候选字段结构完整"],
  },
  {
    key: "ablation_judge",
    short: "05",
    title: "小故命中",
    detail: "逐实体概率影响评估",
    retryable: true,
    entryCriteria: ["候选实体可用", "保留/去除对比上下文可构造"],
    exitCriteria: ["保留概率已生成", "去除概率已生成", "判定结果已生成"],
  },
  {
    key: "ontology",
    short: "06",
    title: "本体",
    detail: "组装实体 JSON 与汇总",
    retryable: true,
    entryCriteria: ["entities 已生成", "relations 已生成", "ablation 结果已生成"],
    exitCriteria: ["ontology 已组装", "entity 级文件清单已生成"],
  },
  {
    key: "probability_precheck",
    short: "07",
    title: "概率",
    detail: "预判分数与解释",
    retryable: true,
    entryCriteria: ["ontology 已生成", "entity 级文件可用"],
    exitCriteria: ["prechecks 已生成", "每个实体均有预判结果"],
  },
  {
    key: "ingest",
    short: "08",
    title: "入库",
    detail: "提交 OntoGit 与写回",
    retryable: true,
    entryCriteria: ["entity 级文件已生成", "写入校验可通过"],
    exitCriteria: ["ingest_results 已生成", "写回版本信息已记录"],
  },
];

export const WORKFLOW_STAGE_KEYS = WORKFLOW_STAGE_DEFINITIONS.map((stage) => stage.key);

export function getWorkflowStageDefinition(stageKey) {
  return WORKFLOW_STAGE_DEFINITIONS.find((stage) => stage.key === stageKey) ?? null;
}
