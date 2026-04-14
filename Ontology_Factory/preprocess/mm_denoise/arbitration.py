from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple

from .clean_rules import numbers_preserved
from .config import ArbitrationConfig
from .models.base import ModelOutput


@dataclass(frozen=True)
class ArbitrationResult:
    chosen_name: str
    clean_text: str
    rationale: str
    rejected: list[str]


def _relative_change(a: str, b: str) -> float:
    if not a and not b:
        return 0.0
    sm = difflib.SequenceMatcher(a=a, b=b)
    # ratio is similarity; change is 1 - similarity
    return 1.0 - sm.ratio()


def _passes_conservative_guards(
    original: str,
    candidate: str,
    cfg: ArbitrationConfig,
) -> tuple[bool, str]:
    if cfg.require_numbers_preserved and not numbers_preserved(original, candidate):
        return False, "numbers_changed"
    chg = _relative_change(original, candidate)
    if chg > cfg.max_relative_change:
        return False, f"too_much_change({chg:.3f})"
    return True, "ok"


def choose_best_candidate(
    original: str,
    candidates: Iterable[ModelOutput],
    cfg: ArbitrationConfig,
) -> ArbitrationResult:
    cand_list = list(candidates)
    print(f"[ARBITRATION_START] candidates={len(cand_list)} original_chars={len(original)}")
    rejected: list[str] = []
    accepted: list[tuple[ModelOutput, float]] = []

    for c in cand_list:
        ok, reason = _passes_conservative_guards(original, c.cleaned_text, cfg)
        if not ok:
            rejected.append(f"{c.name}:{reason}")
            print(f"[ARBITRATION_REJECT] name={c.name} reason={reason}")
            continue
        change = _relative_change(original, c.cleaned_text)
        accepted.append((c, change))
        print(f"[ARBITRATION_ACCEPT] name={c.name} change={change:.3f} confidence={c.confidence}")

    if not accepted:
        # fallback to minimal change among all (even if rejected), but keep original as safest
        print("[ARBITRATION_FALLBACK] chosen=original reason=no_candidate_passed_guards")
        return ArbitrationResult(
            chosen_name="original",
            clean_text=original,
            rationale="no_candidate_passed_guards",
            rejected=rejected,
        )

    # Optional: require two models agree (exact match after stripping)
    if cfg.require_two_models_agree:
        norm_map: dict[str, list[str]] = {}
        for c, _chg in accepted:
            key = c.cleaned_text.strip()
            norm_map.setdefault(key, []).append(c.name)
        best_key = None
        best_names: list[str] = []
        for k, names in norm_map.items():
            if len(names) >= 2:
                if best_key is None or len(names) > len(best_names):
                    best_key, best_names = k, names
        if best_key is not None:
            print(f"[ARBITRATION_PICK] chosen={'&'.join(sorted(best_names))} reason=two_models_agree_exact")
            return ArbitrationResult(
                chosen_name="&".join(sorted(best_names)),
                clean_text=best_key + ("\n" if not best_key.endswith("\n") else ""),
                rationale="two_models_agree_exact",
                rejected=rejected,
            )
        print("[ARBITRATION_FALLBACK] chosen=original reason=require_two_models_agree_but_no_agreement")
        return ArbitrationResult(
            chosen_name="original",
            clean_text=original,
            rationale="require_two_models_agree_but_no_agreement",
            rejected=rejected,
        )

    # Conservative pick: minimal change distance
    accepted.sort(key=lambda t: (t[1], -t[0].confidence))
    best, best_change = accepted[0]
    print(f"[ARBITRATION_PICK] chosen={best.name} reason=min_change({best_change:.3f})")
    return ArbitrationResult(
        chosen_name=best.name,
        clean_text=best.cleaned_text if best.cleaned_text.endswith("\n") else best.cleaned_text + "\n",
        rationale=f"min_change({best_change:.3f})",
        rejected=rejected,
    )

