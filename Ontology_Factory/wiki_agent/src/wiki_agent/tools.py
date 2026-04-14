from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from ner.providers.hanlp_provider import HanLPNerProvider
from ontology_store import OntologyStore, build_wiki_slug
from wiki_agent.wikimg_backend import WikimgBackend


_BLOCKED_SHELL_PATTERNS = (";", "&&", "||", "|", ">", ">>", "<")
_READONLY_COMMANDS = {"pwd", "ls", "find", "rg", "cat", "sed", "head", "tail", "wc", "sort", "stat"}
_PYTHON_MODULES = {
    "wikimg",
    "ner.cli",
    "entity_relation.cli",
    "ontology_store.cli",
    "ontology_core.cli",
    "ontology_negotiator.cli",
    "pipeline.cli",
    "mm_denoise.cli",
    "xiaogugit",
    "ontology_audit_hub.review_cli",
    "ontology_audit_hub.qa_cli",
}
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；\n])")


class WikiAgentToolbox:
    def __init__(
        self,
        *,
        store: OntologyStore,
        document_id: str,
        doc_name: str,
        clean_text: str,
        run_id: str,
        provider: HanLPNerProvider | None = None,
        workspace_root: str | Path | None = None,
        target_folder: str | Path | None = None,
        document_path: str | Path | None = None,
    ) -> None:
        self.store = store
        self.document_id = document_id
        self.doc_name = doc_name
        self.clean_text = clean_text
        self.run_id = run_id
        self.provider = provider or HanLPNerProvider()
        self.workspace_root = Path(workspace_root or Path.cwd()).resolve()
        self.target_folder = Path(target_folder or self.workspace_root).resolve()
        self.document_path = Path(document_path).resolve() if document_path else None
        self.backend = WikimgBackend(self.workspace_root)

    def execute(self, action_name: str, action_input: dict[str, Any] | None = None) -> dict[str, Any]:
        if action_name != "run_command":
            raise ValueError(f"unknown tool: {action_name}")
        payload = action_input or {}
        return self.tool_run_command(str(payload.get("command", "")))

    def ensure_page_slug(self, title: str) -> str:
        base_slug = build_wiki_slug(title)
        existing = self.store.get_page_by_slug(base_slug)
        if existing is None:
            return base_slug
        if _similarity(title.lower(), existing.title.lower()) >= 0.85:
            return existing.slug
        suffix = __import__("hashlib").sha1(title.encode("utf-8")).hexdigest()[:6]
        return f"{base_slug}-{suffix}"

    def choose_layer(self, title: str, page_type: str = "topic") -> str:
        entities = self.store.list_canonical_entities()
        normalized = title.strip().lower()
        best_score = 0.0
        best_canonical_id = ""
        for entity in entities:
            score = max(
                _similarity(normalized, entity.preferred_name.strip().lower()),
                _similarity(normalized, entity.normalized_text.strip().lower()),
            )
            if score > best_score:
                best_score = score
                best_canonical_id = entity.canonical_id
        if best_canonical_id and best_score >= 0.9:
            classification = self.store.get_current_classification(best_canonical_id)
            if classification is not None:
                label = classification.ontology_label.strip()
                if label == "达":
                    return "common"
                if label == "私":
                    return "private"
                if label == "类":
                    return "domain"
        return "domain"

    def tool_run_command(self, command: str) -> dict[str, Any]:
        argv = shlex.split(str(command).strip(), posix=os.name != "nt")
        if not argv:
            raise ValueError("empty command")
        if any(pattern in str(command) for pattern in _BLOCKED_SHELL_PATTERNS):
            raise ValueError("shell operators are not allowed")
        self._validate_command(argv)
        env = os.environ.copy()
        env["PYTHONPATH"] = _build_pythonpath(self.workspace_root, env.get("PYTHONPATH", ""))
        env["PATH"] = _build_tool_path(self.workspace_root, env.get("PATH", ""))
        executable_argv = self._normalize_command(argv, env)
        try:
            completed = subprocess.run(
                executable_argv,
                cwd=str(self.target_folder),
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
                env=env,
            )
        except FileNotFoundError as error:
            return _truncate_observation(
                {
                    "command": command,
                    "cwd": str(self.target_folder),
                    "returncode": 127,
                    "stdout": "",
                    "stderr": str(error),
                },
                max_chars=6000,
            )
        return _truncate_observation(
            {
                "command": command,
                "cwd": str(self.target_folder),
                "returncode": completed.returncode,
                "stdout": completed.stdout.strip(),
                "stderr": completed.stderr.strip(),
            },
            max_chars=6000,
        )

    def _validate_command(self, argv: list[str]) -> None:
        executable = argv[0]
        if executable in _READONLY_COMMANDS:
            self._validate_readonly_command(executable, argv[1:])
            return
        if executable == "wikimg":
            self._validate_wikimg(argv[1:])
            return
        if self._is_python_executable(executable):
            self._validate_python_module(argv[1:])
            return
        raise ValueError(f"unsupported command: {executable}")

    def _validate_readonly_command(self, executable: str, args: list[str]) -> None:
        if executable == "find":
            self._validate_find_args(args)
            return
        if executable == "rg":
            self._validate_rg_args(args)
            return
        if executable == "sed":
            self._validate_sed_args(args)
            return
        for arg in args:
            if self._is_candidate_path_arg(arg):
                self._ensure_path_inside_target(arg)

    def _validate_wikimg(self, args: list[str]) -> None:
        if not args:
            raise ValueError("wikimg requires subcommand")
        if "--root" in args:
            idx = args.index("--root")
            if idx + 1 >= len(args):
                raise ValueError("wikimg --root requires a path")
            root = Path(args[idx + 1]).resolve()
            if root != self.workspace_root:
                raise ValueError("wikimg --root must point to current workspace")

    def _validate_python_module(self, args: list[str]) -> None:
        if len(args) < 2 or args[0] != "-m":
            raise ValueError("python commands must use -m")
        module = args[1]
        if module not in _PYTHON_MODULES:
            raise ValueError(f"unsupported python module: {module}")
        path_flags = {
            "--input",
            "--input-dir",
            "--database",
            "--graph",
            "--config",
            "--artifact-root",
            "--output",
            "--root",
            "--base-dir",
            "--pipeline-config",
            "--preprocess-config",
        }
        if module == "xiaogugit":
            path_flags |= {"--root-dir", "--data-file"}
        if module == "ontology_audit_hub.review_cli":
            path_flags |= {"--request-file"}
        if module == "ontology_audit_hub.qa_cli":
            path_flags |= {"--request-file", "--file"}
        for flag in path_flags:
            for path_arg in self._extract_flag_values(args[2:], flag):
                self._ensure_path_inside_workspace(path_arg)

    def _normalize_command(self, argv: list[str], env: dict[str, str]) -> list[str]:
        if argv[0] == "cat" and shutil.which("cat", path=env.get("PATH", "")) is None:
            return [
                sys.executable,
                "-c",
                (
                    "from pathlib import Path; import sys; "
                    "sys.stdout.write(''.join("
                    "Path(arg).read_text(encoding='utf-8', errors='replace') for arg in sys.argv[1:]"
                    "))"
                ),
                *argv[1:],
            ]
        if argv[0] == "wikimg" and shutil.which("wikimg", path=env.get("PATH", "")) is None:
            return [sys.executable, "-m", "wikimg", *argv[1:]]
        return argv

    def _is_python_executable(self, executable: str) -> bool:
        rendered = str(executable).strip()
        if rendered in {"python", "python3", sys.executable}:
            return True
        return Path(rendered).name.lower() in {"python", "python.exe", "python3", "python3.exe"}

    def _extract_flag_values(self, args: list[str], flag: str) -> list[str]:
        values: list[str] = []
        index = 0
        while index < len(args):
            if args[index] == flag and index + 1 < len(args):
                values.append(args[index + 1])
                index += 2
                continue
            index += 1
        return values

    def _validate_find_args(self, args: list[str]) -> None:
        option_seen = False
        for arg in args:
            if arg.startswith("-"):
                option_seen = True
            if option_seen:
                continue
            if self._is_candidate_path_arg(arg):
                self._ensure_path_inside_target(arg)

    def _validate_rg_args(self, args: list[str]) -> None:
        option_with_value = {"-g", "-t", "-T", "-f", "-m", "-A", "-B", "-C", "-M", "-j", "--glob", "--type", "--type-not", "--file", "--max-count", "--after-context", "--before-context", "--context", "--max-columns", "--threads"}
        positional: list[str] = []
        skip = False
        for arg in args:
            if skip:
                skip = False
                continue
            if arg in option_with_value:
                skip = True
                continue
            if arg.startswith("-"):
                continue
            positional.append(arg)
        for path_arg in positional[1:]:
            if self._is_candidate_path_arg(path_arg):
                self._ensure_path_inside_target(path_arg)

    def _validate_sed_args(self, args: list[str]) -> None:
        positional: list[str] = []
        skip = False
        for arg in args:
            if skip:
                skip = False
                continue
            if arg in {"-e", "-f"}:
                skip = True
                continue
            if arg.startswith("-"):
                continue
            positional.append(arg)
        for path_arg in positional[1:]:
            if self._is_candidate_path_arg(path_arg):
                self._ensure_path_inside_target(path_arg)

    def _is_candidate_path_arg(self, value: str) -> bool:
        stripped = str(value).strip()
        if not stripped or stripped in {".", "./"}:
            return False
        if stripped.startswith("-"):
            return False
        return "/" in stripped or "." in stripped or stripped.isalnum()

    def _ensure_path_inside_target(self, value: str) -> None:
        candidate = Path(value)
        if not candidate.is_absolute():
            candidate = (self.target_folder / candidate).resolve()
        else:
            candidate = candidate.resolve()
        root = self.target_folder.resolve()
        if candidate == root:
            return
        if root not in candidate.parents:
            raise ValueError(f"path outside target folder is not allowed: {value}")

    def _ensure_path_inside_workspace(self, value: str) -> None:
        candidate = Path(value)
        if not candidate.is_absolute():
            candidate = (self.target_folder / candidate).resolve()
        else:
            candidate = candidate.resolve()
        root = self.workspace_root.resolve()
        if candidate == root:
            return
        if root not in candidate.parents:
            raise ValueError(f"path outside workspace is not allowed: {value}")


def _truncate_observation(payload: dict[str, Any], max_chars: int = 4000) -> dict[str, Any]:
    raw = json_dumps(payload)
    if len(raw) <= max_chars:
        return payload
    return {"truncated": True, "preview": raw[:max_chars]}


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return min(len(left), len(right)) / max(len(left), len(right))
    matches = sum(1 for a, b in zip(left, right) if a == b)
    return matches / max(len(left), len(right))


def _build_pythonpath(workspace_root: Path, existing: str) -> str:
    paths = [
        workspace_root,
        workspace_root / "WIKI_MG" / "src",
        workspace_root / "storage" / "src",
        workspace_root / "wiki_agent" / "src",
        workspace_root / "ontology_core" / "src",
        workspace_root / "evolution" / "src",
        workspace_root / "relation" / "src",
        workspace_root / "ner" / "src",
        workspace_root / "dls" / "src",
        workspace_root / "preprocess",
        workspace_root / "pipeline" / "src",
        workspace_root / "aft" / "aft-main" / "src",
    ]
    rendered = [str(path) for path in paths]
    if existing:
        rendered.append(existing)
    return os.pathsep.join(rendered)


def _build_tool_path(workspace_root: Path, existing: str) -> str:
    paths = [
        workspace_root / ".venv" / "Scripts",
        workspace_root / ".venv" / "bin",
    ]
    rendered = [str(path) for path in paths if path.exists()]
    if existing:
        rendered.append(existing)
    return os.pathsep.join(rendered)


def json_dumps(payload: Any) -> str:
    import json

    return json.dumps(payload, ensure_ascii=False, sort_keys=True)
