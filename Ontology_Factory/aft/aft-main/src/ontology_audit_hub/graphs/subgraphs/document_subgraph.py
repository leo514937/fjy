from __future__ import annotations

from pathlib import Path

from langgraph.graph import END, START, StateGraph

from ontology_audit_hub.domain.audit.models import Finding, HumanInputCard, HumanInputOption, Severity
from ontology_audit_hub.domain.documents.claims import extract_claims, merge_claims
from ontology_audit_hub.domain.documents.conflicts import detect_document_conflicts
from ontology_audit_hub.domain.documents.parser import chunk_markdown
from ontology_audit_hub.domain.ontology.loader import load_ontology
from ontology_audit_hub.graphs.state import GraphState
from ontology_audit_hub.infra.runtime import GraphRuntime


def _append_finding(state: GraphState, finding: Finding) -> list[Finding]:
    return list(state.get("findings", [])) + [finding]


def build_document_subgraph(runtime: GraphRuntime | None = None):
    runtime = runtime or GraphRuntime()

    def document_review_core(state: GraphState) -> GraphState:
        document_paths = list(state.get("document_paths", []))
        if not document_paths:
            return {
                **state,
                "current_phase": "document_review",
                "findings": _append_finding(
                    state,
                    Finding(
                        finding_type="missing_document_input",
                        severity=Severity.MEDIUM,
                        expected="At least one document path for document auditing",
                        found="No document_paths were supplied",
                        evidence="The request did not include Markdown or specification documents.",
                        fix_hint="Provide document_paths in the request or switch to a narrower audit mode.",
                    ),
                ),
            }

        ontology = state.get("ontology")
        ontology_path = state.get("ontology_path")
        if ontology is None and ontology_path:
            try:
                ontology = load_ontology(ontology_path)
            except Exception as exc:
                return {
                    **state,
                    "current_phase": "document_review",
                    "errors": list(state.get("errors", [])) + [str(exc)],
                    "findings": _append_finding(
                        state,
                        Finding(
                            finding_type="document_review_missing_ontology_context",
                            severity=Severity.HIGH,
                            expected="Document review has access to a valid ontology",
                            found=str(exc),
                            evidence=f"The document reviewer could not load ontology_path={ontology_path}.",
                            fix_hint="Provide a valid ontology_path before running document-vs-ontology review.",
                        ),
                    ),
                }
        if ontology is None:
            return {
                **state,
                "current_phase": "document_review",
                "findings": _append_finding(
                    state,
                    Finding(
                        finding_type="document_review_missing_ontology_context",
                        severity=Severity.HIGH,
                        expected="Document review has access to a valid ontology",
                        found="No ontology was available in state or request",
                        evidence="Document-vs-ontology conflict detection requires ontology context.",
                        fix_hint="Provide ontology_path or run the ontology subgraph before document review.",
                    ),
                ),
            }

        findings = list(state.get("findings", []))
        chunks = []
        for document_path in document_paths:
            path = Path(document_path)
            if not path.exists():
                findings.append(
                    Finding(
                        finding_type="document_file_missing",
                        severity=Severity.HIGH,
                        expected=f"Document file exists at {document_path}",
                        found="The file could not be found",
                        evidence=f"The document reviewer attempted to open {document_path}.",
                        fix_hint="Correct the document path or add the missing document file.",
                    )
                )
                continue
            if not path.read_text(encoding="utf-8").strip():
                findings.append(
                    Finding(
                        finding_type="empty_document",
                        severity=Severity.MEDIUM,
                        expected="A non-empty document with auditable content",
                        found=f"{document_path} is empty",
                        evidence=f"The file {document_path} contains no text.",
                        fix_hint="Add document content before running document review.",
                    )
                )
                continue
            chunks.extend(chunk_markdown(path, ontology))

        runtime.retriever.upsert_chunks(chunks)
        retrieval_hits = runtime.retriever.search(state["request"].user_request, limit=3)
        claims = extract_claims(chunks, ontology)
        try:
            llm_claims = runtime.llm_adapter.extract_document_claims(chunks, ontology)
        except Exception:
            llm_claims = []
        claims = merge_claims(claims, llm_claims)
        findings.extend(detect_document_conflicts(claims, ontology))
        human_response = state.get("human_response")
        relation_decision = _relation_decision(human_response)
        human_card = None if relation_decision is not None else state.get("human_card")
        missing_relation_claim = _find_candidate_relation_claim(claims, ontology)
        if relation_decision == "accept_relation" and missing_relation_claim is not None:
            findings = [
                finding
                for finding in findings
                if not _matches_relation_claim_conflict(finding, missing_relation_claim)
            ]
        if missing_relation_claim is not None and human_card is None and relation_decision is None:
            human_card = HumanInputCard(
                title="Possible new ontology relation",
                question=(
                    f"Document evidence suggests a new relation "
                    f"{missing_relation_claim.subject} -> {missing_relation_claim.object}. Should this be treated as a new ontology relation?"
                ),
                context=missing_relation_claim.evidence,
                options=[
                    HumanInputOption(id="accept_relation", label="accept_relation", value="accept_relation"),
                    HumanInputOption(id="reject_relation", label="reject_relation", value="reject_relation"),
                ],
            )
        if human_card is not None and retrieval_hits:
            retrieval_context = "\n".join(
                f"- {hit.source_file}#{hit.section}: {hit.content[:120]}"
                for hit in retrieval_hits[:2]
            )
            human_card = human_card.model_copy(
                update={
                    "context": f"{human_card.context}\n\nRelevant retrieved context:\n{retrieval_context}".strip()
                }
            )
        return {
            **state,
            "current_phase": "document_review",
            "ontology": ontology,
            "document_claims": claims,
            "retrieval_hits": retrieval_hits,
            "needs_human_input": state.get("needs_human_input", False) or human_card is not None,
            "human_card": human_card,
            "human_response": None if relation_decision is not None else human_response,
            "findings": findings,
        }

    graph = StateGraph(GraphState)
    graph.add_node("document_review_core", document_review_core)
    graph.add_edge(START, "document_review_core")
    graph.add_edge("document_review_core", END)
    return graph.compile()


def _find_candidate_relation_claim(claims, ontology):
    relation_triples = {(relation.source, relation.target) for relation in ontology.relations}
    entity_names = {entity.name for entity in ontology.entities}
    for claim in claims:
        if claim.claim_type != "relation":
            continue
        relation_target = str(claim.object)
        if claim.subject in entity_names and relation_target in entity_names and (claim.subject, relation_target) not in relation_triples:
            return claim
    return None


def _relation_decision(human_response) -> str | None:
    if human_response is None:
        return None
    selected_value = (human_response.selected_option_id or human_response.response_value or "").strip()
    if selected_value in {"accept_relation", "reject_relation"}:
        return selected_value
    return None


def _matches_relation_claim_conflict(finding: Finding, claim) -> bool:
    relation_target = str(claim.object)
    return (
        finding.finding_type == "document_relation_conflict"
        and finding.evidence == claim.evidence
        and finding.found == f"Document claims relation ({claim.subject}, {claim.predicate.lower()}, {relation_target})"
    )
