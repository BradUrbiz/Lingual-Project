#!/usr/bin/env python3
"""Aggregate extracted teacher JSONs into teacher_dmv.csv.

For each school in docs/sales/extracted/*.json:
  - Match to an anchor row in teacher_dmv.csv (by state + fuzzy school name).
  - If teachers were extracted, REPLACE the anchor row with N teacher rows
    (one per language-per-teacher).
  - If extraction was a failure or yielded no teachers, keep the anchor and
    annotate notes with the extraction status.
  - For teachers whose email was hidden on the page, fall back to
    predict_email.py and mark email_verified=N.

Run from repo root:
  python3 docs/sales/scripts/aggregate_pilot.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "docs" / "sales" / "scripts"))
from predict_email import predict  # noqa: E402

CSV_PATH = REPO / "docs" / "sales" / "teacher_dmv.csv"
EXTRACTED = REPO / "docs" / "sales" / "extracted"

TODAY = date.today().isoformat()


def _norm_name(s: str) -> str:
    s = re.sub(r"[^a-z0-9]", "", s.lower())
    return s


def _match_anchor(extracted_name: str, state: str, anchors: list[dict]) -> int | None:
    """Return index of best-matching anchor row, or None."""
    e = _norm_name(extracted_name)
    candidates = [(i, a) for i, a in enumerate(anchors) if a["state"] == state]
    for i, a in candidates:
        if _norm_name(a["school_name"]) == e:
            return i
    for i, a in candidates:
        an = _norm_name(a["school_name"])
        if e in an or an in e:
            return i
    return None


def main():
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        anchors = list(reader)

    extracted_files = sorted(
        p for p in EXTRACTED.glob("*.json") if not p.name.startswith("_")
    )
    print(f"Loaded {len(anchors)} anchor rows; {len(extracted_files)} extraction files",
          file=sys.stderr)

    expanded_rows: list[dict] = []
    consumed_anchor_idx: set[int] = set()
    stats = Counter()

    for fp in extracted_files:
        d = json.loads(fp.read_text())
        idx = _match_anchor(d["school_name"], d["state"], anchors)
        if idx is None:
            print(f"  WARN no anchor matched for {d['school_name']} ({d['state']})",
                  file=sys.stderr)
            stats["no_anchor"] += 1
            continue
        anchor = anchors[idx]
        consumed_anchor_idx.add(idx)
        teachers = d.get("teachers", [])
        status = d.get("extraction_status", "?")
        stats[status] += 1
        if not teachers:
            anchor = dict(anchor)
            note = anchor.get("notes") or ""
            anchor["notes"] = (
                f"{note} | extraction={status}: "
                f"{d.get('extraction_notes', '')[:120]}"
            ).strip(" |")
            expanded_rows.append(anchor)
            continue

        for t in teachers:
            first = (t.get("first_name") or "").strip()
            last = (t.get("last_name") or "").strip()
            email = (t.get("email") or "").strip()
            email_source = (t.get("email_source") or "").strip()
            languages = t.get("languages") or ["unspecified"]
            role = (t.get("role") or "teacher").strip()
            hook = (t.get("personalization_hook") or "").strip()

            predicted_email = ""
            predicted_conf = ""
            if not email:
                p = predict(first, last, anchor["district"])
                if p.email:
                    predicted_email = p.email
                    predicted_conf = p.confidence
                    stats["email_predicted"] += 1
                else:
                    stats["email_none"] += 1
            else:
                stats["email_extracted"] += 1

            final_email = email or predicted_email
            email_verified = "Y" if email_source == "extracted" else "N"
            email_note = (
                "email source: extracted"
                if email_source == "extracted"
                else f"email source: predicted ({predicted_conf} confidence)"
                if predicted_email
                else "email source: none"
            )

            for lang in languages:
                row = dict(anchor)
                row.update({
                    "teacher_first_name": first,
                    "teacher_last_name": last,
                    "teacher_email": final_email,
                    "teacher_role": role,
                    "language": lang,
                    "source_url": d.get("faculty_page_url")
                                  or anchor.get("source_url", ""),
                    "collected_date": TODAY,
                    "email_verified": email_verified,
                    "personalization_hook": hook,
                    "outreach_status": "queued",
                    "sequence_step": "0",
                    "notes": (
                        f"{anchor.get('notes','')} | {email_note}"
                    ).strip(" |"),
                })
                expanded_rows.append(row)
                stats["teacher_rows_written"] += 1

    untouched = [a for i, a in enumerate(anchors) if i not in consumed_anchor_idx]
    final_rows = untouched + expanded_rows

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header)
        writer.writeheader()
        writer.writerows(final_rows)

    print(f"Stats: {dict(stats)}", file=sys.stderr)
    print(
        f"Wrote {len(final_rows)} rows ({len(untouched)} untouched anchors "
        f"+ {len(expanded_rows)} pilot-expanded) to {CSV_PATH}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
