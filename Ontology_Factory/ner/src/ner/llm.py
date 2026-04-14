from __future__ import annotations

import json
import os
from typing import Any

import httpx
from pydantic import BaseModel, Field

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - optional dependency for local env loading
    def load_dotenv() -> None:
        return None

from ner.schema import NerEntity


class OpenRouterConfig(BaseModel):
    enabled: bool = False
    api_key: str = ""
    base_url: str = "https://openrouter.ai/api/v1"
    model: str = ""
    timeout_s: float = 60.0
    app_name: str = "ontology-factory"

    @classmethod
    def from_mapping(cls, payload: dict[str, Any] | None) -> "OpenRouterConfig":
        load_dotenv()
        payload = payload or {}
        api_key = str(payload.get("api_key", "")).strip()
        api_key_env = str(payload.get("api_key_env", "")).strip()
        model = str(payload.get("model", "")).strip()
        model_env = str(payload.get("model_env", "")).strip()
        if not api_key and api_key_env:
            api_key = os.environ.get(api_key_env, "").strip()
        if not model and model_env:
            model = os.environ.get(model_env, "").strip()
        if not model:
            model = os.environ.get("OPENROUTER_MODEL", "").strip()
        base_url = str(payload.get("base_url", "")).strip() or os.environ.get(
            "OPENROUTER_BASE_URL",
            "https://openrouter.ai/api/v1",
        ).strip()
        app_name = str(payload.get("app_name", "")).strip() or os.environ.get(
            "OPENROUTER_APP_NAME",
            "ontology-factory",
        ).strip()
        enabled = bool(payload.get("enabled", bool(api_key and model)))
        return cls(
            enabled=enabled,
            api_key=api_key,
            base_url=base_url,
            model=model,
            timeout_s=float(payload.get("timeout_s", 60.0)),
            app_name=app_name,
        )


class OpenRouterClient:
    def __init__(self, config: OpenRouterConfig) -> None:
        self.config = config

    def is_enabled(self) -> bool:
        return bool(
            self.config.enabled
            and self.config.api_key.strip()
            and self.config.base_url.strip()
            and self.config.model.strip()
        )

    def enhance_entities(self, *, doc_id: str, text: str, entities: list[NerEntity]) -> dict[str, dict[str, Any]]:
        if not self.is_enabled() or not entities:
            return {}

        prompt_entities = [
            {
                "entity_id": entity.entity_id,
                "text": entity.text,
                "normalized_text": entity.normalized_text,
                "label": entity.label,
                "source_sentence": entity.source_sentence,
            }
            for entity in entities
        ]
        payload = self._chat_json(
            system_prompt=(
                "你是工程文档 NER 增强器。"
                "只做保守增强：规范化别名、修正实体标签、补一行简短描述。"
                "不要凭空创造不存在的实体。"
                "返回 JSON 对象，格式必须为 {\"entities\": [{...}] }。"
            ),
            user_prompt=json.dumps(
                {
                    "doc_id": doc_id,
                    "text_preview": text[:4000],
                    "entities": prompt_entities,
                },
                ensure_ascii=False,
            ),
        )
        result: dict[str, dict[str, Any]] = {}
        for item in payload.get("entities", []):
            if not isinstance(item, dict):
                continue
            entity_id = str(item.get("entity_id", "")).strip()
            if not entity_id:
                continue
            result[entity_id] = {
                "normalized_text": str(item.get("normalized_text", "")).strip(),
                "label": str(item.get("label", "")).strip(),
                "llm_description": str(item.get("description", "")).strip(),
                "llm_ran": str(item.get("ran", "")).strip(),
                "llm_ti": str(item.get("ti", "")).strip(),
                "normalization_notes": str(item.get("notes", "")).strip(),
                "llm_enhanced": True,
            }
        return result

    def resolve_canonical_entities(
        self,
        entities: list[NerEntity],
        candidates_by_entity: dict[str, list[Any]],
    ) -> dict[str, str]:
        if not self.is_enabled() or not entities or not candidates_by_entity:
            return {}

        prompt_entities = []
        for entity in entities:
            candidates = candidates_by_entity.get(entity.entity_id, [])
            if not candidates:
                continue
            prompt_entities.append(
                {
                    "entity_id": entity.entity_id,
                    "text": entity.text,
                    "normalized_text": entity.normalized_text,
                    "label": entity.label,
                    "source_sentence": entity.source_sentence,
                    "candidates": [
                        {
                            "canonical_id": getattr(candidate, "canonical_id", ""),
                            "preferred_name": getattr(candidate, "preferred_name", ""),
                            "normalized_text": getattr(candidate, "normalized_text", ""),
                            "ner_label": getattr(candidate, "ner_label", ""),
                            "mention_count": getattr(candidate, "mention_count", 0),
                        }
                        for candidate in candidates
                    ],
                }
            )
        if not prompt_entities:
            return {}

        payload = self._chat_json(
            system_prompt=(
                "你是工业本体对齐助手。"
                "任务是判断文档里的实体是否与已有 canonical 实体同一。"
                "只在把握较高时返回 canonical_id，否则返回空字符串。"
                "不要创造新的 canonical_id。"
                "返回 JSON 对象，格式必须为 {\"matches\": [{\"entity_id\": \"...\", \"canonical_id\": \"...\"}]}。"
            ),
            user_prompt=json.dumps({"entities": prompt_entities}, ensure_ascii=False),
        )
        matches: dict[str, str] = {}
        for item in payload.get("matches", []):
            if not isinstance(item, dict):
                continue
            entity_id = str(item.get("entity_id", "")).strip()
            canonical_id = str(item.get("canonical_id", "")).strip()
            if entity_id and canonical_id:
                matches[entity_id] = canonical_id
        return matches

    def chat_json(self, *, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        if not self.is_enabled():
            raise RuntimeError("OpenRouter client is disabled.")
        trace = self._chat_json_with_trace(system_prompt=system_prompt, user_prompt=user_prompt)
        return dict(trace["parsed"])

    def chat_json_with_trace(self, *, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        if not self.is_enabled():
            raise RuntimeError("OpenRouter client is disabled.")
        return self._chat_json_with_trace(system_prompt=system_prompt, user_prompt=user_prompt)

    def _chat_json(self, *, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        trace = self._chat_json_with_trace(system_prompt=system_prompt, user_prompt=user_prompt)
        return dict(trace["parsed"])

    def _chat_json_with_trace(self, *, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        url = self.config.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/ontology-factory",
            "X-Title": self.config.app_name,
        }
        payload = {
            "model": self.config.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        with httpx.Client(timeout=self.config.timeout_s) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise RuntimeError("OpenRouter response must be a JSON object.")
        return {
            "parsed": parsed,
            "request": {
                "url": url,
                "payload": payload,
            },
            "response": {
                "raw_text": content,
                "payload": data,
            },
        }
