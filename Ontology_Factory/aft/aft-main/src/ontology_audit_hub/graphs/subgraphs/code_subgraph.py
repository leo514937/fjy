from __future__ import annotations

import re
from pathlib import Path

from langgraph.errors import NodeInterrupt
from langgraph.graph import END, START, StateGraph

from ontology_audit_hub.domain.audit.models import Finding, Severity, TestResult
from ontology_audit_hub.domain.code.detector import (
    apply_human_decision,
    build_ambiguity_human_card_for_entity,
    compare_code_against_ontology,
    validate_selected_binding,
)
from ontology_audit_hub.domain.code.inference import infer_code_specs
from ontology_audit_hub.domain.code.models import CodeCallableSpec, CodeModuleSpec
from ontology_audit_hub.domain.code.parser import parse_python_modules
from ontology_audit_hub.domain.ontology.loader import load_ontology
from ontology_audit_hub.domain.testspec.generator import generate_test_specs
from ontology_audit_hub.domain.testspec.pytest_runner import run_generated_pytests
from ontology_audit_hub.domain.testspec.pytest_writer import write_generated_pytests
from ontology_audit_hub.graphs.state import GraphState
from ontology_audit_hub.infra.runtime import GraphRuntime


def build_code_subgraph(runtime: GraphRuntime | None = None):
    runtime = runtime or GraphRuntime()

    def collect_python_files(state: GraphState) -> GraphState:
        code_paths = list(state.get("code_paths", []))
        if not code_paths:
            return {
                **state,
                "current_phase": "collect_python_files",
                "findings": _append_finding(
                    state,
                    Finding(
                        finding_type="missing_code_input",
                        severity=Severity.MEDIUM,
                        expected="At least one code path for code auditing",
                        found="No code_paths were supplied",
                        evidence="The request did not include source files for auditing.",
                        fix_hint="Provide code_paths in the request or switch to a narrower audit mode.",
                    ),
                ),
            }
        findings = list(state.get("findings", []))
        valid_paths: list[str] = []
        for code_path in code_paths:
            path = Path(code_path)
            if not path.exists():
                findings.append(
                    Finding(
                        finding_type="code_file_missing",
                        severity=Severity.HIGH,
                        expected=f"Code file exists at {code_path}",
                        found="The file could not be found",
                        evidence=f"The code auditor attempted to open {code_path}.",
                        fix_hint="Correct the code path or add the missing source file.",
                    )
                )
                continue
            if path.suffix != ".py":
                findings.append(
                    Finding(
                        finding_type="unsupported_code_file",
                        severity=Severity.LOW,
                        expected="A Python source file for code auditing",
                        found=f"{code_path} has suffix {path.suffix or '<none>'}",
                        evidence="The code audit path only supports Python source files.",
                        fix_hint="Provide Python source files or extend the audit to another language.",
                    )
                )
                continue
            valid_paths.append(str(path))
        return {
            **state,
            "current_phase": "collect_python_files",
            "code_paths": valid_paths,
            "findings": findings,
        }

    def parse_ast(state: GraphState) -> GraphState:
        if not state.get("code_paths"):
            return {
                **state,
                "current_phase": "parse_ast",
            }
        modules = parse_python_modules(list(state.get("code_paths", [])))
        code_specs = [callable_spec for module in modules for callable_spec in module.callables]
        return {
            **state,
            "current_phase": "parse_ast",
            "code_specs": code_specs,
        }

    def infer_specs(state: GraphState) -> GraphState:
        ontology = _ensure_ontology(state)
        if ontology is None:
            return _missing_ontology_state(state, phase="infer_code_specs")
        inferred_specs = infer_code_specs(
            [
                CodeModuleSpec(module_path=spec.module_path, callables=[spec])
                for spec in list(state.get("code_specs", []))
            ],
            ontology,
        )
        return {
            **state,
            "current_phase": "infer_code_specs",
            "ontology": ontology,
            "code_specs": inferred_specs,
        }

    def compare_with_ontology(state: GraphState) -> GraphState:
        ontology = _ensure_ontology(state)
        if ontology is None:
            return _missing_ontology_state(state, phase="compare_with_ontology")
        code_specs = list(state.get("code_specs", []))
        findings, selected_bindings, human_card = compare_code_against_ontology(
            code_specs,
            ontology,
        )
        human_response = state.get("human_response")
        if human_response is not None:
            existing_bindings = dict(selected_bindings)
            selected_bindings = apply_human_decision(
                dict(existing_bindings),
                code_specs,
                human_response.selected_option_id,
                human_response.response_value,
            )
            resolved_entities = set(selected_bindings).difference(existing_bindings)
            findings = _remove_resolved_ambiguity_findings(findings, resolved_entities)
            entities_by_name = {entity.name: entity for entity in ontology.entities}
            for entity_name in sorted(resolved_entities):
                entity = entities_by_name.get(entity_name)
                selected_spec = selected_bindings.get(entity_name)
                if entity is None or selected_spec is None:
                    continue
                findings.extend(validate_selected_binding(entity, selected_spec, ontology))
            human_card = _next_ambiguity_human_card(ontology, code_specs, findings)
        needs_human_input = (
            human_card is not None
            if human_response is not None
            else state.get("needs_human_input", False) or human_card is not None
        )
        binding_map = {entity_name: spec.qualname for entity_name, spec in selected_bindings.items()}
        next_state: GraphState = {
            **state,
            "current_phase": "compare_with_ontology",
            "ontology": ontology,
            "findings": list(state.get("findings", [])) + findings,
            "selected_code_bindings": binding_map,
            "needs_human_input": needs_human_input,
            "human_card": human_card if human_response is not None else human_card or state.get("human_card"),
            "human_response": None if human_response is not None else state.get("human_response"),
        }
        if human_card is not None and runtime.interrupt_on_human:
            raise NodeInterrupt(
                {
                    "session_id": state.get("session_id"),
                    "resume_token": state.get("resume_token"),
                    "current_phase": "compare_with_ontology",
                    "human_card": human_card.model_dump(mode="json"),
                }
            )
        return next_state

    def generate_specs(state: GraphState) -> GraphState:
        ontology = _ensure_ontology(state)
        if ontology is None:
            return _missing_ontology_state(state, phase="generate_test_specs")
        selected_specs = _resolve_selected_bindings(state)
        test_specs, extra_findings = generate_test_specs(ontology, selected_specs)
        return {
            **state,
            "current_phase": "generate_test_specs",
            "test_specs": test_specs,
            "findings": list(state.get("findings", [])) + extra_findings,
        }

    def write_pytests(state: GraphState) -> GraphState:
        if not state.get("test_specs"):
            return {
                **state,
                "current_phase": "write_pytest_files",
                "generated_test_files": [],
            }
        generated_files = write_generated_pytests(list(state.get("test_specs", [])), runtime.generated_tests_dir)
        return {
            **state,
            "current_phase": "write_pytest_files",
            "generated_test_files": generated_files,
        }

    def run_pytests(state: GraphState) -> GraphState:
        generated_files = list(state.get("generated_test_files", []))
        if not generated_files:
            return {
                **state,
                "current_phase": "run_pytest",
                "test_results": list(state.get("test_results", [])),
            }
        return_code, test_results = run_generated_pytests(runtime.generated_tests_dir)
        if return_code != 0 and not test_results:
            test_results = [_synthetic_pytest_error_result(return_code, runtime.generated_tests_dir)]
        binding_map = _resolve_selected_bindings(state)
        qualname_by_entity = {entity_name.lower(): spec.qualname for entity_name, spec in binding_map.items()}
        enriched_results = []
        for result in test_results:
            related_entity = result.related_entity
            enriched_results.append(
                result.model_copy(
                    update={
                        "related_callable": qualname_by_entity.get((related_entity or "").lower(), ""),
                    }
                )
            )
        return {
            **state,
            "current_phase": "run_pytest",
            "test_results": enriched_results,
        }

    def map_test_failures(state: GraphState) -> GraphState:
        findings = list(state.get("findings", []))
        specs_by_name = {spec.name: spec for spec in state.get("test_specs", [])}
        for test_result in state.get("test_results", []):
            if test_result.status == "passed":
                continue
            finding_type, severity, fix_hint = _classify_test_failure(test_result, specs_by_name.get(test_result.test_name))
            findings.append(
                Finding(
                    finding_type=finding_type,
                    severity=severity,
                    expected=_expected_test_outcome(test_result, specs_by_name.get(test_result.test_name)),
                    found=f"Status={test_result.status}",
                    evidence=test_result.details or test_result.nodeid,
                    fix_hint=fix_hint,
                )
            )
        return {
            **state,
            "current_phase": "map_test_failures",
            "findings": findings,
        }

    graph = StateGraph(GraphState)
    graph.add_node("collect_python_files", collect_python_files)
    graph.add_node("parse_ast", parse_ast)
    graph.add_node("infer_code_specs", infer_specs)
    graph.add_node("compare_with_ontology", compare_with_ontology)
    graph.add_node("generate_test_specs", generate_specs)
    graph.add_node("write_pytest_files", write_pytests)
    graph.add_node("run_pytest", run_pytests)
    graph.add_node("map_test_failures", map_test_failures)
    graph.add_edge(START, "collect_python_files")
    graph.add_edge("collect_python_files", "parse_ast")
    graph.add_edge("parse_ast", "infer_code_specs")
    graph.add_edge("infer_code_specs", "compare_with_ontology")
    graph.add_edge("compare_with_ontology", "generate_test_specs")
    graph.add_edge("generate_test_specs", "write_pytest_files")
    graph.add_edge("write_pytest_files", "run_pytest")
    graph.add_edge("run_pytest", "map_test_failures")
    graph.add_edge("map_test_failures", END)
    return graph.compile()


def _append_finding(state: GraphState, finding: Finding) -> list[Finding]:
    return list(state.get("findings", [])) + [finding]


def _ensure_ontology(state: GraphState):
    ontology = state.get("ontology")
    ontology_path = state.get("ontology_path")
    if ontology is None and ontology_path:
        try:
            ontology = load_ontology(ontology_path)
        except Exception:
            return None
    return ontology


def _missing_ontology_state(state: GraphState, *, phase: str) -> GraphState:
    return {
        **state,
        "current_phase": phase,
        "findings": _append_finding(
            state,
            Finding(
                finding_type="code_review_missing_ontology_context",
                severity=Severity.HIGH,
                expected="Code review has access to a valid ontology",
                found="No ontology was available in state or request",
                evidence="Code-vs-ontology comparison requires ontology context.",
                fix_hint="Provide ontology_path or run the ontology subgraph before code review.",
            ),
        ),
    }


def _resolve_selected_bindings(state: GraphState) -> dict[str, CodeCallableSpec]:
    specs_by_qualname = {spec.qualname: spec for spec in list(state.get("code_specs", []))}
    return {
        entity_name: specs_by_qualname[qualname]
        for entity_name, qualname in dict(state.get("selected_code_bindings", {})).items()
        if qualname in specs_by_qualname
    }


def _classify_test_failure(test_result, test_spec):
    if test_result.status == "error":
        return (
            "generated_test_error",
            Severity.CRITICAL,
            "Repair the generated test harness or the target import path before rerunning pytest.",
        )
    if test_spec is not None and test_spec.expected_outcome == "truthy":
        return (
            "generated_test_assumption_mismatch",
            Severity.MEDIUM,
            "Verify the generated fixture assumptions or adapt the validator so ontology-compliant inputs are accepted.",
        )
    return (
        "generated_test_failure",
        Severity.HIGH,
        "Repair the bound callable so it enforces the ontology constraints before rerunning pytest.",
    )


def _expected_test_outcome(test_result, test_spec) -> str:
    if test_spec is None:
        return f"Generated pytest '{test_result.nodeid}' passes"
    if test_spec.expected_outcome == "truthy":
        return f"Generated positive pytest '{test_result.nodeid}' accepts ontology-compliant inputs"
    return f"Generated negative pytest '{test_result.nodeid}' rejects ontology-invalid inputs"


def _remove_resolved_ambiguity_findings(findings: list[Finding], resolved_entities: set[str]) -> list[Finding]:
    if not resolved_entities:
        return findings
    return [
        finding
        for finding in findings
        if not (
            finding.finding_type == "code_ambiguous_callable_binding"
            and (_ambiguity_entity_name(finding) or "") in resolved_entities
        )
    ]


def _ambiguity_entity_name(finding: Finding) -> str | None:
    match = re.search(r"entity '([^']+)'", finding.expected)
    if match is None:
        return None
    return match.group(1)


def _next_ambiguity_human_card(
    ontology,
    code_specs: list[CodeCallableSpec],
    findings: list[Finding],
):
    for finding in findings:
        entity_name = _ambiguity_entity_name(finding)
        if finding.finding_type != "code_ambiguous_callable_binding" or not entity_name:
            continue
        card = build_ambiguity_human_card_for_entity(entity_name, code_specs, ontology)
        if card is not None:
            return card
    return None


def _synthetic_pytest_error_result(return_code: int, test_dir: str) -> TestResult:
    return TestResult(
        test_name="generated_pytest_session",
        nodeid=f"{test_dir}::pytest",
        status="error",
        details=(
            "Generated pytest execution exited with "
            f"status code {return_code} before any JUnit testcases were recorded."
        ),
    )
