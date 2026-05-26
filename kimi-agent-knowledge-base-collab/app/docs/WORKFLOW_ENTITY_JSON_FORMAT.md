# Workflow Entity JSON 统一格式（唯一受支持）

> 本项目现仅支持这一种 OntoGit 实体文件格式。任何旧格式、Markdown 入库格式、兼容解析路径均已废弃并被拦截。

## 1. 顶层结构

顶层必须是对象，且必须包含以下字段：

- `source`：非空字符串
- `ontology`：对象
- `entity`：对象
- `relations`：数组
- `ablation`：对象（可为空对象）

## 2. 字段约束

### `ontology`
- `scope`：固定为 `entity`
- `workflow_version`：非空字符串
- `project_id`：非空字符串
- `entity_id`：非空字符串，且必须等于 `entity.id`
- `entity_name`：非空字符串，且必须等于 `entity.name`
- `generated_at`：非空字符串（建议 ISO 时间）

### `entity`
- `id`：非空字符串
- `name`：非空字符串
- `summary`：字符串
- `type`：字符串
- `level`：数字
- `citations`：字符串数组
- `abilities`：字符串数组
- `properties`：对象

### `relations[]`
每个关系项必须是对象，且至少包含：
- `source_entity_id`：非空字符串
- `target_entity_id`：非空字符串
- `source_name`：非空字符串
- `target_name`：非空字符串
- `relation_type`：非空字符串
- `evidence`：字符串

### `ablation`
- 对象类型（可为空对象）
- 最小必填字段：`entity_id`、`entity_name`
- 基础字段：`impact_level`、`impact_reason`、`system_risk`
- 候选字段：`remove_target`、`retain_target`、`keep_role`、`remove_impact`、`observation`、`evidence`
- 判定字段：`keep_probability`、`remove_probability`、`probability_gap`、`judge_reason`
- 命中标记：`small_reason` 只允许写入 `true`，未命中时保持空缺

## 3. 合法示例

```json
{
  "source": "linear-workflow",
  "ontology": {
    "scope": "entity",
    "workflow_version": "1",
    "project_id": "demo",
    "entity_id": "entity_ocean_salinity",
    "entity_name": "海水盐度监测",
    "generated_at": "2026-04-25T11:30:00Z"
  },
  "entity": {
    "id": "entity_ocean_salinity",
    "name": "海水盐度监测",
    "summary": "用于持续监测盐度变化并触发预警。",
    "type": "capability",
    "level": 2,
    "citations": ["ISO-1234", "内部规范 V2"],
    "abilities": ["监测", "告警"],
    "properties": {
      "domain": "marine",
      "owner": "ocean-lab"
    }
  },
  "relations": [
    {
      "source_entity_id": "entity_ocean_salinity",
      "target_entity_id": "entity_alert_engine",
      "source_name": "海水盐度监测",
      "target_name": "告警引擎",
      "relation_type": "depends_on",
      "evidence": "系统架构图 A-12"
    }
  ],
  "ablation": {
    "impact_level": "high",
    "impact_reason": "失效将导致异常波动无法及时发现",
    "system_risk": "delayed-warning"
  }
}
```

## 4. 非法示例（会被拦截）

### 缺少必填顶层字段
```json
{
  "entity": { "id": "x", "name": "y" }
}
```

### 使用 Markdown 作为入库源
```markdown
# 海水盐度监测
这是旧方案，不再允许。
```

### ontology 与 entity 不一致
```json
{
  "source": "linear-workflow",
  "ontology": {
    "scope": "entity",
    "workflow_version": "1",
    "project_id": "demo",
    "entity_id": "entity_a",
    "entity_name": "A",
    "generated_at": "2026-04-25T00:00:00Z"
  },
  "entity": {
    "id": "entity_b",
    "name": "B"
  },
  "relations": [],
  "ablation": {}
}
```

## 5. 系统拦截点（强约束）

- 前端编辑器：`/Users/qiuboyu/CodeLearning/new_fjy/fjy/kimi-agent-knowledge-base-collab/app/src/features/workspace/components/GraphIngestPanel.tsx`
- 前端写回面板：`/Users/qiuboyu/CodeLearning/new_fjy/fjy/kimi-agent-knowledge-base-collab/app/src/features/workspace/components/WriteBackPanel.tsx`
- 前端 API 拦截：
  - `/Users/qiuboyu/CodeLearning/new_fjy/fjy/kimi-agent-knowledge-base-collab/app/src/features/workspace/api.ts`
  - `/Users/qiuboyu/CodeLearning/new_fjy/fjy/kimi-agent-knowledge-base-collab/app/src/features/ontology/api.ts`
- 后端路由拦截：`/Users/qiuboyu/CodeLearning/new_fjy/fjy/kimi-agent-knowledge-base-collab/app/server.mjs`
- 后端服务拦截：`/Users/qiuboyu/CodeLearning/new_fjy/fjy/kimi-agent-knowledge-base-collab/app/server/services/knowledgeBaseService.mjs`
- OntoGit 图谱扫描解析：`/Users/qiuboyu/CodeLearning/new_fjy/fjy/kimi-agent-knowledge-base-collab/app/server/repositories/ontoGitKnowledgeBaseRepository.mjs`

## 6. 图谱构建规则（当前唯一规则）

1. 全量扫描 OntoGit 的所有项目与时间线文件。
2. 仅解析符合本规范的 JSON 文件。
3. 以 `project_id + entity.id` 形成全局实体 ID。
4. 依据 `relations` 进行实体连接，生成 `cross_references`。
5. 不再解析任何旧导出格式（含 `workflow_export` 之前的历史路径）。
