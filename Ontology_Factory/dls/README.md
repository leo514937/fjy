# OntologyNegotiator

`OntologyNegotiator` 是一个基于 `langgraph` 的“达 / 类 / 私”本体协商模块。它接收图结构输入，按节点执行 `Proposer -> Critic -> Arbiter -> Evaluator` 的循环辩论，并输出：

- `artifacts/results/diagnostics/debates/`：节点级辩论日志（默认写入 `artifacts/`）
- `src/ontology_negotiator/rules/`：Agent 提示词与判断细则（内置资源）
- `artifacts/results/`：标准化 JSON 结果与带标签图（以及 benchmark/诊断产物）

## 安装

推荐先创建项目级虚拟环境，再安装依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .[dev]
python -m pytest -q
```

## 全局配置文件

项目根目录下新增了全局配置文件：

- [config/ontology_negotiator.toml](config/ontology_negotiator.toml)

配置示例：

```toml
[openai]
api_key = "请替换为你的真实 API Key"
model = "gpt-4o-mini"
fallback_model = "gpt-4o-mini" # 可选：主模型 429/503 等失败时切换
base_url = "https://api.openai.com/v1"
temperature = 0.0
timeout = 60
max_retries = 2

[llm_retry]
max_attempts = 3
base_delay_seconds = 0.5
max_delay_seconds = 4.0
jitter_seconds = 0.2
```

默认行为：

- 如果显式传入 `llm`，优先使用 `llm`
- 如果没有传 `llm`，会尝试从全局配置文件读取 `openai.api_key` 和 `openai.model`
- 如果你显式传了 `model_name`，它会覆盖配置文件里的 `model`

也可以显式指定配置路径：

```python
negotiator = OntologyNegotiator(config_path="config/ontology_negotiator.toml")
```

## 运行方式

当前版本是“全 LLM 主导、失败即暴露”的调试型架构：

- 必须提供 `llm` 实例，或在配置文件中提供可构造模型的参数
- LLM 调用会按 `llm_retry` 做重试，并可在 429/503 等情况下切换到 `openai.fallback_model`
- 任一 Agent 调用最终失败、JSON 解析失败或响应 schema 校验失败，都会抛出结构化异常（`NegotiationExecutionError`）
- 不再提供启发式兜底逻辑

## 快速开始

```python
from ontology_negotiator import GraphInput, OntologyNegotiator

graph = GraphInput.model_validate(
    {
        "nodes": [
            {
                "node_id": "uuid_gravity",
                "name": "重力",
                "l_level": "L2",
                "description": "物理公理，描述质量之间的吸引规律。",
                "properties": {"ran": "描述普适的物理作用规律"},
            }
        ],
        "edges": [],
    }
)

negotiator = OntologyNegotiator()
results = negotiator.classify_graph(graph)
print([item.model_dump(mode="json") for item in results])
```

## 文本转图与基准测试

项目新增了 `text -> graph -> benchmark` 的实验路径，方便把结构化文本快速转换成 `GraphInput`，并对不同并发度做全流程性能对比（`max_concurrency` 取值范围为 1~6）。

最小示例：

```python
from ontology_negotiator.benchmark import run_full_pipeline_benchmark
from ontology_negotiator.text_graph_pipeline import build_graph_from_agent_summary

graph = build_graph_from_agent_summary(text, project_key="demo", project_name="demo system")
report = run_full_pipeline_benchmark(
    graph,
    artifact_root="artifacts/demo_benchmark",
    config_path="config/ontology_negotiator.toml",
    max_concurrency=3,
)
print(report["written_files"])
```

输出文件（相对 `artifact_root`）：

- `results/ontology_results.json` / `results/labeled_graph.json`
- `results/diagnostics/debates/*.json`
- `results/diagnostics/full_pipeline_report.json`
- `results/diagnostics/full_pipeline_summary.txt`
- `results/diagnostics/full_pipeline_agent_outputs.json`

并发对比（可选）：`run_graph_benchmark_suite(...)` 会额外写入：

- `results/diagnostics/concurrency_comparison.json`
- `results/diagnostics/concurrency_summary.txt`

### fish_home 示例脚本

仓库内提供了一个端到端示例脚本：`scripts/run_fishhome_negotiation.py`（默认会读取 `examples/fish_home_knowledge_graph.json`，并把产物写入 `artifacts/fish_home_negotiation/`）。

```powershell
python scripts/run_fishhome_negotiation.py
```

## 系统架构图

下面用 ASCII 图展示当前系统的主结构与数据流：

```text
+----------------------------------------------------------------------------------+
|                              OntologyNegotiator                                  |
|                     按节点驱动的本体协商与裁决入口层                               |
+----------------------------------------------------------------------------------+
| 输入: GraphInput(nodes, edges)                                                   |
| 输出: ClassificationResult[] + debates/results artifacts                         |
+-----------------------------------------+----------------------------------------+
                                          |
                                          v
+----------------------------------------------------------------------------------+
|                             1. 运行时与调度层                                     |
+----------------------------------------------------------------------------------+
| OntologyNegotiator                                                                |
| - 加载 config/ontology_negotiator.toml                                           |
| - 构造主 LLM / fallback LLM                                                      |
| - 为每个节点构造初始 NegotiationState                                             |
| - 可并发 classify_graph(max_concurrency)                                         |
+-----------------------------------------+----------------------------------------+
                                          |
                                          v
+----------------------------------------------------------------------------------+
|                           2. 初始上下文构建层                                     |
+----------------------------------------------------------------------------------+
| node_data                                                                         |
| graph_context                                                                     |
| vault_context  <-----  vault.py 中的 match_vault()                               |
|                                                                                  |
| 初始状态还会创建:                                                                 |
| - proposal / critique / history                                                  |
| - persistent_evidence / resolved_evidence / evidence_events                      |
| - debate_focus / debate_gaps / round_summaries                                   |
+-----------------------------------------+----------------------------------------+
                                          |
                                          v
+----------------------------------------------------------------------------------+
|                         3. LangGraph 协商状态机层                                 |
+----------------------------------------------------------------------------------+
| START -> proposer_agent -> critic_agent -> arbiter_node -> evaluator_agent -> END|
|                                   ^                  |                            |
|                                   |                  |                            |
|                                   +------ retry -----+                            |
+-----------------------------------------+----------------------------------------+
                                          |
                                          v
+----------------------------------------------------------------------------------+
|                          4. 四类 Agent 执行层                                    |
+----------------------------------------------------------------------------------+
| Proposer                                                                          |
| - 基于 evidence_pack + working_memory 给出 label / reason / uncertainties        |
|                                                                                  |
| Critic                                                                            |
| - 反驳或部分同意 proposer                                                        |
| - 产出 remaining_gaps / open_questions / counter_evidence                        |
|                                                                                  |
| Arbiter                                                                           |
| - 先同步 persistent evidence vault                                               |
| - 再读取 working_memory 做 retry/finalize 裁决                                    |
| - 给出 next_focus / resolved_evidence_ids / retained_evidence_ids                |
|                                                                                  |
| Evaluator                                                                         |
| - 在 final_label 基础上给出 confidence 和审计意见                                 |
+-----------------------------------------+----------------------------------------+
                                          |
                                          v
+----------------------------------------------------------------------------------+
|                         5. 工作记忆 + 证据保险箱层                                |
+----------------------------------------------------------------------------------+
| short-term working_memory                                                         |
| - focus / gaps / proposal_snapshot / critique_snapshot                           |
| - last_round_summary / recent_turns                                              |
| - active_evidence_digest / resolved_evidence_digest                              |
| - evidence_status_summary / last_logic_path_signature                            |
|                                                                                  |
| persistent evidence vault                                                        |
| - persistent_evidence: 当前仍未解决的关键证据                                     |
| - resolved_evidence: 已解决证据                                                   |
| - evidence_events: opened / retained / narrowed / resolved / reopened            |
+-----------------------------------------+----------------------------------------+
                                          |
                                          v
+----------------------------------------------------------------------------------+
|                      6. 语义分析与停机判定层                                      |
+----------------------------------------------------------------------------------+
| agents.py 中的本地逻辑                                                            |
| - _build_signature(): anchor_refs / logic_operator / object_terms / claim_type   |
| - _signatures_equivalent(): 判断同义改写是否其实是同一逻辑问题                    |
| - _sync_persistent_evidence(): 候选证据与保险箱对账                               |
| - _analyze_round_progress(): 比较本轮与上一轮的 logic_path / evidence 集合        |
| - _detect_repeat_loop(): 识别“逻辑路径未偏移”的空转争论                           |
+-----------------------------------------+----------------------------------------+
                                          |
                                          v
+----------------------------------------------------------------------------------+
|                           7. 结果与产物落盘层                                     |
+----------------------------------------------------------------------------------+
| artifacts.py                                                                      |
| - write_debate(): 保存节点级 debate JSON                                          |
| - write_results(): 保存 ontology_results.json / labeled_graph.json               |
|                                                                                  |
| debates artifact 中会记录:                                                        |
| - proposal / critique / working_memory                                            |
| - round_summaries / audit_history                                                 |
| - persistent_evidence / resolved_evidence / evidence_events                      |
+----------------------------------------------------------------------------------+
```

## 各结构实现细节

### 1. 入口与调度

- `src/ontology_negotiator/negotiator.py` 中的 `OntologyNegotiator` 是系统总入口。
- 它负责读取配置、构造 LLM、创建线程局部 runtime，并按节点执行协商流程。
- `classify_graph()` 支持并发，`classify_node()` 负责单节点的完整辩论闭环。

### 2. 初始上下文构建

- 每个节点都会被整理成 `node_data + graph_context + vault_context`。
- `graph_context` 来自邻居节点与相关边，帮助 Agent 结合局部图结构推理。
- `vault_context` 来自 `src/ontology_negotiator/vault.py` 的语义匹配，它不是最终标签判断器，而是一个“基础规律/通用原则”证据补充器。

### 3. 状态机编排

- 状态机定义在 `src/ontology_negotiator/graph_builder.py`。
- 固定路径是 `Proposer -> Critic -> Arbiter -> Evaluator`。
- 只有 Arbiter 明确给出 `retry` 时，流程才会回到 `proposer_agent` 进入下一轮。
- 当前轮次约束为至少 2 轮、最多 5 轮（见 config/ontology_negotiator.toml 的 [negotiation] 配置）。

### 4. Proposer / Critic / Arbiter / Evaluator

- `Proposer` 负责初步归类与陈述支持证据，并暴露自身不确定点。
- `Critic` 负责质疑、补充反证、列出剩余 gap 与待核实问题。
- `Arbiter` 是最关键的一层，它不只是“投票裁判”，而是会结合工作记忆和证据保险箱，判断是继续追问还是收口。
- `Evaluator` 在最终标签之上给出置信度、稳定性、证据强度、逻辑一致性和审计意见。

### 5. 工作记忆系统

- `working_memory` 是短期上下文窗口，服务于每一轮 Agent 提示词。
- 它保留最近轮的焦点、摘要、快照和最近 turns，帮助 LLM 不必反复阅读全量历史。
- 还加入了 `active_evidence_digest`、`resolved_evidence_digest`、`evidence_status_summary` 和 `last_logic_path_signature`，避免关键证据被“最近两轮限制”冲掉。

### 6. 关键证据保险箱

- `persistent_evidence` 保存当前仍未解决的关键证据条目。
- 每条条目包含 `evidence_id`、来源轮次、来源角色、`reason_type`、`logic_path`、`canonical_claim`、`evidence_refs`、`status` 等字段。
- `resolved_evidence` 保存已经被 Arbiter 明确关闭的问题。
- `evidence_events` 记录证据生命周期，便于审计和后续展示。

### 7. 语义签名与“狡辩检测”

- 旧版本更依赖词面 token 与 Jaccard，相同逻辑换个说法容易被误判成新发现。
- 现在 `agents.py` 会把一句争论提炼成分层签名：
  - `anchor_refs`: 例如 `properties.pin_d8`
  - `logic_operator`: 例如“超阈值”“缺失映射”“待核实”
  - `object_terms`: 例如 D8、水温、温度、阈值
  - `claim_type`: 支持 / 反对 / 缺证据 / 待核实
- 只要逻辑路径没有本质偏移，即使措辞改写，也会被识别为同一个问题。

### 8. 轮次进展分析

- `_analyze_round_progress()` 会比较当前轮与上一轮的：
  - 焦点签名
  - gap 签名
  - 逻辑路径签名
  - active evidence id 集合
  - evidence refs
- `_detect_repeat_loop()` 不再只看词面重复，而是判断：
  - 逻辑路径是否没变化
  - 未解决证据集合是否没变化
  - `next_focus` 是否真的收窄到新检查点
- 如果只是换一种说法但没带来新锚点或新验证路径，就会被当成重复争论。

### 9. Arbiter 裁决后的状态演化

- Arbiter 现在不仅返回 `retry/finalize`，还会返回：
  - `resolved_evidence_ids`
  - `retained_evidence_ids`
  - `new_evidence_ids`
- 实现层据此把证据从 active 移到 resolved，或者继续保留在保险箱中。
- 这让“问题是否真的解决”变成了显式状态，而不是隐含在一段自然语言里。

### 10. 产物与展示能力

- `artifacts/results/ontology_results.json` 保存最终分类结果。
- `artifacts/results/labeled_graph.json` 保存带标签图。
- `artifacts/results/diagnostics/debates/*.json` 保存单节点的完整辩论过程。
- 每个 debate artifact 现在还会带上证据保险箱与生命周期日志，因此非常适合做后续可视化、审计回放和论文展示。

## 展示时可以强调的亮点

- 不是纯短期上下文，而是“短期工作记忆 + 持久证据保险箱”的双层记忆。
- 不是简单词面重复检测，而是“逻辑路径未偏移”的语义级停机判定。
- 每一轮裁决都可以回放，并能追踪某条关键证据从提出到解决的完整生命周期。

