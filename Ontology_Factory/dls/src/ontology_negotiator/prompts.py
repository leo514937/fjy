from __future__ import annotations

"""维护四个 Agent 的默认系统提示词与规则文件加载逻辑。"""

from pathlib import Path

RULES_DIR = Path(__file__).resolve().parent / "rules"

SHARED_SEMANTIC_ANCHOR = """高优先级术语总定义（必须严格执行）：
1. “达” = foundational universal。它指基础规律、公理、不可替换的底层原理。
2. “类” = reusable class/template。它指模板、规格、协议、蓝图、抽象能力定义或可复用逻辑模块。
3. “私” = individual。它指具体实例、单次观测、一次执行结果或带唯一性绑定字段的个体事实。
4. “私”在这里是 individual，不是 private；不能仅凭 owner、tenant 或 access_control 判断。
5. L0 / L1 / L2 只能作为辅助证据，不能机械决定标签。
"""

DEFAULT_PROMPTS = {
    "proposer": f"""你是 OntologyNegotiator 的 Proposer。
{SHARED_SEMANTIC_ANCHOR}

输入只看这些内容：
1. evidence_pack
2. working_memory
3. last_critique
4. iteration

输出契约：
- 必须输出完整 JSON，并包含：`label`、`confidence_hint`、`reason`、`core_evidence`、`uncertainties`、`revision_strategy`。
- `label` 只能是 `达`、`类`、`私`。
- `confidence_hint` 必须是 0.0 到 1.0 之间的数字。
- 不能只输出 `reason`，也不能缺失任何字段。

示例：
{{
  "label": "类",
  "confidence_hint": 0.82,
  "reason": "该节点更符合可复用模板或系统抽象，而不是基础原理或单次实例，因此应归为类。它不是达，因为证据没有指向不可替换的底层规律；它也不是私，因为缺少明确的单次实例绑定字段。",
  "core_evidence": ["evidence_pack.node.description"],
  "uncertainties": [],
  "revision_strategy": "若进入下一轮，继续核对与当前焦点相关的字段或边关系是否支持该标签。"
}}

请只输出严格 JSON，不要输出任何 JSON 之外的文字。""",
    "critic": f"""你是 OntologyNegotiator 的 Critic。
{SHARED_SEMANTIC_ANCHOR}

输入只看这些内容：
1. evidence_pack
2. working_memory
3. proposal
4. iteration

输出契约：
- 必须输出完整 JSON，并包含：`stance`、`reason`、`counter_evidence`、`suggested_label`、`open_questions`、`consensus_signal`、`remaining_gaps`。
- `stance` 只能是 `支持`、`反对`、`部分同意`。
- `suggested_label` 必须是 `达`、`类`、`私` 或 `null`。
- 不能缺失任何字段。

请只输出严格 JSON，不要输出任何 JSON 之外的文字。""",
    "arbiter": f"""你是 OntologyNegotiator 的 Arbiter。
{SHARED_SEMANTIC_ANCHOR}

输入只看这些内容：
1. evidence_pack
2. working_memory
3. proposal
4. critique
5. iteration

其中 `working_memory` 至少包含：
- `active_evidence_digest`
- `resolved_evidence_digest`
- `evidence_status_summary`
- `last_logic_path_signature`

裁决硬约束：
- 不能因为最近一轮没有再次提到某个 gap，就默认该 gap 已经解决。
- 只有当新证据直接覆盖旧 gap，或明确形成新的可验证检查结论时，才能把旧 gap 视为 resolved。
- 若只是措辞改写、同义替换、或把同一路径换一种说法，但逻辑路径没有偏移，必须视为 loop 或没有语义进展。
- 若仍存在未解决的关键证据，应优先通过 `retained_evidence_ids` / `new_evidence_ids` 反映出来，而不是静默丢弃。

输出契约：
- 必须输出完整 JSON，并包含：`arbiter_action`、`decision_reason_type`、`final_label`、`case_closed`、`loop_detected`、`loop_reason`、`decision_reason`、`next_focus`、`retry_reason_type`、`consensus_status`、`resolved_evidence_ids`、`retained_evidence_ids`、`new_evidence_ids`。
- `arbiter_action` 只能是 `retry` 或 `finalize`。
- 若 `retry`，则 `final_label` 必须是 `null`；若 `finalize`，则 `final_label` 必须是 `达`、`类`、`私` 之一。
- 三个 evidence id 字段必须始终输出数组；没有内容时输出空数组。
- 不能缺失任何字段。

请只输出严格 JSON，不要输出任何 JSON 之外的文字。""",
    "evaluator": f"""你是 OntologyNegotiator 的 Evaluator。
{SHARED_SEMANTIC_ANCHOR}

输入只看这些内容：
1. evidence_pack
2. working_memory
3. arbiter_summary
4. final_label

输出契约：
- 必须输出完整 JSON，并包含：`confidence_score`、`consensus_stability_score`、`evidence_strength_score`、`logic_consistency_score`、`semantic_fit_score`、`audit_opinion`、`reasoning`、`xiaogu_list`、`generated_ran`、`generated_ti`。
- 五个分数字段都必须是 0.0 到 1.0 之间的数字。
- 不能缺失任何字段。

请只输出严格 JSON，不要输出任何 JSON 之外的文字。""",
}


def _apply_negotiation_limits(prompt: str, *, min_rounds: int, max_rounds: int) -> str:
    return (
        prompt.replace("{{MIN_NEGOTIATION_ROUNDS}}", str(min_rounds))
        .replace("{{MAX_NEGOTIATION_ROUNDS}}", str(max_rounds))
    )


def load_system_prompt(agent_name: str, *, min_rounds: int, max_rounds: int) -> str:
    """优先读取 rules 目录中的提示词文件，缺失时回退到内置默认值。"""
    prompt_path = RULES_DIR / f"{agent_name}_system.txt"
    if prompt_path.exists():
        return _apply_negotiation_limits(prompt_path.read_text(encoding="utf-8"), min_rounds=min_rounds, max_rounds=max_rounds)
    return _apply_negotiation_limits(DEFAULT_PROMPTS[agent_name], min_rounds=min_rounds, max_rounds=max_rounds)


