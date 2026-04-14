from __future__ import annotations

from langgraph.errors import NodeInterrupt

from ontology_audit_hub.domain.audit.models import AuditMode, HumanDecision, HumanInputCard
from ontology_audit_hub.graphs.state import GraphState
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter, StructuredLLMAdapter

_AUDIT_MODES = {mode.value for mode in AuditMode}
_REPLAYABLE_RESPONSE_IDS = {"accept_relation", "reject_relation"}


def make_human_input_node(
    interrupt_on_human: bool = False,
    llm_adapter: StructuredLLMAdapter | None = None,
):
    llm_adapter = llm_adapter or NullStructuredLLMAdapter()

    def human_input_node(state: GraphState) -> GraphState:
        human_response = state.get("human_response")
        human_card = state.get("human_card")
        if human_response is not None:
            return apply_resumed_human_response(state, human_response)
        if human_card is None:
            human_card = HumanInputCard(
                title="Human input required",
                question="The audit needs clarification before it can be finalized.",
                context=state["request"].user_request,
                options=[],
            )
        try:
            human_card = llm_adapter.enhance_human_input_card(
                human_card,
                context={"current_phase": state.get("current_phase", ""), "user_request": state["request"].user_request},
            )
        except Exception:
            pass
        if interrupt_on_human:
            raise NodeInterrupt(
                {
                    "session_id": state.get("session_id"),
                    "resume_token": state.get("resume_token"),
                    "current_phase": "human_input",
                    "human_card": human_card.model_dump(mode="json"),
                }
            )
        return {
            **state,
            "current_phase": "human_input",
            "needs_human_input": True,
            "human_card": human_card,
            "resume_after_human_input": False,
        }

    return human_input_node


def apply_resumed_human_response(state: GraphState, human_response: HumanDecision) -> GraphState:
    selected_value = _selected_human_value(human_response)
    if selected_value in _AUDIT_MODES:
        rerun_state = _state_for_rerun(state, keep_human_response=False)
        rerun_state.update(
            {
                "audit_mode": selected_value,
                "intent_label": selected_value,
                "intent_confidence": 1.0,
            }
        )
        return rerun_state
    if selected_value in _REPLAYABLE_RESPONSE_IDS or (
        human_response.selected_option_id is not None and ":" in human_response.selected_option_id
    ):
        return _state_for_rerun(state, keep_human_response=True)
    return {
        **state,
        "current_phase": "human_input",
        "needs_human_input": False,
        "human_card": None,
        "human_response": None,
        "resume_after_human_input": False,
    }


def _selected_human_value(human_response: HumanDecision) -> str:
    return (human_response.selected_option_id or human_response.response_value or "").strip()


def _state_for_rerun(state: GraphState, *, keep_human_response: bool) -> GraphState:
    return {
        **state,
        "current_phase": "human_input",
        "current_target": "",
        "findings": [],
        "prioritized_findings": [],
        "test_specs": [],
        "test_results": [],
        "generated_test_files": [],
        "retrieval_hits": [],
        "graph_evidence": [],
        "document_claims": [],
        "selected_code_bindings": {},
        "errors": [],
        "final_report": None,
        "needs_human_input": False,
        "human_card": None,
        "human_response": state.get("human_response") if keep_human_response else None,
        "resume_after_human_input": True,
    }
