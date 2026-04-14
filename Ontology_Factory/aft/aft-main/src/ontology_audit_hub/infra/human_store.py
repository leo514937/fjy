from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

from ontology_audit_hub.domain.audit.models import HumanInputCard


class HumanInteractionStore(Protocol):
    def save_pending(
        self,
        session_id: str,
        resume_token: str | None,
        card: HumanInputCard,
        current_phase: str,
    ) -> None:
        """Persist a pending human interaction payload."""

    def load_pending(self, session_id: str) -> dict[str, object] | None:
        """Load a previously stored pending human interaction payload."""

    def clear_pending(self, session_id: str) -> None:
        """Delete a pending human interaction payload."""


class FileHumanInteractionStore:
    def __init__(self, base_path: str | Path = "artifacts/runs") -> None:
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def save_pending(
        self,
        session_id: str,
        resume_token: str | None,
        card: HumanInputCard,
        current_phase: str,
    ) -> None:
        payload = {
            "session_id": session_id,
            "resume_token": resume_token,
            "current_phase": current_phase,
            "human_card": card.model_dump(mode="json"),
        }
        self._path_for(session_id).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def load_pending(self, session_id: str) -> dict[str, object] | None:
        path = self._path_for(session_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def clear_pending(self, session_id: str) -> None:
        path = self._path_for(session_id)
        if path.exists():
            path.unlink()

    def _path_for(self, session_id: str) -> Path:
        session_dir = self.base_path / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir / "pending_human.json"
