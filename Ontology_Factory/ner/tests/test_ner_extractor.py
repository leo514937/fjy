from __future__ import annotations

from ner.extractor import extract_entities
from ner.providers.base import BaseNerProvider, RawEntityMention


class FakeProvider(BaseNerProvider):
    def extract(self, text: str) -> list[RawEntityMention]:
        return [
            RawEntityMention(text="溶氧", label="TERM", start=0, end=2, confidence=0.9),
            RawEntityMention(text="溶氧", label="TERM", start=6, end=8, confidence=0.8),
            RawEntityMention(text=";", label="TERM", start=12, end=13, confidence=0.1),
            RawEntityMention(text="ESP8266", label="TECH", start=14, end=21, confidence=0.95),
        ]


class FailingLlmClient:
    def enhance_entities(self, *, doc_id: str, text: str, entities):
        raise RuntimeError("network down")


def test_extract_entities_merges_duplicates_and_filters_noise() -> None:
    doc = extract_entities(
        "溶氧保持稳定，溶氧传感器连接ESP8266模块。",
        doc_id="doc-1",
        use_llm=False,
        provider=FakeProvider(),
    )

    assert len(doc.entities) == 2
    assert doc.entities[0].normalized_text == "溶氧"
    assert doc.entities[0].metadata["occurrence_count"] == 2
    assert doc.entities[1].normalized_text == "ESP8266"


def test_extract_entities_falls_back_when_llm_enhancement_fails() -> None:
    doc = extract_entities(
        "溶氧保持稳定。",
        doc_id="doc-2",
        use_llm=True,
        provider=FakeProvider(),
        llm_client=FailingLlmClient(),
    )

    assert doc.entities
    assert doc.entities[0].metadata["llm_enhanced"] is False
    assert "llm_error" in doc.entities[0].metadata
