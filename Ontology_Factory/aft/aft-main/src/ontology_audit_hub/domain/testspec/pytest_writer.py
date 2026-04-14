from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from ontology_audit_hub.domain.audit.models import TestSpec


def write_generated_pytests(test_specs: list[TestSpec], output_dir: str | Path) -> list[str]:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    for stale_file in output_path.glob("test_generated_*.py"):
        stale_file.unlink()
    junit_file = output_path / "junit.xml"
    if junit_file.exists():
        junit_file.unlink()
    grouped: dict[str, list[TestSpec]] = defaultdict(list)
    for spec in test_specs:
        if spec.entity:
            grouped[spec.entity].append(spec)
    generated_files: list[str] = []
    for entity_name, specs in grouped.items():
        file_path = output_path / f"test_generated_{entity_name.lower()}.py"
        file_path.write_text(_render_test_file(entity_name, specs), encoding="utf-8")
        generated_files.append(str(file_path))
    return generated_files


def _render_test_file(entity_name: str, specs: list[TestSpec]) -> str:
    module_path = specs[0].module_path or ""
    target_callable = specs[0].target_callable or ""
    lines = [
        "from __future__ import annotations",
        "",
        "import importlib.util",
        "from pathlib import Path",
        "",
        f"MODULE_PATH = Path(r'''{module_path}''')",
        f"TARGET_QUALNAME = {target_callable!r}",
        "",
        "spec = importlib.util.spec_from_file_location('generated_target_module', MODULE_PATH)",
        "module = importlib.util.module_from_spec(spec)",
        "assert spec is not None and spec.loader is not None",
        "spec.loader.exec_module(module)",
        "",
        "def _resolve_qualname(root, qualname: str):",
        "    current = root",
        "    for part in qualname.split('.'):",
        "        current = getattr(current, part)",
        "    return current",
        "",
        "TARGET = _resolve_qualname(module, TARGET_QUALNAME)",
        "",
        "def _assert_falsy_or_exception(kwargs):",
        "    try:",
        "        result = TARGET(**kwargs)",
        "    except Exception:",
        "        return",
        "    assert not result",
        "",
    ]
    for spec in specs:
        test_name = spec.name
        kwargs_repr = repr(spec.inputs)
        lines.append(f"def test_{test_name}() -> None:")
        if spec.expected_outcome == "truthy":
            lines.append(f"    result = TARGET(**{kwargs_repr})")
            lines.append("    assert result")
        else:
            lines.append(f"    _assert_falsy_or_exception({kwargs_repr})")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
