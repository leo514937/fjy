from __future__ import annotations

"""Convert structured text into graph input and benchmark concurrency runs."""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence

from ontology_negotiator.benchmark import run_full_pipeline_benchmark
from ontology_negotiator.models import GraphInput
from ontology_negotiator.negotiator import DEFAULT_MAX_CONCURRENCY, MAX_ALLOWED_CONCURRENCY

SECTION_PATTERN = re.compile(
    r"(?ms)^\s*\d+\.\s*(?P<title>[^\n(]+?)\s*\((?P<module_id>[a-z0-9_]+)\)\s*(?P<body>.*?)(?=^\s*\d+\.\s*|^\s*总结\s*$|\Z)"
)
LAYER_SECTION_PATTERN = re.compile(
    r"(?ms)^\s*#*\s*[一二三四五六七八九十]+\s*[、.]\s*(?P<label>达层|类层|私层)[^\n]*\n(?P<body>.*?)(?=^\s*#*\s*[一二三四五六七八九十]+\s*[、.]\s*(?:达层|类层|私层)|\Z)"
)
NUMBERED_BLOCK_PATTERN = re.compile(
    r"(?ms)^\s*#*\s*\d+\.\s*(?P<header>[^\n]+)\n(?P<body>.*?)(?=^\s*#*\s*\d+\.\s*|\Z)"
)
ARTIFACT_PATTERN = re.compile(
    r"(?:[A-Za-z0-9_./-]+\.(?:ino|md|py|js|json)|pages/[A-Za-z0-9_./-]+/|/api/v\d+/[A-Za-z0-9_/-]+)"
)
PREFERRED_MODULE_ORDER = [
    "sensor_cluster",
    "arduino_uno_controller",
    "esp8266_wifi_module",
    "onenet_iot_platform",
    "wechat_mini_program_client",
]
MODULE_FLOW_RELATIONS = {
    ("sensor_cluster", "arduino_uno_controller"): "feeds_data_to",
    ("arduino_uno_controller", "esp8266_wifi_module"): "sends_data_to",
    ("esp8266_wifi_module", "onenet_iot_platform"): "uploads_data_to",
    ("onenet_iot_platform", "wechat_mini_program_client"): "serves_api_to",
}


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" :")


def _unique_in_order(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        unique_values.append(value)
    return unique_values


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "item"


def _derive_project_key(text: str, project_key: str | None) -> str:
    if project_key:
        return _slugify(project_key)
    match = re.search(r"([A-Za-z0-9_-]+)\s*项目", text)
    if match:
        return _slugify(match.group(1))
    return "text_project"


def _derive_project_name(project_key: str, project_name: str | None) -> str:
    if project_name:
        return project_name
    return f"{project_key} system"


def _extract_intro_and_summary(text: str) -> tuple[str, str]:
    first_section = SECTION_PATTERN.search(text) or LAYER_SECTION_PATTERN.search(text)
    intro = _clean_text(text[: first_section.start()] if first_section else text)
    summary_match = re.search(r"(?ms)^\s*总结\s*(?P<body>.*)$", text)
    summary = _clean_text(summary_match.group("body")) if summary_match else ""
    return intro, summary


def _build_generated_id(prefix: str, index: int, preferred_text: str = "") -> str:
    slug = _slugify(preferred_text)
    return f"{prefix}_{index}_{slug}" if slug else f"{prefix}_{index}"


def _extract_layer_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    for match in LAYER_SECTION_PATTERN.finditer(text):
        sections[str(match.group("label"))] = match.group("body").strip()
    return sections


def _parse_universal_entries(body: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    current_title: str | None = None
    current_lines: list[str] = []

    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("定义"):
            continue
        title_match = re.match(r"^(?P<title>[^：:\n]+)[：:]\s*(?P<detail>.*)$", line)
        if title_match:
            if current_title is not None:
                entries.append(
                    {
                        "title": current_title,
                        "summary": _clean_text(" ".join(current_lines)),
                    }
                )
            current_title = _clean_text(title_match.group("title"))
            current_lines = [_clean_text(title_match.group("detail"))]
            continue
        if current_title is not None:
            current_lines.append(_clean_text(line.lstrip("* ")))

    if current_title is not None:
        entries.append(
            {
                "title": current_title,
                "summary": _clean_text(" ".join(current_lines)),
            }
        )
    return entries


def _parse_numbered_entries(body: str, *, layer_label: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for index, match in enumerate(NUMBERED_BLOCK_PATTERN.finditer(body), start=1):
        header = _clean_text(match.group("header"))
        content = _clean_text(match.group("body"))
        if not content:
            continue

        explicit_module_match = re.search(
            r"[：:]\s*(?P<module_id>[a-z0-9_]+)\s*(?:\((?P<title>[^)]+)\))?",
            header,
        )
        if explicit_module_match:
            module_id = str(explicit_module_match.group("module_id"))
            title = _clean_text(explicit_module_match.group("title") or module_id)
        else:
            title_match = re.match(r"(?P<title>[^()]+?)(?:\((?P<alias>[^)]+)\))?$", header)
            title = _clean_text(title_match.group("title") if title_match else header)
            alias = _clean_text(title_match.group("alias") if title_match and title_match.group("alias") else "")
            preferred = alias or title
            module_id = _build_generated_id("class" if layer_label == "类层" else "private", index, preferred)

        entries.append(
            {
                "title": title,
                "module_id": module_id,
                "summary": content,
            }
        )
    return entries


def _map_private_entry_to_class_node(
    entry: dict[str, Any],
    class_nodes: list[dict[str, Any]],
) -> str | None:
    if not class_nodes:
        return None
    text = " ".join(
        [
            str(entry.get("title", "")),
            str(entry.get("module_id", "")),
            str(entry.get("summary", "")),
        ]
    ).lower()
    keyword_groups = [
        ("physical", ["arduino", "sensor", "温度", "光照", "硬件", "执行器", "引脚"]),
        ("protocol", ["wifi", "onenet", "协议", "cloud", "api", "通信", "edp"]),
        ("representation", ["wechat", "mini", "client", "ui", "交互", "曲线", "app"]),
    ]
    for group_name, keywords in keyword_groups:
        if any(keyword in text for keyword in keywords):
            for class_node in class_nodes:
                class_text = " ".join(
                    [
                        str(class_node.get("node_id", "")),
                        str(class_node.get("name", "")),
                        str(class_node.get("description", "")),
                    ]
                ).lower()
                if group_name == "physical" and any(key in class_text for key in ["physical", "物理", "执行"]):
                    return str(class_node["node_id"])
                if group_name == "protocol" and any(key in class_text for key in ["protocol", "协议", "数据模型", "通信"]):
                    return str(class_node["node_id"])
                if group_name == "representation" and any(key in class_text for key in ["representation", "表现", "交互"]):
                    return str(class_node["node_id"])
    return str(class_nodes[0]["node_id"])


def _build_graph_from_layered_outline(
    text: str,
    *,
    project_key: str,
    project_name: str,
) -> dict[str, Any]:
    intro, summary = _extract_intro_and_summary(text)
    layer_sections = _extract_layer_sections(text)
    universal_entries = _parse_universal_entries(layer_sections.get("达层", ""))
    class_entries = _parse_numbered_entries(layer_sections.get("类层", ""), layer_label="类层")
    private_entries = _parse_numbered_entries(layer_sections.get("私层", ""), layer_label="私层")

    if not (universal_entries or class_entries or private_entries):
        raise ValueError("No layered ontology entries were found in the input text.")

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    l2_nodes: list[dict[str, Any]] = []
    for index, entry in enumerate(universal_entries, start=1):
        node = {
            "node_id": _build_generated_id("universal", index, str(entry["title"])),
            "name": str(entry["title"]),
            "l_level": "L2",
            "description": str(entry["summary"]),
            "properties": {
                "layer_origin": "达层",
                "ran": str(entry["summary"]),
                "ti": f"Foundational universal principle in {project_name}.",
            },
        }
        nodes.append(node)
        l2_nodes.append(node)

    l1_nodes: list[dict[str, Any]] = []
    for entry in class_entries:
        node = {
            "node_id": str(entry["module_id"]),
            "name": str(entry["title"]),
            "l_level": "L1",
            "description": str(entry["summary"]),
            "properties": {
                "layer_origin": "类层",
                "ran": str(entry["summary"]),
                "ti": f"Reusable class definition in {project_name}.",
            },
        }
        nodes.append(node)
        l1_nodes.append(node)
        for l2_node in l2_nodes:
            edges.append(
                {
                    "source": str(node["node_id"]),
                    "target": str(l2_node["node_id"]),
                    "relation": "grounded_in",
                }
            )

    for entry in private_entries:
        node = {
            "node_id": str(entry["module_id"]),
            "name": str(entry["title"]),
            "l_level": "L0",
            "description": str(entry["summary"]),
            "properties": {
                "layer_origin": "私层",
                "module_id": str(entry["module_id"]),
                "ran": str(entry["summary"]),
                "ti": f"Concrete project instance in {project_name}.",
            },
        }
        nodes.append(node)
        matched_class_node_id = _map_private_entry_to_class_node(entry, l1_nodes)
        if matched_class_node_id is not None:
            edges.append(
                {
                    "source": str(node["node_id"]),
                    "target": matched_class_node_id,
                    "relation": "instantiates",
                }
            )

    if intro or summary:
        system_node_id = f"{project_key}_system"
        system_description = _clean_text(" ".join(part for part in (intro, summary) if part))
        system_node = {
            "node_id": system_node_id,
            "name": project_name,
            "l_level": "L2",
            "description": system_description,
            "properties": {
                "layer_origin": "document_summary",
                "ran": system_description or f"Top-level ontology node for {project_name}.",
                "ti": f"Top-level system concept for {project_name}.",
            },
        }
        nodes.insert(0, system_node)
        for class_node in l1_nodes:
            edges.append(
                {
                    "source": str(class_node["node_id"]),
                    "target": system_node_id,
                    "relation": "part_of",
                }
            )

    return {"nodes": nodes, "edges": edges}


def _extract_sections(text: str) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for match in SECTION_PATTERN.finditer(text):
        title = _clean_text(match.group("title"))
        module_id = _clean_text(match.group("module_id"))
        body = match.group("body")
        if "核心输出内容" in body:
            module_summary, _, outputs_body = body.partition("核心输出内容")
            output_summary = _clean_text(outputs_body.lstrip("：:"))
        else:
            module_summary = body
            output_summary = ""
        sections.append(
            {
                "title": title,
                "module_id": module_id,
                "summary": _clean_text(module_summary),
                "output_summary": output_summary,
                "artifacts": _unique_in_order(ARTIFACT_PATTERN.findall(output_summary)),
            }
        )
    if not sections:
        raise ValueError("No numbered module sections were found in the input text.")
    return sections


def _ordered_module_ids(sections: Sequence[dict[str, Any]]) -> list[str]:
    original_order = [str(section["module_id"]) for section in sections]
    ordered = [module_id for module_id in PREFERRED_MODULE_ORDER if module_id in original_order]
    ordered.extend(module_id for module_id in original_order if module_id not in ordered)
    return ordered


def build_graph_from_agent_summary(
    text: str,
    *,
    project_key: str | None = None,
    project_name: str | None = None,
) -> dict[str, Any]:
    project_key = _derive_project_key(text, project_key)
    project_name = _derive_project_name(project_key, project_name)
    if _extract_layer_sections(text):
        return _build_graph_from_layered_outline(
            text,
            project_key=project_key,
            project_name=project_name,
        )
    intro, summary = _extract_intro_and_summary(text)
    sections = _extract_sections(text)
    system_node_id = f"{project_key}_system"
    system_description = _clean_text(" ".join(part for part in (intro, summary) if part))

    nodes: list[dict[str, Any]] = [
        {
            "node_id": system_node_id,
            "name": project_name,
            "l_level": "L2",
            "description": system_description,
            "properties": {
                "ran": system_description or f"Top-level ontology node for {project_name}.",
                "ti": f"Top-level system concept for {project_name}.",
                "components": [section["module_id"] for section in sections],
            },
        }
    ]
    edges: list[dict[str, Any]] = []

    for section in sections:
        module_id = str(section["module_id"])
        module_title = str(section["title"])
        module_summary = str(section["summary"]) or f"{module_title} is a subsystem in {project_name}."
        artifacts = list(section["artifacts"])
        deliverables_node_id = f"{module_id}__deliverables"
        deliverables_description = str(section["output_summary"]) or (
            f"Concrete implementation bundle produced by {module_title}."
        )

        nodes.append(
            {
                "node_id": module_id,
                "name": module_title,
                "l_level": "L1",
                "description": module_summary,
                "properties": {
                    "module_id": module_id,
                    "artifacts": artifacts,
                    "artifact_count": len(artifacts),
                    "ran": module_summary,
                    "ti": f"Reusable subsystem role for {module_title}.",
                },
            }
        )
        nodes.append(
            {
                "node_id": deliverables_node_id,
                "name": f"{module_title} deliverables",
                "l_level": "L0",
                "description": deliverables_description,
                "properties": {
                    "owner_module_id": module_id,
                    "artifacts": artifacts,
                    "artifact_count": len(artifacts),
                    "ran": deliverables_description,
                    "ti": f"Concrete deliverable bundle owned by {module_title}.",
                },
            }
        )
        edges.append({"source": module_id, "target": system_node_id, "relation": "part_of"})
        edges.append({"source": deliverables_node_id, "target": module_id, "relation": "generated_by"})

    ordered_module_ids = _ordered_module_ids(sections)
    for left_module_id, right_module_id in zip(ordered_module_ids, ordered_module_ids[1:]):
        edges.append(
            {
                "source": left_module_id,
                "target": right_module_id,
                "relation": MODULE_FLOW_RELATIONS.get((left_module_id, right_module_id), "supports"),
            }
        )

    return {"nodes": nodes, "edges": edges}


def normalize_concurrency_values(values: Sequence[int] | None) -> list[int]:
    requested_values = list(values) if values else [1, DEFAULT_MAX_CONCURRENCY]
    normalized_values: list[int] = []
    for value in requested_values:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Concurrency values must be integers.")
        if not 1 <= value <= MAX_ALLOWED_CONCURRENCY:
            raise ValueError(
                f"Concurrency values must be between 1 and {MAX_ALLOWED_CONCURRENCY}."
            )
        if value not in normalized_values:
            normalized_values.append(value)
    return normalized_values


def _write_json(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _throughput(node_count: int, total_seconds: float) -> float | None:
    if total_seconds <= 0:
        return None
    return round(node_count / total_seconds, 6)


def _summarize_run(report: dict[str, Any], run_root: Path) -> dict[str, Any]:
    return {
        "max_concurrency": int(report["max_concurrency"]),
        "node_count": int(report["node_count"]),
        "total_seconds": float(report["total_seconds"]),
        "throughput_nodes_per_second": _throughput(int(report["node_count"]), float(report["total_seconds"])),
        "slowest_step_overall": report.get("slowest_step_overall"),
        "slowest_agent_total": report.get("slowest_agent_total"),
        "artifact_root": str(run_root),
        "written_files": report.get("written_files", {}),
    }


def build_concurrency_comparison_summary(report: dict[str, Any]) -> str:
    lines = [
        "Text-to-graph benchmark suite",
        f"Generated at: {report['generated_at']}",
        f"Source label: {report['source_label']}",
        f"Nodes: {report['graph']['node_count']}",
        f"Edges: {report['graph']['edge_count']}",
        "",
        "Runs:",
    ]

    for run in report.get("runs", []):
        slowest_step = run.get("slowest_step_overall") or {}
        slowest_agent = run.get("slowest_agent_total") or {}
        speedup = run.get("speedup_vs_serial")
        speedup_text = f"{speedup}x" if speedup is not None else "n/a"
        lines.append(
            f"- concurrency={run['max_concurrency']} total={run['total_seconds']}s "
            f"throughput={run['throughput_nodes_per_second']} nodes/s "
            f"speedup_vs_serial={speedup_text}"
        )
        lines.append(
            f"  slowest_step={slowest_step.get('agent_name', 'n/a')}:{slowest_step.get('duration_seconds', 'n/a')}s "
            f"slowest_agent={slowest_agent.get('agent_name', 'n/a')}:{slowest_agent.get('total_seconds', 'n/a')}s"
        )

    best_run = report.get("best_run")
    if best_run:
        lines.extend(
            [
                "",
                "Best run:",
                f"- concurrency={best_run['max_concurrency']} total={best_run['total_seconds']}s",
            ]
        )

    return "\n".join(lines)


def run_graph_benchmark_suite(
    graph: GraphInput | dict[str, Any],
    *,
    artifact_root: Path | str,
    save_graph_to: Path | str | None = None,
    source_label: str = "graph_input",
    concurrency_values: Sequence[int] | None = None,
    llm: Any | None = None,
    model_name: str | None = None,
    llm_kwargs: dict[str, Any] | None = None,
    config_path: Path | str | None = None,
) -> dict[str, Any]:
    graph_model = GraphInput.model_validate(graph)
    graph_payload = graph_model.model_dump(mode="json")
    artifact_root = Path(artifact_root)
    inputs_dir = artifact_root / "inputs"
    results_dir = artifact_root / "results"
    diagnostics_dir = results_dir / "diagnostics"
    graph_copy_path = _write_json(inputs_dir / "input_graph.json", graph_payload)

    written_files = {"artifact_graph": str(graph_copy_path)}
    if save_graph_to is not None:
        saved_graph_path = _write_json(Path(save_graph_to), graph_payload)
        written_files["saved_graph"] = str(saved_graph_path)

    runs: list[dict[str, Any]] = []
    normalized_concurrency = normalize_concurrency_values(concurrency_values)
    for value in normalized_concurrency:
        run_root = artifact_root / "runs" / f"concurrency_{value}"
        run_report = run_full_pipeline_benchmark(
            graph_payload,
            llm=llm,
            artifact_root=run_root,
            model_name=model_name,
            llm_kwargs=llm_kwargs,
            config_path=config_path,
            max_concurrency=value,
        )
        runs.append(_summarize_run(run_report, run_root))

    serial_run = next((run for run in runs if run["max_concurrency"] == 1), None)
    serial_total = float(serial_run["total_seconds"]) if serial_run else None
    for run in runs:
        if serial_total is None or run["total_seconds"] <= 0:
            run["speedup_vs_serial"] = None
        else:
            run["speedup_vs_serial"] = round(serial_total / float(run["total_seconds"]), 6)

    best_run = min(runs, key=lambda item: item["total_seconds"]) if runs else None
    comparison_report = {
        "generated_at": _utc_now_iso(),
        "source_label": source_label,
        "graph": {
            "node_count": len(graph_model.nodes),
            "edge_count": len(graph_model.edges),
        },
        "runs": runs,
        "best_run": best_run,
        "written_files": written_files,
    }

    comparison_report_path = _write_json(diagnostics_dir / "concurrency_comparison.json", comparison_report)
    comparison_summary_path = diagnostics_dir / "concurrency_summary.txt"
    comparison_summary_path.parent.mkdir(parents=True, exist_ok=True)
    comparison_summary_path.write_text(
        build_concurrency_comparison_summary(comparison_report),
        encoding="utf-8",
    )
    comparison_report["written_files"] = {
        **written_files,
        "comparison_report": str(comparison_report_path),
        "comparison_summary": str(comparison_summary_path),
    }
    _write_json(comparison_report_path, comparison_report)
    return comparison_report


def run_text_benchmark_suite(
    text: str,
    *,
    artifact_root: Path | str,
    save_graph_to: Path | str | None = None,
    source_label: str = "text_input",
    project_key: str | None = None,
    project_name: str | None = None,
    concurrency_values: Sequence[int] | None = None,
    llm: Any | None = None,
    model_name: str | None = None,
    llm_kwargs: dict[str, Any] | None = None,
    config_path: Path | str | None = None,
) -> dict[str, Any]:
    graph = build_graph_from_agent_summary(
        text,
        project_key=project_key,
        project_name=project_name,
    )
    return run_graph_benchmark_suite(
        graph,
        artifact_root=artifact_root,
        save_graph_to=save_graph_to,
        source_label=source_label,
        concurrency_values=concurrency_values,
        llm=llm,
        model_name=model_name,
        llm_kwargs=llm_kwargs,
        config_path=config_path,
    )
