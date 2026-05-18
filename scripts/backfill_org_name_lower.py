"""Backfill organizations.name_lower for orgs created before Plan 4.

Idempotent. Run with --dry-run first.

Usage:
    python3 scripts/backfill_org_name_lower.py --dry-run
    python3 scripts/backfill_org_name_lower.py
"""
from __future__ import annotations

import argparse
import sys

import firebase_admin
from firebase_admin import firestore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    firebase_admin.initialize_app()
    db = firestore.client()
    updated = 0
    skipped = 0
    for doc in db.collection('organizations').stream():
        data = doc.to_dict() or {}
        name = data.get('name') or ''
        expected = name.strip().lower()
        if not expected:
            skipped += 1
            continue
        if data.get('name_lower') == expected:
            skipped += 1
            continue
        print(f"{'[DRY] ' if args.dry_run else ''}update {doc.id}: name_lower = {expected!r}")
        if not args.dry_run:
            doc.reference.update({'name_lower': expected})
        updated += 1
    print(f"\nDone. updated={updated} skipped={skipped}")


if __name__ == '__main__':
    sys.exit(main() or 0)
