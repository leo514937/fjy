from __future__ import annotations

import re

from ontology_audit_hub.domain.audit.models import AuditMode, HumanInputCard, HumanInputOption
from ontology_audit_hub.graphs.state import GraphState
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter, StructuredLLMAdapter

FULL_KEYWORDS = {"full", "all", "complete", "鍏ㄩ儴", "鍏ㄩ噺", "鏁翠綋"}
ONTOLOGY_KEYWORDS = {"ontology", "schema", "concept", "鏈綋", "瀹炰綋", "鍏崇郴"}
DOCUMENT_KEYWORDS = {"document", "docs", "markdown", "spec", "鏂囨。", "闇€姹?"}
CODE_KEYWORDS = {"code", "implementation", "source", "pytest", "浠ｇ爜", "瀹炵幇", "娴嬭瘯"}


def _contains_keyword(normalized: str, keyword: str) -> bool:
    if keyword.isascii():
        return re.search(rf"\b{re.escape(keyword)}\b", normalized) is not None
    return keyword in normalized


def classify_intent(
    user_request: str,
    explicit_mode: str | None,
    llm_adapter: StructuredLLMAdapter | None = None,
) -> tuple[str, float, HumanInputCard | None]:
    if explicit_mode:
        return explicit_mode, 1.0, None

    normalized = user_request.lower()
    if any(_contains_keyword(normalized, token) for token in FULL_KEYWORDS):
        return AuditMode.FULL.value, 0.95, None

    matches = {
        AuditMode.ONTOLOGY.value: sum(_contains_keyword(normalized, token) for token in ONTOLOGY_KEYWORDS),
        AuditMode.DOCUMENT.value: sum(_contains_keyword(normalized, token) for token in DOCUMENT_KEYWORDS),
        AuditMode.CODE.value: sum(_contains_keyword(normalized, token) for token in CODE_KEYWORDS),
    }
    matched_labels = [label for label, score in matches.items() if score > 0]

    if len(matched_labels) == 1:
        label = matched_labels[0]
        confidence = min(0.9, 0.55 + 0.15 * matches[label])
        if llm_adapter is None or confidence >= 0.75:
            return label, confidence, None
        try:
            llm_result = llm_adapter.classify_intent(user_request, [mode.value for mode in AuditMode])
        except Exception:
            llm_result = None
        if llm_result is not None and llm_result[0] in {mode.value for mode in AuditMode}:
            return llm_result[0], max(confidence, llm_result[1]), None
        return label, confidence, None

    if len(matched_labels) > 1:
        return AuditMode.FULL.value, 0.7, None

    card: HumanInputCard | None = HumanInputCard(
        title="Intent clarification required",
        question="The audit intent is ambiguous. Which path should the supervisor run?",
        context=user_request,
        options=[
            HumanInputOption(
                id=mode.value,
                label=mode.value,
                value=mode.value,
                description=f"Run the {mode.value} audit path.",
            )
            for mode in AuditMode
        ],
    )
    label = "unknown"
    confidence = 0.0
    if llm_adapter is not None:
        try:
            llm_result = llm_adapter.classify_intent(user_request, [mode.value for mode in AuditMode])
        except Exception:
            llm_result = None
        if llm_result is not None and llm_result[0] in {mode.value for mode in AuditMode}:
            label = llm_result[0]
            confidence = llm_result[1]
            card = None
    return label, confidence, card


def make_intent_router_node(llm_adapter: StructuredLLMAdapter | None = None):
    llm_adapter = llm_adapter or NullStructuredLLMAdapter()

    def intent_router_node(state: GraphState) -> GraphState:
        request = state["request"]
        label, confidence, human_card = classify_intent(
            request.user_request,
            state.get("audit_mode") or None,
            llm_adapter=llm_adapter,
        )
        return {
            **state,
            "intent_label": label,
            "intent_confidence": confidence,
            "current_phase": "intent_router",
            "needs_human_input": (
                state.get("needs_human_input", False)
                or request.require_human_review
                or label == "unknown"
            ),
            "human_card": human_card or state.get("human_card"),
        }

    return intent_router_node


def intent_router_node(state: GraphState) -> GraphState:
    return make_intent_router_node()(state)
