from __future__ import annotations

import copy
import inspect
from typing import Any

import pytest

import ontology_negotiator.agents as agents


PARAPHRASE_A = "\u6c34\u6e29\u8fc7\u9ad8\uff0c\u9700\u8981\u68c0\u67e5\u9608\u503c\u903b\u8f91"
PARAPHRASE_B = "\u6e29\u5ea6\u6570\u503c\u8d85\u51fa\u9608\u503c\uff0c\u9700\u8981\u590d\u6838\u6bd4\u8f83\u6761\u4ef6"


def _base_state() -> dict[str, Any]:
    return {
        "iterations": 3,
        "node_data": {"node_id": "sensor-1", "name": "sensor", "l_level": "L2", "description": ""},
        "graph_context": {"neighbors": [], "edges": []},
        "vault_context": {"matched": False, "evidence": [], "reason": "", "related_l2_nodes": []},
        "proposal": {
            "label": "\u7c7b",
            "confidence_hint": 0.6,
            "reason": "Check D8 threshold path.",
            "core_evidence": ["properties.pin_d8"],
            "uncertainties": [],
            "revision_strategy": "Check the threshold branch.",
        },
        "critique": {
            "stance": "\u53cd\u5bf9",
            "reason": "The D8 threshold branch may be wrong.",
            "counter_evidence": ["properties.pin_d8"],
            "suggested_label": "\u79c1",
            "open_questions": [],
            "consensus_signal": False,
            "remaining_gaps": [],
        },
        "history": [],
        "debate_focus": "Check D8 threshold branch.",
        "debate_gaps": [],
        "round_summaries": [],
        "persistent_evidence": [],
        "resolved_evidence": [],
        "evidence_events": [],
        "loop_detected": False,
        "loop_reason": "",
        "case_closed": False,
        "agent_errors": [],
    }


def _evidence_item(
    evidence_id: str,
    *,
    claim: str,
    logic_path: str,
    refs: list[str],
    status: str = "active",
    source_round: int = 1,
    source_role: str = "critic",
    reason_type: str = "evidence_gap",
    resolution_note: str = "",
    signature: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "evidence_id": evidence_id,
        "source_round": source_round,
        "source_role": source_role,
        "reason_type": reason_type,
        "logic_path": logic_path,
        "canonical_claim": claim,
        "evidence_refs": refs,
        "signature": signature or {},
        "status": status,
        "resolution_note": resolution_note,
    }


def _find_helper(candidates: list[str]):
    for name in candidates:
        fn = getattr(agents, name, None)
        if callable(fn):
            return fn
    pytest.fail(f"Expected one of helper functions to exist: {candidates}")


def _invoke_with_context(fn, context: dict[str, Any]) -> Any:
    kwargs: dict[str, Any] = {}
    for name, parameter in inspect.signature(fn).parameters.items():
        if name in context:
            kwargs[name] = context[name]
            continue
        if parameter.default is not inspect._empty:
            continue
        pytest.fail(f"Cannot satisfy required parameter '{name}' for helper {fn.__name__}")
    return fn(**kwargs)


def _resulting_evidence_lists(result: Any, original_state: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if isinstance(result, dict):
        active = result.get("persistent_evidence", original_state.get("persistent_evidence", []))
        resolved = result.get("resolved_evidence", original_state.get("resolved_evidence", []))
        return list(active), list(resolved)
    return (
        list(original_state.get("persistent_evidence", [])),
        list(original_state.get("resolved_evidence", [])),
    )


def test_working_memory_keeps_active_evidence_digest_when_focus_moves() -> None:
    state = _base_state()
    state["debate_focus"] = "Check D9 description only."
    state["persistent_evidence"] = [
        _evidence_item(
            "ev-d8",
            claim="D8 threshold path is still unverified.",
            logic_path="threshold_exceeded|properties.pin_d8|missing_evidence",
            refs=["properties.pin_d8"],
        )
    ]

    working_memory = agents._build_working_memory(state)

    assert "active_evidence_digest" in working_memory
    assert any("ev-d8" in str(item) or "pin_d8" in str(item).lower() for item in working_memory["active_evidence_digest"])
    assert working_memory["evidence_status_summary"].get("active", 0) >= 1


def test_semantic_signature_treats_threshold_paraphrases_as_same_issue() -> None:
    left = agents._build_signature(PARAPHRASE_A)
    right = agents._build_signature(PARAPHRASE_B)

    assert agents._signatures_equivalent(left, right) is True


def test_repeat_loop_detected_when_logic_path_and_active_evidence_do_not_change() -> None:
    state = _base_state()
    state["persistent_evidence"] = [
        _evidence_item(
            "ev-d8",
            claim="D8 threshold check is still unresolved.",
            logic_path="threshold_exceeded|properties.pin_d8|missing_evidence",
            refs=["properties.pin_d8"],
        )
    ]
    state["round_summaries"] = [
        {
            "round": 2,
            "focus_signature": agents._build_signature("Check the D8 threshold path."),
            "next_focus_signature": agents._build_signature("Verify whether properties.pin_d8 exceeds the threshold."),
            "gap_signatures": [agents._build_signature("Verify whether properties.pin_d8 exceeds the threshold.")],
            "logic_path_signature": agents._build_signature("Verify whether properties.pin_d8 exceeds the threshold."),
            "active_evidence_ids": ["ev-d8"],
            "resolved_evidence_ids": [],
            "evidence_refs": ["properties.pin_d8"],
            "conflict_signature": {
                "proposal_label": "\u7c7b",
                "critic_stance": "\u53cd\u5bf9",
                "critic_suggested_label": "\u79c1",
            },
        }
    ]

    analysis = agents._analyze_round_progress(
        state,
        ["Verify whether properties.pin_d8 exceeds the threshold."],
        "Check whether the value on properties.pin_d8 is over the threshold.",
    )
    loop_detected, loop_reason = agents._detect_repeat_loop(analysis)

    assert loop_detected is True
    assert loop_reason


def test_anchor_reference_narrowing_counts_as_real_progress() -> None:
    state = _base_state()
    state["persistent_evidence"] = [
        _evidence_item(
            "ev-temp",
            claim="Temperature anomaly still needs verification.",
            logic_path="verification_needed|temperature|needs_verification",
            refs=[],
        )
    ]
    state["debate_focus"] = "Temperature anomaly needs a closer check."
    state["round_summaries"] = [
        {
            "round": 2,
            "focus_signature": agents._build_signature("Temperature anomaly needs a closer check."),
            "next_focus_signature": agents._build_signature("Temperature anomaly needs a closer check."),
            "gap_signatures": [agents._build_signature("Temperature anomaly needs a closer check.")],
            "logic_path_signature": agents._build_signature("Temperature anomaly needs a closer check."),
            "active_evidence_ids": ["ev-temp"],
            "resolved_evidence_ids": [],
            "evidence_refs": [],
            "conflict_signature": {
                "proposal_label": "\u7c7b",
                "critic_stance": "\u53cd\u5bf9",
                "critic_suggested_label": "\u79c1",
            },
        }
    ]

    analysis = agents._analyze_round_progress(
        state,
        ["Temperature anomaly needs a closer check."],
        "Inspect properties.pin_d8 threshold logic.",
    )

    assert analysis["verifiable_next_focus"] is True
    assert analysis["next_focus_narrowed"] is True
    assert analysis.get("semantic_progress_detected", True) is True
    assert analysis.get("repeat_dispute_detected", False) is False


def test_explicit_resolution_moves_evidence_to_resolved() -> None:
    helper = _find_helper(
        [
            "_apply_arbiter_evidence_decision",
            "_update_evidence_vault",
            "_sync_evidence_vault",
            "_reconcile_evidence_vault",
        ]
    )
    state = _base_state()
    state["persistent_evidence"] = [
        _evidence_item(
            "ev-d8",
            claim="D8 threshold branch is unresolved.",
            logic_path="threshold_exceeded|properties.pin_d8|missing_evidence",
            refs=["properties.pin_d8"],
        )
    ]
    arbiter_result = {
        "arbiter_action": "finalize",
        "decision_reason_type": "focus_not_narrowed",
        "final_label": "\u7c7b",
        "case_closed": True,
        "loop_detected": False,
        "loop_reason": "",
        "decision_reason": "The previous D8 evidence gap is now closed.",
        "next_focus": "",
        "retry_reason_type": None,
        "consensus_status": "closed",
        "resolved_evidence_ids": ["ev-d8"],
        "retained_evidence_ids": [],
        "new_evidence_ids": [],
    }
    context = {
        "state": copy.deepcopy(state),
        "arbiter_result": arbiter_result,
        "round_analysis": {
            "active_evidence_ids": ["ev-d8"],
            "resolved_evidence_ids": [],
            "logic_path_signature": agents._build_signature("Check D8 threshold branch."),
        },
        "unresolved_gaps": [],
        "next_focus": "",
    }

    result = _invoke_with_context(helper, context)
    active, resolved = _resulting_evidence_lists(result, context["state"])

    assert all(item["evidence_id"] != "ev-d8" for item in active)
    assert any(item["evidence_id"] == "ev-d8" for item in resolved)


def test_round_summary_keeps_evidence_lifecycle_fields_for_artifacts() -> None:
    state = _base_state()
    state["persistent_evidence"] = [
        _evidence_item(
            "ev-d8",
            claim="D8 threshold branch is unresolved.",
            logic_path="threshold_exceeded|properties.pin_d8|missing_evidence",
            refs=["properties.pin_d8"],
        )
    ]
    state["resolved_evidence"] = [
        _evidence_item(
            "ev-old",
            claim="Legacy gap already closed.",
            logic_path="resolved|legacy|support",
            refs=["properties.pin_a0"],
            status="resolved",
            resolution_note="Closed in round 2.",
        )
    ]
    round_analysis = {
        "focus_signature": agents._build_signature("Check D8 threshold branch."),
        "next_focus_signature": agents._build_signature("Inspect properties.pin_d8 threshold logic."),
        "gap_signatures": [agents._build_signature("Inspect properties.pin_d8 threshold logic.")],
        "logic_path_signature": agents._build_signature("Inspect properties.pin_d8 threshold logic."),
        "conflict_signature": {
            "proposal_label": "\u7c7b",
            "critic_stance": "\u53cd\u5bf9",
            "critic_suggested_label": "\u79c1",
        },
        "evidence_refs": ["properties.pin_d8"],
        "focus_changed": True,
        "new_evidence_detected": True,
        "repeat_dispute_detected": False,
        "semantic_progress_detected": True,
        "active_evidence_ids": ["ev-d8"],
        "resolved_evidence_ids": ["ev-old"],
        "narrowing_delta": "generic_temperature -> properties.pin_d8",
    }
    arbiter_result = {
        "arbiter_action": "retry",
        "decision_reason_type": "evidence_gap",
        "retry_reason_type": "evidence_gap",
        "next_focus": "Inspect properties.pin_d8 threshold logic.",
        "final_label": None,
        "decision_reason": "A new verifiable checkpoint appeared.",
        "loop_detected": False,
        "loop_reason": "",
        "resolved_evidence_ids": ["ev-old"],
        "retained_evidence_ids": ["ev-d8"],
        "new_evidence_ids": ["ev-d8"],
    }

    summaries = agents._summarize_round(state, arbiter_result, ["Inspect properties.pin_d8 threshold logic."], round_analysis)
    summary = summaries[-1]

    assert summary["logic_path_signature"]
    assert summary["active_evidence_ids"] == ["ev-d8"]
    assert summary["resolved_evidence_ids"] == ["ev-old"]
    assert summary["narrowing_delta"] == "generic_temperature -> properties.pin_d8"
    assert summary["semantic_progress_detected"] is True

def test_no_anchor_foundational_and_reusable_signatures_are_distinct() -> None:
    foundational = agents._build_signature("Foundational universal principle with a cross instance constraint.")
    reusable = agents._build_signature("Reusable protocol template with instantiable class definition.")

    assert "foundational_principle" in foundational.get("semantic_anchor_terms", [])
    assert "reusable_template" in reusable.get("semantic_anchor_terms", [])
    assert agents._signatures_equivalent(foundational, reusable) is False
    assert "semantic:foundational_principle" in agents._build_logic_path(foundational)


def test_implicit_resolution_closes_generic_gap_when_specific_focus_covers_it() -> None:
    state = _base_state()
    old_signature = agents._build_signature("Verify whether this is a foundational universal principle.")
    state["persistent_evidence"] = [
        _evidence_item(
            "ev-foundation",
            claim="Verify whether this is a foundational universal principle.",
            logic_path=agents._build_logic_path(old_signature),
            refs=[],
            signature=old_signature,
        )
    ]
    state["debate_focus"] = "Review whether the node is a foundational principle."
    state["proposal"]["uncertainties"] = []
    state["critique"]["remaining_gaps"] = []
    state["critique"]["open_questions"] = []

    result = agents._sync_persistent_evidence(
        state,
        [],
        "Inspect node_data.properties.ti and graph_context.edges relation grounded_in.",
    )

    active_ids = {item["evidence_id"] for item in result["persistent_evidence"]}
    resolved_ids = {item["evidence_id"] for item in result["resolved_evidence"]}

    assert "ev-foundation" not in active_ids
    assert "ev-foundation" in resolved_ids
    assert result.get("implicitly_resolved_ids") == ["ev-foundation"]


def test_implicit_resolution_does_not_close_same_paraphrase_without_new_checkpoint() -> None:
    state = _base_state()
    old_signature = agents._build_signature(PARAPHRASE_A)
    state["persistent_evidence"] = [
        _evidence_item(
            "ev-d8",
            claim=PARAPHRASE_A,
            logic_path=agents._build_logic_path(old_signature),
            refs=["properties.pin_d8"],
            signature=old_signature,
        )
    ]
    state["debate_focus"] = "Check the D8 threshold path."

    result = agents._sync_persistent_evidence(state, [], PARAPHRASE_B)

    active_ids = {item["evidence_id"] for item in result["persistent_evidence"]}
    resolved_ids = {item["evidence_id"] for item in result["resolved_evidence"]}

    assert "ev-d8" in active_ids
    assert "ev-d8" not in resolved_ids
    assert result.get("implicitly_resolved_ids") == []


def test_evidence_closed_ignores_stale_gap_penalty_when_active_evidence_is_empty() -> None:
    state = _base_state()
    state["proposal"]["label"] = "\u8fbe"
    state["proposal"]["core_evidence"] = ["node_data.properties.ti"]
    state["node_data"]["description"] = "Foundational universal principle for cross-instance safety."
    state["node_data"]["properties"] = {
        "ti": "Foundational universal principle",
        "ran": "Cross-instance safety law.",
    }
    state["critique"]["remaining_gaps"] = ["stale gap"]
    state["critique"]["open_questions"] = ["stale question"]
    state["persistent_evidence"] = []
    state["round_summaries"] = [
        {
            "decision_reason_type": "evidence_closed",
            "focus_changed": False,
            "new_evidence_detected": False,
            "repeat_dispute_detected": False,
        }
    ]

    assert agents._can_finalize_evidence_closed(state, "\u8fbe", explicit_conflict=False) is True

    evaluation = agents._calibrate_evaluation_scores(
        state,
        {
            "confidence_score": 0.91,
            "consensus_stability_score": 0.87,
            "evidence_strength_score": 0.9,
            "logic_consistency_score": 0.89,
            "semantic_fit_score": 0.92,
            "audit_opinion": "Closed by direct foundational evidence.",
        },
    )

    assert evaluation["confidence_score"] == 0.91
    assert evaluation["semantic_fit_score"] == 0.92