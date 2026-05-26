# Kimi 后端固定工作流架构（线性无分支）

## 目标

后端助手能力从通用智能体模式切换为固定工作流模式。
执行路径必须是单一路径、单顺序，不允许条件分支和动态策略切换。

## 固定流程

每次 `/api/chat` 或 `/api/chat/stream` 请求都严格按以下 4 步执行：

1. `read_input`
2. `summarize_context`
3. `compose_answer`
4. `finalize_output`

说明：
- 四步必须完整执行。
- 步骤顺序固定，不允许跳步。
- 不引入分支判断，不引入 Agent 决策树。

## 模块边界

- 入口路由：`server.mjs`
- 服务装配：`server/createAppServices.mjs`
- 线性工作流执行器：`server/services/linearWorkflowService.mjs`
- 知识库上下文：`server/services/knowledgeBaseService.mjs`
- 会话状态：`server/services/assistantSessionStateService.mjs`
- 图状态：`server/services/conversationGraphStateService.mjs`

## 请求时序

### 非流式 `/api/chat`

1. 路由层读取问题与会话参数。
2. 调用 `knowledgeBaseService.collectChatContext`。
3. 调用 `linearWorkflowService.ask`。
4. 返回固定结构：`answer/context/raw/stderr`。

### 流式 `/api/chat/stream`

1. 路由层开启 SSE。
2. 推送 `context` 事件。
3. 线性执行 4 个阶段并依次推送：
   - `status`
   - `execution_stage`
   - `tool_started/tool_output/tool_finished`（用于前端执行轨迹兼容）
   - `answer_delta`
4. 最后推送 `complete`。

## 运行时目录

- 根目录：`.workflow-runtime/.workflow-runs/conversation-<slug>`
- 上传目录：`uploads/`

说明：
- 不再使用 `.qagent-web-runtime`。
- 不再生成 QAgent skills/wrappers。

## 已移除能力

- QAgent CLI 调用链路
- 控制命令（`work/session/hook/model provider`）
- QAgent runtime 隔离与清理逻辑
- 基于 QAgent 的动态技能注入
- 启动脚本中的 QAgent gateway 停止流程

## 演进约束

后续功能扩展必须遵守：

1. 只允许在线性 4 步内部扩展实现细节。
2. 禁止新增分支式流程控制。
3. 禁止回退到通用智能体执行模型。
