from __future__ import annotations

"""LLM agent implementations for proposer, critic, arbiter, and evaluator."""

import json
import re
from ast import literal_eval
from typing import Any, Type

from ontology_negotiator.errors import NegotiationExecutionError
from ontology_negotiator.errors import invoke_llm_with_retry
from ontology_negotiator.models import (
    AgentErrorPayload,
    ArbiterPayload,
    CritiquePayload,
    EvaluationReportPayload,
    EvidenceEventPayload,
    LLMTracePayload,    NegotiationState,
    PersistentEvidencePayload,
    ProposalPayload,
)
from ontology_negotiator.prompts import load_system_prompt
from ontology_negotiator.config import LLMRetryConfig

try:
    from langchain_core.messages import HumanMessage, SystemMessage
except Exception:
    HumanMessage = None
    SystemMessage = None


AGENT_RESPONSE_MODELS: dict[str, Type[Any]] = {
    "proposer": ProposalPayload,
    "critic": CritiquePayload,
    "arbiter": ArbiterPayload,
    "evaluator": EvaluationReportPayload,
}

_REF_PATTERN = re.compile(
    r"(?:node_data|graph_context|vault_context)(?:\.[A-Za-z0-9_\[\]]+)+|"
    r"(?:properties|neighbors|edges)(?:\.[A-Za-z0-9_\[\]]+)+"
)
_NORMALIZE_PATTERN = re.compile(r"[^0-9a-zA-Z\u4e00-\u9fff]+")
_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "\u662f\u5426",
    "\u9700\u8981",
    "\u8bf4\u660e",
    "\u786e\u8ba4",
    "\u5f53\u524d",
    "\u4e0b\u4e00\u8f6e",
    "\u8bc1\u636e",
    "\u8fb9\u754c",
    "\u5b57\u6bb5",
    "\u5173\u7cfb",
    "\u90bb\u5c45",
    "\u8282\u70b9",
}
_LOGIC_OPERATOR_PATTERNS: dict[str, tuple[str, ...]] = {
    "threshold_exceeded": ("\u8d85\u51fa\u9608\u503c", "\u8d85\u8fc7\u9608\u503c", "\u9ad8\u4e8e\u9608\u503c", "\u8fc7\u9ad8", "\u8fc7\u4f4e", "threshold", "out of range"),
    "missing_mapping": ("\u7f3a\u5931\u6620\u5c04", "\u6ca1\u6709\u6620\u5c04", "\u672a\u6620\u5c04", "missing mapping", "not mapped"),
    "missing_binding": ("\u7f3a\u5c11\u5b9e\u4f8b", "\u5b9e\u4f8b\u7ed1\u5b9a\u4e0d\u8db3", "\u672a\u7ed1\u5b9a", "missing binding", "not bound"),
    "causal_break": ("\u56e0\u679c\u94fe\u65ad\u88c2", "\u903b\u8f91\u6f0f\u6d1e", "\u4e0d\u6210\u7acb", "contradiction", "inconsistent"),
    "verification_needed": ("\u5f85\u6838\u5b9e", "\u9700\u8981\u6838\u5b9e", "\u9700\u8981\u786e\u8ba4", "verify", "check whether"),
}
_CLAIM_TYPE_PATTERNS: dict[str, tuple[str, ...]] = {
    "support": ("\u652f\u6301", "\u6210\u7acb", "matches", "supports"),
    "oppose": ("\u53cd\u5bf9", "\u4e0d\u652f\u6301", "\u4e0d\u6210\u7acb", "contradiction", "conflict"),
    "missing_evidence": ("\u7f3a\u8bc1\u636e", "\u8bc1\u636e\u4e0d\u8db3", "\u6ca1\u6709\u8bc1\u636e", "evidence gap", "missing evidence"),
    "needs_verification": ("\u5f85\u6838\u5b9e", "\u9700\u8981\u6838\u5b9e", "\u9700\u8981\u786e\u8ba4", "uncertain", "unknown"),
}
_SEMANTIC_ANCHOR_PATTERNS: dict[str, tuple[str, ...]] = {
    "foundational_principle": (
        "law",
        "principle",
        "axiom",
        "foundational universal principle",
        "foundational law",
        "fundamental rule",
        "foundation",
        "\u57fa\u7840\u89c4\u5f8b",
        "\u57fa\u672c\u539f\u7406",
        "\u57fa\u7840\u539f\u5219",
        "\u4e0d\u53ef\u66ff\u6362\u5e95\u5c42\u89c4\u5f8b",
        "\u516c\u7406",
        "\u6cd5\u5219",
        "\u539f\u7406",
    ),
    "cross_instance_constraint": (
        "cross instance",
        "across instances",
        "prior constraint",
        "prior law",
        "global invariant",
        "universal constraint",
        "cross-instance",
        "\u8de8\u5b9e\u4f8b",
        "\u5148\u9a8c\u7ea6\u675f",
        "\u5168\u5c40\u7ea6\u675f",
        "\u5168\u5c40\u4e0d\u53d8\u5f0f",
        "\u666e\u904d\u7ea6\u675f",
    ),
    "reusable_template": (
        "template",
        "protocol",
        "module",
        "spec",
        "specification",
        "reusable",
        "class definition",
        "blueprint",
        "abstract capability",
        "instantiable",
        "\u6a21\u677f",
        "\u534f\u8bae",
        "\u6a21\u5757",
        "\u89c4\u8303",
        "\u53ef\u590d\u7528",
        "\u53ef\u5b9e\u4f8b\u5316",
        "\u7c7b\u5b9a\u4e49",
    ),
    "instance_binding": (
        "instance",
        "deployment id",
        "single execution",
        "timestamp",
        "run id",
        "owner_module",
        "concrete project instance",
        "unique binding",
        "\u5177\u4f53\u5b9e\u4f8b",
        "\u552f\u4e00\u7ed1\u5b9a",
        "\u5355\u6b21\u6267\u884c",
        "\u90e8\u7f72id",
        "\u65f6\u95f4\u6233",
        "\u9879\u76ee\u5b9e\u4f8b",
    ),
}
_LABEL_SEMANTIC_PRIORS: dict[str, set[str]] = {
    "\u8fbe": {"foundational_principle", "cross_instance_constraint"},
    "\u7c7b": {"reusable_template"},
    "\u79c1": {"instance_binding"},
}


def _extract_json(content: Any) -> dict[str, Any]:
    if hasattr(content, "model_dump"):
        return content.model_dump(mode="json")
    if isinstance(content, dict):
        return content
    if isinstance(content, list):
        text = "".join(
            item.get("text", str(item))
            if isinstance(item, dict)
            else getattr(item, "text", str(item))
            for item in content
        )
    else:
        text = str(content)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON object found in model response.")
    json_text = text[start : end + 1]
    try:
        return json.loads(json_text)
    except json.JSONDecodeError:
        repaired = _parse_pythonish_json_object(json_text)
        if isinstance(repaired, dict):
            return repaired
        raise


def _parse_pythonish_json_object(text: str) -> dict[str, Any]:
    normalized: list[str] = []
    quote_char: str | None = None
    escaped = False
    index = 0

    while index < len(text):
        char = text[index]
        if quote_char is not None:
            normalized.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                quote_char = None
            index += 1
            continue

        if char in ('"', "'"):
            quote_char = char
            normalized.append(char)
            index += 1
            continue

        if text.startswith("null", index) and _is_token_boundary(text, index, 4):
            normalized.append("None")
            index += 4
            continue
        if text.startswith("true", index) and _is_token_boundary(text, index, 4):
            normalized.append("True")
            index += 4
            continue
        if text.startswith("false", index) and _is_token_boundary(text, index, 5):
            normalized.append("False")
            index += 5
            continue

        normalized.append(char)
        index += 1

    parsed = literal_eval("".join(normalized))
    if not isinstance(parsed, dict):
        raise ValueError("Model response did not evaluate to a JSON object.")
    return parsed


def _is_token_boundary(text: str, start: int, length: int) -> bool:
    before = text[start - 1] if start > 0 else ""
    after_index = start + length
    after = text[after_index] if after_index < len(text) else ""
    return (not before or not (before.isalnum() or before == "_")) and (
        not after or not (after.isalnum() or after == "_")
    )


def _append_history(state: NegotiationState, role: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    history = list(state.get("history", []))
    history.append(
        {
            "round": int(state.get("iterations", 1)),
            "role": role,
            "content": payload,
        }
    )
    return history


def _record_error(state: NegotiationState, error: NegotiationExecutionError) -> None:
    errors = list(state.get("agent_errors", []))
    errors.append(AgentErrorPayload(**error.to_dict()).model_dump(mode="json"))
    state["agent_errors"] = errors


def _append_llm_trace(
    state: NegotiationState,
    *,
    agent_name: str,
    stage: str,
    iteration: int,
    prompt_name: str,
    trace_metadata: dict[str, Any] | None,
) -> None:
    metadata = trace_metadata or {}
    traces = list(state.get("llm_trace", []))
    traces.append(
        LLMTracePayload(
            agent_name=agent_name,
            stage=stage,
            iteration=iteration,
            prompt_name=prompt_name,
            llm_model=metadata.get("llm_model"),
            fallback_model=metadata.get("fallback_model"),
            fallback_used=bool(metadata.get("fallback_used", False)),
            attempts=int(metadata.get("attempts", 1) or 1),
            success=bool(metadata.get("success", True)),
        ).model_dump(mode="json")
    )
    state["llm_trace"] = traces


def _resolve_model_name(llm: Any | None) -> str | None:
    if llm is None:
        return None
    for attr in ("model_name", "model", "name", "model_id"):
        value = getattr(llm, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return type(llm).__name__ if llm is not None else None


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        ordered.append(text)
    return ordered


def _truncate_text(value: Any, limit: int = 120) -> str:
    text = str(value).strip()
    if len(text) <= limit:
        return text
    return text[: max(limit - 3, 0)].rstrip() + "..."


def _compact_value(value: Any, limit: int = 120) -> Any:
    if isinstance(value, str):
        return _truncate_text(value, limit)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_compact_value(item, limit) for item in value[:5]]
    if isinstance(value, dict):
        return {str(key): _compact_value(item, limit) for key, item in list(value.items())[:5]}
    return _truncate_text(value, limit)


def _compact_node_context(node_data: dict[str, Any]) -> dict[str, Any]:
    properties = node_data.get("properties", {}) if isinstance(node_data, dict) else {}
    compacted_properties: dict[str, Any] = {}
    priority_tokens = (
        "artifact",
        "owner",
        "module",
        "template",
        "generated",
        "instantiat",
        "ran",
        "ti",
        "label",
        "type",
        "kind",
        "category",
        "name",
        "id",
        "uuid",
        "relation",
        "edge",
        "role",
    )
    if isinstance(properties, dict):
        for key, value in properties.items():
            key_text = str(key).lower()
            if any(token in key_text for token in priority_tokens):
                compacted_properties[str(key)] = _compact_value(value, 96)
        if not compacted_properties:
            for key, value in list(properties.items())[:5]:
                compacted_properties[str(key)] = _compact_value(value, 96)
    return {
        "node_id": str(node_data.get("node_id", "")),
        "name": str(node_data.get("name", "")),
        "l_level": str(node_data.get("l_level", "")),
        "description": _truncate_text(node_data.get("description", ""), 160),
        "properties": compacted_properties,
    }


def _compact_graph_context(graph_context: dict[str, Any]) -> dict[str, Any]:
    neighbor_summaries: list[dict[str, Any]] = []
    for neighbor in list(graph_context.get("neighbors", []))[:4]:
        if not isinstance(neighbor, dict):
            continue
        neighbor_summaries.append(
            {
                "node_id": str(neighbor.get("node_id", "")),
                "name": str(neighbor.get("name", "")),
                "l_level": str(neighbor.get("l_level", "")),
                "description": _truncate_text(neighbor.get("description", ""), 120),
            }
        )

    edge_summaries: list[dict[str, Any]] = []
    for edge in list(graph_context.get("edges", []))[:6]:
        if not isinstance(edge, dict):
            continue
        source = str(edge.get("source", ""))
        target = str(edge.get("target", ""))
        relation = str(edge.get("relation", ""))
        edge_summaries.append(
            {
                "source": source,
                "target": target,
                "relation": relation,
                "edge_ref": f"{source}->{relation}->{target}",
            }
        )

    return {
        "neighbor_ids": [item["node_id"] for item in neighbor_summaries if item.get("node_id")],
        "neighbor_summaries": neighbor_summaries,
        "edge_summaries": edge_summaries,
    }


def _compact_vault_context(vault_context: dict[str, Any]) -> dict[str, Any]:
    return {
        "matched": bool(vault_context.get("matched", False)),
        "evidence": [_truncate_text(item, 120) for item in list(vault_context.get("evidence", []))[:5]],
        "reason": _truncate_text(vault_context.get("reason", ""), 160),
        "related_l2_nodes": [str(item) for item in list(vault_context.get("related_l2_nodes", []))[:5]],
    }


def _build_evidence_pack(state: NegotiationState) -> dict[str, Any]:
    return {
        "node": _compact_node_context(state.get("node_data", {})),
        "graph": _compact_graph_context(state.get("graph_context", {})),
        "vault": _compact_vault_context(state.get("vault_context", {})),
    }


def _compact_proposal(proposal: dict[str, Any]) -> dict[str, Any]:
    if not proposal:
        return {}
    return {
        "label": proposal.get("label"),
        "confidence_hint": proposal.get("confidence_hint"),
        "reason": _truncate_text(proposal.get("reason", ""), 180),
        "core_evidence": [_truncate_text(item, 100) for item in list(proposal.get("core_evidence", []))[:4]],
        "uncertainties": [_truncate_text(item, 100) for item in list(proposal.get("uncertainties", []))[:3]],
        "revision_strategy": _truncate_text(proposal.get("revision_strategy", ""), 140),
    }


def _compact_critique(critique: dict[str, Any]) -> dict[str, Any]:
    if not critique:
        return {}
    return {
        "stance": critique.get("stance"),
        "reason": _truncate_text(critique.get("reason", ""), 180),
        "counter_evidence": [_truncate_text(item, 100) for item in list(critique.get("counter_evidence", []))[:4]],
        "suggested_label": critique.get("suggested_label"),
        "open_questions": [_truncate_text(item, 100) for item in list(critique.get("open_questions", []))[:3]],
        "consensus_signal": bool(critique.get("consensus_signal", False)),
        "remaining_gaps": [_truncate_text(item, 100) for item in list(critique.get("remaining_gaps", []))[:3]],
    }


def _compact_arbiter(summary: dict[str, Any]) -> dict[str, Any]:
    if not summary:
        return {}
    return {
        "arbiter_action": summary.get("arbiter_action"),
        "decision_reason_type": summary.get("decision_reason_type"),
        "retry_reason_type": summary.get("retry_reason_type"),
        "decision_reason": _truncate_text(summary.get("decision_reason", ""), 160),
        "next_focus": _truncate_text(summary.get("next_focus", ""), 140),
        "final_label": summary.get("final_label"),
        "loop_detected": bool(summary.get("loop_detected", False)),
        "loop_reason": _truncate_text(summary.get("loop_reason", ""), 120),
        "consensus_status": _truncate_text(summary.get("consensus_status", ""), 120),
        "resolved_evidence_ids": list(summary.get("resolved_evidence_ids", []))[:5],
        "retained_evidence_ids": list(summary.get("retained_evidence_ids", []))[:5],
        "new_evidence_ids": list(summary.get("new_evidence_ids", []))[:5],
    }


def _compact_round_summary(summary: dict[str, Any]) -> dict[str, Any]:
    if not summary:
        return {}
    return {
        "round": summary.get("round"),
        "proposal_label": summary.get("proposal_label"),
        "critic_stance": summary.get("critic_stance"),
        "critic_suggested_label": summary.get("critic_suggested_label"),
        "consensus_signal": bool(summary.get("consensus_signal", False)),
        "debate_focus": _truncate_text(summary.get("debate_focus", ""), 140),
        "remaining_gaps": [_truncate_text(item, 100) for item in list(summary.get("remaining_gaps", []))[:3]],
        "arbiter_action": summary.get("arbiter_action"),
        "decision_reason_type": summary.get("decision_reason_type"),
        "retry_reason_type": summary.get("retry_reason_type"),
        "next_focus": _truncate_text(summary.get("next_focus", ""), 140),
        "final_label": summary.get("final_label"),
        "decision_reason": _truncate_text(summary.get("decision_reason", ""), 160),
        "focus_changed": bool(summary.get("focus_changed", False)),
        "new_evidence_detected": bool(summary.get("new_evidence_detected", False)),
        "repeat_dispute_detected": bool(summary.get("repeat_dispute_detected", False)),
        "semantic_progress_detected": bool(summary.get("semantic_progress_detected", False)),
        "narrowing_delta": _truncate_text(summary.get("narrowing_delta", ""), 120),
        "active_evidence_ids": list(summary.get("active_evidence_ids", []))[:5],
        "resolved_evidence_ids": list(summary.get("resolved_evidence_ids", []))[:5],
        "logic_path_signature": _compact_value(summary.get("logic_path_signature", {}), 80),
    }


def _compact_audit_turn(turn: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(turn, dict):
        return {}
    role = str(turn.get("role", ""))
    compact: dict[str, Any] = {
        "round": turn.get("round"),
        "role": role,
    }
    content = turn.get("content", {})
    if not isinstance(content, dict):
        compact["content"] = _truncate_text(content, 160)
        return compact
    if role == "proposer":
        compact.update(_compact_proposal(content))
    elif role == "critic":
        compact.update(_compact_critique(content))
    elif role == "arbiter":
        compact.update(_compact_arbiter(content))
    elif role == "evaluator":
        compact.update(
            {
                "confidence_score": content.get("confidence_score"),
                "consensus_stability_score": content.get("consensus_stability_score"),
                "evidence_strength_score": content.get("evidence_strength_score"),
                "logic_consistency_score": content.get("logic_consistency_score"),
                "semantic_fit_score": content.get("semantic_fit_score"),
                "audit_opinion": _truncate_text(content.get("audit_opinion", ""), 140),
            }
        )
    else:
        compact["content"] = _compact_value(content, 120)
    return compact


def _build_working_memory(state: NegotiationState) -> dict[str, Any]:
    summaries = list(state.get("round_summaries", []))
    latest_summary = summaries[-1] if summaries else {}
    critique = state.get("critique", {})
    return {
        "round": int(state.get("iterations", 1)),
        "focus": str(state.get("debate_focus", "")),
        "gaps": _dedupe(list(state.get("debate_gaps", []))),
        "signals": {
            "focus_changed": bool(latest_summary.get("focus_changed", False)),
            "new_evidence_detected": bool(latest_summary.get("new_evidence_detected", False)),
            "repeat_dispute_detected": bool(latest_summary.get("repeat_dispute_detected", False)),
            "semantic_progress_detected": bool(latest_summary.get("semantic_progress_detected", False)),
            "consensus_signal": bool(critique.get("consensus_signal", False)),
            "loop_detected": bool(state.get("loop_detected", False)),
            "case_closed": bool(state.get("case_closed", False)),
        },
        "proposal_snapshot": _compact_proposal(state.get("proposal", {})),
        "critique_snapshot": _compact_critique(critique),
        "arbiter_snapshot": _compact_arbiter(latest_summary),
        "last_round_summary": _compact_round_summary(latest_summary),
        "active_evidence_digest": _build_evidence_digest(state.get("persistent_evidence", [])),
        "resolved_evidence_digest": _build_evidence_digest(state.get("resolved_evidence", [])),
        "evidence_status_summary": _build_evidence_status_summary(state),
        "last_logic_path_signature": _compact_value(latest_summary.get("logic_path_signature", {}), 100),
        "recent_turns": _select_history(state, limit=2),
    }


def _with_updates(state: NegotiationState, **updates: Any) -> dict[str, Any]:
    merged = dict(state)
    merged.update(updates)
    return merged


def _normalize_text(text: str) -> str:
    normalized = _NORMALIZE_PATTERN.sub(" ", str(text).lower())
    return " ".join(part for part in normalized.split() if part)


def _extract_refs(value: Any) -> set[str]:
    refs: set[str] = set()
    if isinstance(value, str):
        refs.update(match.lower() for match in _REF_PATTERN.findall(value))
        return refs
    if isinstance(value, dict):
        for item in value.values():
            refs.update(_extract_refs(item))
        return refs
    if isinstance(value, list):
        for item in value:
            refs.update(_extract_refs(item))
    return refs


def _tokenize_text(text: str) -> set[str]:
    tokens = set(_normalize_text(text).split())
    return {token for token in tokens if len(token) > 1 and token not in _STOPWORDS}


def _match_semantic_label(text: str, patterns: dict[str, tuple[str, ...]], default: str) -> str:
    lowered = str(text).lower()
    for label, candidates in patterns.items():
        if any(candidate.lower() in lowered for candidate in candidates):
            return label
    return default


def _extract_logic_operator(text: str) -> str:
    return _match_semantic_label(text, _LOGIC_OPERATOR_PATTERNS, "general_check")


def _extract_claim_type(text: str) -> str:
    return _match_semantic_label(text, _CLAIM_TYPE_PATTERNS, "needs_verification")


def _extract_object_terms(text: str) -> set[str]:
    tokens = _tokenize_text(text)
    filtered = {
        token
        for token in tokens
        if token not in {
            "field",
            "edge",
            "neighbor",
            "relation",
            "property",
            "properties",
            "threshold",
            "evidence",
            "logic",
            "check",
            "verify",
        }
    }
    lowered = str(text).lower()
    for pattern in (r"d\d+", r"pin[_a-z0-9]+"):
        filtered.update(re.findall(pattern, lowered))
    keyword_map = {
        "\u6e29\u5ea6": ("\u6e29\u5ea6", "\u6c34\u6e29", "temperature"),
        "\u9608\u503c": ("\u9608\u503c", "threshold"),
        "\u63a7\u5236\u4fe1\u53f7": ("\u63a7\u5236\u4fe1\u53f7", "control signal"),
    }
    for canonical, variants in keyword_map.items():
        if any(variant.lower() in lowered for variant in variants):
            filtered.add(canonical)
    return set(sorted(filtered)[:6])


def _extract_semantic_anchor_terms(text: str) -> set[str]:
    lowered = str(text).lower()
    matched = {
        label
        for label, candidates in _SEMANTIC_ANCHOR_PATTERNS.items()
        if any(candidate.lower() in lowered for candidate in candidates)
    }
    if "grounded_in" in lowered and "foundational universal principle" in lowered:
        matched.add("foundational_principle")
    return matched


def _build_signature(text: str, claim_type: str | None = None) -> dict[str, Any]:
    anchor_refs = sorted(_extract_refs(text))
    object_terms = sorted(_extract_object_terms(text))
    signature = {
        "anchor_refs": anchor_refs,
        "semantic_anchor_terms": sorted(_extract_semantic_anchor_terms(text)),
        "logic_operator": _extract_logic_operator(text),
        "object_terms": object_terms,
        "claim_type": claim_type or _extract_claim_type(text),
        "raw_tokens": sorted(_tokenize_text(text)),
    }
    return signature


def _merge_signatures(signatures: list[dict[str, Any]]) -> dict[str, Any]:
    anchor_refs: set[str] = set()
    semantic_anchor_terms: set[str] = set()
    object_terms: set[str] = set()
    logic_ops: set[str] = set()
    claim_types: set[str] = set()
    raw_tokens: set[str] = set()
    for signature in signatures:
        if not signature:
            continue
        anchor_refs.update(signature.get("anchor_refs", []))
        semantic_anchor_terms.update(signature.get("semantic_anchor_terms", []))
        object_terms.update(signature.get("object_terms", []))
        raw_tokens.update(signature.get("raw_tokens", []))
        logic_operator = str(signature.get("logic_operator", "")).strip()
        if logic_operator:
            logic_ops.add(logic_operator)
        claim_type = str(signature.get("claim_type", "")).strip()
        if claim_type:
            claim_types.add(claim_type)
    return {
        "anchor_refs": sorted(anchor_refs),
        "semantic_anchor_terms": sorted(semantic_anchor_terms),
        "logic_operator": sorted(logic_ops),
        "object_terms": sorted(object_terms),
        "claim_type": sorted(claim_types),
        "raw_tokens": sorted(raw_tokens),
    }


def _as_set(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        return {value} if value else set()
    if isinstance(value, list):
        return {str(item) for item in value if str(item).strip()}
    return {str(value)} if str(value).strip() else set()


def _overlap_ratio(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / max(min(len(left), len(right)), 1)


def _signature_topic_overlap(left: dict[str, Any] | None, right: dict[str, Any] | None) -> bool:
    if not left or not right:
        return False
    return bool(
        _as_set(left.get("anchor_refs")) & _as_set(right.get("anchor_refs"))
        or _as_set(left.get("semantic_anchor_terms")) & _as_set(right.get("semantic_anchor_terms"))
        or _as_set(left.get("object_terms")) & _as_set(right.get("object_terms"))
    )


def _signatures_equivalent(left: dict[str, Any] | None, right: dict[str, Any] | None) -> bool:
    if not left and not right:
        return True
    if not left or not right:
        return False

    left_anchors = _as_set(left.get("anchor_refs"))
    right_anchors = _as_set(right.get("anchor_refs"))
    left_semantic = _as_set(left.get("semantic_anchor_terms"))
    right_semantic = _as_set(right.get("semantic_anchor_terms"))
    left_logic = _as_set(left.get("logic_operator"))
    right_logic = _as_set(right.get("logic_operator"))
    left_claim = _as_set(left.get("claim_type"))
    right_claim = _as_set(right.get("claim_type"))
    left_objects = _as_set(left.get("object_terms"))
    right_objects = _as_set(right.get("object_terms"))
    left_tokens = _as_set(left.get("raw_tokens"))
    right_tokens = _as_set(right.get("raw_tokens"))

    if left_anchors and right_anchors:
        if left_anchors == right_anchors and left_logic == right_logic:
            return True
        if left_anchors == right_anchors and _overlap_ratio(left_objects, right_objects) >= 0.6:
            return True

    if not left_anchors and not right_anchors and left_semantic and right_semantic:
        if left_semantic == right_semantic and left_logic == right_logic and _overlap_ratio(left_objects | left_tokens, right_objects | right_tokens) >= 0.6:
            return True
        if not (left_semantic & right_semantic):
            return False

    if not left_anchors and not right_anchors and not left_semantic and not right_semantic:
        if left_logic == right_logic and left_claim == right_claim and _overlap_ratio(left_objects, right_objects) >= 0.6:
            return True

    combined_left = left_objects | left_tokens
    combined_right = right_objects | right_tokens
    if left_logic == right_logic and left_claim == right_claim and _overlap_ratio(combined_left, combined_right) >= 0.75:
        if left_semantic and right_semantic and not (left_semantic & right_semantic):
            return False
        return True
    return False


def _gap_sets_equivalent(current: list[dict[str, Any]], previous: list[dict[str, Any]]) -> bool:
    if len(current) != len(previous):
        return False
    remaining = previous.copy()
    for signature in current:
        match_index = next(
            (index for index, candidate in enumerate(remaining) if _signatures_equivalent(signature, candidate)),
            None,
        )
        if match_index is None:
            return False
        remaining.pop(match_index)
    return not remaining


def _build_evidence_digest(items: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    digest: list[dict[str, Any]] = []
    for item in items[:limit]:
        if not isinstance(item, dict):
            continue
        digest.append(
            {
                "evidence_id": item.get("evidence_id"),
                "reason_type": item.get("reason_type"),
                "logic_path": _truncate_text(item.get("logic_path", ""), 120),
                "canonical_claim": _truncate_text(item.get("canonical_claim", ""), 120),
                "evidence_refs": list(item.get("evidence_refs", []))[:4],
                "status": item.get("status"),
            }
        )
    return digest


def _build_evidence_status_summary(state: NegotiationState) -> dict[str, Any]:
    active = [item for item in list(state.get("persistent_evidence", [])) if item.get("status") == "active"]
    resolved = list(state.get("resolved_evidence", []))
    return {
        "active": len(active),
        "resolved": len(resolved),
        "active_count": len(active),
        "resolved_count": len(resolved),
        "active_ids": [str(item.get("evidence_id", "")) for item in active[:8]],
        "resolved_ids": [str(item.get("evidence_id", "")) for item in resolved[:8]],
    }


def _select_history(state: NegotiationState, limit: int = 2) -> list[dict[str, Any]]:
    history = list(state.get("history", []))
    if limit <= 0:
        return []
    selected = history[-limit:]
    return [_compact_audit_turn(item) for item in selected]


def _select_round_summaries(state: NegotiationState, limit: int = 1) -> list[dict[str, Any]]:
    summaries = list(state.get("round_summaries", []))
    if limit <= 0:
        return []
    selected = summaries[-limit:]
    return [_compact_round_summary(item) for item in selected]


def _build_unresolved_gaps(state: NegotiationState) -> list[str]:
    critique = state.get("critique", {})
    proposal = state.get("proposal", {})
    combined = []
    combined.extend(list(critique.get("remaining_gaps", [])))
    combined.extend(list(critique.get("open_questions", [])))
    combined.extend(list(proposal.get("uncertainties", [])))
    return _dedupe(combined)


def _resolve_retry_focus(state: NegotiationState, unresolved_gaps: list[str]) -> str:
    if unresolved_gaps:
        return unresolved_gaps[0]
    revision_strategy = str(state.get("proposal", {}).get("revision_strategy", "")).strip()
    if revision_strategy:
        return revision_strategy
    critique_reason = str(state.get("critique", {}).get("reason", "")).strip()
    if critique_reason:
        return critique_reason
    node_id = state.get("node_data", {}).get("node_id", "unknown_node")
    return f"Clarify the evidence boundary for {node_id}."


def _collect_evidence_refs(state: NegotiationState) -> list[str]:
    proposal = state.get("proposal", {})
    critique = state.get("critique", {})
    evidence_sources = [
        proposal.get("core_evidence", []),
        critique.get("counter_evidence", []),
        proposal.get("reason", ""),
        critique.get("reason", ""),
        state.get("debate_focus", ""),
        state.get("debate_gaps", []),
        critique.get("remaining_gaps", []),
        [item.get("canonical_claim", "") for item in list(state.get("persistent_evidence", []))],
    ]
    refs: set[str] = set()
    for source in evidence_sources:
        refs.update(_extract_refs(source))
    return sorted(refs)


def _is_verifiable_focus(text: str) -> bool:
    focus = str(text).strip()
    if not focus:
        return False
    if _extract_refs(focus):
        return True
    keywords = (
        "field",
        "edge",
        "neighbor",
        "relation",
        "property",
        "pin",
        "threshold",
        "\u5b57\u6bb5",
        "\u8fb9",
        "\u90bb\u5c45",
        "\u5173\u7cfb",
        "\u5c5e\u6027",
    )
    lower_focus = focus.lower()
    return any(keyword in lower_focus for keyword in keywords)
def _build_logic_path(signature: dict[str, Any]) -> str:
    anchor_refs = list(signature.get("anchor_refs", []))
    semantic_anchor_terms = list(signature.get("semantic_anchor_terms", []))
    if anchor_refs:
        anchor = ",".join(anchor_refs)
    elif semantic_anchor_terms:
        anchor = f"semantic:{','.join(semantic_anchor_terms)}"
    else:
        anchor = "semantic:unanchored"
    logic_operator = signature.get("logic_operator", [])
    if isinstance(logic_operator, list):
        logic_text = ",".join(logic_operator)
    else:
        logic_text = str(logic_operator)
    claim_type = signature.get("claim_type", [])
    if isinstance(claim_type, list):
        claim_text = ",".join(claim_type)
    else:
        claim_text = str(claim_type)
    objects = ",".join(signature.get("object_terms", []))
    return f"{anchor}|{logic_text}|{claim_text}|{objects}".strip("|")


def _validate_evidence_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    validated: list[dict[str, Any]] = []
    for item in items:
        validated.append(PersistentEvidencePayload.model_validate(item).model_dump(mode="json"))
    return validated


def _make_evidence_event(
    evidence_id: str,
    event_type: str,
    round_number: int,
    source_role: str,
    *,
    reason_type: str = "",
    note: str = "",
    related_evidence_id: str | None = None,
) -> dict[str, Any]:
    return EvidenceEventPayload(
        evidence_id=evidence_id,
        event_type=event_type,
        round=round_number,
        source_role=source_role,
        reason_type=reason_type,
        note=note,
        related_evidence_id=related_evidence_id,
    ).model_dump(mode="json")


def _make_candidate_evidence(text: str, source_role: str, source_round: int, reason_type: str) -> dict[str, Any] | None:
    content = str(text).strip()
    if not content:
        return None
    signature = _build_signature(content)
    evidence_refs = sorted(_extract_refs(content))
    canonical_claim = _build_logic_path(signature) or _normalize_text(content)
    return {
        "source_round": source_round,
        "source_role": source_role,
        "reason_type": reason_type,
        "logic_path": canonical_claim,
        "canonical_claim": canonical_claim,
        "evidence_refs": evidence_refs,
        "signature": signature,
        "raw_text": content,
    }


def _find_matching_evidence(candidate: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidate_signature = candidate.get("signature", {})
    for item in items:
        item_signature = item.get("signature") or _build_signature(str(item.get("canonical_claim", "")))
        if _signatures_equivalent(candidate_signature, item_signature):
            return item
    return None


def _signature_is_more_specific(
    reference_signature: dict[str, Any],
    checkpoint_signature: dict[str, Any],
    checkpoint_text: str,
) -> bool:
    if not _is_verifiable_focus(checkpoint_text):
        return False
    if _signatures_equivalent(reference_signature, checkpoint_signature):
        return False
    reference_anchors = _as_set(reference_signature.get("anchor_refs"))
    checkpoint_anchors = _as_set(checkpoint_signature.get("anchor_refs"))
    reference_semantic = _as_set(reference_signature.get("semantic_anchor_terms"))
    checkpoint_semantic = _as_set(checkpoint_signature.get("semantic_anchor_terms"))
    reference_objects = _as_set(reference_signature.get("object_terms"))
    checkpoint_objects = _as_set(checkpoint_signature.get("object_terms"))
    return bool(
        checkpoint_anchors - reference_anchors
        or checkpoint_semantic - reference_semantic
        or len(checkpoint_objects) > len(reference_objects)
    )



def _build_round_topic_signature(
    state: NegotiationState,
    unresolved_gaps: list[str],
    next_focus: str,
) -> dict[str, Any]:
    proposal = state.get("proposal", {})
    critique = state.get("critique", {})
    texts: list[str] = [
        str(state.get("debate_focus", "")).strip(),
        str(next_focus).strip(),
        str(proposal.get("reason", "")).strip(),
        str(critique.get("reason", "")).strip(),
    ]
    texts.extend(str(item).strip() for item in unresolved_gaps)
    texts.extend(str(item).strip() for item in list(proposal.get("uncertainties", [])))
    signatures = [_build_signature(text) for text in texts if text]
    return _merge_signatures(signatures)



def _build_resolution_checkpoints(
    state: NegotiationState,
    unresolved_gaps: list[str],
    next_focus: str,
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    checkpoints: list[dict[str, Any]] = []
    current_focus = str(state.get("debate_focus", "")).strip()
    if current_focus:
        checkpoints.append(
            {
                "text": current_focus,
                "signature": _build_signature(current_focus),
                "source_role": "focus",
            }
        )
    for item in candidates:
        checkpoints.append(
            {
                "text": str(item.get("raw_text", "")).strip(),
                "signature": item.get("signature", {}),
                "source_role": str(item.get("source_role", "critic")),
            }
        )
    if next_focus.strip() and not any(str(item.get("text", "")).strip() == next_focus.strip() for item in checkpoints):
        checkpoints.append(
            {
                "text": next_focus.strip(),
                "signature": _build_signature(next_focus),
                "source_role": "arbiter",
            }
        )
    for item in unresolved_gaps:
        text = str(item).strip()
        if text and not any(str(candidate.get("text", "")).strip() == text for candidate in checkpoints):
            checkpoints.append(
                {
                    "text": text,
                    "signature": _build_signature(text),
                    "source_role": "critic",
                }
            )
    return checkpoints



def _move_evidence_to_resolved(
    *,
    item: dict[str, Any],
    resolved: list[dict[str, Any]],
    events: list[dict[str, Any]],
    round_number: int,
    source_role: str,
    note: str,
) -> None:
    resolved_item = dict(item)
    resolved_item["status"] = "resolved"
    resolved_item["resolution_note"] = note
    resolved.append(resolved_item)
    events.append(
        _make_evidence_event(
            str(item.get("evidence_id", "")),
            "resolved",
            round_number,
            source_role,
            reason_type=str(item.get("reason_type", "")),
            note=note,
        )
    )



def _should_implicitly_resolve_evidence(
    item: dict[str, Any],
    checkpoints: list[dict[str, Any]],
    round_topic_signature: dict[str, Any],
) -> tuple[bool, str, str]:
    evidence_signature = item.get("signature") or _build_signature(str(item.get("canonical_claim", "")))
    if not _signature_topic_overlap(evidence_signature, round_topic_signature):
        return False, "", ""
    for checkpoint in checkpoints:
        checkpoint_signature = checkpoint.get("signature", {})
        checkpoint_text = str(checkpoint.get("text", "")).strip()
        if not checkpoint_text:
            continue
        if not _signature_topic_overlap(evidence_signature, checkpoint_signature):
            continue
        if _signature_is_more_specific(evidence_signature, checkpoint_signature, checkpoint_text):
            note = (
                "Implicitly resolved after a more specific verifiable checkpoint covered the prior evidence boundary: "
                f"{_truncate_text(checkpoint_text, 96)}"
            )
            return True, note, str(checkpoint.get("source_role", "system"))
    return False, "", ""



def _sync_persistent_evidence(
    state: NegotiationState,
    unresolved_gaps: list[str],
    next_focus: str,
) -> dict[str, Any]:
    round_number = int(state.get("iterations", 1))
    active = _validate_evidence_items(list(state.get("persistent_evidence", [])))
    resolved = _validate_evidence_items(list(state.get("resolved_evidence", [])))
    events = list(state.get("evidence_events", []))

    candidates: list[dict[str, Any]] = []
    for item in unresolved_gaps:
        candidate = _make_candidate_evidence(item, "critic", round_number, "evidence_gap")
        if candidate is not None:
            candidates.append(candidate)
    for item in list(state.get("proposal", {}).get("uncertainties", [])):
        candidate = _make_candidate_evidence(item, "proposer", round_number, "evidence_gap")
        if candidate is not None:
            candidates.append(candidate)
    focus_candidate = _make_candidate_evidence(next_focus, "arbiter", round_number, "evidence_gap")
    if focus_candidate is not None:
        candidates.append(focus_candidate)

    new_ids: list[str] = []
    retained_ids: list[str] = []
    reopened_ids: list[str] = []
    implicit_resolved_ids: list[str] = []
    matched_active_ids: set[str] = set()

    for candidate in candidates:
        match = _find_matching_evidence(candidate, active)
        if match is not None:
            evidence_id = str(match.get("evidence_id", ""))
            matched_active_ids.add(evidence_id)
            retained_ids.append(evidence_id)
            current_signature = match.get("signature") or _build_signature(str(match.get("canonical_claim", "")))
            candidate_signature = candidate.get("signature", {})
            next_logic_path = str(candidate.get("logic_path", ""))
            more_specific = _signature_is_more_specific(
                current_signature,
                candidate_signature,
                str(candidate.get("raw_text", "")),
            )
            if next_logic_path and next_logic_path != str(match.get("logic_path", "")):
                match["logic_path"] = next_logic_path
                match["canonical_claim"] = str(candidate.get("canonical_claim", match.get("canonical_claim", "")))
                match["evidence_refs"] = sorted(set(match.get("evidence_refs", [])) | set(candidate.get("evidence_refs", [])))
                match["signature"] = candidate_signature
                match["status"] = "active"
                events.append(
                    _make_evidence_event(
                        evidence_id,
                        "narrowed",
                        round_number,
                        str(candidate.get("source_role", "critic")),
                        reason_type=str(candidate.get("reason_type", "evidence_gap")),
                        note="Evidence narrowed to a more specific logical checkpoint.",
                    )
                )
            elif more_specific:
                match["signature"] = candidate_signature
                match["canonical_claim"] = str(candidate.get("canonical_claim", match.get("canonical_claim", "")))
                events.append(
                    _make_evidence_event(
                        evidence_id,
                        "narrowed",
                        round_number,
                        str(candidate.get("source_role", "critic")),
                        reason_type=str(candidate.get("reason_type", "evidence_gap")),
                        note="Evidence narrowed to a more specific semantic checkpoint.",
                    )
                )
            else:
                events.append(
                    _make_evidence_event(
                        evidence_id,
                        "retained",
                        round_number,
                        str(candidate.get("source_role", "critic")),
                        reason_type=str(candidate.get("reason_type", "evidence_gap")),
                        note="Evidence remains unresolved and stays in the active vault.",
                    )
                )
            continue

        resolved_match = _find_matching_evidence(candidate, resolved)
        if resolved_match is not None:
            resolved = [item for item in resolved if str(item.get("evidence_id", "")) != str(resolved_match.get("evidence_id", ""))]
            reopened_item = dict(resolved_match)
            reopened_item["status"] = "active"
            reopened_item["resolution_note"] = ""
            reopened_item["logic_path"] = str(candidate.get("logic_path", reopened_item.get("logic_path", "")))
            reopened_item["canonical_claim"] = str(candidate.get("canonical_claim", reopened_item.get("canonical_claim", "")))
            reopened_item["evidence_refs"] = sorted(set(reopened_item.get("evidence_refs", [])) | set(candidate.get("evidence_refs", [])))
            reopened_item["signature"] = candidate.get("signature", {})
            active.append(reopened_item)
            evidence_id = str(reopened_item.get("evidence_id", ""))
            matched_active_ids.add(evidence_id)
            reopened_ids.append(evidence_id)
            retained_ids.append(evidence_id)
            events.append(
                _make_evidence_event(
                    evidence_id,
                    "reopened",
                    round_number,
                    str(candidate.get("source_role", "critic")),
                    reason_type=str(candidate.get("reason_type", "evidence_gap")),
                    note="Previously resolved evidence became active again.",
                )
            )
            continue

        evidence_id = f"ev-r{round_number}-{len(active) + len(new_ids) + 1}"
        new_item = PersistentEvidencePayload(
            evidence_id=evidence_id,
            source_round=round_number,
            source_role=str(candidate.get("source_role", "critic")),
            reason_type=str(candidate.get("reason_type", "evidence_gap")),
            logic_path=str(candidate.get("logic_path", "")),
            canonical_claim=str(candidate.get("canonical_claim", "")),
            evidence_refs=list(candidate.get("evidence_refs", [])),
            signature=candidate.get("signature", {}),
            status="active",
            resolution_note="",
        ).model_dump(mode="json")
        active.append(new_item)
        matched_active_ids.add(evidence_id)
        new_ids.append(evidence_id)
        retained_ids.append(evidence_id)
        events.append(
            _make_evidence_event(
                evidence_id,
                "opened",
                round_number,
                str(candidate.get("source_role", "critic")),
                reason_type=str(candidate.get("reason_type", "evidence_gap")),
                note="New unresolved evidence entered the vault.",
            )
        )

    round_topic_signature = _build_round_topic_signature(state, unresolved_gaps, next_focus)
    checkpoints = _build_resolution_checkpoints(state, unresolved_gaps, next_focus, candidates)
    remaining_active: list[dict[str, Any]] = []

    for item in active:
        item.setdefault("signature", _build_signature(str(item.get("canonical_claim", ""))))
        item["status"] = "active"
        evidence_id = str(item.get("evidence_id", ""))
        if evidence_id in matched_active_ids:
            remaining_active.append(item)
            continue
        should_resolve, note, source_role = _should_implicitly_resolve_evidence(
            item,
            checkpoints,
            round_topic_signature,
        )
        if should_resolve:
            implicit_resolved_ids.append(evidence_id)
            _move_evidence_to_resolved(
                item=item,
                resolved=resolved,
                events=events,
                round_number=round_number,
                source_role=source_role or "system",
                note=note,
            )
            continue
        remaining_active.append(item)
        retained_ids.append(evidence_id)
        events.append(
            _make_evidence_event(
                evidence_id,
                "retained",
                round_number,
                "system",
                reason_type=str(item.get("reason_type", "evidence_gap")),
                note="Evidence stays active because this round did not cover it with a more specific verifiable checkpoint.",
            )
        )

    return {
        "persistent_evidence": remaining_active,
        "resolved_evidence": resolved,
        "evidence_events": events,
        "active_evidence_ids": [str(item.get("evidence_id", "")) for item in remaining_active],
        "new_evidence_ids": new_ids,
        "retained_evidence_ids": _dedupe(retained_ids),
        "reopened_evidence_ids": reopened_ids,
        "implicitly_resolved_ids": implicit_resolved_ids,
    }


def _apply_arbiter_evidence_resolution(state: NegotiationState, arbiter_result: dict[str, Any]) -> dict[str, Any]:
    active = _validate_evidence_items(list(state.get("persistent_evidence", [])))
    resolved = _validate_evidence_items(list(state.get("resolved_evidence", [])))
    events = list(state.get("evidence_events", []))
    round_number = int(state.get("iterations", 1))
    resolved_ids = {str(item) for item in list(arbiter_result.get("resolved_evidence_ids", [])) if str(item).strip()}
    resolution_note = str(arbiter_result.get("decision_reason", "")).strip()

    if not resolved_ids:
        return {
            "persistent_evidence": active,
            "resolved_evidence": resolved,
            "evidence_events": events,
        }

    remaining_active: list[dict[str, Any]] = []
    for item in active:
        evidence_id = str(item.get("evidence_id", ""))
        if evidence_id in resolved_ids:
            resolved_item = dict(item)
            resolved_item["status"] = "resolved"
            resolved_item["resolution_note"] = resolution_note
            resolved.append(resolved_item)
            events.append(
                _make_evidence_event(
                    evidence_id,
                    "resolved",
                    round_number,
                    "arbiter",
                    reason_type=str(item.get("reason_type", "")),
                    note=resolution_note or "Arbiter marked this evidence as resolved.",
                )
            )
        else:
            remaining_active.append(item)

    return {
        "persistent_evidence": remaining_active,
        "resolved_evidence": resolved,
        "evidence_events": events,
    }


def _apply_arbiter_evidence_decision(state: NegotiationState, arbiter_result: dict[str, Any]) -> dict[str, Any]:
    return _apply_arbiter_evidence_resolution(state, arbiter_result)


def _analyze_round_progress(
    state: NegotiationState,
    unresolved_gaps: list[str],
    next_focus: str,
) -> dict[str, Any]:
    previous = list(state.get("round_summaries", []))
    current_focus_signature = _build_signature(str(state.get("debate_focus", "")))
    current_next_focus_signature = _build_signature(next_focus)
    current_gap_signatures = [_build_signature(item, claim_type="missing_evidence") for item in unresolved_gaps]
    current_evidence_refs = _collect_evidence_refs(state)
    active_evidence = list(state.get("persistent_evidence", []))
    resolved_evidence = list(state.get("resolved_evidence", []))
    active_evidence_ids = [str(item.get("evidence_id", "")) for item in active_evidence]
    resolved_evidence_ids = [str(item.get("evidence_id", "")) for item in resolved_evidence]
    current_logic_path_signature = _merge_signatures(
        [current_focus_signature, current_next_focus_signature, *current_gap_signatures]
        + [item.get("signature", _build_signature(str(item.get("canonical_claim", "")))) for item in active_evidence]
    )
    current_conflict_signature = {
        "proposal_label": state.get("proposal", {}).get("label"),
        "critic_stance": state.get("critique", {}).get("stance"),
        "critic_suggested_label": state.get("critique", {}).get("suggested_label"),
    }

    if not previous:
        return {
            "focus_signature": current_focus_signature,
            "next_focus_signature": current_next_focus_signature,
            "gap_signatures": current_gap_signatures,
            "evidence_refs": current_evidence_refs,
            "conflict_signature": current_conflict_signature,
            "logic_path_signature": current_logic_path_signature,
            "active_evidence_ids": active_evidence_ids,
            "resolved_evidence_ids": resolved_evidence_ids,
            "focus_changed": True,
            "new_evidence_detected": True,
            "repeat_dispute_detected": False,
            "same_conflict_type": False,
            "gaps_equivalent": False,
            "next_focus_narrowed": bool(next_focus.strip()),
            "verifiable_next_focus": _is_verifiable_focus(next_focus),
            "same_logic_path": False,
            "same_active_evidence": False,
            "semantic_progress_detected": True,
            "narrowing_delta": "initial_round",
        }

    last_summary = previous[-1]
    previous_focus_signature = last_summary.get("next_focus_signature") or last_summary.get("focus_signature")
    previous_gap_signatures = list(last_summary.get("gap_signatures", []))
    previous_evidence_refs = set(last_summary.get("evidence_refs", []))
    previous_conflict_signature = last_summary.get("conflict_signature", {})
    previous_logic_path_signature = last_summary.get("logic_path_signature", {})
    previous_active_evidence_ids = set(last_summary.get("active_evidence_ids", []))

    focus_changed = not _signatures_equivalent(current_focus_signature, previous_focus_signature)
    gaps_equivalent = _gap_sets_equivalent(current_gap_signatures, previous_gap_signatures)
    new_evidence_detected = bool(set(current_evidence_refs) - previous_evidence_refs)
    same_conflict_type = current_conflict_signature == previous_conflict_signature
    next_focus_narrowed = not _signatures_equivalent(current_focus_signature, current_next_focus_signature)
    same_logic_path = _signatures_equivalent(current_logic_path_signature, previous_logic_path_signature)
    same_active_evidence = set(active_evidence_ids) == previous_active_evidence_ids
    next_focus_new_anchor = bool(set(current_next_focus_signature.get("anchor_refs", [])) - set(current_focus_signature.get("anchor_refs", [])))
    semantic_progress_detected = bool(
        new_evidence_detected
        or not same_logic_path
        or not same_active_evidence
        or next_focus_new_anchor
    )
    repeat_dispute_detected = (
        same_conflict_type
        and same_logic_path
        and same_active_evidence
        and not next_focus_new_anchor
        and not semantic_progress_detected
    )
    if next_focus_new_anchor:
        narrowing_delta = "new_anchor_checkpoint"
    elif next_focus_narrowed:
        narrowing_delta = "narrowed_without_new_anchor"
    else:
        narrowing_delta = "same_boundary"

    return {
        "focus_signature": current_focus_signature,
        "next_focus_signature": current_next_focus_signature,
        "gap_signatures": current_gap_signatures,
        "evidence_refs": current_evidence_refs,
        "conflict_signature": current_conflict_signature,
        "logic_path_signature": current_logic_path_signature,
        "active_evidence_ids": active_evidence_ids,
        "resolved_evidence_ids": resolved_evidence_ids,
        "focus_changed": focus_changed,
        "new_evidence_detected": new_evidence_detected,
        "repeat_dispute_detected": repeat_dispute_detected,
        "same_conflict_type": same_conflict_type,
        "gaps_equivalent": gaps_equivalent,
        "next_focus_narrowed": next_focus_narrowed,
        "verifiable_next_focus": _is_verifiable_focus(next_focus),
        "same_logic_path": same_logic_path,
        "same_active_evidence": same_active_evidence,
        "semantic_progress_detected": semantic_progress_detected,
        "narrowing_delta": narrowing_delta,
    }


def _detect_repeat_loop(analysis: dict[str, Any]) -> tuple[bool, str]:
    if (
        analysis.get("same_logic_path")
        and analysis.get("same_active_evidence")
        and not analysis.get("semantic_progress_detected")
        and not analysis.get("next_focus_narrowed")
    ):
        return True, "The dispute kept the same logical path and unresolved evidence without a new verifiable checkpoint."
    if analysis.get("repeat_dispute_detected"):
        return True, "The dispute repeated the same evidence boundary without semantic progress."
    return False, ""

def _summarize_round(
    state: NegotiationState,
    arbiter_result: dict[str, Any],
    unresolved_gaps: list[str],
    round_analysis: dict[str, Any],
) -> list[dict[str, Any]]:
    summaries = list(state.get("round_summaries", []))
    summaries.append(
        {
            "round": int(state.get("iterations", 1)),
            "proposal_label": state.get("proposal", {}).get("label"),
            "critic_stance": state.get("critique", {}).get("stance"),
            "critic_suggested_label": state.get("critique", {}).get("suggested_label"),
            "consensus_signal": bool(state.get("critique", {}).get("consensus_signal", False)),
            "debate_focus": str(state.get("debate_focus", "")),
            "debate_gaps": list(state.get("debate_gaps", [])),
            "remaining_gaps": unresolved_gaps,
            "arbiter_action": arbiter_result.get("arbiter_action"),
            "decision_reason_type": arbiter_result.get("decision_reason_type"),
            "retry_reason_type": arbiter_result.get("retry_reason_type"),
            "next_focus": arbiter_result.get("next_focus", ""),
            "final_label": arbiter_result.get("final_label"),
            "decision_reason": arbiter_result.get("decision_reason", ""),
            "loop_detected": bool(arbiter_result.get("loop_detected", False)),
            "loop_reason": arbiter_result.get("loop_reason", ""),
            "resolved_evidence_ids": list(arbiter_result.get("resolved_evidence_ids", [])),
            "retained_evidence_ids": list(arbiter_result.get("retained_evidence_ids", [])),
            "new_evidence_ids": list(arbiter_result.get("new_evidence_ids", [])),
            "focus_signature": round_analysis.get("focus_signature", {}),
            "next_focus_signature": round_analysis.get("next_focus_signature", {}),
            "gap_signatures": round_analysis.get("gap_signatures", []),
            "conflict_signature": round_analysis.get("conflict_signature", {}),
            "evidence_refs": round_analysis.get("evidence_refs", []),
            "logic_path_signature": round_analysis.get("logic_path_signature", {}),
            "active_evidence_ids": round_analysis.get("active_evidence_ids", []),
            "resolved_evidence_ids": round_analysis.get("resolved_evidence_ids", []),
            "focus_changed": bool(round_analysis.get("focus_changed", False)),
            "new_evidence_detected": bool(round_analysis.get("new_evidence_detected", False)),
            "repeat_dispute_detected": bool(round_analysis.get("repeat_dispute_detected", False)),
            "semantic_progress_detected": bool(round_analysis.get("semantic_progress_detected", False)),
            "narrowing_delta": round_analysis.get("narrowing_delta", ""),
        }
    )
    return summaries


def _collect_label_semantic_terms(state: NegotiationState) -> set[str]:
    node_data = state.get("node_data", {}) if isinstance(state.get("node_data", {}), dict) else {}
    graph_context = state.get("graph_context", {}) if isinstance(state.get("graph_context", {}), dict) else {}
    vault_context = state.get("vault_context", {}) if isinstance(state.get("vault_context", {}), dict) else {}
    proposal = state.get("proposal", {}) if isinstance(state.get("proposal", {}), dict) else {}
    critique = state.get("critique", {}) if isinstance(state.get("critique", {}), dict) else {}
    properties = node_data.get("properties", {}) if isinstance(node_data.get("properties", {}), dict) else {}

    texts: list[str] = [
        str(node_data.get("name", "")).strip(),
        str(node_data.get("description", "")).strip(),
        str(properties.get("ran", "")).strip(),
        str(properties.get("ti", "")).strip(),
        str(vault_context.get("reason", "")).strip(),
        str(proposal.get("reason", "")).strip(),
        str(critique.get("reason", "")).strip(),
    ]
    texts.extend(str(item).strip() for item in list(vault_context.get("evidence", [])))
    texts.extend(str(item).strip() for item in list(proposal.get("core_evidence", [])))

    for neighbor in list(graph_context.get("neighbors", [])):
        if not isinstance(neighbor, dict):
            continue
        texts.append(str(neighbor.get("name", "")).strip())
        texts.append(str(neighbor.get("description", "")).strip())
    for edge in list(graph_context.get("edges", [])):
        if not isinstance(edge, dict):
            continue
        texts.append(str(edge.get("relation", "")).strip())

    semantic_terms: set[str] = set()
    for text in texts:
        if not text:
            continue
        semantic_terms.update(_extract_semantic_anchor_terms(text))
    return semantic_terms


def _has_direct_label_support(state: NegotiationState, label: str | None) -> bool:
    if label is None:
        return False
    target_terms = _LABEL_SEMANTIC_PRIORS.get(str(label), set())
    if not target_terms:
        return False
    semantic_terms = _collect_label_semantic_terms(state)
    if not (semantic_terms & target_terms):
        return False

    node_data = state.get("node_data", {}) if isinstance(state.get("node_data", {}), dict) else {}
    properties = node_data.get("properties", {}) if isinstance(node_data.get("properties", {}), dict) else {}
    proposal = state.get("proposal", {}) if isinstance(state.get("proposal", {}), dict) else {}
    vault_context = state.get("vault_context", {}) if isinstance(state.get("vault_context", {}), dict) else {}
    direct_support_sources = [
        str(node_data.get("description", "")).strip(),
        str(properties.get("ran", "")).strip(),
        str(properties.get("ti", "")).strip(),
    ]
    direct_support_sources.extend(str(item).strip() for item in list(proposal.get("core_evidence", [])))
    direct_support_sources.extend(str(item).strip() for item in list(vault_context.get("evidence", [])))
    return any(source for source in direct_support_sources)


def _can_finalize_evidence_closed(
    state: NegotiationState,
    proposal_label: str | None,
    *,
    explicit_conflict: bool,
) -> bool:
    if proposal_label is None or explicit_conflict:
        return False
    active_evidence = [item for item in list(state.get("persistent_evidence", [])) if item.get("status") == "active"]
    if active_evidence:
        return False
    return _has_direct_label_support(state, proposal_label)


def _calibrate_evaluation_scores(state: NegotiationState, evaluation: dict[str, Any]) -> dict[str, Any]:
    calibrated = dict(evaluation)
    round_summaries = list(state.get("round_summaries", []))
    latest_round = round_summaries[-1] if round_summaries else {}
    active_evidence = [item for item in list(state.get("persistent_evidence", [])) if item.get("status") == "active"]
    loop_detected = bool(state.get("loop_detected")) or bool(latest_round.get("repeat_dispute_detected"))
    focus_changed = bool(latest_round.get("focus_changed"))
    new_evidence_detected = bool(latest_round.get("new_evidence_detected"))
    decision_reason_type = str(latest_round.get("decision_reason_type", "")).strip()

    penalty = min(len(active_evidence), 2) * 0.08
    if loop_detected:
        penalty += 0.08
    if decision_reason_type != "evidence_closed":
        if not focus_changed:
            penalty += 0.04
        if not new_evidence_detected:
            penalty += 0.03

    for key in (
        "confidence_score",
        "consensus_stability_score",
        "evidence_strength_score",
        "logic_consistency_score",
        "semantic_fit_score",
    ):
        raw = float(calibrated.get(key, 0.0))
        capped = min(raw, 0.93)
        calibrated[key] = round(max(0.0, min(1.0, capped - penalty)), 3)

    if penalty >= 0.12:
        opinion = str(calibrated.get("audit_opinion", "")).strip()
        if opinion and "audit risk adjusted" not in opinion:
            calibrated["audit_opinion"] = f"{opinion}; audit risk adjusted."
    return calibrated


class NegotiationAgents:
    def __init__(
        self,
        llm: Any,
        *,
        fallback_llm: Any | None = None,
        retry_policy: LLMRetryConfig | None = None,
        min_rounds: int = 2,
        max_rounds: int = 5,
    ) -> None:
        self.llm = llm
        self.fallback_llm = fallback_llm
        self.retry_policy = retry_policy or LLMRetryConfig()
        self.min_rounds = int(min_rounds)
        self.max_rounds = int(max_rounds)
        if self.min_rounds < 1:
            self.min_rounds = 1
        if self.max_rounds < self.min_rounds:
            self.max_rounds = self.min_rounds

    def _raise_execution_error(
        self,
        *,
        state: NegotiationState,
        agent_name: str,
        stage: str,
        message: str,
        raw_response: Any,
        prompt_name: str,
    ) -> None:
        error = NegotiationExecutionError(
            node_id=state.get("node_data", {}).get("node_id"),
            agent_name=agent_name,
            stage=stage,
            iteration=int(state.get("iterations", 1)),
            message=message,
            raw_response=raw_response,
            prompt_name=prompt_name,
        )
        _record_error(state, error)
        raise error

    def _invoke_agent(
        self,
        *,
        agent_name: str,
        payload: dict[str, Any],
        state: NegotiationState,
    ) -> dict[str, Any]:
        prompt_name = f"{agent_name}_system"
        prompt = load_system_prompt(agent_name, min_rounds=self.min_rounds, max_rounds=self.max_rounds)

        if self.llm is None:
            self._raise_execution_error(
                state=state,
                agent_name=agent_name,
                stage="llm_invoke",
                message="No usable LLM instance provided.",
                raw_response=None,
                prompt_name=prompt_name,
            )

        def _invoke_client(client: Any) -> Any:
            if SystemMessage is not None and HumanMessage is not None:
                response = client.invoke(
                    [
                        SystemMessage(content=prompt),
                        HumanMessage(
                            content=(
                                "Return strict JSON only. No Markdown, no extra commentary."
                                f"\nagent_name={agent_name}\ninput={json.dumps(payload, ensure_ascii=False)}"
                            )
                        ),
                    ]
                )
            else:
                response = client.invoke(
                    f"{prompt}\nReturn strict JSON only.\n{json.dumps(payload, ensure_ascii=False)}"
                )
            return getattr(response, "content", response)

        if hasattr(self.llm, "generate_json"):
            call = lambda: self.llm.generate_json(agent_name, payload)
            fallback_call = (
                (lambda: self.fallback_llm.generate_json(agent_name, payload))
                if self.fallback_llm is not None and hasattr(self.fallback_llm, "generate_json")
                else None
            )
        elif hasattr(self.llm, "invoke"):
            call = lambda: _invoke_client(self.llm)
            fallback_call = (
                (lambda: _invoke_client(self.fallback_llm))
                if self.fallback_llm is not None and hasattr(self.fallback_llm, "invoke")
                else None
            )
        else:
            self._raise_execution_error(
                state=state,
                agent_name=agent_name,
                stage="llm_invoke",
                message="LLM object supports neither generate_json nor invoke.",
                raw_response=None,
                prompt_name=prompt_name,
            )

        trace_metadata: dict[str, Any] = {}
        raw_response: Any = invoke_llm_with_retry(
            call=call,
            fallback_call=fallback_call,
            node_id=state.get("node_data", {}).get("node_id"),
            agent_name=agent_name,
            stage="llm_invoke",
            iteration=int(state.get("iterations", 1)),
            prompt_name=prompt_name,
            max_attempts=max(1, int(self.retry_policy.max_attempts)),
            base_delay_seconds=float(self.retry_policy.base_delay_seconds),
            max_delay_seconds=float(self.retry_policy.max_delay_seconds),
            jitter_seconds=float(self.retry_policy.jitter_seconds),
            primary_model=_resolve_model_name(self.llm),
            fallback_model=_resolve_model_name(self.fallback_llm),
            trace_metadata=trace_metadata,
        )
        _append_llm_trace(
            state,
            agent_name=agent_name,
            stage="llm_invoke",
            iteration=int(state.get("iterations", 1)),
            prompt_name=prompt_name,
            trace_metadata=trace_metadata,
        )

        try:
            parsed = _extract_json(raw_response)
        except Exception as exc:
            self._raise_execution_error(
                state=state,
                agent_name=agent_name,
                stage="json_parse",
                message=f"JSON parse failed: {exc}",
                raw_response=raw_response,
                prompt_name=prompt_name,
            )

        response_model = AGENT_RESPONSE_MODELS[agent_name]
        try:
            validated = response_model.model_validate(parsed)
        except Exception as exc:
            if hasattr(self.llm, "invoke"):
                print(f"  [Schema Repair 寮€濮媇 鑺傜偣={state.get('node_data', {}).get('node_id')} Agent={agent_name} 鍘熷洜={_truncate_text(str(exc), 100)}", flush=True)
                schema_hint = response_model.model_json_schema()
                repair_prompt = (
                    "The previous JSON did not satisfy the required schema. "
                    "Repair it into a complete JSON object that matches the schema exactly. "
                    "Do not explain. Output JSON only."
                    f"\nagent_name={agent_name}"
                    f"\nvalidation_error={exc}"
                    f"\nschema={json.dumps(schema_hint, ensure_ascii=False)}"
                    f"\ninvalid_json={json.dumps(parsed, ensure_ascii=False)}"
                )
                try:
                    def _invoke_repair(client: Any) -> Any:
                        repair_response = client.invoke(
                            [
                                SystemMessage(content=prompt),
                                HumanMessage(content=repair_prompt),
                            ]
                        )
                        return getattr(repair_response, "content", repair_response)

                    repair_trace_metadata: dict[str, Any] = {}
                    repaired_raw = invoke_llm_with_retry(
                        call=lambda: _invoke_repair(self.llm),
                        fallback_call=(
                            (lambda: _invoke_repair(self.fallback_llm))
                            if self.fallback_llm is not None and hasattr(self.fallback_llm, "invoke")
                            else None
                        ),
                        node_id=state.get("node_data", {}).get("node_id"),
                        agent_name=agent_name,
                        stage="schema_repair",
                        iteration=int(state.get("iterations", 1)),
                        prompt_name=prompt_name,
                        max_attempts=max(1, int(self.retry_policy.max_attempts)),
                        base_delay_seconds=float(self.retry_policy.base_delay_seconds),
                        max_delay_seconds=float(self.retry_policy.max_delay_seconds),
                        jitter_seconds=float(self.retry_policy.jitter_seconds),
                        primary_model=_resolve_model_name(self.llm),
                        fallback_model=_resolve_model_name(self.fallback_llm),
                        trace_metadata=repair_trace_metadata,
                    )
                    _append_llm_trace(
                        state,
                        agent_name=agent_name,
                        stage="schema_repair",
                        iteration=int(state.get("iterations", 1)),
                        prompt_name=prompt_name,
                        trace_metadata=repair_trace_metadata,
                    )
                    repaired_parsed = _extract_json(repaired_raw)
                    validated = response_model.model_validate(repaired_parsed)
                    print(f"  [Schema Repair 鎴愬姛] 鑺傜偣={state.get('node_data', {}).get('node_id')} Agent={agent_name}", flush=True)
                except Exception as repair_exc:
                    print(f"  [Schema Repair 澶辫触] 鑺傜偣={state.get('node_data', {}).get('node_id')} Agent={agent_name} 閿欒={_truncate_text(str(repair_exc), 100)}", flush=True)
                    self._raise_execution_error(
                        state=state,
                        agent_name=agent_name,
                        stage="schema_validate",
                        message=f"{response_model.__name__} validation failed: {exc}",
                        raw_response=parsed,
                        prompt_name=prompt_name,
                    )
            else:
                self._raise_execution_error(
                    state=state,
                    agent_name=agent_name,
                    stage="schema_validate",
                    message=f"{response_model.__name__} validation failed: {exc}",
                    raw_response=parsed,
                    prompt_name=prompt_name,
                )
        return validated.model_dump(mode="json")
    def proposer_agent(self, state: NegotiationState) -> NegotiationState:
        proposal = self._invoke_agent(
            agent_name="proposer",
            payload={
                "evidence_pack": _build_evidence_pack(state),
                "working_memory": _build_working_memory(state),
                "last_critique": state.get("critique"),
                "iteration": state.get("iterations", 1),
            },
            state=state,
        )
        updated_state = _with_updates(state, proposal=proposal)
        return {
            "proposal": proposal,
            "history": _append_history(state, "proposer", proposal),
            "working_memory": _build_working_memory(updated_state),
            "evidence_pack": _build_evidence_pack(updated_state),
        }

    def critic_agent(self, state: NegotiationState) -> NegotiationState:
        critique = self._invoke_agent(
            agent_name="critic",
            payload={
                "evidence_pack": _build_evidence_pack(state),
                "working_memory": _build_working_memory(state),
                "proposal": state.get("proposal", {}),
                "iteration": state.get("iterations", 1),
            },
            state=state,
        )
        updated_state = _with_updates(state, critique=critique)
        return {
            "critique": critique,
            "history": _append_history(state, "critic", critique),
            "working_memory": _build_working_memory(updated_state),
            "evidence_pack": _build_evidence_pack(updated_state),
        }

    def arbiter_node(self, state: NegotiationState) -> NegotiationState:
        iterations = int(state.get("iterations", 1))
        unresolved_gaps = _build_unresolved_gaps(state)
        next_focus = _resolve_retry_focus(state, unresolved_gaps)
        evidence_sync = _sync_persistent_evidence(state, unresolved_gaps, next_focus)
        state_for_arbiter = _with_updates(
            state,
            persistent_evidence=evidence_sync["persistent_evidence"],
            resolved_evidence=evidence_sync["resolved_evidence"],
            evidence_events=evidence_sync["evidence_events"],
        )
        round_analysis = _analyze_round_progress(state_for_arbiter, unresolved_gaps, next_focus)
        local_loop_detected, local_loop_reason = _detect_repeat_loop(round_analysis)

        arbiter_result = self._invoke_agent(
            agent_name="arbiter",
            payload={
                "evidence_pack": _build_evidence_pack(state_for_arbiter),
                "working_memory": _build_working_memory(state_for_arbiter),
                "proposal": state.get("proposal", {}),
                "critique": state.get("critique", {}),
                "iteration": iterations,
            },
            state=state_for_arbiter,
        )

        proposal_label = state.get("proposal", {}).get("label")
        critique = state.get("critique", {})
        critique_suggested = critique.get("suggested_label")
        consensus_signal = bool(critique.get("consensus_signal", False))
        explicit_conflict = bool(
            critique.get("stance") == "\u53cd\u5bf9"
            or (critique_suggested is not None and critique_suggested != proposal_label)
        )

        loop_detected = bool(arbiter_result.get("loop_detected", False)) or local_loop_detected
        loop_reason = str(arbiter_result.get("loop_reason", "")).strip() or local_loop_reason
        default_retained_ids = list(evidence_sync.get("active_evidence_ids", []))
        default_new_ids = list(evidence_sync.get("new_evidence_ids", []))
        default_resolved_ids = list(evidence_sync.get("implicitly_resolved_ids", []))

        if iterations < self.min_rounds:
            arbiter_result = {
                "arbiter_action": "retry",
                "decision_reason_type": "min_round_enforcement",
                "final_label": None,
                "case_closed": False,
                "loop_detected": loop_detected,
                "loop_reason": loop_reason,
                "decision_reason": "Round 1 is reserved for one directed follow-up before closure.",
                "next_focus": next_focus,
                "retry_reason_type": "min_round_enforcement",
                "consensus_status": "continue_review",
                "resolved_evidence_ids": [],
                "retained_evidence_ids": default_retained_ids,
                "new_evidence_ids": default_new_ids,
            }
        elif iterations >= self.max_rounds:
            arbiter_result = {
                "arbiter_action": "finalize",
                "decision_reason_type": "forced_finalization",
                "final_label": arbiter_result.get("final_label") or critique_suggested or proposal_label,
                "case_closed": True,
                "loop_detected": loop_detected,
                "loop_reason": loop_reason,
                "decision_reason": f"Round {self.max_rounds} is the hard stop, so the case is closed with the closest supported label.",
                "next_focus": "",
                "retry_reason_type": None,
                "consensus_status": "forced_finalization",
                "resolved_evidence_ids": list(arbiter_result.get("resolved_evidence_ids", [])),
                "retained_evidence_ids": default_retained_ids,
                "new_evidence_ids": default_new_ids,
            }
        elif loop_detected:
            arbiter_result = {
                "arbiter_action": "finalize",
                "decision_reason_type": "repeat_conflict",
                "final_label": arbiter_result.get("final_label") or critique_suggested or proposal_label,
                "case_closed": True,
                "loop_detected": True,
                "loop_reason": loop_reason,
                "decision_reason": "The dispute repeated the same evidence boundary without a new verifiable check point.",
                "next_focus": "",
                "retry_reason_type": None,
                "consensus_status": "closed_repeat_conflict",
                "resolved_evidence_ids": list(arbiter_result.get("resolved_evidence_ids", [])),
                "retained_evidence_ids": default_retained_ids,
                "new_evidence_ids": default_new_ids,
            }
        else:
            if _can_finalize_evidence_closed(
                state_for_arbiter,
                proposal_label,
                explicit_conflict=explicit_conflict,
            ):
                arbiter_result = {
                    "arbiter_action": "finalize",
                    "decision_reason_type": "evidence_closed",
                    "final_label": arbiter_result.get("final_label") or proposal_label,
                    "case_closed": True,
                    "loop_detected": False,
                    "loop_reason": "",
                    "decision_reason": "Previously active evidence gaps are now covered by verifiable checkpoints, and the current label has direct positive support.",
                    "next_focus": "",
                    "retry_reason_type": None,
                    "consensus_status": "closed_evidence_closed",
                    "resolved_evidence_ids": default_resolved_ids,
                    "retained_evidence_ids": default_retained_ids,
                    "new_evidence_ids": default_new_ids,
                }
            else:
                should_retry = (
                    iterations < self.max_rounds
                    and (explicit_conflict or unresolved_gaps or not consensus_signal)
                    and bool(round_analysis.get("semantic_progress_detected"))
                    and bool(round_analysis.get("next_focus_narrowed"))
                    and bool(round_analysis.get("verifiable_next_focus"))
                )
                if should_retry:
                    arbiter_result = {
                        "arbiter_action": "retry",
                        "decision_reason_type": "conflict_unresolved" if explicit_conflict else "evidence_gap",
                        "final_label": None,
                        "case_closed": False,
                        "loop_detected": False,
                        "loop_reason": "",
                        "decision_reason": "A new evidence checkpoint appeared and the dispute narrowed enough to justify one last review round.",
                        "next_focus": next_focus,
                        "retry_reason_type": "conflict_unresolved" if explicit_conflict else "evidence_gap",
                        "consensus_status": "continue_review",
                        "resolved_evidence_ids": default_resolved_ids + list(arbiter_result.get("resolved_evidence_ids", [])),
                        "retained_evidence_ids": default_retained_ids,
                        "new_evidence_ids": default_new_ids,
                    }
                else:
                    if round_analysis.get("same_conflict_type") and not round_analysis.get("semantic_progress_detected"):
                        decision_reason_type = "repeat_conflict"
                        decision_reason = "The label conflict stayed on the same logical path and produced no semantic progress."
                    elif not round_analysis.get("new_evidence_detected"):
                        decision_reason_type = "no_new_evidence"
                        decision_reason = "No new evidence references were added in this round, so another debate round would be mechanical."
                    else:
                        decision_reason_type = "focus_not_narrowed"
                        decision_reason = "The next focus did not narrow to a more specific check point, so the case is ready for closure."
                    arbiter_result = {
                        "arbiter_action": "finalize",
                        "decision_reason_type": decision_reason_type,
                        "final_label": arbiter_result.get("final_label") or critique_suggested or proposal_label,
                        "case_closed": True,
                        "loop_detected": False,
                        "loop_reason": "",
                        "decision_reason": decision_reason,
                        "next_focus": "",
                        "retry_reason_type": None,
                        "consensus_status": "closed",
                        "resolved_evidence_ids": default_resolved_ids + list(arbiter_result.get("resolved_evidence_ids", [])),
                        "retained_evidence_ids": default_retained_ids,
                        "new_evidence_ids": default_new_ids,
                    }

        try:
            validated = ArbiterPayload.model_validate(arbiter_result).model_dump(mode="json")
        except Exception as exc:
            self._raise_execution_error(
                state=state_for_arbiter,
                agent_name="arbiter",
                stage="arbiter_contract",
                message=f"Arbiter contract validation failed: {exc}",
                raw_response=arbiter_result,
                prompt_name="arbiter_system",
            )

        evidence_resolution = _apply_arbiter_evidence_resolution(state_for_arbiter, validated)
        resolved_state = _with_updates(
            state_for_arbiter,
            persistent_evidence=evidence_resolution["persistent_evidence"],
            resolved_evidence=evidence_resolution["resolved_evidence"],
            evidence_events=evidence_resolution["evidence_events"],
        )
        history = _append_history(resolved_state, "arbiter", validated)
        round_summaries = _summarize_round(resolved_state, validated, unresolved_gaps, round_analysis)
        updated_state = _with_updates(
            resolved_state,
            history=history,
            round_summaries=round_summaries,
            arbiter_action=validated["arbiter_action"],
            arbiter_summary=str(validated["decision_reason"]).strip(),
            case_closed=bool(validated["case_closed"]),
            loop_detected=bool(validated["loop_detected"]),
            loop_reason=str(validated["loop_reason"]),
            final_label=validated["final_label"],
            debate_focus=str(validated["next_focus"]).strip() if validated["arbiter_action"] == "retry" else "",
            debate_gaps=unresolved_gaps,
        )

        common_payload = {
            "history": history,
            "arbiter_summary": str(validated["decision_reason"]).strip(),
            "loop_detected": bool(validated["loop_detected"]),
            "loop_reason": str(validated["loop_reason"]),
            "debate_gaps": unresolved_gaps,
            "round_summaries": round_summaries,
            "working_memory": _build_working_memory(updated_state),
            "evidence_pack": _build_evidence_pack(updated_state),
            "persistent_evidence": evidence_resolution["persistent_evidence"],
            "resolved_evidence": evidence_resolution["resolved_evidence"],
            "evidence_events": evidence_resolution["evidence_events"],
        }

        if validated["arbiter_action"] == "retry":
            return {
                **common_payload,
                "consensus_reached": False,
                "arbiter_action": "retry",
                "case_closed": False,
                "iterations": iterations + 1,
                "debate_focus": str(validated["next_focus"]).strip(),
            }

        return {
            **common_payload,
            "consensus_reached": consensus_signal and not explicit_conflict and not unresolved_gaps,
            "arbiter_action": "finalize",
            "final_label": validated["final_label"],
            "case_closed": bool(validated["case_closed"]),
            "debate_focus": "",
        }

    def evaluator_agent(self, state: NegotiationState) -> NegotiationState:
        evaluation = self._invoke_agent(
            agent_name="evaluator",
            payload={
                "evidence_pack": _build_evidence_pack(state),
                "working_memory": _build_working_memory(state),
                "arbiter_summary": state.get("arbiter_summary", ""),
                "final_label": state.get("final_label"),
            },
            state=state,
        )
        evaluation = _calibrate_evaluation_scores(state, evaluation)
        updated_state = _with_updates(state, evaluation_report=evaluation)
        return {
            "history": _append_history(state, "evaluator", evaluation),
            "confidence_score": evaluation["confidence_score"],
            "evaluation_report": evaluation,
            "working_memory": _build_working_memory(updated_state),
            "evidence_pack": _build_evidence_pack(updated_state),
        }
















