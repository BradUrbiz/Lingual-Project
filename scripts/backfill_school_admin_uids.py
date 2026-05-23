"""Backfill organizations.school_admin_uids for orgs created before Plan 4.

Walks every membership with role=school_admin & status=active, and ensures
its uid is in the target org's school_admin_uids array.

Idempotent. Run with --dry-run first.

Usage:
    python3 scripts/backfill_school_admin_uids.py --dry-run
    python3 scripts/backfill_school_admin_uids.py
"""
from __future__ import annotations

import argparse
import collections
import sys

import firebase_admin
from firebase_admin import firestore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    firebase_admin.initialize_app()
    db = firestore.client()

    # Gather active school_admin memberships per org.
    by_org: dict[str, set[str]] = collections.defaultdict(set)
    for m in (
        db.collection('memberships')
          .where('status', '==', 'active')
          .where('roles', 'array_contains', 'school_admin')
          .stream()
    ):
        data = m.to_dict() or {}
        org_id = data.get('org_id')
        uid = data.get('uid')
        if org_id and uid:
            by_org[org_id].add(uid)

    touched = 0
    skipped = 0
    for org_id, expected in by_org.items():
        org_ref = db.collection('organizations').document(org_id)
        org_doc = org_ref.get()
        if not org_doc.exists:
            skipped += 1
            continue
        current = set((org_doc.to_dict() or {}).get('school_admin_uids') or [])
        missing = expected - current
        if not missing:
            skipped += 1
            continue
        print(f"{'[DRY] ' if args.dry_run else ''}org {org_id}: adding {sorted(missing)}")
        if not args.dry_run:
            org_ref.update({
                'school_admin_uids': firestore.ArrayUnion(list(missing)),
            })
        touched += 1

    print(f"\nDone. orgs_touched={touched} orgs_skipped={skipped}")


if __name__ == '__main__':
    sys.exit(main() or 0)
