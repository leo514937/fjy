from __future__ import annotations

from dataclasses import dataclass, field

from ontology_audit_hub.domain.audit.models import Finding
from ontology_audit_hub.infra.graph_augmenter import GraphAugmenterProtocol, NullGraphAugmenter
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter, StructuredLLMAdapter
from ontology_audit_hub.infra.retrieval import NullRetriever, RetrieverProtocol


@dataclass
class GraphRuntime:
    retriever: RetrieverProtocol = field(default_factory=NullRetriever)
    graph_augmenter: GraphAugmenterProtocol = field(default_factory=NullGraphAugmenter)
    llm_adapter: StructuredLLMAdapter = field(default_factory=NullStructuredLLMAdapter)
    interrupt_on_human: bool = False
    run_artifact_dir: str = "artifacts/runs/default"
    generated_tests_dir: str = "artifacts/generated_tests"
    diagnostic_findings: list[Finding] = field(default_factory=list)
