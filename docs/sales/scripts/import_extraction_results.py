#!/usr/bin/env python3
"""Import agent-returned extraction JSON into docs/sales/extracted.

The subagent workflow returns a single JSON object with `results: [...]`. This
script validates the minimum schema and writes one normalized school file per
result.

Run from docs/sales:
    python3 scripts/import_extraction_results.py /tmp/agent_batch.json --write
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

SALES_DIR = Path(__file__).resolve().parents[1]
DEFAULT_EXTRACTED = SALES_DIR / "extracted"
VALID_STATUSES = {"success", "partial", "names_only", "failed"}


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def slugify_school(state: str, school_name: str, district: str = "") -> str:
    school_slug = _slug(school_name)
    if district:
        return f"{state}-{_slug(district)}-{school_slug}.json"
    return f"{state}-{school_slug}.json"


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def destination_path(extracted_dir: Path, result: dict[str, Any]) -> Path:
    """Choose a stable output path without overwriting same-name districts."""
    state = result["state"]
    school_name = result["school_name"]
    district = result["district"]
    legacy_path = extracted_dir / slugify_school(state, school_name)
    if legacy_path.exists():
        try:
            existing = json.loads(legacy_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}
        if _norm(existing.get("district", "")) == _norm(district):
            return legacy_path
    return extracted_dir / slugify_school(state, school_name, district)


def validate_result(result: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for key in ("school_name", "state", "district", "county", "school_url"):
        if not (result.get(key) or "").strip():
            errors.append(f"missing {key}")
    status = result.get("extraction_status")
    if status not in VALID_STATUSES:
        errors.append(f"invalid extraction_status {status!r}")
    teachers = result.get("teachers")
    if not isinstance(teachers, list):
        errors.append("teachers must be a list")
        return errors
    for idx, teacher in enumerate(teachers):
        prefix = f"teachers[{idx}]"
        if not (teacher.get("first_name") or "").strip():
            errors.append(f"{prefix} missing first_name")
        if not (teacher.get("last_name") or "").strip():
            errors.append(f"{prefix} missing last_name")
        email = (teacher.get("email") or "").strip()
        source = (teacher.get("email_source") or "").strip()
        if email and source != "extracted":
            errors.append(f"{prefix} email requires email_source=extracted")
        if source == "extracted" and not email:
            errors.append(f"{prefix} extracted source requires email")
        if source and source != "extracted":
            errors.append(f"{prefix} unsupported email_source {source!r}")
        languages = teacher.get("languages")
        if not isinstance(languages, list):
            errors.append(f"{prefix} languages must be a list")
    return errors


def normalize_result(result: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "school_name": (result.get("school_name") or "").strip(),
        "state": (result.get("state") or "").strip(),
        "district": (result.get("district") or "").strip(),
        "county": (result.get("county") or "").strip(),
        "school_url": (result.get("school_url") or "").strip(),
        "extraction_status": result.get("extraction_status"),
        "extraction_notes": (result.get("extraction_notes") or "").strip(),
        "faculty_page_url": (result.get("faculty_page_url") or "").strip(),
        "teachers": [],
    }
    for teacher in result.get("teachers") or []:
        normalized["teachers"].append(
            {
                "first_name": (teacher.get("first_name") or "").strip(),
                "last_name": (teacher.get("last_name") or "").strip(),
                "email": (teacher.get("email") or "").strip(),
                "email_source": (teacher.get("email_source") or "").strip(),
                "role": (teacher.get("role") or "teacher").strip(),
                "languages": teacher.get("languages") or ["unspecified"],
                "personalization_hook": (
                    teacher.get("personalization_hook") or ""
                ).strip(),
            }
        )
    return normalized


def import_results(
    payload: dict[str, Any],
    extracted_dir: Path = DEFAULT_EXTRACTED,
    *,
    write: bool = False,
) -> dict[str, Any]:
    results = payload.get("results")
    if not isinstance(results, list):
        raise ValueError("payload must contain results list")

    summary = {"valid": 0, "invalid": 0, "written": 0, "errors": []}
    for result in results:
        errors = validate_result(result)
        school = result.get("school_name", "<unknown>")
        if errors:
            summary["invalid"] += 1
            summary["errors"].append({"school_name": school, "errors": errors})
            continue
        normalized = normalize_result(result)
        summary["valid"] += 1
        path = destination_path(extracted_dir, normalized)
        if write:
            path.write_text(
                json.dumps(normalized, indent=2) + "\n",
                encoding="utf-8",
            )
            summary["written"] += 1
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--extracted-dir", type=Path, default=DEFAULT_EXTRACTED)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    summary = import_results(payload, args.extracted_dir, write=args.write)
    print(json.dumps(summary, indent=2, sort_keys=True))
    if not args.write:
        print("Dry run only; pass --write to write extracted JSON files.")
    return 1 if summary["invalid"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
