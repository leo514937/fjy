from __future__ import annotations

import json
import sys
import types

from ontology_audit_hub.domain.audit.models import ChatHistoryMessage, QAGraphHit, RetrievalHit
from ontology_audit_hub.infra.llm.pydantic_ai_adapter import PydanticAILLMAdapter


class FakeAgent:
    instances: list[FakeAgent] = []

    def __init__(self, model_name, *, output_type, system_prompt):
        self.model_name = model_name
        self.output_type = output_type
        self.system_prompt = system_prompt
        self.__class__.instances.append(self)

    def run_sync(self, prompt):
        if hasattr(self.output_type, "model_fields") and "query" in self.output_type.model_fields:
            return types.SimpleNamespace(output=self.output_type(query="Payment approval rules"))
        if hasattr(self.output_type, "model_fields") and "use_rag" in self.output_type.model_fields:
            return types.SimpleNamespace(output=self.output_type(use_rag=True, use_graph=False, reason="Need document recall."))
        return types.SimpleNamespace(output=f"agent:{prompt}")


def test_answer_prompt_requires_distinct_r_and_g_citations(monkeypatch) -> None:
    FakeAgent.instances.clear()
    fake_module = types.SimpleNamespace(Agent=FakeAgent)
    monkeypatch.setitem(sys.modules, "pydantic_ai", fake_module)

    adapter = PydanticAILLMAdapter("openai:gpt-4o-mini")
    _, prompt = adapter._build_answer_request(
        question="What does Payment generate?",
        source_results=[],
        route_trace=[],
        rag_hits=[
            RetrievalHit(
                source_file="kb/payment.md",
                section="Rules",
                content="Payments require invoice references.",
                citation_id="R1",
            )
        ],
        graph_hits=[
            QAGraphHit(
                entity="Payment",
                evidence_text="Matched Payment.",
                related_entities=["Invoice"],
                relations=["out:generates:Invoice"],
                citation_id="G1",
            )
        ],
        graph_paths=["Payment -[generates]-> Invoice"],
        warnings=[],
        chat_history=[ChatHistoryMessage(role="user", content="We were discussing Payment.")],
    )

    answer_prompt = FakeAgent.instances[0].system_prompt
    assert "[R1]" in answer_prompt
    assert "[G1]" in answer_prompt
    assert "Never swap a graph citation" in answer_prompt
    assert "Do not mention internal routing" in answer_prompt

    payload = json.loads(prompt)
    assert payload["ChatHistory"][0]["content"] == "We were discussing Payment."
    assert payload["RetrievedKnowledge"]["RagHits"][0]["citation_id"] == "R1"
    assert payload["RetrievedKnowledge"]["GraphHits"][0]["citation_id"] == "G1"
    assert "AnswerMode" not in payload


def test_short_queries_use_unified_answer_agent_without_forced_clarification(monkeypatch) -> None:
    FakeAgent.instances.clear()
    fake_module = types.SimpleNamespace(Agent=FakeAgent)
    monkeypatch.setitem(sys.modules, "pydantic_ai", fake_module)

    adapter = PydanticAILLMAdapter("openai:gpt-4o-mini")
    answer = adapter.answer_question(
        "bb",
        source_results=[],
        route_trace=[],
        rag_hits=[],
        graph_hits=[],
        graph_paths=[],
        warnings=[],
        chat_history=[],
    )

    assert answer is not None
    assert answer.startswith("agent:")
    assert len(FakeAgent.instances) == 2


def test_retrieval_decision_uses_structured_agent(monkeypatch) -> None:
    FakeAgent.instances.clear()
    fake_module = types.SimpleNamespace(Agent=FakeAgent)
    monkeypatch.setitem(sys.modules, "pydantic_ai", fake_module)

    adapter = PydanticAILLMAdapter("openai:gpt-4o-mini")
    use_rag, use_graph, reason = adapter.decide_qa_retrieval(
        "What about its approval rules?",
        chat_history=[ChatHistoryMessage(role="user", content="We were just discussing Payment.")],
        rag_available=True,
        graph_available=True,
        explicit_rag=False,
        explicit_graph=False,
    )

    assert use_rag is True
    assert use_graph is False
    assert reason == "Need document recall."
    retrieval_prompt = FakeAgent.instances[1].system_prompt
    assert "Decide whether external retrieval should run" in retrieval_prompt


def test_rewrite_query_for_retrieval_uses_structured_agent(monkeypatch) -> None:
    FakeAgent.instances.clear()
    fake_module = types.SimpleNamespace(Agent=FakeAgent)
    monkeypatch.setitem(sys.modules, "pydantic_ai", fake_module)

    adapter = PydanticAILLMAdapter("openai:gpt-4o-mini")
    rewritten = adapter.rewrite_query_for_retrieval(
        "What about its approval rules?",
        chat_history=[ChatHistoryMessage(role="user", content="We were just discussing Payment.")],
    )

    assert rewritten is not None
    rewrite_prompt = FakeAgent.instances[-1].system_prompt
    assert "Rewrite the user question into one concise retrieval query" in rewrite_prompt
