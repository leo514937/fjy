from __future__ import annotations

import logging
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field
from typing import Any, Protocol

from qdrant_client import QdrantClient

from ontology_audit_hub.domain.audit.models import (
    ChatHistoryMessage,
    GraphReference,
    QAGraphHit,
    RAGOptions,
    RAGReference,
    RetrievalHit,
)
from ontology_audit_hub.infra.embeddings import build_default_embedding_adapter
from ontology_audit_hub.infra.lexical_index import LexicalSearchHit, SqliteLexicalIndex
from ontology_audit_hub.infra.settings import AuditHubSettings

logger = logging.getLogger(__name__)

_neo4j_module: Any | None

try:  # pragma: no cover - optional dependency path
    import neo4j as _imported_neo4j
except ImportError:  # pragma: no cover - optional dependency path
    _neo4j_module = None
else:  # pragma: no cover - optional dependency path
    _neo4j_module = _imported_neo4j


@dataclass(frozen=True)
class QueryRewriteTrace:
    retrieval_query: str
    status: str = "skipped"
    applied: bool = False
    detail: str = ""


@dataclass(frozen=True)
class RAGSearchResult:
    hits: list[RetrievalHit]
    returned_count: int
    search_mode: str = "dense_rerank"
    dense_candidate_count: int = 0
    sparse_candidate_count: int = 0
    fusion_candidate_count: int = 0
    rewrite: QueryRewriteTrace = field(default_factory=lambda: QueryRewriteTrace(retrieval_query=""))
    warnings: list[str] = field(default_factory=list)


class RAGReaderProtocol(Protocol):
    def search(
        self,
        reference: RAGReference | None,
        query: str,
        options: RAGOptions | None = None,
        *,
        history: list[ChatHistoryMessage] | None = None,
    ) -> RAGSearchResult:
        """Query an external RAG source."""


class GraphReaderProtocol(Protocol):
    def query(
        self,
        reference: GraphReference | None,
        question: str,
        ontology_tags: list[str],
    ) -> tuple[list[QAGraphHit], list[str]]:
        """Query an external knowledge graph."""


@dataclass
class _RankedCandidate:
    hit: RetrievalHit
    vector: list[float]
    channels: set[str] = field(default_factory=set)
    dense_rank: int | None = None
    sparse_rank: int | None = None
    fusion_score: float = 0.0


class QdrantReferenceReader:
    def __init__(
        self,
        *,
        settings: AuditHubSettings | None = None,
        llm_adapter: Any | None = None,
        lexical_index: SqliteLexicalIndex | None = None,
    ) -> None:
        self._settings = settings
        self._use_dynamic_env_defaults = settings is None
        self.settings = settings or AuditHubSettings.from_env()
        self.llm_adapter = llm_adapter
        self.lexical_index = lexical_index or SqliteLexicalIndex(self.settings.rag_lexical_db_path)
        self._rewrite_cache: dict[str, tuple[float, QueryRewriteTrace]] = {}

    def search(
        self,
        reference: RAGReference | None,
        query: str,
        options: RAGOptions | None = None,
        *,
        history: list[ChatHistoryMessage] | None = None,
    ) -> RAGSearchResult:
        settings = self._current_settings()
        embedding_adapter = build_default_embedding_adapter(settings)
        if reference is None:
            if not settings.qdrant_url:
                raise RuntimeError("No RAG reference provided and no default Qdrant URL configured.")
            url = settings.qdrant_url
            api_key = settings.qdrant_api_key
            collection = settings.qdrant_collection_name
            top_k = settings.rag_top_k
        else:
            url = reference.url
            api_key = reference.api_key
            collection = reference.collection_name
            top_k = reference.top_k

        effective_candidate_pool = settings.rag_candidate_pool
        effective_sparse_candidate_pool = settings.rag_sparse_candidate_pool
        effective_top_k = top_k
        min_relevance_score = settings.rag_min_relevance_score
        if options is not None:
            if options.candidate_pool is not None:
                effective_candidate_pool = options.candidate_pool
            if options.sparse_candidate_pool is not None:
                effective_sparse_candidate_pool = options.sparse_candidate_pool
            if options.top_k is not None:
                effective_top_k = options.top_k
            if options.min_relevance_score is not None:
                min_relevance_score = options.min_relevance_score

        candidate_pool = max(effective_top_k, effective_candidate_pool)
        sparse_candidate_pool = max(effective_top_k, effective_sparse_candidate_pool)
        rewrite = self._rewrite_query_if_enabled(
            query=query,
            history=history,
            options=options,
            settings=settings,
        )
        retrieval_query = rewrite.retrieval_query or query
        query_vector = embedding_adapter.embed_query(retrieval_query)
        hybrid_enabled = _hybrid_enabled(options, settings)
        warnings: list[str] = []

        logger.info(
            "Starting RAG search collection=%s hybrid_enabled=%s candidate_pool=%s sparse_candidate_pool=%s top_k=%s rewrite_applied=%s query=%r retrieval_query=%r",
            collection,
            hybrid_enabled,
            candidate_pool,
            sparse_candidate_pool,
            effective_top_k,
            rewrite.applied,
            query[:160],
            retrieval_query[:160],
        )
        client = QdrantClient(url=url, api_key=api_key, timeout=5)
        try:
            dense_candidates = self._dense_recall(
                client=client,
                collection=collection,
                url=url,
                query_vector=query_vector,
                limit=candidate_pool,
            )
            sparse_count = 0
            if hybrid_enabled:
                lexical_query = _build_lexical_query(query, retrieval_query)
                if lexical_query:
                    try:
                        sparse_hits = self.lexical_index.search(
                            collection,
                            lexical_query,
                            limit=sparse_candidate_pool,
                        )
                        sparse_count = len(sparse_hits)
                        self._merge_sparse_hits(
                            client=client,
                            collection=collection,
                            url=url,
                            sparse_hits=sparse_hits,
                            candidates=dense_candidates,
                        )
                    except Exception as exc:
                        warnings.append(f"Sparse recall failed: {exc}")
                else:
                    warnings.append("Sparse recall skipped because the lexical query was empty.")
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

        fused_candidates = list(dense_candidates.values())
        if hybrid_enabled:
            _apply_rrf(fused_candidates, rrf_k=max(1, settings.rag_rrf_k))
            search_mode = "hybrid_rrf_mmr"
        else:
            for candidate in fused_candidates:
                candidate.fusion_score = candidate.hit.score
            search_mode = "dense_rerank"

        fused_candidates.sort(key=lambda item: item.fusion_score, reverse=True)
        selected = _apply_mmr(
            query_vector,
            [(candidate.hit.model_copy(update={"score": candidate.fusion_score}), candidate.vector) for candidate in fused_candidates],
            effective_top_k,
        )

        final_hits: list[RetrievalHit] = []
        filtered_low_relevance_count = 0
        ranked_candidates = {
            ranked_candidate.hit.chunk_id: ranked_candidate
            for ranked_candidate in fused_candidates
            if ranked_candidate.hit.chunk_id
        }
        for index, (hit, mmr_score) in enumerate(selected, start=1):
            ranked_candidate = ranked_candidates.get(hit.chunk_id)
            channels = sorted(ranked_candidate.channels) if ranked_candidate is not None else ["dense"]
            dense_rank = ranked_candidate.dense_rank if ranked_candidate is not None else None
            sparse_rank = ranked_candidate.sparse_rank if ranked_candidate is not None else None
            fusion_rank = index
            relevance_score = _compute_relevance_score(hit)
            if relevance_score < min_relevance_score:
                filtered_low_relevance_count += 1
                continue
            metadata = dict(hit.metadata)
            metadata.update(
                {
                    "mmr_score": mmr_score,
                    "relevance_score": relevance_score,
                    "min_relevance_score": min_relevance_score,
                    "candidate_pool": candidate_pool,
                    "sparse_candidate_pool": sparse_candidate_pool,
                    "retrieval_channels": channels,
                    "dense_rank": dense_rank,
                    "sparse_rank": sparse_rank,
                    "fusion_rank": fusion_rank,
                    "rewrite_applied": rewrite.applied,
                    "retrieval_query": retrieval_query,
                }
            )
            final_hits.append(
                hit.model_copy(
                    update={
                        "citation_id": f"R{len(final_hits) + 1}",
                        "score": relevance_score,
                        "metadata": metadata,
                    }
                )
            )

        if filtered_low_relevance_count:
            warnings.append(
                f"Filtered {filtered_low_relevance_count} retrieval chunk(s) below the minimum relevance score {min_relevance_score:.2f}."
            )

        return RAGSearchResult(
            hits=final_hits,
            returned_count=len(final_hits),
            search_mode=search_mode,
            dense_candidate_count=len([candidate for candidate in fused_candidates if "dense" in candidate.channels]),
            sparse_candidate_count=sparse_count if hybrid_enabled else 0,
            fusion_candidate_count=len(fused_candidates) if hybrid_enabled else 0,
            rewrite=rewrite,
            warnings=warnings,
        )

    def close(self) -> None:
        close = getattr(self.lexical_index, "close", None)
        if callable(close):
            close()

    def _dense_recall(
        self,
        *,
        client: QdrantClient,
        collection: str,
        url: str,
        query_vector: list[float],
        limit: int,
    ) -> dict[str, _RankedCandidate]:
        response = client.query_points(
            collection_name=collection,
            query=query_vector,
            limit=limit,
            with_payload=True,
            with_vectors=True,
        )
        candidates: dict[str, _RankedCandidate] = {}
        for rank, result in enumerate(response.points, start=1):
            payload = result.payload or {}
            vector = _extract_vector(getattr(result, "vector", None))
            dense_score = _normalize_dense_score(float(result.score or 0.0))
            hit = _build_retrieval_hit(
                payload=payload,
                dense_score=dense_score,
                sparse_score=0.0,
                collection=collection,
                url=url,
                point_id=str(getattr(result, "id", "")),
            )
            chunk_id = hit.chunk_id or str(getattr(result, "id", ""))
            candidates[chunk_id] = _RankedCandidate(
                hit=hit,
                vector=vector,
                channels={"dense"},
                dense_rank=rank,
                fusion_score=dense_score,
            )
        return candidates

    def _merge_sparse_hits(
        self,
        *,
        client: QdrantClient,
        collection: str,
        url: str,
        sparse_hits: list[LexicalSearchHit],
        candidates: dict[str, _RankedCandidate],
    ) -> None:
        missing_ids = [hit.chunk_id for hit in sparse_hits if hit.chunk_id not in candidates]
        retrieved_by_id: dict[str, Any] = {}
        if missing_ids:
            retrieved = client.retrieve(
                collection_name=collection,
                ids=missing_ids,
                with_payload=True,
                with_vectors=True,
            )
            for item in retrieved:
                payload = item.payload or {}
                chunk_id = str(payload.get("chunk_id") or getattr(item, "id", ""))
                if chunk_id:
                    retrieved_by_id[chunk_id] = item

        for rank, sparse_hit in enumerate(sparse_hits, start=1):
            normalized_sparse_score = _normalize_sparse_score(sparse_hit.score)
            existing = candidates.get(sparse_hit.chunk_id)
            if existing is not None:
                existing.channels.add("sparse")
                existing.sparse_rank = rank
                existing.hit = existing.hit.model_copy(
                    update={
                        "sparse_score": normalized_sparse_score,
                    }
                )
                continue

            point = retrieved_by_id.get(sparse_hit.chunk_id)
            if point is None:
                continue
            payload = point.payload or {}
            hit = _build_retrieval_hit(
                payload=payload,
                dense_score=0.0,
                sparse_score=normalized_sparse_score,
                collection=collection,
                url=url,
                point_id=str(getattr(point, "id", "")),
            )
            candidates[sparse_hit.chunk_id] = _RankedCandidate(
                hit=hit,
                vector=_extract_vector(getattr(point, "vector", None)),
                channels={"sparse"},
                sparse_rank=rank,
                fusion_score=normalized_sparse_score,
            )

    def _rewrite_query_if_enabled(
        self,
        *,
        query: str,
        history: list[ChatHistoryMessage] | None,
        options: RAGOptions | None,
        settings: AuditHubSettings,
    ) -> QueryRewriteTrace:
        if not _query_rewrite_enabled(options, settings):
            return QueryRewriteTrace(retrieval_query=query, status="skipped", detail="Query rewrite was disabled.")

        rewrite_fn = getattr(self.llm_adapter, "rewrite_query_for_retrieval", None)
        if not callable(rewrite_fn):
            return QueryRewriteTrace(
                retrieval_query=query,
                status="skipped",
                detail="No query rewrite adapter was configured.",
            )

        recent_history = list((history or [])[-max(0, settings.rag_query_rewrite_history_messages) :])
        cache_key = _rewrite_cache_key(query, recent_history)
        now = time.monotonic()
        cached = self._rewrite_cache.get(cache_key)
        if cached is not None and cached[0] > now:
            return cached[1]

        executor = ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(rewrite_fn, query, chat_history=recent_history)
            rewritten = future.result(timeout=max(settings.rag_query_rewrite_timeout_seconds, 0.1))
        except FutureTimeoutError:
            executor.shutdown(wait=False, cancel_futures=True)
            trace = QueryRewriteTrace(
                retrieval_query=query,
                status="degraded",
                detail="Query rewrite timed out and fell back to the original question.",
            )
            self._cache_rewrite(cache_key, trace, settings)
            return trace
        except Exception as exc:
            executor.shutdown(wait=False, cancel_futures=True)
            trace = QueryRewriteTrace(
                retrieval_query=query,
                status="degraded",
                detail=f"Query rewrite failed and fell back to the original question: {exc}",
            )
            self._cache_rewrite(cache_key, trace, settings)
            return trace
        else:
            executor.shutdown(wait=False, cancel_futures=True)

        normalized_rewrite = str(rewritten or "").strip()
        if not normalized_rewrite or normalized_rewrite == query:
            trace = QueryRewriteTrace(
                retrieval_query=query,
                status="processed",
                applied=False,
                detail="Query rewrite kept the original wording.",
            )
            self._cache_rewrite(cache_key, trace, settings)
            return trace

        trace = QueryRewriteTrace(
            retrieval_query=normalized_rewrite,
            status="processed",
            applied=True,
            detail="Query rewrite expanded the retrieval query with recent chat context.",
        )
        self._cache_rewrite(cache_key, trace, settings)
        return trace

    def _cache_rewrite(self, cache_key: str, trace: QueryRewriteTrace, settings: AuditHubSettings) -> None:
        ttl = max(1, settings.rag_query_rewrite_cache_ttl_seconds)
        self._rewrite_cache[cache_key] = (time.monotonic() + ttl, trace)

    def _current_settings(self) -> AuditHubSettings:
        if self._use_dynamic_env_defaults:
            return AuditHubSettings.from_env()
        return self.settings


class Neo4jReferenceReader:
    def __init__(self, *, settings: AuditHubSettings | None = None) -> None:
        self._settings = settings
        self._use_dynamic_env_defaults = settings is None
        self.settings = settings or AuditHubSettings.from_env()

    def query(
        self,
        reference: GraphReference | None,
        question: str,
        ontology_tags: list[str],
    ) -> tuple[list[QAGraphHit], list[str]]:
        if _neo4j_module is None:
            raise RuntimeError("neo4j is not installed.")

        settings = self._current_settings()
        if reference is None:
            if not settings.neo4j_uri:
                raise RuntimeError("No graph reference provided and no default Neo4j URI configured.")
            uri = settings.neo4j_uri
            username = settings.neo4j_username or "neo4j"
            password = settings.neo4j_password or "password"
            database = settings.neo4j_database
        else:
            uri = reference.uri
            username = reference.username
            password = reference.password
            database = reference.database

        candidates = _extract_candidate_entities(question, ontology_tags)
        if not candidates:
            return [], []

        driver = _neo4j_module.GraphDatabase.driver(
            uri,
            auth=(username, password),
            connection_timeout=5.0,
        )
        try:
            with driver.session(database=database) as session:
                records = session.run(
                    """
                    UNWIND $candidates AS candidate
                    MATCH (seed)
                    WHERE any(value IN [
                        coalesce(properties(seed)["name"], ""),
                        coalesce(properties(seed)["title"], ""),
                        coalesce(properties(seed)["qualname"], ""),
                        coalesce(properties(seed)["finding_key"], ""),
                        coalesce(properties(seed)["section"], "")
                    ] WHERE toLower(toString(value)) = toLower(candidate))
                    OPTIONAL MATCH (seed)-[r]-(neighbor)
                    WITH
                        candidate,
                        seed,
                        labels(seed) AS seed_labels,
                        collect(
                            DISTINCT CASE
                                WHEN neighbor IS NULL THEN NULL
                                ELSE {
                                    neighbor: toString(coalesce(
                                        properties(neighbor)["name"],
                                        properties(neighbor)["title"],
                                        properties(neighbor)["qualname"],
                                        properties(neighbor)["finding_key"],
                                        properties(neighbor)["section"],
                                        head(labels(neighbor)),
                                        "unknown"
                                    )),
                                    neighbor_labels: labels(neighbor),
                                    relation_type: coalesce(toString(properties(r)["type"]), type(r), "related"),
                                    direction: CASE WHEN startNode(r) = seed THEN "out" ELSE "in" END
                                }
                            END
                        )[0..8] AS relations
                    RETURN
                        toString(coalesce(
                            properties(seed)["name"],
                            properties(seed)["title"],
                            properties(seed)["qualname"],
                            properties(seed)["finding_key"],
                            properties(seed)["section"],
                            head(seed_labels),
                            candidate
                        )) AS entity,
                        seed_labels AS labels,
                        relations
                    """,
                    candidates=candidates,
                )
                hits: list[QAGraphHit] = []
                graph_paths: list[str] = []
                seen_entities: set[str] = set()
                for record in records:
                    entity = str(record.get("entity") or "")
                    if not entity or entity in seen_entities:
                        continue
                    seen_entities.add(entity)
                    relations_payload = [item for item in record.get("relations", []) if item and item.get("neighbor")]
                    related_entities = [str(item["neighbor"]) for item in relations_payload]
                    relations = [
                        f"{item['direction']}:{item['relation_type']}:{item['neighbor']}"
                        for item in relations_payload
                    ]
                    graph_paths.extend(
                        [
                            (
                                f"{entity} -[{item['relation_type']}]-> {item['neighbor']}"
                                if item["direction"] == "out"
                                else f"{item['neighbor']} -[{item['relation_type']}]-> {entity}"
                            )
                            for item in relations_payload
                        ]
                    )
                    seed_labels = [str(label) for label in (record.get("labels") or [])]
                    label_text = f" ({', '.join(seed_labels)})" if seed_labels else ""
                    evidence_text = (
                        f"Matched graph node '{entity}'{label_text}."
                        if not relations_payload
                        else f"Matched graph node '{entity}'{label_text} with related nodes {related_entities}."
                    )
                    hits.append(
                        QAGraphHit(
                            entity=entity,
                            evidence_text=evidence_text,
                            related_entities=related_entities,
                            relations=relations,
                            citation_id=f"G{len(hits) + 1}",
                        )
                    )
                logger.info(
                    "Graph recall complete candidates=%s hits=%s paths=%s sample=%s",
                    candidates[:8],
                    len(hits),
                    len(graph_paths),
                    [f"{hit.entity}:{','.join(hit.related_entities[:3])}" for hit in hits[:3]],
                )
                return hits, list(dict.fromkeys(graph_paths))
        finally:
            driver.close()

    def _current_settings(self) -> AuditHubSettings:
        if self._use_dynamic_env_defaults:
            return AuditHubSettings.from_env()
        return self.settings


def _build_retrieval_hit(
    *,
    payload: dict[str, Any],
    dense_score: float,
    sparse_score: float,
    collection: str,
    url: str,
    point_id: str,
) -> RetrievalHit:
    score = dense_score if dense_score > 0.0 else sparse_score
    return RetrievalHit(
        chunk_id=str(payload.get("chunk_id", "")),
        source_file=str(payload.get("source_file", "")),
        section=str(payload.get("section", "")),
        content=str(payload.get("content", "")),
        source_id=str(payload.get("source_id", "")),
        heading_path=list(payload.get("heading_path", [])),
        ontology_tags=list(payload.get("ontology_tags", [])),
        version=str(payload.get("version", "unknown")),
        status=str(payload.get("status", "unknown")),
        score=score,
        dense_score=dense_score,
        sparse_score=sparse_score,
        token_count=int(payload.get("token_count", 0) or 0),
        match_reason=_build_match_reason(payload, dense_score=dense_score, sparse_score=sparse_score),
        metadata={
            "collection": collection,
            "id": point_id,
            "url": url,
            "raw_dense_score": dense_score,
            "raw_sparse_score": sparse_score,
            "filename": str(payload.get("filename", "")),
            "content_type": str(payload.get("content_type", "")),
            "section_ordinal": payload.get("section_ordinal"),
            "chunk_ordinal": payload.get("chunk_ordinal"),
            "index_profile": str(payload.get("index_profile", "")),
            "content_sha256": str(payload.get("content_sha256", "")),
        },
    )


def _build_match_reason(payload: dict[str, Any], *, dense_score: float, sparse_score: float) -> str:
    section = str(payload.get("section", ""))
    tags = ",".join(payload.get("ontology_tags", []))
    heading_path = " > ".join(payload.get("heading_path", []))
    return (
        f"section={section}; heading_path={heading_path or 'none'}; "
        f"tags={tags or 'none'}; dense_score={dense_score:.3f}; sparse_score={sparse_score:.3f}"
    )


def _extract_candidate_entities(question: str, ontology_tags: list[str]) -> list[str]:
    candidates = [tag.strip() for tag in ontology_tags if tag and tag.strip()]
    seen = {candidate.lower() for candidate in candidates}
    for token in re.findall(r"\b[A-Za-z][A-Za-z0-9_]+\b|[\u4e00-\u9fff]{2,}", question):
        normalized = token.strip()
        if not normalized:
            continue
        if len(normalized) < 3 and not _contains_cjk(normalized):
            continue
        lowered = normalized.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        candidates.append(normalized)
    return candidates


def _extract_vector(raw_vector: Any) -> list[float]:
    if raw_vector is None:
        return []
    if isinstance(raw_vector, dict):
        for value in raw_vector.values():
            if isinstance(value, list):
                return [float(item) for item in value]
        return []
    if isinstance(raw_vector, list):
        return [float(item) for item in raw_vector]
    return []


def _apply_mmr(
    query_vector: list[float],
    candidates: list[tuple[RetrievalHit, list[float]]],
    top_k: int,
    *,
    lambda_weight: float = 0.7,
) -> list[tuple[RetrievalHit, float]]:
    if not candidates or top_k <= 0:
        return []
    remaining = list(candidates)
    selected: list[tuple[RetrievalHit, list[float], float]] = []
    while remaining and len(selected) < top_k:
        best_index = 0
        best_score = float("-inf")
        for index, (candidate_hit, candidate_vector) in enumerate(remaining):
            relevance = candidate_hit.score
            if relevance == 0.0:
                relevance = (
                    _cosine_similarity(query_vector, candidate_vector)
                    if candidate_vector
                    else max(candidate_hit.dense_score, candidate_hit.sparse_score)
                )
            diversity_penalty = 0.0
            if selected and candidate_vector:
                similarities = [
                    _cosine_similarity(candidate_vector, selected_vector)
                    for _, selected_vector, _ in selected
                    if selected_vector
                ]
                diversity_penalty = max(similarities) if similarities else 0.0
            mmr_score = (lambda_weight * relevance) - ((1 - lambda_weight) * diversity_penalty)
            if mmr_score > best_score:
                best_index = index
                best_score = mmr_score
        hit, vector = remaining.pop(best_index)
        selected.append((hit, vector, best_score))
    return [(hit, mmr_score) for hit, _, mmr_score in selected]


def _apply_rrf(candidates: list[_RankedCandidate], *, rrf_k: int) -> None:
    for candidate in candidates:
        score = 0.0
        if candidate.dense_rank is not None:
            score += 1.0 / (rrf_k + candidate.dense_rank)
        if candidate.sparse_rank is not None:
            score += 1.0 / (rrf_k + candidate.sparse_rank)
        candidate.fusion_score = score


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / (left_norm * right_norm)


def _query_rewrite_enabled(options: RAGOptions | None, settings: AuditHubSettings) -> bool:
    if options is not None and options.enable_query_rewrite is not None:
        return bool(options.enable_query_rewrite)
    return bool(settings.rag_query_rewrite_enabled)


def _hybrid_enabled(options: RAGOptions | None, settings: AuditHubSettings) -> bool:
    if options is not None and options.enable_hybrid_retrieval is not None:
        return bool(options.enable_hybrid_retrieval)
    return bool(settings.rag_hybrid_enabled)


def _rewrite_cache_key(query: str, history: list[ChatHistoryMessage]) -> str:
    normalized_history = "|".join(f"{item.role}:{item.content.strip()}" for item in history)
    return f"{' '.join(query.strip().lower().split())}::{normalized_history}"


def _normalize_sparse_score(raw_score: float) -> float:
    return 1.0 / (1.0 + abs(float(raw_score)))


def _normalize_dense_score(raw_score: float) -> float:
    return max(0.0, min(float(raw_score), 1.0))


def _compute_relevance_score(hit: RetrievalHit) -> float:
    return max(
        0.0,
        min(
            1.0,
            max(
                _normalize_dense_score(hit.dense_score),
                max(0.0, min(float(hit.sparse_score), 1.0)),
            ),
        ),
    )


def _build_lexical_query(original_query: str, rewritten_query: str) -> str:
    original_tokens = _extract_lexical_tokens(original_query)
    merged_tokens = list(original_tokens)
    seen = {token.lower() for token in merged_tokens}
    for token in _extract_lexical_tokens(rewritten_query):
        lowered = token.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        merged_tokens.append(token)
    phrases = ['"' + token.replace('"', '""') + '"' for token in merged_tokens[:16]]
    return " OR ".join(phrases)


def _extract_lexical_tokens(text: str) -> list[str]:
    tokens: list[str] = []
    seen: set[str] = set()
    for token in re.findall(r"[A-Za-z0-9_./:-]+|[\u4e00-\u9fff]{2,}", text):
        normalized = token.strip().strip("\"'`")
        if not normalized:
            continue
        if len(normalized) < 2 and not _contains_cjk(normalized):
            continue
        lowered = normalized.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        tokens.append(normalized)
    return tokens


def _contains_cjk(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in value)

