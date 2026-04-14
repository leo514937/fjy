from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path

from fastapi.testclient import TestClient

from ontology_audit_hub.api import create_app
from ontology_audit_hub.domain.audit.models import QAGraphHit, RetrievalHit
from ontology_audit_hub.infra.checkpointing import SqliteCheckpointStoreFactory
from ontology_audit_hub.infra.graph_augmenter import NullGraphAugmenter
from ontology_audit_hub.infra.human_store import FileHumanInteractionStore
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter
from ontology_audit_hub.infra.qa_sources import QueryRewriteTrace, RAGSearchResult
from ontology_audit_hub.infra.retrieval import NullRetriever
from ontology_audit_hub.infra.runtime import GraphRuntime
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.qa_service import QuestionAnswerService
from ontology_audit_hub.service import SupervisorService


class ReadyLLMAdapter(NullStructuredLLMAdapter):
    def __init__(self, *, answer_prefix: str = "LLM answer", retrieval_decision: tuple[bool, bool, str] | None = None) -> None:
        self.answer_prefix = answer_prefix
        self.retrieval_decision = retrieval_decision
        self.last_kwargs = None

    def check_ready(self) -> tuple[bool, str]:
        return True, "ready"

    def decide_qa_retrieval(
        self,
        question: str,
        *,
        chat_history=None,
        rag_available: bool,
        graph_available: bool,
        explicit_rag: bool = False,
        explicit_graph: bool = False,
    ) -> tuple[bool, bool, str] | None:
        if self.retrieval_decision is not None:
            return self.retrieval_decision
        return None

    def answer_question(
        self,
        question: str,
        *,
        source_results,
        route_trace,
        rag_hits,
        graph_hits,
        graph_paths,
        warnings,
        chat_history=None,
        answer_mode="grounded",
    ) -> str | None:
        self.last_kwargs = {
            "source_results": source_results,
            "route_trace": route_trace,
            "rag_hits": rag_hits,
            "graph_hits": graph_hits,
            "graph_paths": graph_paths,
            "warnings": warnings,
            "chat_history": chat_history,
        }
        return f"{self.answer_prefix}: {question} | rag={len(rag_hits)} | graph={len(graph_hits)}"

    async def stream_answer_question(
        self,
        question: str,
        *,
        source_results,
        route_trace,
        rag_hits,
        graph_hits,
        graph_paths,
        warnings,
        chat_history=None,
        answer_mode="grounded",
    ):
        answer = self.answer_question(
            question,
            source_results=source_results,
            route_trace=route_trace,
            rag_hits=rag_hits,
            graph_hits=graph_hits,
            graph_paths=graph_paths,
            warnings=warnings,
            chat_history=chat_history,
        ) or ""
        midpoint = max(1, len(answer) // 2)
        yield answer[:midpoint]
        yield answer[midpoint:]


class UnavailableLLMAdapter(NullStructuredLLMAdapter):
    def check_ready(self) -> tuple[bool, str]:
        return False, "LLM disabled"


class SlowStreamingLLMAdapter(NullStructuredLLMAdapter):
    def __init__(self) -> None:
        self.started = threading.Event()
        self.waiting = threading.Event()
        self.cancelled = threading.Event()

    def check_ready(self) -> tuple[bool, str]:
        return True, "ready"

    async def stream_answer_question(
        self,
        question: str,
        *,
        source_results,
        route_trace,
        rag_hits,
        graph_hits,
        graph_paths,
        warnings,
        chat_history=None,
        answer_mode="grounded",
    ):
        self.started.set()
        yield "partial"
        try:
            self.waiting.set()
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise


class FakeRAGReader:
    def __init__(
        self,
        *,
        hits: list[RetrievalHit] | None = None,
        error: str | None = None,
        search_result: RAGSearchResult | None = None,
    ) -> None:
        self.hits = hits or []
        self.error = error
        self.search_result = search_result
        self.last_options = None
        self.call_count = 0

    def search(self, reference, query: str, options=None, *, history=None) -> RAGSearchResult:
        self.call_count += 1
        if self.error:
            raise RuntimeError(self.error)
        self.last_options = options
        if self.search_result is not None:
            return self.search_result
        return RAGSearchResult(
            hits=list(self.hits),
            returned_count=len(self.hits),
        )


class FakeGraphReader:
    def __init__(self, *, hits: list[QAGraphHit] | None = None, paths: list[str] | None = None, error: str | None = None) -> None:
        self.hits = hits or []
        self.paths = paths or []
        self.error = error
        self.call_count = 0

    def query(self, reference, question: str, ontology_tags: list[str]) -> tuple[list[QAGraphHit], list[str]]:
        self.call_count += 1
        if self.error:
            raise RuntimeError(self.error)
        return list(self.hits), list(self.paths)


def _make_audit_service(tmp_path: Path) -> SupervisorService:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=False,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    return SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=NullRetriever(),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=False,
        ),
        checkpoint_store_factory=SqliteCheckpointStoreFactory(tmp_path / "checkpoints.sqlite3"),
        human_store=FileHumanInteractionStore(tmp_path / "human"),
    )


def _read_sse_events(response) -> list[tuple[str, dict]]:
    payload = "".join(response.iter_text())
    events: list[tuple[str, dict]] = []
    for chunk in payload.split("\n\n"):
        normalized = chunk.strip()
        if not normalized:
            continue
        event_name = ""
        data_line = ""
        for line in normalized.splitlines():
            if line.startswith("event:"):
                event_name = line.partition(":")[2].strip()
            elif line.startswith("data:"):
                data_line = line.partition(":")[2].strip()
        if event_name and data_line:
            events.append((event_name, json.loads(data_line)))
    return events


def test_qa_answer_uses_graph_and_rag_sources_when_triggered(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(retrieval_decision=(True, True, "Need both document and graph evidence.")),
        rag_reader=FakeRAGReader(
            hits=[
                RetrievalHit(
                    source_file="kb/payment.md",
                    section="Overview",
                    content="Payment records must include payment_id and amount.",
                    ontology_tags=["Payment"],
                    score=0.91,
                )
            ]
        ),
        graph_reader=FakeGraphReader(
            hits=[
                QAGraphHit(
                    entity="Payment",
                    evidence_text="Payment generates Invoice.",
                    related_entities=["Invoice"],
                    relations=["out:generates:Invoice"],
                )
            ],
            paths=["Payment -[generates]-> Invoice"],
        ),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "What does Payment generate?",
            "graph_ref": {
                "backend": "neo4j",
                "uri": "bolt://example",
                "username": "neo4j",
                "password": "password",
                "database": "neo4j",
            },
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
                "top_k": 3,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "route" not in payload
    assert payload["answer"]
    assert [item["status"] for item in payload["source_results"]] == ["processed", "processed"]
    assert payload["evidence"]["rag_hits"]
    assert payload["evidence"]["graph_hits"]
    assert payload["evidence"]["rag_hits"][0]["citation_id"] == "R1"
    assert payload["evidence"]["graph_hits"][0]["citation_id"] == "G1"
    assert any(step["stage"] == "trigger_decision" for step in payload["route_trace"])


def test_qa_answer_uses_normal_llm_conversation_when_no_retrieval_is_triggered(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        settings=AuditHubSettings(
            qdrant_enabled=False,
            neo4j_enabled=False,
            llm_enabled=True,
            llm_model="openai:gpt-4o-mini",
        ),
        llm_adapter=ReadyLLMAdapter(answer_prefix="Direct LLM"),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post("/qa/answer", json={"question": "Summarize the billing domain."})

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"].startswith("Direct LLM:")
    assert [item["status"] for item in payload["source_results"]] == ["skipped", "skipped"]
    assert not any(step["stage"] == "llm_only" for step in payload["route_trace"])
    assert any(step["stage"] == "trigger_decision" for step in payload["route_trace"])

def test_qa_answer_uses_history_as_normal_dialog_context_without_special_route(tmp_path: Path) -> None:
    llm_adapter = ReadyLLMAdapter(answer_prefix="History LLM")
    rag_reader = FakeRAGReader(
        hits=[
            RetrievalHit(
                source_file="kb/payment.md",
                section="Rules",
                content="Payments require invoice references.",
            )
        ]
    )
    graph_reader = FakeGraphReader(
        hits=[
            QAGraphHit(
                entity="Payment",
                evidence_text="Matched Payment.",
                related_entities=["Invoice"],
                relations=["out:generates:Invoice"],
            )
        ],
        paths=["Payment -[generates]-> Invoice"],
    )
    qa_service = QuestionAnswerService(llm_adapter=llm_adapter, rag_reader=rag_reader, graph_reader=graph_reader)
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "What did we discuss?",
            "history": [
                {"role": "user", "content": "We discussed Payment."},
                {"role": "assistant", "content": "You just asked about Payment approval rules."},
            ],
            "graph_ref": {
                "backend": "neo4j",
                "uri": "bolt://example",
                "username": "neo4j",
                "password": "password",
                "database": "neo4j",
            },
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert rag_reader.call_count == 0
    assert graph_reader.call_count == 0
    assert all(item["status"] == "skipped" for item in payload["source_results"])
    assert llm_adapter.last_kwargs is not None
    assert [item.content for item in llm_adapter.last_kwargs["chat_history"]] == [
        "We discussed Payment.",
        "You just asked about Payment approval rules.",
    ]
    assert any("Skipped external retrieval for conversational or recap-style input." in step["detail"] for step in payload["route_trace"])


def test_qa_answer_without_history_still_uses_normal_llm_for_recap_question(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="Clarify LLM"),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post("/qa/answer", json={"question": "What did we discuss?", "history": []})

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"].startswith("Clarify LLM:")
    assert payload["evidence"]["rag_hits"] == []
    assert payload["evidence"]["graph_hits"] == []


def test_qa_answer_can_use_chat_history_and_still_trigger_rag(tmp_path: Path) -> None:
    llm_adapter = ReadyLLMAdapter(answer_prefix="Context LLM", retrieval_decision=(True, False, "Need document recall."))
    rag_reader = FakeRAGReader(
        hits=[
            RetrievalHit(
                source_file="kb/payment.md",
                section="Rules",
                content="Payments require invoice references.",
            )
        ]
    )
    graph_reader = FakeGraphReader()
    qa_service = QuestionAnswerService(llm_adapter=llm_adapter, rag_reader=rag_reader, graph_reader=graph_reader)
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "What about its approval rules?",
            "history": [
                {"role": "user", "content": "We were just discussing Payment."},
                {"role": "assistant", "content": "Okay, let us keep looking at Payment."},
            ],
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
            },
        },
    )

    assert response.status_code == 200
    assert rag_reader.call_count == 1
    assert llm_adapter.last_kwargs is not None
    assert [item.content for item in llm_adapter.last_kwargs["chat_history"]] == [
        "We were just discussing Payment.",
        "Okay, let us keep looking at Payment.",
    ]


def test_qa_answer_uses_normal_llm_for_simple_greeting(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="Greeting LLM"),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post("/qa/answer", json={"question": "hello"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"].startswith("Greeting LLM:")
    assert any(step["stage"] == "trigger_decision" for step in payload["route_trace"])
    assert not payload["evidence"]["rag_hits"]


def test_qa_answer_returns_citation_fallback_when_llm_is_unavailable_but_external_evidence_exists(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        settings=AuditHubSettings(
            qdrant_enabled=False,
            neo4j_enabled=False,
            llm_enabled=False,
        ),
        llm_adapter=UnavailableLLMAdapter(),
        rag_reader=FakeRAGReader(
            hits=[
                RetrievalHit(
                    source_file="kb/payment.md",
                    section="Rules",
                    content="Payment must be positive.",
                    ontology_tags=["Payment"],
                    score=0.77,
                )
            ]
        ),
        graph_reader=FakeGraphReader(
            hits=[
                QAGraphHit(
                    entity="Payment",
                    evidence_text="Payment connects to Invoice.",
                    related_entities=["Invoice"],
                    relations=["out:generates:Invoice"],
                )
            ],
            paths=["Payment -[generates]-> Invoice"],
        ),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "What does Payment generate?",
            "graph_ref": {
                "backend": "neo4j",
                "uri": "bolt://example",
                "username": "neo4j",
                "password": "password",
                "database": "neo4j",
            },
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "[R1]" in payload["answer"]
    assert "[G1]" in payload["answer"]
    assert payload["source_results"][0]["status"] == "processed"
    assert payload["source_results"][1]["status"] == "processed"


def test_qa_answer_returns_503_when_llm_and_external_evidence_are_both_unavailable(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=UnavailableLLMAdapter(),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post("/qa/answer", json={"question": "Explain the ontology."})

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "error"
    assert "Unable to answer" in payload["message"]
    assert any(step["stage"] == "synthesize_answer" for step in payload["route_trace"])


def test_qa_answer_degrades_when_rag_query_fails_but_llm_can_still_answer(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(retrieval_decision=(True, False, "Need document recall.")),
        rag_reader=FakeRAGReader(error="qdrant offline"),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "Tell me about payments.",
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"]
    assert payload["source_results"][1]["status"] == "degraded"
    assert any("RAG query failed" in warning for warning in payload["warnings"])

def test_qa_answer_records_warning_when_triggered_sources_return_no_hits(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="Fallback LLM", retrieval_decision=(True, True, "Need both channels.")),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "What is the approval flow?",
            "graph_ref": {
                "backend": "neo4j",
                "uri": "bolt://example",
                "username": "neo4j",
                "password": "password",
                "database": "neo4j",
            },
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"].startswith("Fallback LLM:")
    assert any("did not return usable evidence" in warning for warning in payload["warnings"])


def test_qa_answer_emits_query_rewrite_and_hybrid_route_trace(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="Hybrid LLM", retrieval_decision=(True, False, "Need document recall.")),
        rag_reader=FakeRAGReader(
            search_result=RAGSearchResult(
                hits=[
                    RetrievalHit(
                        source_file="kb/payment.md",
                        section="Rules",
                        content="Payments require invoice references.",
                        citation_id="R1",
                        metadata={"retrieval_channels": ["dense", "sparse"]},
                    )
                ],
                returned_count=1,
                search_mode="hybrid_rrf_mmr",
                dense_candidate_count=3,
                sparse_candidate_count=2,
                fusion_candidate_count=4,
                rewrite=QueryRewriteTrace(
                    retrieval_query="Payment approval rules",
                    status="processed",
                    applied=True,
                    detail="Query rewrite expanded the retrieval query with recent chat context.",
                ),
                warnings=["Sparse recall failed over one stale chunk."],
            )
        ),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "What about its approval rules?",
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
            },
            "history": [
                {"role": "user", "content": "We were just discussing Payment."},
                {"role": "assistant", "content": "Okay, I will keep answering about Payment."},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    route_by_stage = {item["stage"]: item for item in payload["route_trace"]}
    assert route_by_stage["query_rewrite"]["status"] == "processed"
    assert route_by_stage["sparse_recall"]["status"] == "processed"
    assert route_by_stage["rank_fusion"]["status"] == "processed"
    assert any("Sparse recall failed" in warning for warning in payload["warnings"])


def test_qa_answer_appends_rag_citations_when_llm_omits_them(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="Citation LLM"),
        rag_reader=FakeRAGReader(
            hits=[
                RetrievalHit(
                    source_file="kb/gta.md",
                    section="Benchmark",
                    content="GTA evaluates real-world tool-use workflows.",
                    citation_id="R1",
                )
            ]
        ),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "Please explain how GTA Benchmark evaluates tool-use workflows.",
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "[R1]" in payload["answer"]
    assert payload["evidence"]["rag_hits"][0]["citation_id"] == "R1"


def test_qa_answer_stream_appends_rag_citations_when_llm_omits_them(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="Stream Citation LLM"),
        rag_reader=FakeRAGReader(
            hits=[
                RetrievalHit(
                    source_file="kb/gta.md",
                    section="Benchmark",
                    content="GTA evaluates real-world tool-use workflows.",
                    citation_id="R1",
                )
            ]
        ),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    with client.stream(
        "POST",
        "/qa/answer/stream",
        json={
            "question": "Please explain how GTA Benchmark evaluates tool-use workflows.",
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
            },
        },
    ) as response:
        assert response.status_code == 200
        events = _read_sse_events(response)

    complete_payload = events[-1][1]
    assert complete_payload["answer"].startswith("Stream Citation LLM:")
    assert "[R1]" in complete_payload["answer"]
    assert complete_payload["evidence"]["rag_hits"][0]["citation_id"] == "R1"


def test_qa_answer_returns_400_for_invalid_request_payload(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post("/qa/answer", json={"question": ""})

    assert response.status_code == 400
    payload = response.json()
    assert payload["status"] == "error"
    assert payload["message"] == "Invalid QA request."


def test_qa_answer_uses_session_memory_when_history_is_not_provided(tmp_path: Path) -> None:
    llm_adapter = ReadyLLMAdapter(answer_prefix="Session LLM")
    qa_service = QuestionAnswerService(
        llm_adapter=llm_adapter,
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    first = client.post(
        "/qa/answer",
        json={"session_id": "session-1", "question": "We are discussing Payment approvals."},
    )
    assert first.status_code == 200

    second = client.post(
        "/qa/answer",
        json={"session_id": "session-1", "question": "What about it?"},
    )

    assert second.status_code == 200
    assert llm_adapter.last_kwargs is not None
    assert [item.content for item in llm_adapter.last_kwargs["chat_history"]] == [
        "We are discussing Payment approvals.",
        "Session LLM: We are discussing Payment approvals. | rag=0 | graph=0",
    ]


def test_qa_answer_explicit_history_overrides_existing_session_memory(tmp_path: Path) -> None:
    llm_adapter = ReadyLLMAdapter(answer_prefix="Override LLM")
    qa_service = QuestionAnswerService(
        llm_adapter=llm_adapter,
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    warmup = client.post(
        "/qa/answer",
        json={"session_id": "session-2", "question": "Remember the Invoice flow."},
    )
    assert warmup.status_code == 200

    response = client.post(
        "/qa/answer",
        json={
            "session_id": "session-2",
            "question": "What did we discuss?",
            "history": [
                {"role": "user", "content": "We discussed Payment only."},
                {"role": "assistant", "content": "Yes, only Payment was in scope."},
            ],
        },
    )

    assert response.status_code == 200
    assert llm_adapter.last_kwargs is not None
    assert [item.content for item in llm_adapter.last_kwargs["chat_history"]] == [
        "We discussed Payment only.",
        "Yes, only Payment was in scope.",
    ]


def test_qa_answer_stream_emits_status_and_answer_chunks(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="Stream LLM"),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    with client.stream("POST", "/qa/answer/stream", json={"question": "Summarize the billing domain."}) as response:
        assert response.status_code == 200
        events = _read_sse_events(response)

    event_names = [event for event, _ in events]
    assert event_names[0] == "status"
    assert "context" in event_names
    assert "answer_delta" in event_names
    assert event_names[-1] == "complete"
    complete_payload = events[-1][1]
    assert "route" not in complete_payload
    assert complete_payload["answer"].startswith("Stream LLM:")


def test_qa_answer_stream_uses_normal_llm_for_simple_greeting(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="Stream LLM"),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    with client.stream("POST", "/qa/answer/stream", json={"question": "hello"}) as response:
        assert response.status_code == 200
        events = _read_sse_events(response)

    event_names = [event for event, _ in events]
    assert event_names[0] == "status"
    assert "answer_delta" in event_names
    assert events[-1][0] == "complete"
    assert "route" not in events[-1][1]
    assert events[-1][1]["answer"].startswith("Stream LLM:")


def test_qa_answer_stream_emits_error_event_when_no_evidence_and_llm_is_unavailable(tmp_path: Path) -> None:
    qa_service = QuestionAnswerService(
        llm_adapter=UnavailableLLMAdapter(),
        rag_reader=FakeRAGReader(),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    with client.stream("POST", "/qa/answer/stream", json={"question": "Explain the ontology."}) as response:
        assert response.status_code == 200
        events = _read_sse_events(response)

    assert [event for event, _ in events][-1] == "error"
    assert "Unable to answer" in events[-1][1]["message"]


def test_qa_answer_cancel_endpoint_cancels_active_stream_task(tmp_path: Path) -> None:
    app = create_app(
        service=_make_audit_service(tmp_path),
        qa_service=QuestionAnswerService(
            llm_adapter=SlowStreamingLLMAdapter(),
            rag_reader=FakeRAGReader(),
            graph_reader=FakeGraphReader(),
        ),
    )
    stream_client = TestClient(app)
    control_client = TestClient(app)
    adapter = app.state.qa_service.llm_adapter
    stream_done = threading.Event()

    def consume_stream() -> None:
        try:
            with stream_client.stream(
                "POST",
                "/qa/answer/stream",
                json={"question": "Explain payments", "request_id": "req-cancel"},
            ) as response:
                assert response.status_code == 200
                for _ in response.iter_text():
                    pass
        finally:
            stream_done.set()

    thread = threading.Thread(target=consume_stream, daemon=True)
    thread.start()

    assert adapter.started.wait(timeout=5)
    assert adapter.waiting.wait(timeout=5)
    response = control_client.post("/qa/answer/cancel", json={"request_id": "req-cancel"})
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"

    assert adapter.cancelled.wait(timeout=5)
    stream_client.close()
    control_client.close()


def test_qa_answer_applies_rag_options_and_exposes_rag_route_trace(tmp_path: Path) -> None:
    rag_reader = FakeRAGReader(
        hits=[
            RetrievalHit(
                source_file="kb/payment.md",
                section="Rules",
                content="Payments require invoice references and approval tokens.",
                source_id="payments-doc",
                heading_path=["Rules"],
                token_count=18,
                dense_score=0.88,
                score=0.88,
            )
        ]
    )
    qa_service = QuestionAnswerService(
        llm_adapter=ReadyLLMAdapter(answer_prefix="RAG LLM", retrieval_decision=(True, False, "Need document recall.")),
        rag_reader=rag_reader,
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post(
        "/qa/answer",
        json={
            "question": "What does a payment require?",
            "rag_ref": {
                "backend": "qdrant",
                "url": "http://qdrant:6333",
                "collection_name": "knowledge",
                "top_k": 5,
            },
            "rag_options": {
                "candidate_pool": 12,
                "top_k": 4,
                "max_context_chunks": 3,
                "enable_graph_context": False,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert rag_reader.last_options is not None
    assert rag_reader.last_options.candidate_pool == 12
    assert any(step["stage"] == "dense_recall" for step in payload["route_trace"])
    assert any(step["stage"] == "mmr_rerank" for step in payload["route_trace"])
    assert any(step["stage"] == "pack_context" for step in payload["route_trace"])
    assert any(step["stage"] == "graph_enrichment" and step["status"] == "skipped" for step in payload["route_trace"])
    assert payload["evidence"]["rag_hits"][0]["citation_id"] == "R1"


def test_qa_answer_uses_default_rag_source_when_frontend_only_sends_question(tmp_path: Path) -> None:
    settings = AuditHubSettings(
        qdrant_enabled=True,
        qdrant_url="http://qdrant:6333",
        qdrant_collection_name="knowledge",
        neo4j_enabled=False,
        llm_enabled=True,
        llm_model="openai:gpt-4o-mini",
    )
    qa_service = QuestionAnswerService(
        settings=settings,
        llm_adapter=ReadyLLMAdapter(answer_prefix="Default RAG", retrieval_decision=(True, False, "Need document recall.")),
        rag_reader=FakeRAGReader(
            hits=[
                RetrievalHit(
                    source_file="kb/payment.md",
                    section="Rules",
                    content="Payments require invoice references.",
                    source_id="payments-doc",
                    heading_path=["Rules"],
                    dense_score=0.93,
                    score=0.93,
                )
            ]
        ),
        graph_reader=FakeGraphReader(),
    )
    client = TestClient(create_app(service=_make_audit_service(tmp_path), qa_service=qa_service))

    response = client.post("/qa/answer", json={"question": "What does a payment require?"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"].startswith("Default RAG:")
    assert payload["source_results"][1]["status"] == "processed"
    assert "default RAG source" in payload["source_results"][1]["summary"]
    assert any(
        step["stage"] == "dense_recall" and "default RAG source" in step["detail"]
        for step in payload["route_trace"]
    )
