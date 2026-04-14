from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from pydantic import ValidationError

from ontology_audit_hub.domain.audit.models import (
    AuditRequest,
    HumanDecision,
    QuestionAnswerCancelRequest,
    QuestionAnswerRequest,
)
from ontology_audit_hub.domain.documents.models import KnowledgeUploadConfig
from ontology_audit_hub.domain.review.models import GitHubReviewCancelRequest, GitHubReviewRequest
from ontology_audit_hub.github_review_service import GitHubReviewError, GitHubReviewService
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.knowledge_service import KnowledgeUploadError, KnowledgeUploadService
from ontology_audit_hub.qa_service import QuestionAnswerError, QuestionAnswerService
from ontology_audit_hub.service import HumanInterruptPayload, SupervisorService


def _configure_app_logging() -> None:
    logger = logging.getLogger("ontology_audit_hub")
    logger.setLevel(logging.INFO)
    handler_exists = any(getattr(handler, "_ontology_audit_hub_handler", False) for handler in logger.handlers)
    if not handler_exists:
        handler = logging.StreamHandler()
        handler._ontology_audit_hub_handler = True  # type: ignore[attr-defined]
        handler.setLevel(logging.INFO)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
        logger.addHandler(handler)
    logger.propagate = False


def create_app(
    service: SupervisorService | None = None,
    qa_service: QuestionAnswerService | None = None,
    knowledge_service: KnowledgeUploadService | None = None,
    github_review_service: GitHubReviewService | None = None,
) -> FastAPI:
    _configure_app_logging()
    logging.getLogger("ontology_audit_hub").setLevel(logging.INFO)
    audit_service = service or SupervisorService()
    question_answer_service = qa_service or QuestionAnswerService()
    github_code_review_service = github_review_service or GitHubReviewService()
    document_knowledge_service = knowledge_service or KnowledgeUploadService()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            yield
        finally:
            audit_service.close()
            question_answer_service.close()
            github_code_review_service.close()
            document_knowledge_service.close()

    app = FastAPI(title="Ontology-Driven QA Audit Hub", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Ontology-Audit-Session-ID", "X-Ontology-Audit-Artifact-Dir", "X-Ontology-Audit-Status"],
    )
    app.state.audit_service = audit_service
    app.state.qa_service = question_answer_service
    app.state.github_review_service = github_code_review_service
    app.state.knowledge_service = document_knowledge_service
    app.state.qa_stream_tasks = {}
    app.state.qa_stream_tasks_lock = asyncio.Lock()
    app.state.github_review_stream_tasks = {}
    app.state.github_review_stream_tasks_lock = asyncio.Lock()

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse(url="/docs", status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    @app.get("/favicon.ico", include_in_schema=False, status_code=status.HTTP_204_NO_CONTENT)
    def favicon() -> Response:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/health")
    def health() -> dict[str, object]:
        settings = audit_service.settings
        return {
            "status": "ok",
            "features": {
                "qdrant_enabled": settings.qdrant_enabled,
                "neo4j_enabled": settings.neo4j_enabled,
                "llm_enabled": settings.llm_enabled,
            },
        }

    @app.get("/ready")
    def ready(response: Response) -> dict[str, object]:
        payload = audit_service.readiness()
        if not payload["ready"]:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return payload

    @app.post("/audit/run")
    def run_audit(request: AuditRequest, response: Response) -> dict[str, object]:
        try:
            session_id, result = audit_service.run_session(request)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _apply_session_headers(response, audit_service, session_id, result)
        if isinstance(result, HumanInterruptPayload):
            return result.to_dict()
        return result.model_dump(mode="json")

    @app.post("/audit/resume")
    def resume_audit(decision: HumanDecision, response: Response) -> dict[str, object]:
        try:
            session_id, result = audit_service.resume_session(decision)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _apply_session_headers(response, audit_service, session_id, result)
        if isinstance(result, HumanInterruptPayload):
            return result.to_dict()
        return result.model_dump(mode="json")

    @app.post("/qa/answer")
    def answer_question(payload: dict[str, Any]) -> JSONResponse:
        try:
            request = QuestionAnswerRequest.model_validate(payload)
        except ValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "status": "error",
                    "message": "Invalid QA request.",
                    "errors": exc.errors(),
                },
            )

        try:
            response = question_answer_service.answer(request)
        except QuestionAnswerError as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content=exc.payload.model_dump(mode="json"),
            )
        except Exception as exc:
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "status": "error",
                    "message": str(exc),
                    "route_trace": [],
                    "warnings": [],
                },
            )

        return JSONResponse(status_code=status.HTTP_200_OK, content=response.model_dump(mode="json"))

    @app.post("/review/github")
    def review_github_code(payload: dict[str, Any]) -> JSONResponse:
        try:
            request = GitHubReviewRequest.model_validate(payload)
        except ValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "status": "error",
                    "message": "GitHub 审查请求无效。",
                    "errors": json.loads(exc.json()),
                },
            )

        try:
            response = github_code_review_service.review(request)
        except GitHubReviewError as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content=exc.payload.model_dump(mode="json"),
            )
        except Exception as exc:
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "status": "error",
                    "message": str(exc),
                    "errors": [],
                    "warnings": [],
                },
            )

        return JSONResponse(status_code=status.HTTP_200_OK, content=response.model_dump(mode="json"))

    @app.post("/review/github/stream")
    async def review_github_code_stream(payload: dict[str, Any]) -> Response:
        try:
            request = GitHubReviewRequest.model_validate(payload)
        except ValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "status": "error",
                    "message": "GitHub 审查请求无效。",
                    "errors": json.loads(exc.json()),
                },
            )

        async def stream() -> Any:
            current_task = asyncio.current_task()
            current_loop = asyncio.get_running_loop()
            request_id = request.request_id
            if request_id and current_task is not None:
                async with app.state.github_review_stream_tasks_lock:
                    previous = app.state.github_review_stream_tasks.get(request_id)
                    if previous is not None and previous[0] is not current_task:
                        previous[1].call_soon_threadsafe(previous[0].cancel)
                    app.state.github_review_stream_tasks[request_id] = (current_task, current_loop)
            try:
                async for event in github_code_review_service.stream_review(request):
                    yield _format_sse_event(event["event"], event["data"])
            except asyncio.CancelledError:
                return
            except GitHubReviewError as exc:
                yield _format_sse_event("error", exc.payload.model_dump(mode="json"))
            except Exception as exc:
                msg = str(exc)
                if "401" in msg or "Unauthorized" in msg or "User not found" in msg:
                    msg = "API 密钥无效或账户认证失败，请检查配置。"
                yield _format_sse_event(
                    "error",
                    {
                        "status": "error",
                        "message": msg,
                        "errors": [],
                        "warnings": [],
                    },
                )
            finally:
                if request_id and current_task is not None:
                    async with app.state.github_review_stream_tasks_lock:
                        registered = app.state.github_review_stream_tasks.get(request_id)
                        if registered is not None and registered[0] is current_task:
                            app.state.github_review_stream_tasks.pop(request_id, None)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/review/github/cancel")
    async def cancel_review_github_code(payload: dict[str, Any]) -> JSONResponse:
        try:
            request = GitHubReviewCancelRequest.model_validate(payload)
        except ValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "status": "error",
                    "message": "GitHub 审查取消请求无效。",
                    "errors": exc.errors(),
                },
            )

        async with app.state.github_review_stream_tasks_lock:
            registered = app.state.github_review_stream_tasks.get(request.request_id)
            if registered is None:
                return JSONResponse(
                    status_code=status.HTTP_404_NOT_FOUND,
                    content={
                        "status": "not_found",
                        "request_id": request.request_id,
                    },
                )
            task, loop = registered
            loop.call_soon_threadsafe(task.cancel)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "status": "cancelled",
                "request_id": request.request_id,
            },
        )

    @app.post("/qa/answer/stream")
    async def answer_question_stream(payload: dict[str, Any]) -> Response:
        try:
            request = QuestionAnswerRequest.model_validate(payload)
        except ValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "status": "error",
                    "message": "Invalid QA request.",
                    "errors": exc.errors(),
                },
            )

        async def stream() -> Any:
            current_task = asyncio.current_task()
            current_loop = asyncio.get_running_loop()
            request_id = request.request_id
            if request_id and current_task is not None:
                async with app.state.qa_stream_tasks_lock:
                    previous = app.state.qa_stream_tasks.get(request_id)
                    if previous is not None and previous[0] is not current_task:
                        previous[1].call_soon_threadsafe(previous[0].cancel)
                    app.state.qa_stream_tasks[request_id] = (current_task, current_loop)
            try:
                async for event in question_answer_service.stream_answer(request):
                    yield _format_sse_event(event["event"], event["data"])
            except asyncio.CancelledError:
                return
            except Exception as exc:
                msg = str(exc)
                if "401" in msg or "Unauthorized" in msg or "User not found" in msg:
                    msg = "API 密钥无效或账户认证失败，请检查 .env 文件中的配置。"
                yield _format_sse_event(
                    "error",
                    {
                        "status": "error",
                        "message": msg,
                        "route_trace": [],
                        "warnings": [],
                    },
                )
            finally:
                if request_id and current_task is not None:
                    async with app.state.qa_stream_tasks_lock:
                        registered = app.state.qa_stream_tasks.get(request_id)
                        if registered is not None and registered[0] is current_task:
                            app.state.qa_stream_tasks.pop(request_id, None)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/qa/answer/cancel")
    async def cancel_answer_question(payload: dict[str, Any]) -> JSONResponse:
        try:
            request = QuestionAnswerCancelRequest.model_validate(payload)
        except ValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "status": "error",
                    "message": "Invalid QA cancel request.",
                    "errors": exc.errors(),
                },
            )

        async with app.state.qa_stream_tasks_lock:
            registered = app.state.qa_stream_tasks.get(request.request_id)
            if registered is None:
                return JSONResponse(
                    status_code=status.HTTP_404_NOT_FOUND,
                    content={
                        "status": "not_found",
                        "request_id": request.request_id,
                    },
                )
            task, loop = registered
            loop.call_soon_threadsafe(task.cancel)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "status": "cancelled",
                "request_id": request.request_id,
            },
        )

    @app.post("/knowledge/upload")
    async def upload_knowledge_document(
        file: UploadFile = File(...),
        collection_name: str | None = Form(None),
        source_id: str | None = Form(None),
        chunk_size: int | None = Form(None),
        overlap_size: int | None = Form(None),
        chunk_strategy: str | None = Form(None),
        target_chunk_tokens: int | None = Form(None),
        chunk_overlap_tokens: int | None = Form(None),
        max_chunk_tokens: int | None = Form(None),
        language: str | None = Form(None),
        index_profile: str | None = Form(None),
        version: str = Form("uploaded"),
        document_status: str = Form("active", alias="status"),
    ) -> JSONResponse:
        defaults = document_knowledge_service.default_upload_config()
        try:
            config = KnowledgeUploadConfig.model_validate(
                {
                    "collection_name": collection_name,
                    "source_id": source_id,
                    "chunk_size": chunk_size,
                    "overlap_size": overlap_size,
                    "chunk_strategy": chunk_strategy if chunk_strategy is not None else defaults.chunk_strategy,
                    "target_chunk_tokens": (
                        target_chunk_tokens
                        if target_chunk_tokens is not None
                        else defaults.target_chunk_tokens
                    ),
                    "chunk_overlap_tokens": (
                        chunk_overlap_tokens
                        if chunk_overlap_tokens is not None
                        else defaults.chunk_overlap_tokens
                    ),
                    "max_chunk_tokens": (
                        max_chunk_tokens
                        if max_chunk_tokens is not None
                        else defaults.max_chunk_tokens
                    ),
                    "language": language,
                    "index_profile": index_profile if index_profile is not None else defaults.index_profile,
                    "version": version,
                    "status": document_status,
                }
            )
        except ValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "status": "error",
                    "message": "Invalid knowledge upload request.",
                    "errors": exc.errors(),
                },
            )

        try:
            payload = document_knowledge_service.upload_document(
                filename=file.filename or "",
                content=await file.read(),
                content_type=file.content_type,
                config=config,
            )
        except KnowledgeUploadError as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    "status": "error",
                    "message": exc.message,
                },
            )
        except Exception as exc:
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "status": "error",
                    "message": str(exc),
                },
            )

        return JSONResponse(status_code=status.HTTP_200_OK, content=payload.model_dump(mode="json"))

    @app.get("/graph/explore")
    def explore_graph() -> JSONResponse:
        """Return all nodes and relationships for visualization."""
        settings = AuditHubSettings.from_env()
        if not settings.neo4j_enabled or not settings.neo4j_uri:
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"error": "Neo4j is not enabled or configured."},
            )
        try:
            import neo4j as _neo4j
            driver = _neo4j.GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_username or "neo4j", settings.neo4j_password or "password"),
                connection_timeout=5.0,
            )
            nodes_map: dict[str, dict] = {}
            links: list[dict] = []
            
            with driver.session(database=settings.neo4j_database) as session:
                # Optimized query to get virtually all data. 
                # OPTIONAL MATCH ensures we get isolated nodes too.
                # `->` avoids duplicating relationships.
                query = """
                MATCH (n)
                OPTIONAL MATCH (n)-[r]->(m)
                RETURN 
                    id(n) AS source_id, n.name AS source_name, labels(n) AS source_labels, properties(n) AS source_props,
                    id(r) AS rel_id, type(r) AS rel_label, properties(r) AS rel_props,
                    id(m) AS target_id, m.name AS target_name, labels(m) AS target_labels, properties(m) AS target_props
                LIMIT 2000
                """
                records = list(session.run(query))
                
                # Degree tracker
                degrees: dict[str, int] = {}
                
                def process_node(n_id, name, labels, props):
                    if n_id is None:
                        return str(n_id)
                    # Fallback to id if name is missing
                    node_id_str = str(name) if name else f"node_{n_id}"
                    
                    if node_id_str in nodes_map:
                        return node_id_str
                    
                    labels = labels or []
                    props = props or {}
                    # Priority based type detection
                    node_type = "entity"
                    raw_labels_lower = [label.lower() for label in labels]
                    if any("concept" in label for label in raw_labels_lower) or props.get("is_concept"):
                        node_type = "concept"
                    elif any("category" in label for label in raw_labels_lower):
                        node_type = "category"
                    elif any("attribute" in label for label in raw_labels_lower):
                        node_type = "attribute"
                    elif any("constraint" in label for label in raw_labels_lower):
                        node_type = "constraint"
                    elif labels:
                        node_type = labels[0].lower()
                    
                    # Store title or name to display
                    display_name = name if name else (props.get("title") or props.get("id") or f"Unknown [{labels[0] if labels else 'Node'}]")
                    
                    nodes_map[node_id_str] = {
                        "id": node_id_str,
                        "name": display_name,
                        "type": node_type,
                        "props": props
                    }
                    return node_id_str

                seen_links = set()
                for record in records:
                    s_id = process_node(record["source_id"], record["source_name"], record["source_labels"], record["source_props"])
                    t_id = process_node(record["target_id"], record["target_name"], record["target_labels"], record["target_props"])

                    # Process Relation
                    if record["rel_id"] is not None:
                        rel_id_str = str(record["rel_id"])
                        if rel_id_str not in seen_links and s_id and t_id:
                            rel_props = record["rel_props"] or {}
                            rel_type = str(rel_props.get("type") or record["rel_label"])
                            links.append({
                                "source": s_id,
                                "target": t_id,
                                "type": rel_type
                            })
                            seen_links.add(rel_id_str)
                        
                            degrees[s_id] = degrees.get(s_id, 0) + 1
                            degrees[t_id] = degrees.get(t_id, 0) + 1

                # Post-process degrees
                for n_id, node in nodes_map.items():
                    node["degree"] = degrees.get(n_id, 0)

            driver.close()
            return JSONResponse(status_code=status.HTTP_200_OK, content={"nodes": list(nodes_map.values()), "links": links})
        except Exception as exc:
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"error": f"Graph retrieval failed: {exc}"},
            )





    return app


def _apply_session_headers(
    response: Response,
    service: SupervisorService,
    session_id: str,
    result: object,
) -> None:
    response.headers["X-Ontology-Audit-Session-ID"] = session_id
    response.headers["X-Ontology-Audit-Artifact-Dir"] = str(service.settings.session_dir(session_id))
    response.headers["X-Ontology-Audit-Status"] = (
        "requires_human_input" if isinstance(result, HumanInterruptPayload) else "completed"
    )


def _format_sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


app = create_app()
