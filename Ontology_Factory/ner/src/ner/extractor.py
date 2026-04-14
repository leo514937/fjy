from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from typing import Any

from ner.llm import OpenRouterClient
from ner.providers.base import BaseNerProvider, RawEntityMention
from ner.providers.hanlp_provider import HanLPNerProvider
from ner.schema import NerDocument, NerEntity

_WHITESPACE_RE = re.compile(r"\s+")
_PUNCT_ONLY_RE = re.compile(r"^[\W_]+$", re.UNICODE)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；\n])")
_MAX_LLM_ENTITY_COUNT = 60
_MAX_LLM_TEXT_CHARS = 4000


def extract_entities(
    text: str,
    *,
    doc_id: str,
    use_llm: bool = True,
    provider: BaseNerProvider | None = None,
    llm_client: OpenRouterClient | None = None,
) -> NerDocument:
    provider = provider or HanLPNerProvider()
    raw_mentions = provider.extract(text)
    entities = _merge_mentions(raw_mentions=raw_mentions, text=text, doc_id=doc_id)
    if use_llm and llm_client is not None and entities:
        if len(entities) > _MAX_LLM_ENTITY_COUNT or len(text) > _MAX_LLM_TEXT_CHARS:
            for entity in entities:
                entity.metadata["llm_enhanced"] = False
                entity.metadata["llm_skipped"] = True
                entity.metadata["llm_skip_reason"] = (
                    f"entity_count={len(entities)} text_chars={len(text)} exceeds "
                    f"limits({_MAX_LLM_ENTITY_COUNT}, {_MAX_LLM_TEXT_CHARS})"
                )
        else:
            try:
                enhancements = llm_client.enhance_entities(doc_id=doc_id, text=text, entities=entities)
                entities = _apply_enhancements(entities, enhancements)
            except Exception as exc:
                for entity in entities:
                    entity.metadata["llm_enhanced"] = False
                    entity.metadata["llm_error"] = f"{type(exc).__name__}: {exc}"
    return NerDocument(doc_id=doc_id, source_text=text, entities=entities)


def _merge_mentions(*, raw_mentions: list[RawEntityMention], text: str, doc_id: str) -> list[NerEntity]:
    grouped: dict[tuple[str, str], list[RawEntityMention]] = defaultdict(list)
    for mention in raw_mentions:
        normalized_text = _normalize_entity_text(mention.text)
        if _is_noise(normalized_text):
            continue
        mention = RawEntityMention(
            text=mention.text.strip(),
            label=mention.label.strip() or "TERM",
            start=max(0, mention.start),
            end=max(mention.start, mention.end),
            confidence=mention.confidence,
        )
        grouped[(normalized_text, mention.label)].append(mention)

    entities: list[NerEntity] = []
    for (normalized_text, label), mentions in grouped.items():
        ordered_mentions = sorted(mentions, key=lambda item: (item.start, item.end))
        surface_counter = Counter(item.text.strip() for item in ordered_mentions if item.text.strip())
        preferred_text = surface_counter.most_common(1)[0][0] if surface_counter else normalized_text
        first = ordered_mentions[0]
        sentence = _extract_sentence(text, first.start, first.end)
        entity = NerEntity(
            entity_id=_build_entity_id(doc_id, normalized_text, label),
            text=preferred_text,
            normalized_text=normalized_text,
            label=label,
            start=first.start,
            end=first.end,
            confidence=_mean_confidence(ordered_mentions),
            source_sentence=sentence,
            metadata={
                "mentions": [
                    {
                        "text": mention.text,
                        "start": mention.start,
                        "end": mention.end,
                        "confidence": mention.confidence,
                    }
                    for mention in ordered_mentions
                ],
                "occurrence_count": len(ordered_mentions),
                "source_sentences": _unique_preserve_order(
                    _extract_sentence(text, mention.start, mention.end) for mention in ordered_mentions
                ),
                "normalization_notes": "",
                "llm_enhanced": False,
            },
        )
        entities.append(entity)
    return sorted(entities, key=lambda item: (item.start, item.end, item.normalized_text))


def _apply_enhancements(entities: list[NerEntity], enhancements: dict[str, dict[str, Any]]) -> list[NerEntity]:
    enhanced_entities: list[NerEntity] = []
    for entity in entities:
        payload = enhancements.get(entity.entity_id, {})
        updated = entity.model_copy(deep=True)
        normalized_text = str(payload.get("normalized_text", "")).strip()
        label = str(payload.get("label", "")).strip()
        if normalized_text:
            updated.normalized_text = normalized_text
        if label:
            updated.label = label
        updated.metadata["llm_description"] = str(payload.get("llm_description", "")).strip()
        updated.metadata["llm_ran"] = str(payload.get("llm_ran", "")).strip()
        updated.metadata["llm_ti"] = str(payload.get("llm_ti", "")).strip()
        updated.metadata["normalization_notes"] = str(payload.get("normalization_notes", "")).strip()
        updated.metadata["llm_enhanced"] = bool(payload.get("llm_enhanced", False))
        enhanced_entities.append(updated)
    return enhanced_entities


def _normalize_entity_text(value: str) -> str:
    text = _WHITESPACE_RE.sub(" ", value).strip(" \t\r\n,.;:()[]{}<>\"'“”‘’")
    return text


def _is_noise(value: str) -> bool:
    if not value:
        return True
    if _PUNCT_ONLY_RE.match(value):
        return True
    if len(value) == 1 and not value.isupper():
        return True
    if len(value) < 2 and not any(char.isdigit() for char in value):
        return True
    return False


def _extract_sentence(text: str, start: int, end: int) -> str:
    if not text:
        return ""
    cursor = 0
    for piece in _SENTENCE_SPLIT_RE.split(text):
        sentence = piece.strip()
        next_cursor = cursor + len(piece)
        if sentence and cursor <= start <= next_cursor:
            return sentence
        cursor = next_cursor
    return text[max(0, start - 40) : min(len(text), end + 40)].strip()


def _mean_confidence(mentions: list[RawEntityMention]) -> float | None:
    values = [mention.confidence for mention in mentions if mention.confidence is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _build_entity_id(doc_id: str, normalized_text: str, label: str) -> str:
    digest = hashlib.sha1(f"{doc_id}|{normalized_text}|{label}".encode("utf-8")).hexdigest()[:12]
    return f"ent_{digest}"


def _unique_preserve_order(values):
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
