from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Protocol

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver


class CheckpointStoreFactory(Protocol):
    @contextmanager
    def open(self) -> Iterator[BaseCheckpointSaver]:
        """Yield a configured checkpoint saver."""


class MemoryCheckpointStoreFactory:
    @contextmanager
    def open(self) -> Iterator[BaseCheckpointSaver]:
        yield MemorySaver()


class SqliteCheckpointStoreFactory:
    def __init__(self, path: str | Path = "artifacts/checkpoints/audit_sessions.sqlite3") -> None:
        self.path = Path(path)

    @contextmanager
    def open(self) -> Iterator[BaseCheckpointSaver]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with SqliteSaver.from_conn_string(str(self.path)) as saver:
            yield saver
