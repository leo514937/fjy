from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
COMMON_PYTHONPATHS = (
    REPO_ROOT,
    REPO_ROOT / "WIKI_MG" / "src",
    REPO_ROOT / "storage" / "src",
    REPO_ROOT / "wiki_agent" / "src",
    REPO_ROOT / "ontology_core" / "src",
    REPO_ROOT / "evolution" / "src",
    REPO_ROOT / "relation" / "src",
    REPO_ROOT / "ner" / "src",
    REPO_ROOT / "dls" / "src",
    REPO_ROOT / "preprocess",
    REPO_ROOT / "pipeline" / "src",
    REPO_ROOT / "aft" / "aft-main" / "src",
)


@dataclass(frozen=True)
class CliSpec:
    name: str
    module: str
    min_python: tuple[int, int]
    help_args: tuple[str, ...]
    description: str


CLI_SPECS: dict[str, CliSpec] = {
    "wikimg": CliSpec(
        name="wikimg",
        module="wikimg",
        min_python=(3, 10),
        help_args=("--help",),
        description="Layered wiki CLI.",
    ),
    "ner": CliSpec(
        name="ner",
        module="ner.cli",
        min_python=(3, 10),
        help_args=("extract", "--help"),
        description="Named entity extraction CLI.",
    ),
    "entity-relation": CliSpec(
        name="entity-relation",
        module="entity_relation.cli",
        min_python=(3, 10),
        help_args=("extract", "--help"),
        description="Relation extraction CLI.",
    ),
    "ontology-store": CliSpec(
        name="ontology-store",
        module="ontology_store.cli",
        min_python=(3, 10),
        help_args=("query", "--help"),
        description="Storage query CLI.",
    ),
    "ontology-core": CliSpec(
        name="ontology-core",
        module="ontology_core.cli",
        min_python=(3, 10),
        help_args=("search", "--help"),
        description="Canonical ontology search CLI.",
    ),
    "ontology-negotiator": CliSpec(
        name="ontology-negotiator",
        module="ontology_negotiator.cli",
        min_python=(3, 10),
        help_args=("classify", "--help"),
        description="Ontology negotiator CLI.",
    ),
    "xiaogugit": CliSpec(
        name="xiaogugit",
        module="xiaogugit",
        min_python=(3, 9),
        help_args=("--help",),
        description="Git-backed ontology versioning CLI.",
    ),
    "aft-review": CliSpec(
        name="aft-review",
        module="ontology_audit_hub.review_cli",
        min_python=(3, 11),
        help_args=("--help",),
        description="AFT GitHub review CLI.",
    ),
    "aft-qa": CliSpec(
        name="aft-qa",
        module="ontology_audit_hub.qa_cli",
        min_python=(3, 11),
        help_args=("--help",),
        description="AFT QA and ingestion CLI.",
    ),
}


def _python_version_label(version: tuple[int, int]) -> str:
    return f"{version[0]}.{version[1]}"


def _current_python_tuple() -> tuple[int, int]:
    return sys.version_info[:2]


def supports_current_python(spec: CliSpec) -> bool:
    return _current_python_tuple() >= spec.min_python


def build_env(existing: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(existing or os.environ)
    pythonpath_entries = [str(path) for path in COMMON_PYTHONPATHS]
    existing_pythonpath = env.get("PYTHONPATH", "").strip()
    if existing_pythonpath:
        pythonpath_entries.append(existing_pythonpath)
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_entries)
    return env


def build_command(cli_name: str, args: Sequence[str]) -> list[str]:
    spec = CLI_SPECS[cli_name]
    return [sys.executable, "-m", spec.module, *args]


def run_cli(
    cli_name: str,
    args: Sequence[str],
    *,
    cwd: Path | None = None,
    timeout: int = 30,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        build_command(cli_name, args),
        cwd=str(cwd or REPO_ROOT),
        env=build_env(),
        text=True,
        capture_output=True,
        check=False,
        timeout=timeout,
    )


def _smoke_args(cli_name: str) -> list[str]:
    spec = CLI_SPECS[cli_name]
    if cli_name == "xiaogugit":
        raise ValueError("xiaogugit smoke args are built from a temporary directory")
    if cli_name == "wikimg":
        raise ValueError("wikimg smoke args are built from a temporary directory")
    return list(spec.help_args)


def smoke_cli(cli_name: str) -> dict[str, object]:
    spec = CLI_SPECS[cli_name]
    if not supports_current_python(spec):
        return {
            "cli": cli_name,
            "status": "skipped",
            "reason": (
                f"requires Python >= {_python_version_label(spec.min_python)}, "
                f"current interpreter is {_python_version_label(_current_python_tuple())}"
            ),
        }

    if cli_name == "xiaogugit":
        smoke_args = ["--root-dir", "<tempdir>", "project", "list"]
        with tempfile.TemporaryDirectory(prefix="cli-baseline-xiaogugit-") as temp_dir:
            completed = run_cli(
                cli_name,
                ["--root-dir", temp_dir, "project", "list"],
            )
    elif cli_name == "wikimg":
        smoke_args = ["init"]
        with tempfile.TemporaryDirectory(prefix="cli-baseline-wikimg-") as temp_dir:
            completed = run_cli(cli_name, ["init"], cwd=Path(temp_dir))
    else:
        smoke_args = _smoke_args(cli_name)
        completed = run_cli(cli_name, smoke_args)

    payload = {
        "cli": cli_name,
        "command": build_command(cli_name, smoke_args),
        "returncode": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }
    payload["status"] = "passed" if completed.returncode == 0 else "failed"
    return payload


def smoke_clis(cli_names: Sequence[str] | None = None) -> list[dict[str, object]]:
    names = list(cli_names) if cli_names else list(CLI_SPECS)
    return [smoke_cli(name) for name in names]


def _render_json(payload: object) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _strip_remainder(args: Sequence[str]) -> list[str]:
    remainder = list(args)
    if remainder and remainder[0] == "--":
        return remainder[1:]
    return remainder


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Unified startup and smoke-test baseline for repository CLIs.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="List supported CLI specs.")

    run_parser = subparsers.add_parser("run", help="Run one CLI with the shared interpreter/PYTHONPATH baseline.")
    run_parser.add_argument("cli", choices=sorted(CLI_SPECS))
    run_parser.add_argument("args", nargs=argparse.REMAINDER)

    smoke_parser = subparsers.add_parser("smoke", help="Run smoke checks for one or more CLIs.")
    smoke_parser.add_argument(
        "--cli",
        dest="cli_names",
        action="append",
        choices=sorted(CLI_SPECS),
        help="Limit smoke checks to specific CLIs.",
    )

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.command == "list":
        _render_json(
            [
                {
                    "name": spec.name,
                    "module": spec.module,
                    "min_python": _python_version_label(spec.min_python),
                    "description": spec.description,
                }
                for spec in CLI_SPECS.values()
            ]
        )
        return 0

    if args.command == "run":
        cli_args = _strip_remainder(args.args)
        completed = run_cli(args.cli, cli_args)
        _render_json(
            {
                "cli": args.cli,
                "command": build_command(args.cli, cli_args),
                "returncode": completed.returncode,
                "stdout": completed.stdout.strip(),
                "stderr": completed.stderr.strip(),
            }
        )
        return completed.returncode

    if args.command == "smoke":
        results = smoke_clis(args.cli_names)
        _render_json(results)
        return 1 if any(result["status"] == "failed" for result in results) else 0

    parser.error(f"unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
