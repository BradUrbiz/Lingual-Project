#!/usr/bin/env python3
"""Email prediction helper for the teacher-outreach pipeline.

Used by the extraction stage as a FALLBACK when a school's faculty directory
does not publish email addresses. Real extracted emails always take priority.

Predicted emails MUST be marked email_verified=N and pass Hunter/NeverBounce
verification before any cold-email send. Pattern accuracy varies — MCPS verified
at ~40% match rate due to middle-initial variants, FCPS uses multiple formats
simultaneously, so single-pattern prediction is best-effort.

CLI:
    python3 docs/sales/scripts/predict_email.py "Jane" "Doe" "Montgomery County Public Schools"
    -> jane_doe@mcpsmd.org
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import NamedTuple, Optional

PATTERNS_PATH = Path(__file__).resolve().parents[1] / "district_email_patterns.json"


class Prediction(NamedTuple):
    email: Optional[str]
    confidence: str
    source: str  # "pattern" or "no_pattern"
    notes: str


def _patterns() -> dict:
    raw = json.loads(PATTERNS_PATH.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def _normalize(name: str) -> str:
    """Lowercase, strip accents, drop non-alpha. Idempotent."""
    if not name:
        return ""
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", n.lower())


def predict(first: str, last: str, district: str) -> Prediction:
    pats = _patterns()
    entry = pats.get(district)
    if not entry or not entry.get("pattern"):
        return Prediction(None, "n/a", "no_pattern",
                          f"district {district!r} has no pattern")
    f = _normalize(first)
    l = _normalize(last)
    if not f or not l:
        return Prediction(None, entry["confidence"], "no_pattern",
                          "name normalization produced empty string")
    email = entry["pattern"].format(first=f, last=l)
    return Prediction(email, entry["confidence"], "pattern",
                      entry.get("notes", ""))


def main():
    if len(sys.argv) != 4:
        print("usage: predict_email.py FIRST LAST DISTRICT", file=sys.stderr)
        sys.exit(2)
    p = predict(sys.argv[1], sys.argv[2], sys.argv[3])
    if p.email:
        print(p.email)
        print(f"  confidence: {p.confidence}", file=sys.stderr)
        if p.notes:
            print(f"  notes: {p.notes}", file=sys.stderr)
    else:
        print(f"NO PREDICTION ({p.notes})", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
