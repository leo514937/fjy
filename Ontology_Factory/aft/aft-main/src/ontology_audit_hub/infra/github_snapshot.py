from __future__ import annotations

import re
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from ontology_audit_hub.domain.review.models import GitHubRepoTarget

DEFAULT_MAX_REVIEW_CANDIDATES = 60
DEFAULT_MAX_FOCUS_FILES = 6
DEFAULT_MAX_STAGE_FILE_CHARACTERS = 8_000
DEFAULT_MAX_STAGE_TOTAL_CHARACTERS = 30_000
DEFAULT_COMPAT_FILE_CHARACTERS = 18_000
DEFAULT_DOWNLOAD_TIMEOUT_SECONDS = 20.0
SCOPE_HEAD_LINES = 80
SCOPE_TAIL_LINES = 40
LOW_VALUE_DIRECTORY_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".next",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "vendor",
}
LOW_VALUE_FILE_NAMES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "poetry.lock",
    "cargo.lock",
    "composer.lock",
}
LOW_VALUE_SUFFIXES = {
    ".bmp",
    ".csv",
    ".doc",
    ".docx",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".lock",
    ".map",
    ".md",
    ".markdown",
    ".min.css",
    ".min.js",
    ".pdf",
    ".png",
    ".snap",
    ".svg",
    ".txt",
    ".webp",
    ".woff",
    ".woff2",
    ".zip",
}
IMPORT_LINE_RE = re.compile(
    r"^\s*(?:from\s+\S+\s+import\s+.+|import\s+.+|#include\s+[<\"].+[>\"]|use\s+\S+|require\(.+\))"
)
DECLARATION_RE = re.compile(
    r"^\s*(?:async\s+def|def|class|interface|type|enum|function|export\s+(?:async\s+)?function|"
    r"export\s+class|export\s+const|const\s+\w+\s*=\s*(?:async\s*)?\(|public\s+\w+\(|private\s+\w+\(|"
    r"protected\s+\w+\(|func\s+\w+\()"
)


class GitHubSnapshotError(RuntimeError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@dataclass(frozen=True)
class GitHubReviewCandidate:
    path: str
    absolute_path: Path
    file_type: str
    size_bytes: int
    is_explicit: bool
    head_excerpt: str
    tail_excerpt: str
    imports_summary: list[str]
    declarations_summary: list[str]
    truncated: bool = False


@dataclass(frozen=True)
class GitHubSnapshotFile:
    path: str
    absolute_path: Path
    content: str
    truncated: bool = False


def parse_github_repo_target(repository_url: str, ref: str) -> GitHubRepoTarget:
    parsed = urllib.parse.urlparse(repository_url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or host != "github.com":
        raise GitHubSnapshotError(400, "repository_url 必须指向公开的 github.com 仓库。")

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise GitHubSnapshotError(400, "repository_url 必须包含 owner 和 repository 名称。")

    owner = parts[0].strip()
    repo = parts[1].strip()
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not owner or not repo:
        raise GitHubSnapshotError(400, "repository_url 必须包含 owner 和 repository 名称。")

    normalized_ref = ref.strip()
    if not normalized_ref:
        raise GitHubSnapshotError(400, "ref 不能为空。")

    archive_ref = urllib.parse.quote(normalized_ref, safe="")
    archive_url = f"https://api.github.com/repos/{owner}/{repo}/zipball/{archive_ref}"
    return GitHubRepoTarget(
        repository_url=f"https://github.com/{owner}/{repo}",
        owner=owner,
        repo=repo,
        ref=normalized_ref,
        archive_url=archive_url,
    )


def download_repository_snapshot(
    repo_target: GitHubRepoTarget,
    *,
    destination_root: Path,
    timeout_seconds: float = DEFAULT_DOWNLOAD_TIMEOUT_SECONDS,
) -> Path:
    destination_root.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="github-review-", dir=str(destination_root)))
    archive_path = temp_dir / "snapshot.zip"

    request = urllib.request.Request(
        repo_target.archive_url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "ontology-audit-hub",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            archive_path.write_bytes(response.read())
    except urllib.error.HTTPError as exc:
        if exc.code in {404, 422}:
            raise GitHubSnapshotError(
                502,
                f"无法下载 {repo_target.full_name}@{repo_target.ref}，仓库或 ref 可能不存在。",
            ) from exc
        raise GitHubSnapshotError(502, f"GitHub 下载失败，HTTP {exc.code}。") from exc
    except urllib.error.URLError as exc:
        raise GitHubSnapshotError(502, f"GitHub 下载失败：{exc.reason}") from exc

    try:
        with zipfile.ZipFile(archive_path) as archive:
            archive.extractall(temp_dir)
    except zipfile.BadZipFile as exc:
        raise GitHubSnapshotError(502, "GitHub 返回了无效的仓库压缩包。") from exc

    repo_roots = sorted(
        [candidate for candidate in temp_dir.iterdir() if candidate.is_dir() and candidate.name != "__MACOSX"]
    )
    if not repo_roots:
        raise GitHubSnapshotError(502, "下载的 GitHub 压缩包中未找到仓库快照。")
    return repo_roots[0]


def discover_review_candidates(
    snapshot_dir: Path,
    requested_paths: list[str],
    *,
    max_candidates: int = DEFAULT_MAX_REVIEW_CANDIDATES,
) -> tuple[list[GitHubReviewCandidate], list[str]]:
    warnings: list[str] = []
    candidate_paths: list[tuple[Path, bool]] = []

    for requested_path in requested_paths:
        normalized = _normalize_repo_relative_path(requested_path)
        candidate = snapshot_dir.joinpath(*normalized.parts)
        if not candidate.exists():
            raise GitHubSnapshotError(400, f"仓库快照中未找到指定路径：{normalized.as_posix()}")
        if candidate.is_dir():
            for file_path in _iter_directory_files(candidate):
                candidate_paths.append((file_path, False))
        elif candidate.is_file():
            candidate_paths.append((candidate, True))

    deduped_paths: list[tuple[Path, bool]] = []
    seen_files: set[str] = set()
    for file_path, is_explicit in candidate_paths:
        try:
            relative_path = file_path.relative_to(snapshot_dir).as_posix()
        except ValueError:
            continue
        if relative_path in seen_files:
            continue
        seen_files.add(relative_path)
        deduped_paths.append((file_path, is_explicit))

    selected_candidates: list[GitHubReviewCandidate] = []
    candidate_limit_hit = False
    for file_path, is_explicit in deduped_paths:
        relative_path = file_path.relative_to(snapshot_dir).as_posix()
        if not is_explicit and _should_skip_low_value_file(relative_path):
            continue
        try:
            text = _read_text_file(file_path)
        except GitHubSnapshotError as exc:
            warnings.append(f"已跳过不可读取文件：{relative_path}（{exc.message}）")
            continue
        if not text.strip():
            warnings.append(f"已跳过空文件：{relative_path}")
            continue

        selected_candidates.append(
            _build_review_candidate(
                path=relative_path,
                absolute_path=file_path,
                text=text,
                size_bytes=file_path.stat().st_size,
                is_explicit=is_explicit,
            )
        )
        if len(selected_candidates) >= max_candidates:
            candidate_limit_hit = True
            break

    if candidate_limit_hit:
        warnings.append(f"范围规划仅纳入前 {max_candidates} 个候选文本文件。")

    if not selected_candidates:
        raise GitHubSnapshotError(400, "筛选请求路径后，没有保留任何可读取的文本文件。")

    return selected_candidates, list(dict.fromkeys(warnings))


def collect_focus_review_files(
    candidates: list[GitHubReviewCandidate],
    focus_paths: list[str],
    *,
    max_focus_files: int = DEFAULT_MAX_FOCUS_FILES,
    max_file_characters: int = DEFAULT_MAX_STAGE_FILE_CHARACTERS,
    max_total_characters: int = DEFAULT_MAX_STAGE_TOTAL_CHARACTERS,
) -> tuple[list[GitHubSnapshotFile], list[str]]:
    warnings: list[str] = []
    focus_candidates = {candidate.path: candidate for candidate in candidates}
    ordered_focus_paths: list[str] = []
    seen_paths: set[str] = set()
    for path in focus_paths:
        normalized = path.replace("\\", "/").strip()
        if not normalized or normalized in seen_paths or normalized not in focus_candidates:
            continue
        seen_paths.add(normalized)
        ordered_focus_paths.append(normalized)

    if len(ordered_focus_paths) > max_focus_files:
        warnings.append(f"仅深度审查前 {max_focus_files} 个焦点文件。")
        ordered_focus_paths = ordered_focus_paths[:max_focus_files]

    selected_files: list[GitHubSnapshotFile] = []
    total_characters = 0
    for path in ordered_focus_paths:
        candidate = focus_candidates[path]
        text = _read_text_file(candidate.absolute_path)
        truncated = False

        if len(text) > max_file_characters:
            text = text[:max_file_characters]
            truncated = True
            warnings.append(f"深度审查前已截断大文件：{path}")

        remaining = max_total_characters - total_characters
        if remaining <= 0:
            warnings.append(f"由于深度审查预算已用尽，已跳过焦点文件：{path}")
            continue
        if len(text) > remaining:
            text = text[:remaining]
            truncated = True
            warnings.append(f"为满足总深度审查预算，已截断焦点文件：{path}")

        if not text.strip():
            warnings.append(f"已跳过空的焦点文件：{path}")
            continue

        total_characters += len(text)
        selected_files.append(
            GitHubSnapshotFile(
                path=path,
                absolute_path=candidate.absolute_path,
                content=text,
                truncated=truncated,
            )
        )

    if not selected_files:
        raise GitHubSnapshotError(400, "应用深度审查限制后，没有保留任何焦点文件。")

    return selected_files, list(dict.fromkeys(warnings))


def collect_review_files(snapshot_dir: Path, requested_paths: list[str]) -> tuple[list[GitHubSnapshotFile], list[str]]:
    warnings: list[str] = []
    resolved_files: list[Path] = []

    for requested_path in requested_paths:
        normalized = _normalize_repo_relative_path(requested_path)
        candidate = snapshot_dir.joinpath(*normalized.parts)
        if not candidate.exists():
            raise GitHubSnapshotError(400, f"仓库快照中未找到指定路径：{normalized.as_posix()}")
        if candidate.is_dir():
            resolved_files.extend(_iter_directory_files(candidate))
        elif candidate.is_file():
            resolved_files.append(candidate)

    selected_files: list[GitHubSnapshotFile] = []
    seen: set[str] = set()
    for file_path in resolved_files:
        relative_path = file_path.relative_to(snapshot_dir).as_posix()
        if relative_path in seen:
            continue
        seen.add(relative_path)
        raw = file_path.read_bytes()
        if _looks_binary(raw):
            warnings.append(f"已跳过二进制文件：{relative_path}")
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                warnings.append(f"已跳过非 UTF-8 文本文件：{relative_path}")
                continue
        if not text.strip():
            warnings.append(f"已跳过空文件：{relative_path}")
            continue
        truncated = False
        if len(text) > DEFAULT_COMPAT_FILE_CHARACTERS:
            text = text[:DEFAULT_COMPAT_FILE_CHARACTERS]
            truncated = True
            warnings.append(f"审查前已截断大文件：{relative_path}")
        selected_files.append(
            GitHubSnapshotFile(
                path=relative_path,
                absolute_path=file_path,
                content=text,
                truncated=truncated,
            )
        )

    if not selected_files:
        raise GitHubSnapshotError(400, "筛选请求路径后，没有保留任何可读取的文本文件。")

    return selected_files, list(dict.fromkeys(warnings))


def cleanup_snapshot(snapshot_dir: str | Path | None) -> None:
    if not snapshot_dir:
        return
    root = Path(snapshot_dir)
    cleanup_root = root.parent if root.exists() else root
    try:
        shutil.rmtree(cleanup_root, ignore_errors=True)
    except Exception:
        return


def add_line_numbers(content: str) -> str:
    lines = content.splitlines()
    if not lines:
        return "1 | "
    width = len(str(len(lines)))
    return "\n".join(f"{index:>{width}} | {line}" for index, line in enumerate(lines, start=1))


def _normalize_repo_relative_path(raw_path: str) -> PurePosixPath:
    normalized = raw_path.replace("\\", "/").strip()
    candidate = PurePosixPath(normalized)
    if not normalized or candidate.is_absolute() or ".." in candidate.parts:
        raise GitHubSnapshotError(400, f"无效的仓库相对路径：{raw_path}")
    return candidate


def _iter_directory_files(directory: Path):
    for child in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
        if child.is_dir():
            if child.name in LOW_VALUE_DIRECTORY_NAMES:
                continue
            yield from _iter_directory_files(child)
            continue
        if child.is_file():
            yield child


def _build_review_candidate(
    *,
    path: str,
    absolute_path: Path,
    text: str,
    size_bytes: int,
    is_explicit: bool,
) -> GitHubReviewCandidate:
    lines = text.splitlines()
    truncated = len(lines) > SCOPE_HEAD_LINES + SCOPE_TAIL_LINES
    head_excerpt = "\n".join(lines[:SCOPE_HEAD_LINES])
    tail_excerpt = "\n".join(lines[-SCOPE_TAIL_LINES:]) if truncated else ""
    return GitHubReviewCandidate(
        path=path,
        absolute_path=absolute_path,
        file_type=_classify_file_type(path),
        size_bytes=size_bytes,
        is_explicit=is_explicit,
        head_excerpt=head_excerpt,
        tail_excerpt=tail_excerpt,
        imports_summary=_extract_matching_lines(lines, IMPORT_LINE_RE, limit=8),
        declarations_summary=_extract_matching_lines(lines, DECLARATION_RE, limit=10),
        truncated=truncated,
    )


def _classify_file_type(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix in {".py"}:
        return "python"
    if suffix in {".ts", ".tsx"}:
        return "typescript"
    if suffix in {".js", ".jsx", ".mjs", ".cjs"}:
        return "javascript"
    if suffix in {".go"}:
        return "go"
    if suffix in {".java"}:
        return "java"
    if suffix in {".rb"}:
        return "ruby"
    if suffix in {".rs"}:
        return "rust"
    if suffix in {".c", ".cc", ".cpp", ".h", ".hpp"}:
        return "cpp"
    if suffix in {".cs"}:
        return "csharp"
    if suffix in {".json"}:
        return "json"
    if suffix in {".yaml", ".yml"}:
        return "yaml"
    if suffix in {".toml"}:
        return "toml"
    if suffix in {".sh", ".bash"}:
        return "shell"
    return suffix.lstrip(".") or "text"


def _extract_matching_lines(lines: list[str], pattern: re.Pattern[str], *, limit: int) -> list[str]:
    matches: list[str] = []
    for line in lines:
        if pattern.match(line):
            matches.append(line.strip())
        if len(matches) >= limit:
            break
    return matches


def _should_skip_low_value_file(relative_path: str) -> bool:
    path = PurePosixPath(relative_path)
    name = path.name.lower()
    suffix = path.suffix.lower()
    if name in LOW_VALUE_FILE_NAMES:
        return True
    if name.endswith(".min.js") or name.endswith(".min.css"):
        return True
    if suffix in LOW_VALUE_SUFFIXES:
        return True
    if "/docs/" in f"/{relative_path.lower()}/":
        return True
    return False


def _read_text_file(file_path: Path) -> str:
    raw = file_path.read_bytes()
    if _looks_binary(raw):
        raise GitHubSnapshotError(400, "二进制内容")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise GitHubSnapshotError(400, "非 UTF-8 文本") from exc


def _looks_binary(raw: bytes) -> bool:
    if b"\x00" in raw:
        return True
    sample = raw[:1024]
    if not sample:
        return False
    non_text = sum(byte < 9 or (13 < byte < 32) for byte in sample)
    return non_text / max(len(sample), 1) > 0.3
