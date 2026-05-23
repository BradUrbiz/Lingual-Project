"""Backfill organization metadata copied from approved school requests.

For orgs approved before LIMITATIONS #49, the organization document may exist
but still miss Plan 3 wizard metadata such as school_type and country. The
source of truth for those fields is the approved school_requests row with
created_org_id pointing at the organization.

Idempotent by default: only missing/blank organization fields are written.

Usage:
    python3 scripts/backfill_org_metadata_from_requests.py --dry-run
    python3 scripts/backfill_org_metadata_from_requests.py
    python3 scripts/backfill_org_metadata_from_requests.py --overwrite
"""
from __future__ import annotations

import argparse
import sys

import firebase_admin
from firebase_admin import firestore


BLANK_VALUES = (None, '')


def _metadata_from_request(request_data: dict) -> dict:
    location = request_data.get('location') or {}
    return {
        'school_type': request_data.get('school_type'),
        'country': location.get('country') or request_data.get('country'),
        'state': location.get('state'),
        'county': location.get('county'),
        'website_url': request_data.get('website_url'),
        'public_or_private': request_data.get('public_private'),
        'grade_size': request_data.get('grade_size'),
    }


def _build_missing_update(org_data: dict, metadata: dict, *, overwrite: bool = False) -> dict:
    update = {}
    for key, value in metadata.items():
        if value in BLANK_VALUES:
            continue
        current = org_data.get(key)
        if overwrite or current in BLANK_VALUES:
            update[key] = value
    return update


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()

    firebase_admin.initialize_app()
    db = firestore.client()

    updated = 0
    skipped = 0
    missing_org = 0
    for request_doc in db.collection('school_requests').where('status', '==', 'approved').stream():
        request_data = request_doc.to_dict() or {}
        org_id = request_data.get('created_org_id')
        if not org_id:
            skipped += 1
            continue

        org_ref = db.collection('organizations').document(org_id)
        org_doc = org_ref.get()
        if not org_doc.exists:
            missing_org += 1
            continue

        metadata = _metadata_from_request(request_data)
        update = _build_missing_update(
            org_doc.to_dict() or {},
            metadata,
            overwrite=args.overwrite,
        )
        if not update:
            skipped += 1
            continue

        prefix = '[DRY] ' if args.dry_run else ''
        print(f"{prefix}org {org_id} from request {request_doc.id}: {update}")
        if not args.dry_run:
            org_ref.update(update)
        updated += 1

    print(
        f"\nDone. orgs_updated={updated} skipped={skipped} "
        f"missing_org={missing_org} overwrite={args.overwrite}"
    )


if __name__ == '__main__':
    sys.exit(main() or 0)
