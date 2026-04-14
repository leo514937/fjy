from __future__ import annotations

import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from ontology_audit_hub.domain.audit.models import TestResult


def run_generated_pytests(test_dir: str | Path) -> tuple[int, list[TestResult]]:
    test_path = Path(test_dir)
    xml_path = test_path / "junit.xml"
    if xml_path.exists():
        xml_path.unlink()
    command = [sys.executable, "-m", "pytest", str(test_path), "-q", f"--junitxml={xml_path}"]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    return completed.returncode, _parse_junit_results(xml_path)


def _parse_junit_results(xml_path: Path) -> list[TestResult]:
    if not xml_path.exists():
        return []
    root = ET.fromstring(xml_path.read_text(encoding="utf-8"))
    results: list[TestResult] = []
    for testcase in root.iter("testcase"):
        nodeid = "::".join(part for part in [testcase.attrib.get("file"), testcase.attrib.get("name")] if part)
        status = "passed"
        details = ""
        failure = testcase.find("failure")
        error = testcase.find("error")
        if failure is not None:
            status = "failed"
            details = failure.text or ""
        elif error is not None:
            status = "error"
            details = error.text or ""
        results.append(
            TestResult(
                test_name=testcase.attrib.get("name", ""),
                nodeid=nodeid,
                status=status,
                details=details.strip(),
                related_entity=_extract_entity_from_nodeid(nodeid),
            )
        )
    return results


def _extract_entity_from_nodeid(nodeid: str) -> str | None:
    file_name = Path(nodeid.split("::", 1)[0]).stem
    if file_name.startswith("test_generated_"):
        return file_name.removeprefix("test_generated_").capitalize()
    simple_name = nodeid.split("::")[-1]
    if simple_name.startswith("test_"):
        parts = simple_name.removeprefix("test_").split("_", 1)
        if parts and parts[0]:
            return parts[0].capitalize()
    return None
