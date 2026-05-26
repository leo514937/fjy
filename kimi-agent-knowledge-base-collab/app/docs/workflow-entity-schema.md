# 工作流实体 JSON IO 规范

本文档定义当前后端、前端、工作流引擎与 OntoGit 网关之间唯一允许的本体实体 JSON 结构。

## 规范目标

- 所有本体数据只使用这一种 JSON 结构。
- 读写层统一依赖这份结构，不再兼容旧格式。
- 所有写入都只写 JSON，不再写 Markdown 作为持久化格式。
- 文件工作流的输出结果即为本体实体的标准格式。

## 顶层结构

```json
{
  "source": "linear-workflow",
  "ontology": {
    "workflow_version": "v1-linear-file-workflow",
    "generated_at": "2026-04-25T00:00:00Z",
    "project_id": "demo",
    "scope": "entity",
    "entity_id": "entity_salinity_monitoring",
    "entity_name": "盐度监测",
    "system_summary": {
      "entity_count": 1,
      "relation_count": 1,
      "ablation_count": 0
    },
    "entity": { },
    "relations": [ ],
    "ablation": null
  },
  "entity": { },
  "relations": [ ],
  "ablation": null,
  "precheck": null,
  "ontology_summary": { },
  "probability": "95%"
}
```

## 字段说明

- `source`：固定为字符串，当前默认值为 `linear-workflow`。
- `ontology`：本体层元信息，必须包含实体归属、生成时间、系统汇总和实体快照。
- `entity`：当前实体的标准定义，`ontology.entity` 与顶层 `entity` 必须一致。
- `relations`：当前实体的关系数组，元素必须使用标准关系字段。
- `ablation`：当前实体的消融评估结果，允许为 `null`，支持精简的候选说明与小故命中结果。
- `precheck`：写入前的概率或健康检查结果，允许为 `null`。
- `ontology_summary`：与 `ontology.system_summary` 一致的汇总对象。
- `probability`：可选字符串，表示附加的概率结果，例如 `95%`。

## 实体字段

`entity` 只允许以下字段：

- `id`
- `name`
- `summary`
- `type`
- `level`
- `source`
- `properties`
- `abilities`
- `citations`

## 关系字段

`relations[]` 只允许以下字段：

- `source_entity_id`
- `target_entity_id`
- `source_name`
- `target_name`
- `relation_type`
- `evidence`

## 消融字段

`ablation` 允许以下字段：

- `entity_id`
- `entity_name`
- `impact_level`
- `impact_reason`
- `system_risk`
- `remove_target`
- `retain_target`
- `keep_role`
- `remove_impact`
- `observation`
- `evidence`
- `keep_probability`
- `remove_probability`
- `probability_gap`
- `judge_reason`
- `small_reason`

约束补充：

- `small_reason` 只允许在命中时写入 `true`
- 不允许显式写入 `small_reason: false`

## 预检字段

`precheck` 只允许以下字段：

- `entity_id`
- `entity_name`
- `precheck_probability`
- `precheck_reason`
- `raw`

## 约束

- 顶层不允许出现额外字段，但允许可选的 `probability`。
- `ontology`、`entity`、`relations`、`ablation`、`precheck`、`ontology_summary` 的结构都要通过统一校验。
- 任何旧版 Wiki、Markdown、批量兼容格式都视为无效输入。
- 读取 OntoGit 时，知识图谱构建也只扫描符合此结构的 JSON 文件。

## 来源

- 文件工作流的 `entity_files[].data`
- 编辑器入库草稿
- OntoGit 网关 `write-and-infer`
