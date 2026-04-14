from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv


def workspace_root() -> Path:
    return Path(__file__).resolve().parents[3]


def ensure_local_imports() -> None:
    root = workspace_root()
    load_dotenv(root / ".env")
    candidates = [
        root / "WIKI_MG" / "src",
        root / "wiki_agent" / "src",
        root / "ner" / "src",
        root / "relation" / "src",
        root / "storage" / "src",
        root / "ontology_core" / "src",
        root / "evolution" / "src",
        root / "dls" / "src",
        root / "preprocess",
    ]
    for candidate in candidates:
        resolved = str(candidate)
        if candidate.exists() and resolved not in sys.path:
            sys.path.insert(0, resolved)
