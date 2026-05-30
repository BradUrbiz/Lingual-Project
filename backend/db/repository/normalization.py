"""Pure backfill transforms: Firestore value -> Postgres value.

Implements the "Backfill Normalization And ID Resolution" table in
docs/school-integration/POSTGRES_SCHEMA.md. These are pure functions (no DB, no
Firestore) so they are directly unit-testable; the backfill upsert layer composes
them. Each normalizer is conservative: it remaps the documented legacy values and
passes everything else through unchanged.
"""

from __future__ import annotations

import datetime
from typing import Any

# --- Value remaps (retired vocabularies -> current CHECK-valid values) -------

# enrollments.status: 'pending_sync' retired after the 2026-04-21 roster decouple.
_ENROLLMENT_STATUS = {'pending_sync': 'inactive'}

# enrollments.join_source: pre-decouple 'canvas' rows -> 'canvas_legacy'.
_JOIN_SOURCE = {'canvas': 'canvas_legacy'}

# organizations.status: pre-enum 'inactive' rows -> 'archived'.
_ORG_STATUS = {'inactive': 'archived'}

# assignments.target_language_intensity legacy values (assignment_resolver.py:820).
_TARGET_LANGUAGE_INTENSITY = {
    'mostly_target': 'target_led',
    'bilingual_scaffold': 'english_led',
}


def normalize_enrollment_status(value: str | None) -> str:
    return _ENROLLMENT_STATUS.get(value, value or 'active')


def normalize_join_source(value: str | None) -> str:
    return _JOIN_SOURCE.get(value, value or 'manual')


def normalize_org_status(value: str | None) -> str:
    return _ORG_STATUS.get(value, value or 'active')


def normalize_membership_status(value: str | None) -> str:
    """Membership status. Unlike org/enrollment status there is NO retired
    vocabulary to remap (live values are only active/invited/removed), so this is
    a default-to-'active' passthrough. An unexpected value passes through and is
    surfaced as a per-row error by the DB CHECK + the backfill's per-row SAVEPOINT
    rather than being silently coerced — kept symmetric with the other status
    normalizers so the choice is explicit, not an omission.
    """
    return value or 'active'


def normalize_target_language_intensity(value: str | None) -> str:
    return _TARGET_LANGUAGE_INTENSITY.get(value, value or 'balanced')


# --- Type coercions ----------------------------------------------------------

def parse_firestore_timestamp(value: Any) -> datetime.datetime | None:
    """Coerce a Firestore timestamp / ISO string / '' into a datetime or None.

    Firestore stores some fields (e.g. assignments.release_at/due_at) as ISO
    strings or empty strings; others as native timestamps with a .isoformat()
    or already datetime. Empty/None -> None.
    """
    if value is None or value == '':
        return None
    if isinstance(value, datetime.datetime):
        return value
    # Firestore Timestamp / DatetimeWithNanoseconds expose isoformat via str();
    # an ISO string parses directly.
    if isinstance(value, str):
        try:
            return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    to_dt = getattr(value, 'isoformat', None)
    if callable(to_dt):
        try:
            return datetime.datetime.fromisoformat(value.isoformat().replace('Z', '+00:00'))
        except (ValueError, TypeError):
            return None
    return None


def coerce_str_list(value: Any) -> list[str]:
    """Firestore list[str] (or None) -> a clean list[str] for a text[] column."""
    if not value:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value if v is not None]
    return [str(value)]


def coerce_jsonb(value: Any, *, default: Any = None) -> Any:
    """None -> the bounded default ({} or []); otherwise pass through."""
    if value is None:
        return {} if default is None else default
    return value
