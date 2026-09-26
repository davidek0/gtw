"""Rule-based red-flag detection. Runs on every final transcript before any LLM call.

Demo list only: the real list must come from clinicians.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import cache

RED_FLAG_SCRIPT = (
    "Det du berättar kan vara allvarligt. Jag skickar ett larm till vårdpersonalen nu. "
    "Om det känns akut, ring 112 direkt."
)

PHRASES = [
    "ont i bröstet",
    "bröstsmärta",
    "tryck över bröstet",
    "får ingen luft",
    "kan inte andas",
    "slog i huvudet",
    "kommer inte upp",
    "kan inte resa mig",
    "kan inte resa sig",
    "sluddrar",
    "sluddrig",
    "sned i ansiktet",
    "vill inte leva",
    "vill jag inte leva",
    "vill dö",
    "vill jag dö",
    "ta mitt liv",
]

# Short phrases only match exactly; fuzzy matching them causes false alarms ("vill dö" ~ "vill du").
FUZZY_MIN_LENGTH = 10
FUZZY_THRESHOLD = 0.86


@dataclass(frozen=True)
class RedFlagHit:
    phrase: str
    matched_text: str


def normalize(text: str) -> str:
    text = re.sub(r"\W+", " ", text.lower())
    return " ".join(text.split())


def _fuzzy_match(phrase: str, windows: Callable[[int], list[tuple[str, SequenceMatcher]]]) -> str | None:
    n = len(phrase.split())
    for size in sorted({max(n - 1, 1), n, n + 1}):
        for window, matcher in windows(size):
            matcher.set_seq1(phrase)
            # The quick ratios are cheap upper bounds of ratio(), so they only skip certain misses.
            if (
                matcher.real_quick_ratio() >= FUZZY_THRESHOLD
                and matcher.quick_ratio() >= FUZZY_THRESHOLD
                and matcher.ratio() >= FUZZY_THRESHOLD
            ):
                return window
    return None


def check(text: str) -> RedFlagHit | None:
    normalized = normalize(text)
    words = normalized.split()

    @cache
    def windows(size: int) -> list[tuple[str, SequenceMatcher]]:
        spans = (" ".join(words[i : i + size]) for i in range(len(words) - size + 1))
        return [(span, SequenceMatcher(None, "", span)) for span in spans]

    for phrase in PHRASES:
        # Matches at a word start, so "bröstsmärta" also catches "bröstsmärtan".
        if f" {phrase}" in f" {normalized}":
            return RedFlagHit(phrase, phrase)
        if len(phrase) >= FUZZY_MIN_LENGTH and (window := _fuzzy_match(phrase, windows)):
            return RedFlagHit(phrase, window)
    return None
