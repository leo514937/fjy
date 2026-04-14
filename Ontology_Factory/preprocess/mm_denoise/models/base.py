from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ModelOutput:
    name: str
    cleaned_text: str
    confidence: float
    notes: str


class ModelClient(Protocol):
    def clean_text(self, text: str) -> ModelOutput: ...

