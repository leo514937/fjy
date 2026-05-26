# 本体工厂技术文档

## 1. 文档范围

本文描述当前项目中“本体工厂”的已实现能力与运行链路，重点覆盖本体组织、图谱浏览、工作区编辑、文件工作流、助手联动和接口分层。

本文不展开后端源码细节、数据库设计和未来规划，只记录当前已经落地、能够在系统中观察到的技术结构。

---

## 2. 本体工厂概述

本体工厂可以理解为一套围绕知识图谱运行的生产系统，核心目标是把文件、实体、关系、分层视图和交互能力组织成一条从“实”到“名”的可持续演化链路。

它当前体现出的能力不是单点页面功能，而是下面这条完整链路：

```text
应用入口
  -> 启动与鉴权
  -> 全局壳层
  -> 本体上下文
  -> 图谱浏览 / 工作台 / 文件工作流 / 助手
  -> 各自 API 与运行态
```

本体工厂的核心洞察与关键特征是：

1. 本体知识图谱是全局演化的主线（名实体系的载体），而不是附属的数据。
2. 文件内容的演化、实体抽取与关系组织，是一个识别同异、建立关联的连续流程。
3. 工作区、工作流和助手之间存在明显联动。
4. 系统已形成“展示、编辑、推理、预览、提交”一体化结构。

---

## 3. 启动与鉴权

### 3.1 应用启动

入口文件是 [`app/src/main.tsx`](../src/main.tsx)。

当前启动顺序如下：

1. 引入全局样式
2. 调用 `installBrowserAuthFetch()`
3. `createRoot(...).render(<App />)`

这说明系统在进入业务页面前，就已经完成了浏览器侧请求封装。

### 3.2 统一鉴权请求

统一请求逻辑位于 [`app/src/shared/api/http.ts`](../src/shared/api/http.ts)。

当前链路具备这些特点：

- 请求统一经过 `apiFetch`
- 如果没有登录态，会跳转到 `/auth/login`
- API 基地址优先读取 `VITE_API_BASE_URL`
- 环境变量未配置时回退到本地默认地址

这套机制保证了本体工厂可以直接进入业务态，而不需要额外的手工登录跳转流程。

---

## 4. 全局壳层

全局壳层位于 [`app/src/app/AppShell.tsx`](../src/app/AppShell.tsx)。

它负责组织以下页面入口：

- `AssistantPage`
- `ExplorerPage`
- `FileWorkflowPage`
- `LabPage`
- `WorkspacePage`

`AppShell` 采用懒加载方式，只有在页面被访问时才加载对应模块，这样可以降低初始体积，也让功能边界更清晰。

### 4.1 本体（名实）上下文

`AppShell` 的核心不是普通路由容器，而是把**本体知识图谱**作为全局的“名实演化”上下文。

它通过这些能力把系统串起来：

- `useOntologyContext()`
- `OntologyProvider`
- `useOntologyAssistantState()`
- `LAYER_FILTERS`
- `SearchPanel`

这意味着系统的组织方式是“围绕本体的名实映射运行”，而不是“围绕页面堆叠”。

---

## 5. 本体核心层

本体核心层主要由 [`app/src/features/ontology/api.ts`](../src/features/ontology/api.ts) 及相关页面/状态钩子组成。

### 5.1 核心演化对象

当前本体工厂的名实体系围绕以下对象展开演化：

- `Entity` 实体（名的载体）
- `CrossReference` 跨实体关系（孤立-连接的对照与涌现）
- `Layer` 分层视图（“达-类-私”层级的组织）
- `Domain` 领域视图
- `Knowledge Graph` 知识图谱（整体名实耦网络）

### 5.2 核心能力

当前系统已经具备这些本体能力：

- 多层过滤：按全量、Common、Domain、Private 等层级切换
- 实体检索：从全局侧边栏直接搜索实体
- 图谱概览：展示领域数、层级数、实体数、关系数
- 实体联动：选中实体后自动进入对应图谱/探索语境
- 助手联动：实体状态可直接进入助手上下文

### 5.3 现有接口

本体侧当前已经接入的主要接口包括：

- `/api/knowledge-graph`
- `/api/knowledge-graph/slice`
- `/api/ontologies`
- `/api/search`
- `/api/analysis`
- `/api/system-analysis`
- `/api/education`
- `/api/about`
- `/api/editor/workspace`
- `/api/editor/preview`
- `/api/editor/commit`

### 5.4 架构演化意义

这里的重点不只是“有接口”，而是系统已经把本体能力拆解成了支持层层追溯的可操作维度：

- 图谱浏览
- 图谱分层
- 实体搜索
- 实体联动
- 编辑工作区
- 提交预览

这使得本体不只是静态的展示对象，而是具备演化特征，且可以持续累积的知识结构。

---

## 6. 图谱浏览与探索

图谱浏览能力主要由 `ExplorerPage`、全局侧边栏和本体上下文共同构成。

### 6.1 页面入口

这一层主要依赖：

- `ExplorerPage`
- `AppShell` 内的全局侧边栏
- `useOntologyContext`
- `useOntologyAssistantState`

### 6.2 典型数据流

```text
AppShell 全局侧边栏
  -> SearchPanel / Layer Filter
  -> useOntologyContext
  -> ontology api
  -> knowledge-graph / ontologies / search / analysis

选中实体后的联动：
  selectedEntity / filteredEntities
    -> useOntologyAssistantState
    -> 助手视图联动
```

### 6.3 作用

这一层承担的是“看见本体”（即观察名的谱系与同异关系）的能力：

- 查找实体与追溯其元的根基
- 观察“达-类-私”的层级分布
- 查看图谱名实映射概览
- 根据实体状态联动到其他演化模块

---

## 7. 工作区与知识演化

工作区页面是知识库编辑与演化的主操作阵地，入口是 [`app/src/features/workspace/WorkspaceDashboard.tsx`](../src/features/workspace/WorkspaceDashboard.tsx)。

### 7.1 页面结构

当前页面结构已经比较清晰：

- 左侧：项目列表
- 左侧：文件列表
- 右侧：文件内容
- 右侧：图谱入库
- 右侧：时间线
- 右侧：概率分析
- 右侧：版本推荐
- 弹层：diff 对比

### 7.2 状态层

工作区状态由 `useWorkspaceState()` 统一管理。

这说明系统已经把“项目、文件、时间线、diff、概率、推荐”等能力收敛到一个统一状态模型中，而不是分散在多个互不相干的组件里。

### 7.3 工作区链路

```text
WorkspacePage
  -> WorkspaceDashboard
  -> useWorkspaceState
  -> workspace api
  -> 项目 / 文件 / 时间线 / 概率 / 推荐 / diff

GraphIngestPanel
  -> ontology api
  -> editor workspace / commit
```

### 7.4 已接入接口

工作区当前对接的接口主要包括：

- `/api/xg/projects`
- `/api/xg/read/:project/:filename`
- `/api/xg/timelines/:project`
- `/api/xg/write-and-infer`
- `/api/probability/api/llm/probability-reason`
- `/api/workflow/config`
- `/api/workflow/file/retry/stream`
- `/api/xg/version-recommend/official`
- `/api/xg/version-recommend/community`
- `/api/xg/rollback`
- `/api/xg/diff`
- `/api/xg/projects/init`
- `/api/xg/projects/:id`
- `/api/xg/version-recommend/official/set`
- `/api/probability/api/llm/probability`

### 7.5 作用

工作区不是传统的 CRUD 页面，它更像是“名实映射”的校验与演化阵地，体现在三点：

- 文件内容可以直接进入图谱入库链路
- 文件演化会影响实体和关系视图
- 概率分析与版本推荐围绕知识结构演化展开

换句话说，工作区是本体工厂的“编辑侧入口”。

---

## 8. 文件工作流：从实到名的生产链路

文件工作流页面是最能体现“从文件到本体”（即从元初观察到以名举实）这一生产链路的模块，入口是 [`FileWorkflowPage.tsx`](./kimi-agent-knowledge-base-collab/app/src/app/pages/FileWorkflowPage.tsx)。

它不是一个静态的结果展示页，而是一套完整的运行时工作流界面，既负责发起文件直传，也负责接收分阶段 SSE 事件、恢复历史会话、展示中间结果、支持从任意阶段重试，并在完成后刷新本体图谱。

### 8.1 运行入口与会话恢复

文件工作流的核心状态由 [`runtime.ts`](./kimi-agent-knowledge-base-collab/app/src/features/workflow/runtime.ts) 管理，页面加载后会优先恢复最近一次工作流会话。

当前已落地的会话能力包括：

- 自动读取 `sessionStorage` 中持久化的工作流快照
- 自动恢复最近一次 `conversationId`
- 恢复 `projectId`、运行状态、结果面板和实时日志
- 页面重新进入后继续展示上一次的阶段进度
- 通过订阅机制同步当前会话的后续状态变化

这意味着文件工作流已经具备“可中断、可恢复、可继续观察”的运行态，而不是一次性请求完成后再统一返回。

### 8.2 运行前配置

页面顶部已经提供了运行前的基础配置项：

- 文件选择
- `project_id` 输入，默认值为 `demo`
- 工作流模型配置
- 运行按钮
- 从阶段重试按钮

其中，工作流模型由 [`/api/workflow/config`](./kimi-agent-knowledge-base-collab/app/src/features/workspace/api.ts) 读取和保存，当前前端已支持：

- 首次进入时自动拉取配置
- 编辑 `workflowModel`
- 手动保存配置
- 保存后立即以新的模型名作为后端工作流 LLM 调用参数

也就是说，文件工作流已经不仅仅是“跑一条链路”，还可以切换执行模型。

### 8.3 八阶段工作流

当前页面中已经落地的阶段固定为八个，和运行时常量保持一致：

1. `auth_precheck`
2. `observe`
3. `relations`
4. `ablation_candidate`
5. `ablation_judge`
6. `ontology`
7. `probability_precheck`
8. `ingest`

各阶段的职责对应了从“元初观察”到“名实校验”的生产过程，并在页面中被显式编码展示：

- `auth_precheck`：登录校验、上下文准备和前置检查
- `observe`：元初观察（从文件内容中抽取实体“名”、摘要、引用片段和属性“实”）
- `relations`：孤立-连接对照（组织实体之间的交互关系、方向和证据）
- `ablation_candidate`：消融预选（LLM 语义扫描，初步识别具备关键影响的实体候选）
- `ablation_judge`：小故判定（对候选实体执行“移除对比”，确认其是否为核心因果节点）
- `ontology`：组装本体 JSON 和名实汇总信息
- `probability_precheck`：名实耦验证预判与解释
- `ingest`：提交 OntoGit 并记录名实映射的版本化演化

页面中每个阶段都维护了独立的 `status`、`started_at`、`finished_at`、`output` 和 `error`，因此可以把每一步的执行过程拆开查看。

这里尤其需要强调的是，当前工作流已经不是旧口径里的“单一消融阶段”，而是明确拆成了 `ablation_candidate` 和 `ablation_judge` 两个阶段。也正因为如此，文件工作流现在是完整的八阶段链路，而不是七阶段链路。

#### 8.3.1 消融预选（`ablation_candidate`）

消融预选承担的是“先缩小关键实体搜索空间”的职责，是整个八阶段链路里最重要的分流点之一。

它的核心作用不是直接下结论，而是先回答两个问题：

- 哪些实体值得进入后续高成本的小故判定
- 哪些实体虽然被识别出来了，但对整体名实结构未必构成关键影响

在这一阶段，系统会综合 `observe` 产生的实体信息和 `relations` 产生的关系网络，做一次面向全局知识拓扑的语义扫描，输出一批“潜力节点”。这些节点通常具备以下特征：

- 出现在多个关系链路中
- 与核心概念的连接度较高
- 一旦移除，可能导致摘要、关系或领域结构发生明显收缩

把消融拆出一个“预选阶段”有三个实际价值：

- 降低后续小故判定的计算成本，不必对所有实体逐个做高强度移除推理
- 提高结果可解释性，让读者先看到“为什么它被纳入候选”
- 让重试与排障更细粒度，出现偏差时可以只回到候选筛选，而不必把整条消融链路重跑

#### 8.3.2 小故判定（`ablation_judge`）

`ablation_judge` 是消融分析的核心判定阶段，也是文档里最需要突出说明的差异化能力。“小故”不是普通的高频实体，也不是简单的相关性排序，而是指那些一旦缺席，就会让当前名实耦系统明显失稳或失真的核心因果节点。

这一阶段的理论根基借用了老子“无之以为用”的思想：不是只看“有什么”，而是通过模拟“如果它不在，会发生什么”来反向定义该实体的真实价值。

当前文档可将其判定逻辑理解为四步：

1. 取 `ablation_candidate` 输出的候选实体作为输入集合。
2. 对每个候选分别构造“保留该实体”和“移除该实体”两种语境。
3. 比较两种语境下的名实耦系统概率差值。
4. 当差值达到阈值时，将该实体确认为“小故”，并生成因果解释。

其中最核心的比较指标是：

- $P_k$ (Keep Probability)：实体存在时，系统逻辑的自洽性概率。
- $P_r$ (Remove Probability)：模拟删除该实体后，剩余知识网络的逻辑强度。

当前判定阈值为：当 $P_k - P_r \ge 10$ 时，该实体被确认为“小故”。

从技术实现上看，这一阶段不是单路打分，而是并行双路推理：在尽量一致的上下文下，对比“有该实体”和“无该实体”两种状态的系统表现差异。最终产出的不只是一个分数，还包括“若无此项，则系统将如何变化”的解释性陈述，因此它同时具备：

- 结构判断能力：判断某实体是否是名实网络中的关键支点
- 因果解释能力：说明它为什么关键，而不是只给结果标签
- 风险暴露能力：提示移除后会丢失哪些关系、摘要主线或领域组织

也正因为有了这个阶段，本体工厂的提取逻辑才从“抽实体、列关系”进一步提升到“识别关键因果节点”。这是文件工作流从信息整理走向知识判定的关键分水岭。

### 8.4 实时流式执行

文件工作流不是一次性请求，而是通过 SSE 流式推进的。

当前前端已经实现了两条主链路：

- 正常执行：`POST /api/workflow/file/run/stream`
- 从指定阶段重试：`POST /api/workflow/file/retry/stream`

执行时会携带：

- 文件内容
- `projectId`
- `conversationId`
- 文件名
- 指定起始阶段（重试时）

运行时会消费这些事件类型：

- `status`：更新全局状态消息
- `workflow_stage`：更新单个阶段的状态和中间结果
- `complete`：写入最终结果并标记完成
- `error`：记录异常并终止当前会话

这一层的实现让文件工作流具备了非常明确的过程可视化能力：不是等最终落库后再看结果，而是边执行边看到每个阶段怎么推进。

### 8.5 响应式中断控制

系统已实现全链路的中断管控能力：

- **前端逻辑**：`runtime.ts` 维护 `currentReader`，点击“终止执行”时显式调用 `cancel()` 并同步更新本地 `isRunning` 状态。
- **后端逻辑**：`LinearWorkflowService` 注入 `AbortSignal` 检查点。
- **原子性**：支持 `POST /api/workflow/terminate` 接口，确保后端及时停止昂贵的 LLM 推理计算。

### 8.6 中间结果面板

页面右侧和中间区域已经把工作流的中间产物拆成多个可读视图，而不是简单吐一个大 JSON。

当前已经有的展示面板包括：

- `实体`：展示 `observe` 阶段抽取出的实体、摘要、引用片段和属性数量
- `关系`：展示 `relations` 阶段输出的源实体、目标实体、关系类型和证据
- `消融 / 小故`：展示 `ablation_candidate` 与 `ablation_judge` 两阶段汇总后的候选实体、判定结果、影响等级、原因和系统风险
- `入库`：展示每个实体对应的写入状态、`commit_id` 和 `version_id`
- `LLM Debug`：展示各阶段的原始文本回复和解析后的 JSON
- `原始 JSON`：展示完整的工作流运行结果

页面同时还会显示：

- 总进度百分比
- 当前运行阶段
- 每个阶段的耗时
- 成功与失败状态
- 实时控制台日志
- 文件元数据侧写
- 目标项目 `projectId`

这些内容组合起来，已经把文件工作流的“运行态、结果态、排障态”都覆盖到了。

### 8.7 现有的提取逻辑

页面并不是简单渲染后端结果，而是已经做了明确的数据提取和清洗。

当前已落地的提取逻辑包括：

- 从 `observe` 阶段提取实体列表
- 从 `relations` 阶段提取关系列表
- 从 `ablation_candidate` 阶段提取消融候选列表
- 从 `ablation_judge` 阶段提取小故判定结果、原因说明和系统风险
- 从各阶段提取 `llm_raw` 和 `llm_raw_text`
- 从阶段结果中提取 `entity_count`、`relation_count`、`ablation_count` 等统计值，其中 `ablation_count` 可用于汇总消融候选或最终小故条目数量
- 对数组、对象和字符串做基础类型归一化

这说明文件工作流页面已经把后端的结构化结果加工成了前端可直接观察的业务视图。

### 8.8 与本体入库的衔接

文件工作流最终会把结果接到知识图谱刷新链路上。

当前已落地的联动动作包括：

- 工作流完成且成功后，调用 [`fetchKnowledgeGraph`](./kimi-agent-knowledge-base-collab/app/src/features/ontology/api.ts)
- 在 `projectId` 存在时触发本体刷新
- 让最新的文件解析结果尽快进入图谱视图

这样，文件工作流不只是“生成一份 JSON”，而是直接成为本体图谱更新的前置入口。

### 8.9 写入校验与结构约束

文件工作流相关的写入逻辑并不是允许任意 JSON 直接入库，而是共享了一套严格的数据校验。

当前复用的校验器是 [`validateWorkflowEntityFileData`](./kimi-agent-knowledge-base-collab/app/src/features/workspace/workflowEntityFormat.ts)，它约束了标准工作流实体 JSON 的结构，主要包括：

- 顶层字段只能包含 `source`、`ontology`、`entity`、`relations`、`ablation`、`precheck`、`ontology_summary`、`probability`
- `ontology.scope` 必须是 `entity`
- `ontology.entity_id` 必须和 `entity.id` 一致
- `ontology.entity_name` 必须和 `entity.name` 一致
- `relations` 必须是结构化数组
- `ablation`、`precheck` 等字段都有明确的对象结构要求

需要注意的是：运行态已经拆成 `ablation_candidate` 和 `ablation_judge` 两个阶段，但在写入态和共享数据结构里，相关结论仍会被汇总进统一的 `ablation` 对象。这并不表示工作流还是七阶段，而是说明“运行阶段拆分”和“落库结构聚合”是两层不同的设计。

这套校验同样也被 [`commitEditorDraft`](./kimi-agent-knowledge-base-collab/app/src/features/ontology/api.ts) 和 [`writeXgAndInfer`](./kimi-agent-knowledge-base-collab/app/src/features/workspace/api.ts) 复用，说明文件工作流、编辑器写回和工作区入库已经共享同一套数据底座。

### 8.10 当前已经落地的文件工作流工作

如果把现有实现归纳成一份工作清单，已经完成的内容可以概括为：

- 文件选择后可以直接发起工作流执行
- 运行过程通过 SSE 实时推送
- 八个阶段的状态已经固定并可视化，其中消融链路已拆分为“消融预选 + 小故判定”
- 运行会话支持恢复和继续观察
- 支持从任意阶段重试
- 支持工作流模型配置和保存
- 支持实体、关系、消融候选、小故判定、入库和原始 JSON 的多视图查看
- 支持 LLM 原始回复调试
- 支持完成后自动刷新知识图谱
- 支持标准工作流实体 JSON 的写入校验
- 支持将工作流结果与工作区、编辑器和本体接口共享同一数据结构

### 8.11 演化与生成路径

从生产链路上看，文件工作流现在已经把“从文件到本体”的演化路径明确成了下面这条线：

```text
选择文件 / 设置 project_id / 设置工作流模型
  -> POST /api/workflow/file/run/stream
  -> auth_precheck
  -> observe
  -> relations
  -> ablation_candidate
  -> ablation_judge
  -> ontology
  -> probability_precheck
  -> ingest
  -> 完成后刷新 knowledge-graph
```

### 8.12 性能优化基座

为了应对 Windows 环境下的执行延迟，系统实现了以下优化：

1. **环境配置缓存 (PowerShell Cache)**：对 `readWindowsGlobalEnv` 增加了 60 秒全局缓存，避免了由于频繁启动 PowerShell 进程导致的首屏加载阻塞（单次阻塞约 1-3s）。
2. **进程影子替换 (Exec Start)**：启动脚本采用 `exec` 模式替换 Bash 外壳，确保 PID 文件记录的是真实服务进程，彻底解决了 Windows 下僵尸进程杀不掉的问题。


这条链路基本定义了本体工厂当前文件工作流的生产过程，也把现有工作完整串起来了。

---

## 9. 助手联动

助手页面入口是 [`app/src/app/pages/AssistantPage.tsx`](../src/app/pages/AssistantPage.tsx)，前端主要通过 [`app/src/features/assistant/api.ts`](../src/features/assistant/api.ts) 对接。

### 9.1 现有接口

- `/api/chat`
- `/api/chat/state`
- `/api/chat/upload`
- `/api/chat/graph`
- `/api/chat/stream`

### 9.2 与本体的关系

助手不是独立孤岛，它和本体的名实体系联动很明显：

- 选择实体后可以进入本体的层层追溯上下文
- 助手可以围绕图谱的同异识别进行问答推理
- 聊天状态和图谱演化状态可以相互影响

因此，助手更适合被理解为本体知识图谱的自然交互与推演层。

---

## 10. 系统分层总结

如果从本体工厂的角度看当前实现，可以把系统理解成三层：

1. **入口层**
   - `main.tsx`
   - `installBrowserAuthFetch()`
   - `App.tsx`
   - `AppShell.tsx`

2. **能力演化层**
   - 本体 / 图谱 / 搜索 / “达-类-私”分层 / 助手
   - 工作区 / 文件 / 演化时间线 / 同异 diff / 推荐 / 概率
   - 工作流 / 元初观察 / 关系对照 / 名实组装 / 入库

3. **接口层**
   - `ontology api`
   - `workspace api`
   - `assistant api`
   - `workflow runtime`

这三层共同构成了本体工厂当前的完整技术形态。
