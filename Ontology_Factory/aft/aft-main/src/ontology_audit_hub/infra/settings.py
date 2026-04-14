from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _expand_env_placeholders(value: str) -> str:
    def replace(match: re.Match[str]) -> str:
        return os.environ.get(match.group(1), "")

    return re.sub(r"\$\{([^}]+)\}", replace, value)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _load_dotenv_file() -> None:
    """Pure-Python .env loader — no external dependencies.
    
    Searches for the .env file from the current working directory upward,
    and sets any missing environment variables from it.
    """
    cwd = Path.cwd()
    env_path: Path | None = None
    for directory in [cwd, *cwd.parents]:
        candidate = directory / ".env"
        if candidate.is_file():
            env_path = candidate
            break

    if env_path is None:
        return

    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            # Only set if not already in environment (shell overrides .env)
            if key and key not in os.environ:
                os.environ[key] = _expand_env_placeholders(val)


@dataclass(frozen=True)
class AuditHubSettings:
    run_root: Path = Path("artifacts/runs")
    qdrant_enabled: bool = True
    qdrant_mode: str = "embedded"
    qdrant_path: Path = field(default_factory=lambda: Path(f"artifacts/qdrant/process-{os.getpid()}"))
    qdrant_url: str | None = None
    qdrant_api_key: str | None = None
    qdrant_collection_name: str = "ontology_audit_chunks"
    qdrant_upload_chunk_size: int = 1000
    qdrant_upload_overlap_size: int = 200
    rag_embedding_provider: str = "openai"
    rag_embedding_model: str = "text-embedding-3-small"
    rag_embedding_dimensions: int = 1536
    rag_embedding_api_key: str | None = None
    rag_embedding_base_url: str | None = None
    rag_chunk_tokens: int = 400
    rag_chunk_overlap_tokens: int = 80
    rag_max_chunk_tokens: int = 600
    rag_candidate_pool: int = 40
    rag_sparse_candidate_pool: int = 30
    rag_top_k: int = 8
    rag_max_context_chunks: int = 6
    rag_min_relevance_score: float = 0.3
    rag_query_rewrite_enabled: bool = False
    rag_query_rewrite_timeout_seconds: float = 1.5
    rag_query_rewrite_cache_ttl_seconds: int = 300
    rag_query_rewrite_history_messages: int = 4
    rag_hybrid_enabled: bool = False
    rag_rrf_k: int = 60
    rag_lexical_db_path: Path = Path("artifacts/lexical/lexical_index.sqlite3")
    rag_enable_graph_context: bool = True
    checkpoint_path: Path = Path("artifacts/checkpoints/audit_sessions.sqlite3")
    llm_enabled: bool = False
    llm_provider: str = "pydantic-ai"
    llm_model: str | None = None
    neo4j_enabled: bool = False
    neo4j_uri: str | None = None
    neo4j_username: str | None = None
    neo4j_password: str | None = None
    neo4j_database: str = "neo4j"
    backend_timeout_seconds: float = 5.0
    interrupt_on_human: bool = True
    github_review_max_candidates: int = 60
    github_review_max_scope_files: int = 20
    github_review_max_focus_files: int = 6
    github_review_max_stage_file_chars: int = 8000
    github_review_max_stage_total_chars: int = 30000
    github_review_download_timeout_seconds: float = 20.0

    # Agent System Prompts (Overrides)
    prompt_github_scope_planner: str | None = None
    prompt_github_correctness: str | None = None
    prompt_github_risk_regression: str | None = None
    prompt_github_security: str | None = None
    prompt_github_test_coverage: str | None = None
    prompt_github_judge_merge: str | None = None
    prompt_qa_answer: str | None = None
    prompt_qa_retrieval_decision: str | None = None
    prompt_qa_classify_intent: str | None = None
    prompt_qa_query_rewrite: str | None = None
    prompt_doc_claim_extraction: str | None = None
    prompt_human_card_enhancement: str | None = None
    prompt_repair_suggestion: str | None = None

    @classmethod
    def from_env(cls) -> AuditHubSettings:
        # Auto-load .env file before reading env vars (no external deps needed)
        _load_dotenv_file()

        neo4j_uri = _expand_env_placeholders(os.getenv("ONTOLOGY_AUDIT_NEO4J_URI", "")) or None
        neo4j_username = _expand_env_placeholders(os.getenv("ONTOLOGY_AUDIT_NEO4J_USERNAME", "")) or None
        neo4j_password = _expand_env_placeholders(os.getenv("ONTOLOGY_AUDIT_NEO4J_PASSWORD", "")) or None
        llm_model = _expand_env_placeholders(os.getenv("ONTOLOGY_AUDIT_LLM_MODEL", "")) or None
        qdrant_url = _expand_env_placeholders(os.getenv("ONTOLOGY_AUDIT_QDRANT_URL", "")) or None
        rag_embedding_api_key = (
            _expand_env_placeholders(os.getenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_API_KEY", ""))
            or _expand_env_placeholders(os.getenv("OPENAI_API_KEY", ""))
            or None
        )
        rag_embedding_base_url = (
            _expand_env_placeholders(os.getenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_BASE_URL", ""))
            or _expand_env_placeholders(os.getenv("OPENAI_BASE_URL", ""))
            or None
        )
        default_qdrant_mode = "server" if qdrant_url else "embedded"
        return cls(
            run_root=Path(os.getenv("ONTOLOGY_AUDIT_RUN_ROOT", "artifacts/runs")),
            qdrant_enabled=_env_bool("ONTOLOGY_AUDIT_QDRANT_ENABLED", True),
            qdrant_mode=os.getenv("ONTOLOGY_AUDIT_QDRANT_MODE", default_qdrant_mode),
            qdrant_path=Path(
                os.getenv("ONTOLOGY_AUDIT_QDRANT_PATH", f"artifacts/qdrant/process-{os.getpid()}")
            ),
            qdrant_url=qdrant_url,
            qdrant_api_key=os.getenv("ONTOLOGY_AUDIT_QDRANT_API_KEY"),
            qdrant_collection_name=os.getenv("ONTOLOGY_AUDIT_QDRANT_COLLECTION", "ontology_audit_chunks"),
            qdrant_upload_chunk_size=_env_int("ONTOLOGY_AUDIT_QDRANT_UPLOAD_CHUNK_SIZE", 1000),
            qdrant_upload_overlap_size=_env_int("ONTOLOGY_AUDIT_QDRANT_UPLOAD_OVERLAP_SIZE", 200),
            rag_embedding_provider=os.getenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_PROVIDER", "openai"),
            rag_embedding_model=os.getenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_MODEL", "text-embedding-3-small"),
            rag_embedding_dimensions=_env_int("ONTOLOGY_AUDIT_RAG_EMBEDDING_DIMENSIONS", 1536),
            rag_embedding_api_key=rag_embedding_api_key,
            rag_embedding_base_url=rag_embedding_base_url,
            rag_chunk_tokens=_env_int("ONTOLOGY_AUDIT_RAG_CHUNK_TOKENS", 400),
            rag_chunk_overlap_tokens=_env_int("ONTOLOGY_AUDIT_RAG_CHUNK_OVERLAP_TOKENS", 80),
            rag_max_chunk_tokens=_env_int("ONTOLOGY_AUDIT_RAG_MAX_CHUNK_TOKENS", 600),
            rag_candidate_pool=_env_int("ONTOLOGY_AUDIT_RAG_CANDIDATE_POOL", 40),
            rag_sparse_candidate_pool=_env_int("ONTOLOGY_AUDIT_RAG_SPARSE_CANDIDATE_POOL", 30),
            rag_top_k=_env_int("ONTOLOGY_AUDIT_RAG_TOP_K", 8),
            rag_max_context_chunks=_env_int("ONTOLOGY_AUDIT_RAG_MAX_CONTEXT_CHUNKS", 6),
            rag_min_relevance_score=_env_float("ONTOLOGY_AUDIT_RAG_MIN_RELEVANCE_SCORE", 0.3),
            rag_query_rewrite_enabled=_env_bool("ONTOLOGY_AUDIT_RAG_QUERY_REWRITE_ENABLED", False),
            rag_query_rewrite_timeout_seconds=_env_float("ONTOLOGY_AUDIT_RAG_QUERY_REWRITE_TIMEOUT_SECONDS", 1.5),
            rag_query_rewrite_cache_ttl_seconds=_env_int("ONTOLOGY_AUDIT_RAG_QUERY_REWRITE_CACHE_TTL_SECONDS", 300),
            rag_query_rewrite_history_messages=_env_int("ONTOLOGY_AUDIT_RAG_QUERY_REWRITE_HISTORY_MESSAGES", 4),
            rag_hybrid_enabled=_env_bool("ONTOLOGY_AUDIT_RAG_HYBRID_ENABLED", False),
            rag_rrf_k=_env_int("ONTOLOGY_AUDIT_RAG_RRF_K", 60),
            rag_lexical_db_path=Path(
                os.getenv("ONTOLOGY_AUDIT_RAG_LEXICAL_DB_PATH", "artifacts/lexical/lexical_index.sqlite3")
            ),
            rag_enable_graph_context=_env_bool("ONTOLOGY_AUDIT_RAG_ENABLE_GRAPH_CONTEXT", True),
            checkpoint_path=Path(
                os.getenv("ONTOLOGY_AUDIT_CHECKPOINT_PATH", "artifacts/checkpoints/audit_sessions.sqlite3")
            ),
            llm_enabled=_env_bool("ONTOLOGY_AUDIT_LLM_ENABLED", llm_model is not None),
            llm_provider=os.getenv("ONTOLOGY_AUDIT_LLM_PROVIDER", "pydantic-ai"),
            llm_model=llm_model,
            neo4j_enabled=_env_bool(
                "ONTOLOGY_AUDIT_NEO4J_ENABLED",
                bool(neo4j_uri and neo4j_username and neo4j_password),
            ),
            neo4j_uri=neo4j_uri,
            neo4j_username=neo4j_username,
            neo4j_password=neo4j_password,
            neo4j_database=os.getenv("ONTOLOGY_AUDIT_NEO4J_DATABASE", "neo4j"),
            backend_timeout_seconds=_env_float("ONTOLOGY_AUDIT_BACKEND_TIMEOUT_SECONDS", 5.0),
            interrupt_on_human=_env_bool("ONTOLOGY_AUDIT_INTERRUPT_ON_HUMAN", True),
            github_review_max_candidates=_env_int("ONTOLOGY_AUDIT_GITHUB_REVIEW_MAX_CANDIDATES", 60),
            github_review_max_scope_files=_env_int("ONTOLOGY_AUDIT_GITHUB_REVIEW_MAX_SCOPE_FILES", 20),
            github_review_max_focus_files=_env_int("ONTOLOGY_AUDIT_GITHUB_REVIEW_MAX_FOCUS_FILES", 6),
            github_review_max_stage_file_chars=_env_int("ONTOLOGY_AUDIT_GITHUB_REVIEW_MAX_STAGE_FILE_CHARS", 8000),
            github_review_max_stage_total_chars=_env_int("ONTOLOGY_AUDIT_GITHUB_REVIEW_MAX_STAGE_TOTAL_CHARS", 30000),
            github_review_download_timeout_seconds=_env_float(
                "ONTOLOGY_AUDIT_GITHUB_REVIEW_DOWNLOAD_TIMEOUT_SECONDS",
                20.0,
            ),
            prompt_github_scope_planner=os.getenv("ONTOLOGY_AUDIT_PROMPT_GITHUB_SCOPE_PLANNER"),
            prompt_github_correctness=os.getenv("ONTOLOGY_AUDIT_PROMPT_GITHUB_CORRECTNESS"),
            prompt_github_risk_regression=os.getenv("ONTOLOGY_AUDIT_PROMPT_GITHUB_RISK_REGRESSION"),
            prompt_github_security=os.getenv("ONTOLOGY_AUDIT_PROMPT_GITHUB_SECURITY"),
            prompt_github_test_coverage=os.getenv("ONTOLOGY_AUDIT_PROMPT_GITHUB_TEST_COVERAGE"),
            prompt_github_judge_merge=os.getenv("ONTOLOGY_AUDIT_PROMPT_GITHUB_JUDGE_MERGE"),
            prompt_qa_answer=os.getenv("ONTOLOGY_AUDIT_PROMPT_QA_ANSWER"),
            prompt_qa_retrieval_decision=os.getenv("ONTOLOGY_AUDIT_PROMPT_QA_RETRIEVAL_DECISION"),
            prompt_qa_classify_intent=os.getenv("ONTOLOGY_AUDIT_PROMPT_QA_CLASSIFY_INTENT"),
            prompt_qa_query_rewrite=os.getenv("ONTOLOGY_AUDIT_PROMPT_QA_QUERY_REWRITE"),
            prompt_doc_claim_extraction=os.getenv("ONTOLOGY_AUDIT_PROMPT_DOC_CLAIM_EXTRACTION"),
            prompt_human_card_enhancement=os.getenv("ONTOLOGY_AUDIT_PROMPT_HUMAN_CARD_ENHANCEMENT"),
            prompt_repair_suggestion=os.getenv("ONTOLOGY_AUDIT_PROMPT_REPAIR_SUGGESTION"),
        )

    def session_dir(self, session_id: str) -> Path:
        return self.run_root / session_id

    def generated_tests_dir_for(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "generated_tests"

    def request_snapshot_path_for(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "request.json"

    def report_snapshot_path_for(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "final_report.json"

    def interrupt_snapshot_path_for(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "interrupt_payload.json"

    def pending_human_path_for(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "pending_human.json"

    def error_snapshot_path_for(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "error.json"
