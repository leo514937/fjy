from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from ner.providers.base import BaseNerProvider, RawEntityMention

_ASCII_ENTITY_PATTERN = re.compile(r"\b[A-Za-z][A-Za-z0-9_.+-]{1,31}\b")
_CHINESE_ENTITY_PATTERN = re.compile(r"[\u4e00-\u9fff]{2,12}")
_STOPWORDS = {
    "项目",
    "系统",
    "模块",
    "平台",
    "数据",
    "功能",
    "进行",
    "实现",
    "负责",
    "用于",
    "以及",
    "当前",
}
_DOMAIN_TERMS = (
    "溶氧",
    "投喂机",
    "鱼群密度",
    "水温",
    "光照",
    "OneNet",
    "ESP8266",
    "Arduino",
    "FastAPI",
)


class HanLPNerProvider(BaseNerProvider):
    def __init__(self, model_name: str = "MSRA_NER_BERT_BASE_ZH") -> None:
        self.model_name = model_name

    def extract(self, text: str) -> list[RawEntityMention]:
        mentions = self._extract_with_hanlp(text)
        if mentions:
            return mentions
        return self._fallback_extract(text)

    def _extract_with_hanlp(self, text: str) -> list[RawEntityMention]:
        try:
            pipeline = _load_hanlp_model(self.model_name)
        except Exception:
            return []

        try:
            raw_output = pipeline(text)
        except Exception:
            return []
        return _flatten_hanlp_output(raw_output, text)

    def _fallback_extract(self, text: str) -> list[RawEntityMention]:
        mentions: list[RawEntityMention] = []
        seen: set[tuple[int, int, str]] = set()
        for match in _ASCII_ENTITY_PATTERN.finditer(text):
            entity = RawEntityMention(
                text=match.group(0),
                label="TECH",
                start=match.start(),
                end=match.end(),
                confidence=0.45,
            )
            key = (entity.start, entity.end, entity.label)
            if key not in seen:
                seen.add(key)
                mentions.append(entity)

        for term in _DOMAIN_TERMS:
            for start in _find_all(text, term):
                entity = RawEntityMention(
                    text=term,
                    label="TERM",
                    start=start,
                    end=start + len(term),
                    confidence=0.65,
                )
                key = (entity.start, entity.end, entity.label)
                if key not in seen:
                    seen.add(key)
                    mentions.append(entity)

        for match in _CHINESE_ENTITY_PATTERN.finditer(text):
            candidate = match.group(0)
            if candidate in _STOPWORDS:
                continue
            if candidate.endswith(("进行", "实现", "负责", "支持")):
                continue
            entity = RawEntityMention(
                text=candidate,
                label="TERM",
                start=match.start(),
                end=match.end(),
                confidence=0.3,
            )
            key = (entity.start, entity.end, entity.label)
            if key not in seen:
                seen.add(key)
                mentions.append(entity)
        return sorted(mentions, key=lambda item: (item.start, item.end, item.text))


@lru_cache(maxsize=4)
def _load_hanlp_model(model_name: str) -> Any:
    import hanlp  # type: ignore

    return hanlp.load(model_name)


def _flatten_hanlp_output(raw_output: Any, text: str) -> list[RawEntityMention]:
    mentions: list[RawEntityMention] = []
    for item in _iterate_candidates(raw_output):
        mention = _parse_candidate(item, text)
        if mention is not None:
            mentions.append(mention)
    dedup: dict[tuple[int, int, str], RawEntityMention] = {}
    for mention in mentions:
        dedup[(mention.start, mention.end, mention.label)] = mention
    return sorted(dedup.values(), key=lambda item: (item.start, item.end, item.text))


def _iterate_candidates(value: Any):
    if isinstance(value, dict):
        for child in value.values():
            yield from _iterate_candidates(child)
        return
    if isinstance(value, (list, tuple)):
        if _looks_like_entity_tuple(value):
            yield value
            return
        for child in value:
            yield from _iterate_candidates(child)


def _looks_like_entity_tuple(value: list[Any] | tuple[Any, ...]) -> bool:
    if len(value) < 3:
        return False
    primitives = sum(isinstance(item, (str, int, float)) for item in value[:4])
    return primitives >= 3


def _parse_candidate(value: list[Any] | tuple[Any, ...], text: str) -> RawEntityMention | None:
    items = list(value)
    if len(items) >= 4 and isinstance(items[0], str) and isinstance(items[1], str) and isinstance(items[2], int) and isinstance(items[3], int):
        return RawEntityMention(
            text=items[0],
            label=items[1],
            start=items[2],
            end=items[3],
            confidence=float(items[4]) if len(items) > 4 and isinstance(items[4], (int, float)) else None,
        )
    if len(items) >= 4 and isinstance(items[0], int) and isinstance(items[1], int) and isinstance(items[2], str) and isinstance(items[3], str):
        return RawEntityMention(
            text=items[3],
            label=items[2],
            start=items[0],
            end=items[1],
            confidence=float(items[4]) if len(items) > 4 and isinstance(items[4], (int, float)) else None,
        )
    if len(items) >= 3 and isinstance(items[0], str) and isinstance(items[1], str):
        start = text.find(items[0])
        if start >= 0:
            return RawEntityMention(
                text=items[0],
                label=items[1],
                start=start,
                end=start + len(items[0]),
                confidence=float(items[2]) if isinstance(items[2], (int, float)) else None,
            )
    return None


def _find_all(text: str, needle: str) -> list[int]:
    starts: list[int] = []
    cursor = 0
    while True:
        index = text.find(needle, cursor)
        if index < 0:
            return starts
        starts.append(index)
        cursor = index + len(needle)
