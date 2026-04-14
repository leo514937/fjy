from ontology_audit_hub.domain.audit.models import AuditRequest, Finding, HumanInputCard, HumanInputOption, Severity
from ontology_audit_hub.graphs.nodes.finalize_report import make_finalize_report_node
from ontology_audit_hub.graphs.nodes.human_input import make_human_input_node
from ontology_audit_hub.graphs.nodes.intent_router import make_intent_router_node


class FakeLLMAdapter:
    def classify_intent(self, user_request: str, allowed_modes: list[str]):
        return "document", 0.88

    def extract_document_claims(self, chunks, ontology):
        return []

    def enhance_human_input_card(self, card, *, context=None):
        return card.model_copy(update={"title": f"[LLM] {card.title}"})

    def suggest_repairs(self, findings, *, retrieval_hits, graph_evidence, existing_suggestions):
        return existing_suggestions + ["LLM suggestion"]


def test_intent_router_uses_llm_for_ambiguous_requests() -> None:
    node = make_intent_router_node(FakeLLMAdapter())
    state = {"request": AuditRequest(user_request="please inspect this carefully"), "audit_mode": ""}

    result = node(state)

    assert result["intent_label"] == "document"
    assert result["needs_human_input"] is False


def test_human_input_node_uses_llm_to_polish_cards() -> None:
    node = make_human_input_node(interrupt_on_human=False, llm_adapter=FakeLLMAdapter())
    state = {
        "request": AuditRequest(user_request="Need clarification"),
        "human_card": HumanInputCard(
            title="Clarify binding",
            question="Which callable should we use?",
            context="Multiple options were found.",
            options=[HumanInputOption(id="a", label="a", value="a")],
        ),
    }

    result = node(state)

    assert result["human_card"].title.startswith("[LLM]")


def test_finalize_report_uses_llm_repair_suggestions() -> None:
    node = make_finalize_report_node(FakeLLMAdapter())
    finding = Finding(
        finding_type="code_missing_required_fields",
        severity=Severity.HIGH,
        expected="All required fields are present",
        found="amount is missing",
        evidence="Callable parameters are incomplete.",
        fix_hint="Add the amount parameter.",
    )

    result = node({"findings": [finding], "prioritized_findings": [finding], "test_results": []})

    assert "LLM suggestion" in result["final_report"].repair_suggestions
