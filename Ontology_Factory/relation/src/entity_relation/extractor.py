from __future__ import annotations

import hashlib
import itertools
from typing import Iterable

from entity_relation.schema import EntityRelation, RelationDocument
from ner.schema import NerDocument, NerEntity

_RELATION_PATTERNS: list[tuple[str, tuple[str, ...], float, bool]] = [
    ("controls", ("控制", "调节", "驱动", "启停", "开关"), 0.82, False),
    ("monitors", ("监测", "检测", "采集", "测量", "查看"), 0.8, False),
    ("reports_to", ("上传", "上报", "发送", "同步", "推送"), 0.78, False),
    ("connected_to", ("连接", "接入", "串口", "联网", "配网"), 0.75, False),
    ("uses", ("基于", "使用", "采用", "依托"), 0.72, False),
    ("co_occurs_with", tuple(), 0.35, True),
]


def extract_relations(document: NerDocument) -> RelationDocument:
    sentence_groups = _group_entities_by_sentence(document.entities)
    relations: list[EntityRelation] = []
    seen_keys: set[tuple[str, str, str]] = set()

    for sentence, entities in sentence_groups.items():
        ordered = _order_entities_in_sentence(sentence, entities)
        if len(ordered) < 2:
            continue
        relation_type, confidence, symmetric = _infer_relation(sentence)
        for source, target in _iter_entity_pairs(ordered):
            dedupe_key = _dedupe_relation_key(source, target, relation_type, symmetric)
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            relations.append(
                EntityRelation(
                    relation_id=_build_relation_id(document.doc_id, source.entity_id, target.entity_id, relation_type),
                    source_entity_id=source.entity_id,
                    target_entity_id=target.entity_id,
                    source_text=source.normalized_text or source.text,
                    target_text=target.normalized_text or target.text,
                    relation_type=relation_type,
                    confidence=confidence,
                    evidence_sentence=sentence,
                    metadata={"symmetric": symmetric},
                )
            )

    return RelationDocument(doc_id=document.doc_id, relations=relations)


def _group_entities_by_sentence(entities: Iterable[NerEntity]) -> dict[str, list[NerEntity]]:
    groups: dict[str, list[NerEntity]] = {}
    for entity in entities:
        sentences = list(entity.metadata.get("source_sentences", [])) or [entity.source_sentence]
        for sentence in sentences:
            sentence = str(sentence).strip()
            if not sentence:
                continue
            groups.setdefault(sentence, []).append(entity)
    return groups


def _order_entities_in_sentence(sentence: str, entities: list[NerEntity]) -> list[NerEntity]:
    unique: list[NerEntity] = []
    seen_ids: set[str] = set()
    for entity in sorted(entities, key=lambda item: _sentence_index(sentence, item)):
        if entity.entity_id in seen_ids:
            continue
        seen_ids.add(entity.entity_id)
        unique.append(entity)
    return unique


def _sentence_index(sentence: str, entity: NerEntity) -> int:
    index = sentence.find(entity.normalized_text or entity.text)
    if index >= 0:
        return index
    return 10**6 + entity.start


def _infer_relation(sentence: str) -> tuple[str, float, bool]:
    for relation_type, keywords, confidence, symmetric in _RELATION_PATTERNS:
        if not keywords:
            continue
        if any(keyword in sentence for keyword in keywords):
            return relation_type, confidence, symmetric
    relation_type, _, confidence, symmetric = _RELATION_PATTERNS[-1]
    return relation_type, confidence, symmetric


def _iter_entity_pairs(entities: list[NerEntity]):
    if len(entities) == 2:
        yield entities[0], entities[1]
        return
    for left, right in itertools.pairwise(entities):
        yield left, right


def _dedupe_relation_key(
    source: NerEntity,
    target: NerEntity,
    relation_type: str,
    symmetric: bool,
) -> tuple[str, str, str]:
    left = source.normalized_text or source.text
    right = target.normalized_text or target.text
    if symmetric and left > right:
        left, right = right, left
    return (left, relation_type, right)


def _build_relation_id(doc_id: str, source_entity_id: str, target_entity_id: str, relation_type: str) -> str:
    digest = hashlib.sha1(f"{doc_id}|{source_entity_id}|{target_entity_id}|{relation_type}".encode("utf-8")).hexdigest()[:12]
    return f"rel_{digest}"
