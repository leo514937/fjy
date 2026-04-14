from __future__ import annotations

import asyncio
import shutil
import tempfile
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any, Literal, cast

from ontology_audit_hub.domain.review.models import (
    GitHubReviewErrorResponse,
    GitHubReviewIssue,
    GitHubReviewPartialReport,
    GitHubReviewProgress,
    GitHubReviewRequest,
    GitHubReviewResponse,
)
from ontology_audit_hub.graphs.github_review_graph import build_github_review_graph
from ontology_audit_hub.graphs.nodes.github_review._utils import limit_review_issues
from ontology_audit_hub.infra.github_snapshot import GitHubSnapshotError
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter
from ontology_audit_hub.infra.llm.pydantic_ai_adapter import PydanticAILLMAdapter
from ontology_audit_hub.infra.settings import AuditHubSettings

TOTAL_GRAPH_PHASES = 12
STATUS_MESSAGES = {
    "validate_request": "正在校验 GitHub 审查请求...",
    "resolve_github_target": "正在解析仓库目标...",
    "download_repository_snapshot": "正在下载 GitHub 仓库快照...",
    "discover_candidate_files": "正在发现候选审查文件...",
    "build_scope_packet": "正在构建轻量范围包...",
    "scope_planner": "正在规划快速审查范围...",
    "select_focus_files": "正在选择深度审查焦点文件...",
    "correctness": "正在执行正确性审查...",
    "risk_regression": "正在执行回归风险审查...",
    "security": "正在执行安全审查...",
    "test_coverage": "正在执行测试覆盖审查...",
    "local_merge_and_finalize": "正在汇总审查结果...",
}
REVIEWER_ISSUE_FIELDS = {
    "correctness": "correctness_issues",
    "risk_regression": "risk_regression_issues",
    "security": "security_issues",
    "test_coverage": "test_coverage_issues",
}


class GitHubReviewError(RuntimeError):
    def __init__(self, status_code: int, payload: GitHubReviewErrorResponse) -> None:
        super().__init__(payload.message)
        self.status_code = status_code
        self.payload = payload


class GitHubReviewService:
    def __init__(
        self,
        *,
        settings: AuditHubSettings | None = None,
        llm_adapter=None,
        review_runner: Callable[[GitHubReviewRequest], GitHubReviewResponse | dict[str, Any]] | None = None,
        review_graph=None,
    ) -> None:
        self.settings = settings or AuditHubSettings.from_env()
        self.llm_adapter = llm_adapter or _build_llm_adapter(self.settings)
        self.review_runner = review_runner
        self.review_graph = review_graph or build_github_review_graph(
            llm_adapter=self.llm_adapter,
            settings=self.settings,
        )

    def close(self) -> None:
        return None

    def review(self, request: GitHubReviewRequest) -> GitHubReviewResponse:
        prepared_request = self._prepare_request(request)

        if self.review_runner is not None:
            return self._coerce_response(self.review_runner(prepared_request))

        self._assert_ready()
        workspace_dir = self._create_workspace()
        try:
            result = self.review_graph.invoke(self._build_initial_state(prepared_request, workspace_dir))
        except GitHubSnapshotError as exc:
            raise GitHubReviewError(
                status_code=exc.status_code,
                payload=GitHubReviewErrorResponse(message=exc.message),
            ) from exc
        except GitHubReviewError:
            raise
        except Exception as exc:
            raise GitHubReviewError(
                status_code=500,
                payload=GitHubReviewErrorResponse(message=str(exc)),
            ) from exc
        finally:
            shutil.rmtree(workspace_dir, ignore_errors=True)

        return self._coerce_response(result.get("final_report"))

    async def stream_review(self, request: GitHubReviewRequest) -> AsyncIterator[dict[str, Any]]:
        prepared_request = self._prepare_request(request)

        if self.review_runner is not None:
            response = self._coerce_response(self.review_runner(prepared_request))
            yield {"event": "complete", "data": response.model_dump(mode="json")}
            return

        self._assert_ready()
        workspace_dir = self._create_workspace()
        state = self._build_initial_state(prepared_request, workspace_dir)
        completed_phases = 0

        yield {"event": "status", "data": {"message": "开始 GitHub 代码审查..."}}
        yield {
            "event": "progress",
            "data": GitHubReviewProgress(
                phase="queued",
                completed_phases=0,
                total_phases=TOTAL_GRAPH_PHASES,
            ).model_dump(mode="json"),
        }

        try:
            async for update in self.review_graph.astream(state, stream_mode="updates"):
                node_name, delta = next(iter(update.items()))
                state.update(delta)
                completed_phases += 1
                yield {
                    "event": "status",
                    "data": {"message": STATUS_MESSAGES.get(node_name, "正在执行 GitHub 代码审查...")},
                }
                yield {
                    "event": "progress",
                    "data": GitHubReviewProgress(
                        phase=node_name,
                        completed_phases=min(completed_phases, TOTAL_GRAPH_PHASES),
                        total_phases=TOTAL_GRAPH_PHASES,
                    ).model_dump(mode="json"),
                }
                partial_report = self._build_partial_report(node_name=node_name, delta=delta, state=state)
                if partial_report is not None:
                    yield {"event": "partial_report", "data": partial_report.model_dump(mode="json")}

            response = self._coerce_response(state.get("final_report"))
            yield {"event": "complete", "data": response.model_dump(mode="json")}
        except asyncio.CancelledError:
            raise
        except GitHubSnapshotError as exc:
            raise GitHubReviewError(
                status_code=exc.status_code,
                payload=GitHubReviewErrorResponse(message=exc.message),
            ) from exc
        except GitHubReviewError:
            raise
        except Exception as exc:
            raise GitHubReviewError(
                status_code=500,
                payload=GitHubReviewErrorResponse(message=str(exc)),
            ) from exc
        finally:
            shutil.rmtree(workspace_dir, ignore_errors=True)

    def _prepare_request(self, request: GitHubReviewRequest) -> GitHubReviewRequest:
        return request.model_copy(
            update={
                "repository_url": request.repository_url.strip(),
                "ref": request.ref.strip(),
                "paths": [path.strip() for path in request.paths if path.strip()],
                "request_id": request.request_id,
            }
        )

    def _assert_ready(self) -> None:
        llm_ready, llm_detail = _llm_ready(self.llm_adapter)
        if llm_ready:
            return
        raise GitHubReviewError(
            status_code=503,
            payload=GitHubReviewErrorResponse(
                message="GitHub 代码审查当前不可用，因为审查模型尚未就绪。",
                warnings=[llm_detail] if llm_detail else [],
            ),
        )

    def _build_initial_state(self, request: GitHubReviewRequest, workspace_dir: Path) -> dict[str, Any]:
        return {
            "request": request,
            "snapshot_workspace_dir": str(workspace_dir),
            "warnings": [],
        }

    def _create_workspace(self) -> Path:
        base_dir = self.settings.run_root / "github_reviews"
        base_dir.mkdir(parents=True, exist_ok=True)
        return Path(tempfile.mkdtemp(prefix="github-review-", dir=str(base_dir)))

    def _build_partial_report(
        self,
        *,
        node_name: str,
        delta: dict[str, Any],
        state: dict[str, Any],
    ) -> GitHubReviewPartialReport | None:
        if node_name not in REVIEWER_ISSUE_FIELDS:
            return None
        if node_name not in set(state.get("enabled_reviewers", [])):
            return None
        issues = [
            GitHubReviewIssue.model_validate(issue.model_dump(mode="json"))
            for issue in limit_review_issues(delta.get(REVIEWER_ISSUE_FIELDS[node_name], []))
        ]
        reviewed_files = [file.path for file in state.get("focus_files", [])]
        return GitHubReviewPartialReport(
            category=cast("Literal['correctness', 'risk_regression', 'security', 'test_coverage']", node_name),
            issues=issues,
            reviewed_files=reviewed_files,
            warnings=list(state.get("warnings", [])),
        )

    def _coerce_response(self, response: GitHubReviewResponse | dict[str, Any] | Any) -> GitHubReviewResponse:
        if isinstance(response, GitHubReviewResponse):
            return response
        if isinstance(response, dict):
            return GitHubReviewResponse.model_validate(response)
        raise GitHubReviewError(
            status_code=500,
            payload=GitHubReviewErrorResponse(
                message="GitHub 代码审查工作流返回了无效响应。",
            ),
        )


def _build_llm_adapter(settings: AuditHubSettings):
    if not settings.llm_enabled or not settings.llm_model:
        return NullStructuredLLMAdapter()
    try:
        return PydanticAILLMAdapter(settings.llm_model, provider=settings.llm_provider, settings=settings)
    except Exception:
        return NullStructuredLLMAdapter()


def _llm_ready(llm_adapter) -> tuple[bool, str]:
    try:
        ready, detail = llm_adapter.check_ready()
        return bool(ready), str(detail)
    except Exception as exc:
        return False, str(exc)
