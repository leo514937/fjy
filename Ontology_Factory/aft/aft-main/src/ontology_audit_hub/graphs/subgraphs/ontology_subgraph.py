from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from ontology_audit_hub.domain.audit.models import Finding, Severity
from ontology_audit_hub.domain.ontology.loader import load_ontology
from ontology_audit_hub.domain.ontology.validators import validate_ontology
from ontology_audit_hub.graphs.state import GraphState


def _append_finding(state: GraphState, finding: Finding) -> list[Finding]:
    return list(state.get("findings", [])) + [finding]


def ontology_audit_core(state: GraphState) -> GraphState:
    ontology_path = state.get("ontology_path")
    if not ontology_path:
        return {
            **state,
            "current_phase": "ontology_audit",
            "findings": _append_finding(
                state,
                Finding(
                    finding_type="missing_ontology_input",
                    severity=Severity.HIGH,
                    expected="A valid ontology_path for ontology auditing",
                    found="No ontology_path was supplied",
                    evidence="The request did not provide an ontology file path.",
                    fix_hint="Provide ontology_path in the audit request YAML.",
                ),
            ),
        }
    try:
        ontology = load_ontology(ontology_path)
    except FileNotFoundError:
        return {
            **state,
            "current_phase": "ontology_audit",
            "findings": _append_finding(
                state,
                Finding(
                    finding_type="ontology_file_missing",
                    severity=Severity.HIGH,
                    expected=f"Ontology file exists at {ontology_path}",
                    found="The file could not be found",
                    evidence=f"The supervisor attempted to load {ontology_path}.",
                    fix_hint="Correct the ontology_path or add the missing ontology file.",
                ),
            ),
        }
    except Exception as exc:
        return {
            **state,
            "current_phase": "ontology_audit",
            "errors": list(state.get("errors", [])) + [str(exc)],
            "findings": _append_finding(
                state,
                Finding(
                    finding_type="ontology_load_error",
                    severity=Severity.HIGH,
                    expected="Ontology YAML parses into the ontology domain model",
                    found=str(exc),
                    evidence=f"Ontology loading failed for {ontology_path}.",
                    fix_hint="Repair the ontology YAML structure so it matches the domain schema.",
                ),
            ),
        }
    validation_findings = validate_ontology(ontology)
    return {
        **state,
        "current_phase": "ontology_audit",
        "ontology": ontology,
        "findings": list(state.get("findings", [])) + validation_findings,
    }


def build_ontology_subgraph():
    graph = StateGraph(GraphState)
    graph.add_node("ontology_audit_core", ontology_audit_core)
    graph.add_edge(START, "ontology_audit_core")
    graph.add_edge("ontology_audit_core", END)
    return graph.compile()
