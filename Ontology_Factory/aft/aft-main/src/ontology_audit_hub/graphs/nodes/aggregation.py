from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from ontology_audit_hub.domain.audit.models import Finding, GraphEvidenceHit, HumanInputCard, HumanInputOption, Severity
from ontology_audit_hub.domain.audit.severity import rank_findings
from ontology_audit_hub.graphs.state import GraphState


def aggregate_findings_node(state: GraphState) -> GraphState:
    findings = list(state.get("findings", []))
    deduped: list[Finding] = []
    seen: set[tuple[str, str, str, str]] = set()
    for finding in findings:
        key = (finding.finding_type, finding.expected, finding.found, finding.evidence)
        if key not in seen:
            seen.add(key)
            deduped.append(finding)
    return {
        **state,
        "current_phase": "aggregate_findings",
        "findings": deduped,
    }


def severity_ranking_node(state: GraphState) -> GraphState:
    ranked = rank_findings(list(state.get("findings", [])))
    needs_human_input = state.get("needs_human_input", False)
    human_card = state.get("human_card")
    if state["request"].require_human_review and human_card is None:
        needs_human_input = True
        human_card = HumanInputCard(
            title="Human review requested",
            question="A human review was explicitly requested before finalizing the audit.",
            context=state["request"].user_request,
            options=[
                HumanInputOption(id="approve", label="approve", value="approve"),
                HumanInputOption(id="revise", label="revise", value="revise"),
            ],
        )
    if not ranked and state.get("errors"):
        ranked = [
            Finding(
                finding_type="execution_error",
                severity=Severity.HIGH,
                expected="Execution without internal errors",
                found="; ".join(state["errors"]),
                evidence="Supervisor graph collected errors while executing the audit.",
                fix_hint="Inspect the recorded errors and repair the failing node before re-running the audit.",
            )
        ]
    return {
        **state,
        "current_phase": "severity_ranking",
        "needs_human_input": needs_human_input,
        "human_card": human_card,
        "prioritized_findings": ranked,
        "findings": list(state.get("findings", [])) or ranked,
    }


def make_enrich_findings_node(graph_augmenter) -> Callable[[GraphState], GraphState]:
    def enrich_findings_node(state: GraphState) -> GraphState:
        findings = _apply_retrieval_evidence(list(state.get("findings", [])), list(state.get("retrieval_hits", [])))
        graph_evidence = list(state.get("graph_evidence", []))
        try:
            graph_augmenter.ingest_state(
                state.get("ontology"),
                list(state.get("document_claims", [])),
                list(state.get("code_specs", [])),
            )
            graph_evidence = graph_augmenter.enrich_findings(findings)
            findings = _apply_graph_evidence(findings, graph_evidence)
        except Exception as exc:
            return {
                **state,
                "current_phase": "enrich_findings",
                "errors": list(state.get("errors", [])) + [str(exc)],
                "graph_evidence": list(state.get("graph_evidence", [])),
            }
        return {
            **state,
            "current_phase": "enrich_findings",
            "findings": findings,
            "graph_evidence": graph_evidence,
        }

    return enrich_findings_node


def _apply_graph_evidence(findings: list[Finding], evidence_hits: list[GraphEvidenceHit]) -> list[Finding]:
    evidence_by_key = {hit.finding_key: hit for hit in evidence_hits}
    updated: list[Finding] = []
    for finding in findings:
        key = _finding_key(finding)
        hit = evidence_by_key.get(key)
        if hit is None:
            updated.append(finding)
            continue
        impact_path = f" Impact path: {' -> '.join(hit.impact_path)}." if hit.impact_path else ""
        updated.append(
            finding.model_copy(
                update={
                    "evidence": f"{finding.evidence}\nGraph evidence: {hit.evidence_text}{impact_path}",
                }
            )
        )
    return updated


def _apply_retrieval_evidence(findings: list[Finding], retrieval_hits) -> list[Finding]:
    updated: list[Finding] = []
    for finding in findings:
        matches = [hit for hit in retrieval_hits if _retrieval_hit_matches_finding(hit, finding)]
        if not matches:
            updated.append(finding)
            continue
        retrieval_summary = "; ".join(
            f"{Path(hit.source_file).name}#{hit.section} (score={hit.score:.2f}): {hit.content[:90]}"
            for hit in matches[:2]
        )
        updated.append(
            finding.model_copy(
                update={"evidence": f"{finding.evidence}\nRetrieved context: {retrieval_summary}"}
            )
        )
    return updated


def _retrieval_hit_matches_finding(hit, finding: Finding) -> bool:
    evidence_text = " ".join([finding.expected, finding.found, finding.evidence]).lower()
    if any(tag.lower() in evidence_text for tag in hit.ontology_tags):
        return True
    searchable = f"{hit.source_file} {hit.section} {hit.content}".lower()
    return any(token in searchable for token in _extract_candidate_tokens(finding))


def _extract_candidate_tokens(finding: Finding) -> list[str]:
    tokens = []
    for chunk in (finding.expected, finding.found, finding.evidence):
        for token in chunk.lower().replace("'", " ").replace('"', " ").split():
            token = token.strip(".,:;()[]")
            if len(token) >= 5:
                tokens.append(token)
    return list(dict.fromkeys(tokens))


def _finding_key(finding: Finding) -> str:
    return "|".join([finding.finding_type, finding.expected, finding.found, finding.evidence])
