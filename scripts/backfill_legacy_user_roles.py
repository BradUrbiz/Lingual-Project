"""One-shot backfill: infer intended_role for legacy users.

Reads `users/` and, for each user without `profile.intended_role`, looks at:
  - active memberships (priority: school_admin > teacher)
  - active enrollments (treated as 'student')

Writes `profile.intended_role` + `profile.onboarding_state='complete'` so the
user routes to their existing flow on next sign-in (no modal needed).

Note on `onboarding_state='complete'` for all roles (vs. the modal's
teacher/admin → `'role_selected'`): every user resolved here has an
active membership or enrollment, so the dispatcher's membership branch
(`getOnboardingDestination` step 2) routes them before `onboarding_state`
is consulted. `'complete'` is therefore safe for all three roles in this
path. The modal's `'role_selected'` for teacher/admin matters only when
there is no membership yet — i.e., the user is mid-signup.

Users with neither memberships nor enrollments are left untouched — the
LegacyRoleMigrationModal handles them at next sign-in.

Usage:
  python3 scripts/backfill_legacy_user_roles.py --dry-run
  python3 scripts/backfill_legacy_user_roles.py            # writes
"""
from __future__ import annotations

import argparse
import logging
import sys
from typing import Iterable

logger = logging.getLogger(__name__)


def _get_firestore_client():
    """Initialize Firebase Admin if needed; return Firestore client."""
    import firebase_admin
    from firebase_admin import firestore
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return firestore.client()


def list_user_memberships(db, uid: str) -> list:
    rows = (
        db.collection('memberships')
        .where('uid', '==', uid)
        .stream()
    )
    return [{**r.to_dict(), 'id': r.id} for r in rows]


def list_user_enrollments(db, uid: str) -> list:
    rows = (
        db.collection('enrollments')
        .where('student_uid', '==', uid)
        .where('status', '==', 'active')
        .stream()
    )
    return [r.id for r in rows]


def infer_role_from_memberships(memberships: Iterable[dict]) -> str | None:
    active = [m for m in memberships if (m.get('status') or 'active') == 'active']
    has_admin = any('school_admin' in (m.get('roles') or []) for m in active)
    has_teacher = any('teacher' in (m.get('roles') or []) for m in active)
    if has_admin:
        return 'admin'
    if has_teacher:
        return 'teacher'
    return None


def infer_role_from_signals(memberships: Iterable[dict], enrollments: list) -> str | None:
    role = infer_role_from_memberships(memberships)
    if role:
        return role
    if enrollments:
        return 'student'
    return None


def run_backfill(*, db, dry_run: bool, batch_size: int) -> dict:
    stats = {
        'scanned': 0,
        'written': 0,
        'skipped_already_migrated': 0,
        'skipped_no_signal': 0,
        'would_set_admin': 0,
        'would_set_teacher': 0,
        'would_set_student': 0,
    }
    for user_doc in db.collection('users').stream():
        stats['scanned'] += 1
        data = user_doc.to_dict() or {}
        profile = data.get('profile') or {}
        if profile.get('intended_role'):
            stats['skipped_already_migrated'] += 1
            continue

        uid = user_doc.id
        memberships = list_user_memberships(db, uid)
        enrollments = list_user_enrollments(db, uid)
        role = infer_role_from_signals(memberships, enrollments)
        if role is None:
            stats['skipped_no_signal'] += 1
            logger.info('[backfill] uid=%s transition=skipped (no_signal)', uid)
            continue

        would_key = f'would_set_{role}'
        stats[would_key] = stats.get(would_key, 0) + 1
        logger.info('[backfill] uid=%s transition=%s dry_run=%s', uid, role, dry_run)

        if not dry_run:
            db.collection('users').document(uid).update({
                'profile.intended_role': role,
                'profile.onboarding_state': 'complete',
            })
            stats['written'] += 1
    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    parser = argparse.ArgumentParser(description='Backfill legacy user roles.')
    parser.add_argument('--dry-run', action='store_true', help='Do not write; log transitions only.')
    parser.add_argument('--batch-size', type=int, default=500, help='Reserved for future batching.')
    args = parser.parse_args(argv)

    db = _get_firestore_client()
    stats = run_backfill(db=db, dry_run=args.dry_run, batch_size=args.batch_size)
    print('Backfill stats:')
    for k, v in stats.items():
        print(f'  {k}: {v}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
