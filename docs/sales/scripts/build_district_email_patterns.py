#!/usr/bin/env python3
"""Derive district email patterns from already extracted teacher contacts.

This is Phase A of the sales extraction yield strategy: use only the local
`extracted/*.json` files and infer district-level patterns from emails that
were actually observed on public faculty pages.

Run from repo root or docs/sales:
    python3 docs/sales/scripts/build_district_email_patterns.py
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any

SALES_DIR = Path(__file__).resolve().parents[1]
DEFAULT_EXTRACTED = SALES_DIR / "extracted"
DEFAULT_OUTPUT = SALES_DIR / "district_email_patterns.json"


def _normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", value.lower())


def _candidate_local_parts(first: str, last: str) -> list[tuple[str, str]]:
    f0 = first[:1]
    l0 = last[:1]
    return [
        ("{first}.{last}", f"{first}.{last}"),
        ("{first}_{last}", f"{first}_{last}"),
        ("{first}{last}", f"{first}{last}"),
        ("{first[0]}{last}", f"{f0}{last}"),
        ("{first[0]}.{last}", f"{f0}.{last}"),
        ("{first[0]}_{last}", f"{f0}_{last}"),
        ("{first}{last[0]}", f"{first}{l0}"),
        ("{last}{first[0]}", f"{last}{f0}"),
        ("{last}.{first}", f"{last}.{first}"),
    ]


def _classify_confidence(top_count: int, observed_count: int) -> str:
    if observed_count <= 0:
        return "n/a"
    share = top_count / observed_count
    if top_count >= 10 and share >= 0.80:
        return "verified"
    if top_count >= 5 and share >= 0.70:
        return "high"
    if top_count >= 3 and share >= 0.60:
        return "medium"
    if top_count >= 2:
        return "low"
    return "low"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def derive_patterns(
    extracted_dir: Path = DEFAULT_EXTRACTED,
    *,
    min_support: int = 2,
) -> dict[str, dict[str, Any]]:
    observations: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for path in sorted(extracted_dir.glob("*.json")):
        if path.name.startswith("_"):
            continue
        data = _read_json(path)
        district = (data.get("district") or "").strip()
        if not district or district == "independent":
            continue
        for teacher in data.get("teachers") or []:
            email = (teacher.get("email") or "").strip().lower()
            if teacher.get("email_source") != "extracted" or "@" not in email:
                continue
            first = _normalize_name(teacher.get("first_name") or "")
            last = _normalize_name(teacher.get("last_name") or "")
            if not first or not last:
                continue
            local, domain = email.rsplit("@", 1)
            candidates = _candidate_local_parts(first, last)
            matched_template = None
            for template, candidate in candidates:
                if local == candidate:
                    matched_template = f"{template}@{domain}"
                    break
            observations[district].append(
                {
                    "school_name": data.get("school_name", ""),
                    "first_name": teacher.get("first_name", ""),
                    "last_name": teacher.get("last_name", ""),
                    "email": email,
                    "domain": domain,
                    "pattern": matched_template,
                }
            )

    generated: dict[str, dict[str, Any]] = {}
    for district, rows in sorted(observations.items()):
        pattern_counts = Counter(r["pattern"] for r in rows if r.get("pattern"))
        if not pattern_counts:
            continue
        pattern, supporting_emails = pattern_counts.most_common(1)[0]
        if supporting_emails < min_support:
            continue
        domain = pattern.rsplit("@", 1)[1]
        observed_emails = len(rows)
        matched_emails = sum(pattern_counts.values())
        dominant_share = round(supporting_emails / observed_emails, 3)
        generated[district] = {
            "pattern": pattern,
            "domain": domain,
            "confidence": _classify_confidence(supporting_emails, observed_emails),
            "source": "generated_from_extracted_contacts",
            "observed_emails": observed_emails,
            "matched_emails": matched_emails,
            "supporting_emails": supporting_emails,
            "dominant_pattern_share": dominant_share,
            "pattern_counts": dict(pattern_counts.most_common()),
            "generated_notes": (
                f"Derived from {supporting_emails}/{observed_emails} observed "
                f"emails in docs/sales/extracted on {date.today().isoformat()}."
            ),
        }

    return generated


def merge_patterns(
    generated: dict[str, dict[str, Any]],
    existing_path: Path = DEFAULT_OUTPUT,
    *,
    preserve_existing_patterns: bool = True,
) -> dict[str, Any]:
    if existing_path.exists():
        merged: dict[str, Any] = _read_json(existing_path)
    else:
        merged = {}

    meta = dict(merged.get("_meta") or {})
    meta.update(
        {
            "generated_from": "docs/sales/extracted/*.json",
            "generated_last_updated": date.today().isoformat(),
            "generated_rule": (
                "Generated entries only use teachers whose email_source is "
                "'extracted'. Inferred emails remain unverified."
            ),
            "supported_email_source_values": [
                "extracted",
                "inferred_pattern",
                "inferred_directory",
                "empty",
            ],
        }
    )
    merged["_meta"] = meta

    for district, entry in generated.items():
        current = dict(merged.get(district) or {})
        current.pop("examples", None)
        if current.get("source") == "generated_from_extracted_contacts":
            for key in (
                "generated_pattern",
                "generated_domain",
                "generated_confidence",
                "generated_source",
            ):
                current.pop(key, None)
        is_curated = current.get("source") != "generated_from_extracted_contacts"
        if preserve_existing_patterns and current.get("pattern") and is_curated:
            next_entry = {
                **current,
                "generated_pattern": entry["pattern"],
                "generated_domain": entry["domain"],
                "generated_confidence": entry["confidence"],
                "generated_source": entry["source"],
                "observed_emails": entry["observed_emails"],
                "matched_emails": entry["matched_emails"],
                "supporting_emails": entry["supporting_emails"],
                "dominant_pattern_share": entry["dominant_pattern_share"],
                "pattern_counts": entry["pattern_counts"],
                "generated_notes": entry["generated_notes"],
            }
        else:
            next_entry = {**current, **entry}
        merged[district] = next_entry

    return merged


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--extracted-dir", type=Path, default=DEFAULT_EXTRACTED)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--min-support", type=int, default=2)
    parser.add_argument(
        "--prefer-generated",
        action="store_true",
        help="Overwrite existing curated pattern/domain/confidence fields.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    generated = derive_patterns(args.extracted_dir, min_support=args.min_support)
    merged = merge_patterns(
        generated,
        args.output,
        preserve_existing_patterns=not args.prefer_generated,
    )

    print(f"Derived patterns for {len(generated)} districts")
    for district, entry in sorted(
        generated.items(),
        key=lambda item: (-item[1]["supporting_emails"], item[0]),
    )[:20]:
        print(
            f"  {district}: {entry['pattern']} "
            f"({entry['supporting_emails']}/{entry['observed_emails']}, "
            f"{entry['confidence']})"
        )

    if args.dry_run:
        print(f"Dry run only; would write {args.output}")
        return 0

    args.output.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
