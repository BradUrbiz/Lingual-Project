#!/usr/bin/env python3
"""Apply district email patterns to names-only extraction files.

This script intentionally preserves `extraction_status`: a file can remain
`names_only` while individual teacher rows gain `email_source=inferred_pattern`.
That keeps raw extraction truth separate from outreach deliverability.

Run from repo root or docs/sales:
    python3 docs/sales/scripts/apply_pattern_inference.py --write
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

SALES_DIR = Path(__file__).resolve().parents[1]
DEFAULT_EXTRACTED = SALES_DIR / "extracted"
DEFAULT_PATTERNS = SALES_DIR / "district_email_patterns.json"


def _normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", value.lower())


def _load_patterns(patterns_path: Path) -> dict[str, dict[str, Any]]:
    raw = json.loads(patterns_path.read_text(encoding="utf-8"))
    return {
        district: entry
        for district, entry in raw.items()
        if not district.startswith("_") and isinstance(entry, dict)
    }


def _predict_email(
    first_name: str,
    last_name: str,
    district: str,
    patterns: dict[str, dict[str, Any]],
) -> tuple[str, dict[str, Any] | None]:
    entry = patterns.get(district)
    if not entry or not entry.get("pattern"):
        return "", None
    first = _normalize_name(first_name)
    last = _normalize_name(last_name)
    if not first or not last:
        return "", entry
    try:
        return entry["pattern"].format(first=first, last=last), entry
    except (IndexError, KeyError, ValueError):
        return "", entry


def apply_inference(
    extracted_dir: Path = DEFAULT_EXTRACTED,
    patterns_path: Path = DEFAULT_PATTERNS,
    *,
    write: bool = False,
) -> dict[str, int]:
    patterns = _load_patterns(patterns_path)
    stats: Counter[str] = Counter()

    for path in sorted(extracted_dir.glob("*.json")):
        if path.name.startswith("_"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("extraction_status") != "names_only":
            continue
        stats["names_only_files"] += 1
        district = data.get("district") or ""
        pattern_entry = patterns.get(district)
        if not pattern_entry or not pattern_entry.get("pattern"):
            stats["files_without_pattern"] += 1
            continue

        changed = False
        for teacher in data.get("teachers") or []:
            if (teacher.get("email") or "").strip():
                stats["teachers_already_had_email"] += 1
                continue
            email, used_entry = _predict_email(
                teacher.get("first_name") or "",
                teacher.get("last_name") or "",
                district,
                patterns,
            )
            if not email or not used_entry:
                stats["teachers_not_inferred"] += 1
                continue
            teacher["email"] = email
            teacher["email_source"] = "inferred_pattern"
            teacher["email_verified"] = "N"
            teacher["pattern_confidence"] = used_entry.get("confidence", "n/a")
            teacher["pattern_domain"] = used_entry.get("domain", "")
            changed = True
            stats["teachers_inferred"] += 1

        if changed:
            data["pattern_inference"] = {
                "status": "applied",
                "email_source": "inferred_pattern",
                "pattern": pattern_entry.get("pattern"),
                "confidence": pattern_entry.get("confidence", "n/a"),
                "applied_date": date.today().isoformat(),
            }
            stats["files_changed"] += 1
            if write:
                path.write_text(
                    json.dumps(data, indent=2) + "\n",
                    encoding="utf-8",
                )

    return dict(stats)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--extracted-dir", type=Path, default=DEFAULT_EXTRACTED)
    parser.add_argument("--patterns", type=Path, default=DEFAULT_PATTERNS)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    stats = apply_inference(args.extracted_dir, args.patterns, write=args.write)
    print(json.dumps(stats, indent=2, sort_keys=True))
    if not args.write:
        print("Dry run only; pass --write to update extracted JSON files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
