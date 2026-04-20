---
{
  "profile": "kimi",
  "page_kind": "meta",
  "meta_role": "workflow",
  "title": "Agent 写入工作流",
  "type": "流程文档",
  "domain": "平台",
  "level": 0,
  "source": "WiKiMG kimi demo",
  "properties": {
    "适用对象": [
      "把现成资料整理进 WiKiMG 的 agent",
      "负责补充节点和关系的协作成员"
    ],
    "产出目标": [
      "生成可被前端直接消费的 wiki 节点",
      "保证 relations、证据和正文结构可校验"
    ]
  },
  "relations": [
    {
      "target": "common:kimi-demo/平台说明",
      "type": "配套说明",
      "description": "平台说明介绍了当前能力边界。"
    },
    {
      "target": "domain:kimi-demo/智能养鱼系统概览",
      "type": "写入目标示例",
      "description": "系统概览页可以作为新 agent 学习的参考样板。"
    }
  ]
}
---
# Agent 写入工作流

> 这份页面给其他 agent 用，目标是把现成文档稳定地写进 WiKiMG，并立刻被前端消费。

## 定义与定位
这不是业务实体页，而是操作流程页。它定义了 agent 在处理现成文档时，如何从原文抽取主题、创建节点、补关系、挂证据并校验结果，使输出的 Markdown 能直接进入当前前端。

## 属性
- 工作模式: 先抽主题，再写 frontmatter，最后补正文和关系
- 验收标准: `validate --profile kimi` 通过，且 export 后节点可进入图谱
- 推荐用法: 复制本文模板，按文档批次执行

## 现成文档写入步骤
- 第 1 步：先读原始文档，抽出 3 到 8 个稳定主题，不要按原文顺序机械切页。
- 第 2 步：判断每个主题是 `system`、`entity`、`topic` 还是 `meta`。
- 第 3 步：按内容性质选择 `wiki/common/kimi-demo/`、`wiki/domain/kimi-demo/` 或 `wiki/private/kimi-demo/`。
- 第 4 步：先写 frontmatter，至少补齐 `profile`、`title`、`type`、`domain`、`level`、`source`、`properties`、`relations`。
- 第 5 步：再写正文 section，至少保证有 `定义与定位`、`证据来源`、`关联主题`；建议补 `属性`。
- 第 6 步：`relations` 里尽量写“为什么相关”，不要只写一个空 target。
- 第 7 步：`证据来源` 只放原文里真出现过的句子或事实，不要把推断写成证据。
- 第 8 步：写完一批后运行 `wikimg validate --profile kimi --json`，修掉坏链接和缺字段。
- 第 9 步：再运行 `wikimg export --profile kimi --json`，确认新节点进入 `entity_index`、关系进入 `cross_references`。
- 第 10 步：刷新前端，检查节点数、搜索结果、图谱和详情是否同步变化。

## layer 决策表
| 文档类型 | 推荐 layer | 说明 |
| --- | --- | --- |
| 通用规则、字段字典、平台公共说明 | `common` | 面向多个业务领域复用，属于共享知识 |
| 业务节点、系统组件、监测/控制能力 | `domain` | 直接进入业务图谱，是最常见的实体层 |
| 草稿、实验记录、内部推演、预算草案 | `private` | 仍会导出和展示，但需要明确它是内部材料 |
| 聚合说明页、关于页、科普页 | 任意 layer + `page_kind: meta` | `meta` 只服务聚合接口，不进入实体图谱 |

## 必须遵守的分类规则
- `page_kind: entity` 会进入图谱、搜索、统计和详情。
- `page_kind: meta` 不进入 `entity_index`，只给 `/api/about`、`/api/education`、`/api/editor` 这类聚合接口使用。
- `domain` 字段写业务领域，比如 `环境监测`、`远程控制`、`平台接入`、`设备管理`、`用户场景`。
- `layer` 不写在 frontmatter 里，由文档所在目录自动决定，所以路径必须选对。

## frontmatter 模板
```json
{
  "profile": "kimi",
  "page_kind": "entity",
  "title": "新主题",
  "type": "主题类型",
  "domain": "智能养鱼",
  "level": 2,
  "source": "原始文档名或批次名",
  "properties": {
    "关键点": ["待补充"]
  },
  "relations": [
    {
      "target": "domain:kimi-demo/智能养鱼系统概览",
      "type": "相关",
      "description": "说明为什么它们相关。"
    }
  ]
}
```

## 正文模板
```md
# 新主题

> 用一句话给出这个节点最直观的解释。

## 定义与定位
说明它是什么、属于哪个范围、在系统里起什么作用。

## 属性
- 关键属性: 待补充

## 证据来源
- 来自原文的事实 1
- 来自原文的事实 2
- 这是一条新增内容，用于验证 sync 的增量写入。

## 关联主题
- [智能养鱼系统概览](../../domain/kimi-demo/智能养鱼系统概览.md)
```

## 常见错误
- 不要只新建普通 `.md` 却不写 `profile: kimi`，这样前端不会读到。
- 不要把 `relations` 只写名字不写 target。
- 不要让 `证据来源` 变成主观总结，那里应该尽量贴近原始材料。
- 不要把一个长文原样复制成一页，优先拆成可复用的主题节点。
- 不要把内部草稿错放到 `common` 或 `domain`，否则前端会把它误当成稳定知识节点。

## 关联主题
- [平台说明](./平台说明.md)
- [智能养鱼系统概览](../../domain/kimi-demo/智能养鱼系统概览.md)
