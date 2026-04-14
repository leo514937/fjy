from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, List, Tuple


@dataclass(frozen=True)
class CleanResult:
    clean_text: str
    removed_lines: int
    merged_wrap_lines: int


_WS_RUN = re.compile(r"[ \t]{2,}")
_EMPTY_RUN = re.compile(r"\n{3,}")

# Common page number patterns (conservative; only removed if repeated many times)
_PAGE_PATTERNS = [
    re.compile(r"^\s*page\s*\d+\s*(/|of)?\s*\d*\s*$", re.IGNORECASE),
    re.compile(r"^\s*\d+\s*/\s*\d+\s*$"),
    re.compile(r"^\s*第\s*\d+\s*页\s*(/|共)?\s*\d*\s*页?\s*$"),
]

# Lines that are likely separators
_SEPARATOR = re.compile(r"^\s*[-=_]{3,}\s*$")


def _looks_like_page_number(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if any(p.match(s) for p in _PAGE_PATTERNS):
        return True
    # Bare number line: only treat as page number if very short
    if s.isdigit() and len(s) <= 4:
        return True
    return False


def _tokenize_numbers(text: str) -> Counter[str]:
    # Capture integers/decimals/scientific, keep sign.
    nums = re.findall(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
    return Counter(nums)


def _is_mostly_punct(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    punct = sum(1 for ch in s if not ch.isalnum() and not ("\u4e00" <= ch <= "\u9fff"))
    return punct / max(1, len(s)) > 0.8


def _detect_repeated_lines(lines: List[str], min_freq: int = 3) -> set[str]:
    # Use normalized form for counting but remove original exact lines.
    norm = [re.sub(r"\s+", " ", ln.strip().lower()) for ln in lines if ln.strip()]
    counts = Counter(norm)
    repeated_norm = {k for k, v in counts.items() if v >= min_freq and 3 <= len(k) <= 120}
    out: set[str] = set()
    for ln in lines:
        k = re.sub(r"\s+", " ", ln.strip().lower())
        if k in repeated_norm:
            out.add(ln)
    return out


def _merge_soft_wrap(lines: List[str]) -> tuple[List[str], int]:
    """
    Conservative soft-wrap merge:
    - If a line does NOT end with strong punctuation and next line starts with lower/word/Chinese,
      treat as wrapped and join with a space.
    - Do NOT merge if line ends with ':' '：' ';' '；' '.' '。' '?' '？' '!' '！'
      or if next line looks like a list header/bullet/numbered item.
    """
    merged: List[str] = []
    i = 0
    merged_count = 0

    def is_list_like(s: str) -> bool:
        st = s.lstrip()
        return bool(re.match(r"^([-\*\u2022]|(\d+|[A-Za-z])[\)\.\、]|（\d+）)\s+", st))

    strong_end = set(":：;；.。?？！!）)】]}")

    while i < len(lines):
        cur = lines[i].rstrip()
        if i + 1 < len(lines):
            nxt = lines[i + 1].lstrip()
            if cur and nxt:
                # Never merge anything that looks like a page number line.
                if _looks_like_page_number(cur) or _looks_like_page_number(nxt):
                    merged.append(cur)
                    i += 1
                    continue
                # Avoid merging two short lines (often headers/footers/table fragments).
                if len(cur.strip()) <= 15 and len(nxt.strip()) <= 15:
                    merged.append(cur)
                    i += 1
                    continue
                end = cur[-1]
                if end not in strong_end and not is_list_like(nxt) and not _SEPARATOR.match(nxt):
                    # Avoid merging if current looks like a heading
                    if not re.match(r"^\s*#+\s+\S+", cur) and not re.match(r"^\s*[一二三四五六七八九十]+\s*[、\.]\s*\S+", cur):
                        merged.append(cur + " " + nxt.rstrip())
                        i += 2
                        merged_count += 1
                        continue
        merged.append(cur)
        i += 1
    return merged, merged_count


def clean_text_conservative(text: str) -> CleanResult:
    """
    Goal: remove obvious noise while preserving semantics & numbers.
    """
    lines = text.split("\n")

    # Trim trailing spaces; collapse inner spaces (not across words excessively)
    lines = [ln.rstrip() for ln in lines]

    repeated = _detect_repeated_lines(lines, min_freq=4)

    removed = 0
    kept: List[str] = []
    for ln in lines:
        s = ln.strip()
        if not s:
            kept.append("")
            continue
        # separators
        if _SEPARATOR.match(s):
            removed += 1
            continue
        # remove repeated headers/footers only if shortish
        if ln in repeated and len(s) <= 120:
            removed += 1
            continue
        # remove mostly punctuation junk
        if _is_mostly_punct(s) and len(s) <= 30:
            removed += 1
            continue
        kept.append(ln)

    # Remove repeated page-number lines only if they appear frequently
    page_like_idx = [i for i, ln in enumerate(kept) if _looks_like_page_number(ln)]
    if len(page_like_idx) >= 5:
        kept2: List[str] = []
        for ln in kept:
            if _looks_like_page_number(ln):
                removed += 1
                continue
            kept2.append(ln)
        kept = kept2

    # Collapse whitespace runs (but keep leading indentation)
    normed: List[str] = []
    for ln in kept:
        if not ln.strip():
            normed.append("")
            continue
        m = re.match(r"^(\s*)(.*)$", ln)
        assert m is not None
        indent, body = m.group(1), m.group(2)
        body = _WS_RUN.sub(" ", body)
        normed.append(indent + body.strip())

    # Merge soft wraps conservatively
    normed, merged_wrap = _merge_soft_wrap(normed)

    out = "\n".join(normed)
    out = _EMPTY_RUN.sub("\n\n", out).strip() + "\n"
    return CleanResult(clean_text=out, removed_lines=removed, merged_wrap_lines=merged_wrap)


def numbers_preserved(original: str, candidate: str) -> bool:
    return _tokenize_numbers(original) == _tokenize_numbers(candidate)

