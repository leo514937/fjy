from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Protocol

from ontology_audit_hub.domain.audit.models import Finding, GraphEvidenceHit
from ontology_audit_hub.domain.code.models import CodeCallableSpec
from ontology_audit_hub.domain.documents.models import DocumentClaim
from ontology_audit_hub.domain.ontology.models import OntologyModel

neo4j: Any | None
try:  # pragma: no cover - optional dependency path
    import neo4j as _neo4j
except ImportError:  # pragma: no cover - optional dependency path
    neo4j = None
else:  # pragma: no cover - optional dependency path
    neo4j = _neo4j

GraphDatabase: Any | None = neo4j.GraphDatabase if neo4j is not None else None


class GraphAugmenterProtocol(Protocol):
    def ingest_state(
        self,
        ontology: OntologyModel | None,
        document_claims: list[DocumentClaim],
        code_specs: list[CodeCallableSpec],
    ) -> None:
        """Persist graph inputs for optional graph-aware retrieval."""

    def enrich_findings(self, findings: list[Finding]) -> list[GraphEvidenceHit]:
        """Return graph-aware evidence hits for findings."""

    def check_ready(self, timeout_seconds: float = 5.0) -> tuple[bool, str]:
        """Return a readiness probe result for the graph backend."""

    def backend_info(self) -> dict[str, Any]:
        """Return user-facing backend metadata."""

    def close(self) -> None:
        """Release backend resources when supported."""


class NullGraphAugmenter:
    def ingest_state(
        self,
        ontology: OntologyModel | None,
        document_claims: list[DocumentClaim],
        code_specs: list[CodeCallableSpec],
    ) -> None:
        return None

    def enrich_findings(self, findings: list[Finding]) -> list[GraphEvidenceHit]:
        return []

    def check_ready(self, timeout_seconds: float = 5.0) -> tuple[bool, str]:
        return False, "Graph augmentation backend is disabled."

    def backend_info(self) -> dict[str, Any]:
        return {"backend": "null", "mode": "disabled"}

    def close(self) -> None:
        return None


@dataclass
class Neo4jSettings:
    uri: str
    username: str
    password: str
    database: str = "neo4j"


class Neo4jGraphAugmenter:
    def __init__(self, settings: Neo4jSettings) -> None:
        self.settings = settings

    def ingest_state(
        self,
        ontology: OntologyModel | None,
        document_claims: list[DocumentClaim],
        code_specs: list[CodeCallableSpec],
    ) -> None:
        if GraphDatabase is None:
            raise RuntimeError("neo4j is not installed. Install ontology-audit-hub[graph] to enable graph augmentation.")
        driver = GraphDatabase.driver(
            self.settings.uri,
            auth=(self.settings.username, self.settings.password),
        )
        try:
            with driver.session(database=self.settings.database) as session:
                if ontology is not None:
                    for entity in ontology.entities:
                        session.run("MERGE (:OntologyEntity {name: $name})", name=entity.name)
                    for relation in ontology.relations:
                        session.run(
                            """
                            MERGE (s:OntologyEntity {name: $source})
                            MERGE (t:OntologyEntity {name: $target})
                            MERGE (s)-[:ONTOLOGY_RELATION {type: $relation_type}]->(t)
                            """,
                            source=relation.source,
                            target=relation.target,
                            relation_type=relation.relation_type,
                        )
                for claim in document_claims:
                    claim_id = hashlib.sha1(
                        f"{claim.source_file}|{claim.section}|{claim.subject}|{claim.predicate}|{claim.object}".encode()
                    ).hexdigest()
                    session.run(
                        """
                        MERGE (d:DocumentSection {source_file: $source_file, section: $section})
                        SET d.last_claim = $evidence
                        MERGE (claim:DocumentClaim {claim_id: $claim_id})
                        SET claim.claim_type = $claim_type,
                            claim.subject = $subject,
                            claim.predicate = $predicate,
                            claim.object = $object,
                            claim.evidence = $evidence
                        MERGE (d)-[:HAS_CLAIM]->(claim)
                        """,
                        claim_id=claim_id,
                        source_file=claim.source_file,
                        section=claim.section,
                        claim_type=claim.claim_type,
                        subject=claim.subject,
                        predicate=claim.predicate,
                        object=str(claim.object),
                        evidence=claim.evidence,
                    )
                    session.run(
                        """
                        MERGE (subject:OntologyEntity {name: $subject})
                        MERGE (claim:DocumentClaim {claim_id: $claim_id})
                        MERGE (claim)-[:ABOUT_SUBJECT]->(subject)
                        """,
                        claim_id=claim_id,
                        subject=claim.subject,
                    )
                    if isinstance(claim.object, str):
                        session.run(
                            """
                            MERGE (target:OntologyEntity {name: $target})
                            MERGE (claim:DocumentClaim {claim_id: $claim_id})
                            MERGE (claim)-[:ABOUT_OBJECT]->(target)
                            """,
                            claim_id=claim_id,
                            target=claim.object,
                        )
                for spec in code_specs:
                    session.run(
                        """
                        MERGE (c:CodeCallable {module_path: $module_path, qualname: $qualname})
                        SET c.docstring = $docstring
                        """,
                        module_path=spec.module_path,
                        qualname=spec.qualname,
                        docstring=spec.docstring,
                    )
                    for entity_name in spec.referenced_entities:
                        session.run(
                            """
                            MERGE (c:CodeCallable {module_path: $module_path, qualname: $qualname})
                            MERGE (e:OntologyEntity {name: $entity_name})
                            MERGE (c)-[:MENTIONS_ENTITY]->(e)
                            """,
                            module_path=spec.module_path,
                            qualname=spec.qualname,
                            entity_name=entity_name,
                        )
                    for target in spec.mentioned_targets:
                        session.run(
                            """
                            MERGE (c:CodeCallable {module_path: $module_path, qualname: $qualname})
                            MERGE (e:OntologyEntity {name: $entity_name})
                            MERGE (c)-[:MENTIONS_TARGET]->(e)
                            """,
                            module_path=spec.module_path,
                            qualname=spec.qualname,
                            entity_name=target,
                        )
        finally:
            driver.close()

    def enrich_findings(self, findings: list[Finding]) -> list[GraphEvidenceHit]:
        hits: list[GraphEvidenceHit] = []
        driver = None
        try:
            if GraphDatabase is None:
                raise RuntimeError("neo4j is not installed.")
            driver = GraphDatabase.driver(
                self.settings.uri,
                auth=(self.settings.username, self.settings.password),
            )
            with driver.session(database=self.settings.database) as session:
                for finding in findings:
                    related_entities = _extract_entities_from_finding(finding)
                    self._persist_finding(session, finding, related_entities)
                    records = self._query_related_context(session, related_entities)
                    if records:
                        evidence_text, impact_path = _summarize_graph_records(records)
                    else:
                        evidence_text, impact_path = (
                            f"Graph evidence available for {finding.finding_type}.",
                            [],
                        )
                    hits.append(
                        GraphEvidenceHit(
                            finding_key=_finding_key(finding),
                            evidence_text=evidence_text,
                            related_entities=related_entities,
                            impact_path=impact_path,
                            source="neo4j",
                            metadata={"record_count": len(records)},
                        )
                    )
        except Exception:
            return [
                GraphEvidenceHit(
                    finding_key=_finding_key(finding),
                    evidence_text=f"Graph evidence available for {finding.finding_type}.",
                    related_entities=_extract_entities_from_finding(finding),
                    source="neo4j",
                    metadata={"fallback": True},
                )
                for finding in findings
            ]
        finally:
            if driver is not None:
                driver.close()
        return hits

    def check_ready(self, timeout_seconds: float = 5.0) -> tuple[bool, str]:
        if GraphDatabase is None:
            return False, "neo4j is not installed."
        driver = GraphDatabase.driver(
            self.settings.uri,
            auth=(self.settings.username, self.settings.password),
            connection_timeout=timeout_seconds,
        )
        try:
            with driver.session(database=self.settings.database) as session:
                session.run("RETURN 1 AS ok").consume()
            return True, f"Neo4j database '{self.settings.database}' is reachable."
        except Exception as exc:
            return False, str(exc)
        finally:
            driver.close()

    def backend_info(self) -> dict[str, Any]:
        return {
            "backend": "neo4j",
            "uri": self.settings.uri,
            "database": self.settings.database,
        }

    def close(self) -> None:
        return None

    def _persist_finding(self, session, finding: Finding, related_entities: list[str]) -> None:
        finding_key = _finding_key(finding)
        session.run(
            """
            MERGE (f:Finding {finding_key: $finding_key})
            SET f.finding_type = $finding_type,
                f.expected = $expected,
                f.found = $found,
                f.evidence = $evidence
            """,
            finding_key=finding_key,
            finding_type=finding.finding_type,
            expected=finding.expected,
            found=finding.found,
            evidence=finding.evidence,
        )
        for entity_name in related_entities:
            session.run(
                """
                MERGE (f:Finding {finding_key: $finding_key})
                MERGE (e:OntologyEntity {name: $entity_name})
                MERGE (f)-[:RELATES_TO]->(e)
                """,
                finding_key=finding_key,
                entity_name=entity_name,
            )

    def _query_related_context(self, session, related_entities: list[str]) -> list[dict[str, list[str] | str]]:
        if not related_entities:
            return []
        records = session.run(
            """
            UNWIND $entities AS entity_name
            MATCH (e:OntologyEntity {name: entity_name})
            OPTIONAL MATCH (e)<-[:MENTIONS_ENTITY]-(c:CodeCallable)
            OPTIONAL MATCH (e)<-[:ABOUT_SUBJECT|ABOUT_OBJECT]-(claim:DocumentClaim)<-[:HAS_CLAIM]-(section:DocumentSection)
            RETURN entity_name AS entity,
                   collect(DISTINCT c.qualname)[0..3] AS callables,
                   collect(DISTINCT section.source_file + '#' + section.section)[0..3] AS sections
            """,
            entities=related_entities,
        )
        return [record.data() for record in records]


def _finding_key(finding: Finding) -> str:
    return "|".join([finding.finding_type, finding.expected, finding.found, finding.evidence])


def _extract_entities_from_finding(finding: Finding) -> list[str]:
    tokens = set()
    for part in (finding.expected, finding.found, finding.evidence):
        for token in part.replace("'", " ").replace('"', " ").split():
            if token[:1].isupper():
                tokens.add(token.strip(".,:;()[]"))
    return sorted(tokens)


def _summarize_graph_records(records: list[dict[str, list[str] | str]]) -> tuple[str, list[str]]:
    snippets: list[str] = []
    impact_path: list[str] = []
    for record in records:
        entity = str(record.get("entity", ""))
        callables = [value for value in record.get("callables", []) if value]
        sections = [value for value in record.get("sections", []) if value]
        if callables:
            snippets.append(f"{entity} is referenced by code callables {callables}.")
            impact_path.extend([f"{entity} -> CodeCallable:{callable_name}" for callable_name in callables])
        if sections:
            snippets.append(f"{entity} appears in document sections {sections}.")
            impact_path.extend([f"{entity} -> DocumentSection:{section}" for section in sections])
    if not snippets:
        return "Graph evidence available but no related downstream nodes were found.", impact_path
    return " ".join(snippets), impact_path
