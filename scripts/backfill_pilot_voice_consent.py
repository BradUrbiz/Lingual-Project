"""One-shot backfill: grant voice + guardian consent for existing pilot students.

For students enrolled before auto-grant-on-enroll shipped, this script runs the
same helper (``auto_grant_voice_consent_for_pilot``) so their compliance record
is upgraded. Idempotent — rerunning does nothing on already-granted students.
Explicit ``revoked`` values are preserved.

Usage:
    python3 scripts/backfill_pilot_voice_consent.py <org_id>
    python3 scripts/backfill_pilot_voice_consent.py <org_id> --dry-run
"""

from __future__ import annotations

import argparse
import sys

from firebase_admin import initialize_app

import database
from backend.services.compliance import (
    auto_grant_voice_consent_for_pilot,
    normalize_student_compliance_record,
)


def _iter_student_uids_for_org(db, org_id: str):
    seen: set[str] = set()
    memberships = db.get_memberships_collection().where("org_id", "==", org_id).stream()
    for doc in memberships:
        data = doc.to_dict() or {}
        roles = data.get("roles") or []
        if "student" not in roles:
            continue
        status = data.get("status")
        if status and status != "active":
            continue
        uid = data.get("uid")
        if uid and uid not in seen:
            seen.add(uid)
            yield uid


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("org_id")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        initialize_app()
    except ValueError:
        pass

    db = database
    organization = db.get_organization(args.org_id)
    if not organization:
        print(f"Organization {args.org_id!r} not found.", file=sys.stderr)
        return 2

    print(f"Backfilling voice consent for org {args.org_id!r} ({organization.get('name', '')})")
    granted = 0
    skipped = 0
    for uid in _iter_student_uids_for_org(db, args.org_id):
        stored = db.get_student_compliance_record(args.org_id, uid)
        current = normalize_student_compliance_record(
            stored,
            org_id=args.org_id,
            student_uid=uid,
            user=db.get_user(uid),
            organization=organization,
        )
        needs_voice = current.get("voice_consent_status") not in {"granted", "revoked"}
        needs_guardian = current.get("is_minor") and current.get("guardian_consent_status") not in {"granted", "revoked"}
        if not (needs_voice or needs_guardian):
            skipped += 1
            print(f"  skip  {uid}  (already granted or revoked)")
            continue
        if args.dry_run:
            print(f"  WOULD grant  {uid}  (voice={needs_voice} guardian={needs_guardian})")
        else:
            auto_grant_voice_consent_for_pilot(db, org_id=args.org_id, student_uid=uid)
            print(f"  grant {uid}  (voice={needs_voice} guardian={needs_guardian})")
        granted += 1

    verb = "would grant" if args.dry_run else "granted"
    print(f"\nDone. {verb}={granted}, skipped={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
