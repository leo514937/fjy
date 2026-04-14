from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel


class RawEntityMention(BaseModel):
    text: str
    label: str
    start: int
    end: int
    confidence: float | None = None


class BaseNerProvider(ABC):
    @abstractmethod
    def extract(self, text: str) -> list[RawEntityMention]:
        raise NotImplementedError
