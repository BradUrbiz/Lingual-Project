#!/usr/bin/env python3
"""Aggregate URL-enrichment results into teacher_dmv.csv.

For each result in docs/sales/enrichment/*.json:
  - Find the matching anchor row (state + fuzzy school name).
  - If anchor.school_url is empty AND result has a URL, populate it.
  - Always add a note about the enrichment source and confidence.

Run from repo root:
  python3 docs/sales/scripts/aggregate_urls.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CSV_PATH = REPO / "docs" / "sales" / "teacher_dmv.csv"
ENRICH = REPO / "docs" / "sales" / "enrichment"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _match(name: str, state: str, rows: list[dict]) -> int | None:
    n = _norm(name)
    candidates = [(i, r) for i, r in enumerate(rows) if r["state"] == state]
    for i, r in candidates:
        if _norm(r["school_name"]) == n:
            return i
    for i, r in candidates:
        rn = _norm(r["school_name"])
        if n in rn or rn in n:
            return i
    return None


def main():
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        rows = list(reader)

    files = sorted(p for p in ENRICH.glob("*.json") if not p.name.startswith("_"))
    print(f"Loaded {len(rows)} CSV rows; {len(files)} enrichment files",
          file=sys.stderr)

    stats = Counter()
    not_matched = []
    for fp in files:
        d = json.loads(fp.read_text())
        for res in d.get("results", []):
            sn = res.get("school_name", "")
            st = res.get("state", "")
            url = (res.get("url") or "").strip()
            conf = res.get("confidence", "")
            verified = res.get("verified", False)
            idx = _match(sn, st, rows)
            if idx is None:
                not_matched.append(f"{st} | {sn}")
                stats["no_match"] += 1
                continue
            row = rows[idx]
            existing = (row.get("school_url") or "").strip()
            if existing:
                stats["already_had_url"] += 1
                continue
            if not url or conf == "not_found":
                # Annotate the anchor so we know enrichment was attempted
                row["notes"] = (
                    f"{row.get('notes','')} | url_enrichment: not_found"
                ).strip(" |")
                stats["not_found"] += 1
                continue
            row["school_url"] = url
            verified_flag = "verified" if verified else "unverified"
            row["notes"] = (
                f"{row.get('notes','')} | url_enrichment: "
                f"{conf} confidence, {verified_flag}"
            ).strip(" |")
            stats[f"url_added_{conf}"] += 1

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Stats: {dict(stats)}", file=sys.stderr)
    if not_matched:
        print(f"\nUnmatched schools ({len(not_matched)}):", file=sys.stderr)
        for s in not_matched[:20]:
            print(f"  {s}", file=sys.stderr)


if __name__ == "__main__":
    main()
