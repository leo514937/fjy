from ontology_audit_hub.domain.audit.models import AuditReport, AuditRequest, Finding, Severity


def test_finding_and_report_contract() -> None:
    finding = Finding(
        finding_type="sample_issue",
        severity=Severity.MEDIUM,
        expected="Expected value",
        found="Found value",
        evidence="Evidence text",
        fix_hint="Fix hint",
    )
    report = AuditReport(
        summary="Summary",
        findings=[finding],
        prioritized_findings=[finding],
        repair_suggestions=["Fix hint"],
        unresolved_questions=[],
        next_steps=["Next step"],
    )

    assert report.findings[0].finding_type == "sample_issue"
    assert report.prioritized_findings[0].severity == Severity.MEDIUM


def test_audit_request_defaults() -> None:
    request = AuditRequest(user_request="Audit the ontology")

    assert request.audit_mode is None
    assert request.document_paths == []
    assert request.code_paths == []
    assert request.require_human_review is False
