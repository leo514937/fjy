from __future__ import annotations

import json
import os
from dataclasses import dataclass
import time
from typing import Any, Dict, Optional

import httpx

from .base import ModelOutput


_SYSTEM_PROMPT = """你是工程文档清洗器。目标是把输入文本做“低风险、保守”的降噪清洗，只输出干净文本。

严格约束：
- 宁可漏修，也不要猜测或改写事实。
- 禁止改动任何数字、单位、符号表达式（例如 0.5、10kV、±、≤、mm、℃、kN、MPa）。
- 允许的改动仅限：去除明显页眉页脚/页码、去除重复行、修复断行/多余空格、修复明显编码控制字符、去除无意义分隔线。
- 不要补全缺失内容，不要添加新信息。

输出格式必须是 json对象，字段如下：
{{
  "cleaned_text": "string",
  "confidence": 0.0-1.0,
  "notes": "简短说明你做了哪些低风险清洗"
}}
"""


@dataclass(frozen=True)
class OpenAICompatClient:
    name: str
    base_url: str
    api_key_env: str
    model: str
    timeout_s: int = 60

    def clean_text(self, text: str) -> ModelOutput:
        # Backward-compatible behavior:
        # - If api_key_env matches an environment variable, use its value.
        # - Otherwise treat api_key_env itself as a direct API key string.
        api_key = os.environ.get(self.api_key_env, "")
        if not api_key:
            api_key = self.api_key_env.strip()
        if not api_key:
            raise RuntimeError("Missing API key (set env var or put key in api_key_env).")

        url = self.base_url.rstrip("/") + "/chat/completions"
        payload: Dict[str, Any] = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
        }

        headers = {"Authorization": f"Bearer {api_key}"}
        print(
            f"[REQ] name={self.name} model={self.model} base_url={self.base_url} "
            f"text_chars={len(text)} timeout_s={self.timeout_s} response_format=json_object"
        )
        started = time.perf_counter()
        with httpx.Client(timeout=self.timeout_s) as client:
            resp = client.post(url, json=payload, headers=headers)
            elapsed = time.perf_counter() - started
            print(f"[RESP] name={self.name} status={resp.status_code} elapsed_s={elapsed:.2f} body_chars={len(resp.text)}")
            resp.raise_for_status()
            data = resp.json()

        try:
            content = data["choices"][0]["message"]["content"]
        except Exception as e:
            raise RuntimeError(f"Bad response shape from {self.name}") from e

        try:
            obj = json.loads(content)
        except Exception as e:
            raise RuntimeError(f"Model {self.name} did not return valid JSON") from e

        print(f"[PARSE] name={self.name} content_chars={len(content)} keys={sorted(obj.keys())}")
        cleaned = str(obj.get("cleaned_text", ""))
        confidence = float(obj.get("confidence", 0.0))
        notes = str(obj.get("notes", ""))
        return ModelOutput(name=self.name, cleaned_text=cleaned, confidence=confidence, notes=notes)

