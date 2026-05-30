"""One-time migration: rewrite legacy enrollment document IDs.

Run with --dry-run (default) or --commit. Idempotent.

Rules:
  * enrollments whose document id is not ``<class_id>_<student_uid>`` are
    rewritten to the deterministic id when both fields are present
  * rows with malformed data are skipped
  * rows whose deterministic target already exists are left untouched and
    reported as conflicts

Usage:
    python3 scripts/migrate_legacy_enrollment_ids.py
    python3 scripts/migrate_legacy_enrollment_ids.py --class-id CLASS_ID
    python3 scripts/migrate_legacy_enrollment_ids.py --class-id CLASS_ID --commit
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


@dataclass
class MigrationReport:
    migrated: int = 0
    skipped_conflicts: int = 0
    skipped_malformed: int = 0
    untouched: int = 0

    def render(self, mode: str) -> str:
        return (
            f"[{mode}] migrated={self.migrated} "
            f"skipped_conflicts={self.skipped_conflicts} "
            f"skipped_malformed={self.skipped_malformed} "
            f"untouched={self.untouched}"
        )


def _expected_enrollment_id(row: dict) -> str:
    class_id = (row.get('class_id') or '').strip()
    student_uid = (row.get('student_uid') or '').strip()
    if not class_id or not student_uid:
        return ''
    return f'{class_id}_{student_uid}'


def migrate_once(*, db, commit: bool, class_id: str = '', student_uid: str = '') -> MigrationReport:
    """Pure function over a db-like adapter.

    Required db surface:
      - list_all_enrollments() -> list[dict]
      - get_enrollment_by_id(enrollment_id) -> dict | None
      - set_enrollment(enrollment_id, payload) -> None
      - delete_enrollment(enrollment_id) -> None
    """
    report = MigrationReport()

    for row in db.list_all_enrollments():
        row_id = row.get('id', '')
        row_class_id = (row.get('class_id') or '').strip()
        row_student_uid = (row.get('student_uid') or '').strip()

        if class_id and row_class_id != class_id:
            continue
        if student_uid and row_student_uid != student_uid:
            continue

        expected_id = _expected_enrollment_id(row)
        if not expected_id:
            report.skipped_malformed += 1
            continue

        if row_id == expected_id:
            report.untouched += 1
            continue

        if db.get_enrollment_by_id(expected_id):
            report.skipped_conflicts += 1
            continue

        if commit:
            payload = {key: value for key, value in row.items() if key != 'id'}
            db.set_enrollment(expected_id, payload)
            db.delete_enrollment(row_id)
        report.migrated += 1

    return report


class LiveFirestoreDb:
    """Adapter bridging the migration's small surface onto real Firestore."""

    def list_all_enrollments(self):
        from database import get_enrollments_collection

        docs = get_enrollments_collection().stream()
        rows = []
        for doc in docs:
            data = doc.to_dict() or {}
            data['id'] = doc.id
            rows.append(data)
        return rows

    def get_enrollment_by_id(self, enrollment_id):
        from database import get_enrollment_ref

        doc = get_enrollment_ref(enrollment_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data

    def set_enrollment(self, enrollment_id, payload):
        from database import get_enrollment_ref

        get_enrollment_ref(enrollment_id).set(dict(payload))

    def delete_enrollment(self, enrollment_id):
        from database import get_enrollment_ref

        get_enrollment_ref(enrollment_id).delete()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', action='store_true', help='Write changes to Firestore. Default is dry-run.')
    parser.add_argument('--class-id', default='', help='Optional class id scope for a targeted migration run.')
    parser.add_argument('--student-uid', default='', help='Optional student uid scope for a targeted migration run.')
    args = parser.parse_args()

    # This migration rewrites enrollment docs via direct Firestore writes that
    # bypass the database.py helpers, so the slice-2b enrollment dual-write would
    # NOT mirror them, silently desyncing Postgres. Refuse to run while the shadow
    # is live; disable it, migrate, then re-sync via the Postgres backfill.
    if os.environ.get('DUAL_WRITE_ENROLLMENTS') == '1':
        sys.exit(
            'ERROR: DUAL_WRITE_ENROLLMENTS=1 is set. Disable it before running this '
            'migration (its direct Firestore writes are not shadowed to Postgres), '
            'then re-sync with scripts/backfill_postgres_school_domain.py --write.'
        )

    mode = 'COMMIT' if args.commit else 'DRY-RUN'
    print(f'Legacy enrollment id migration - mode={mode}')
    if args.class_id:
        print(f'class_id={args.class_id}')
    if args.student_uid:
        print(f'student_uid={args.student_uid}')

    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app(options={
                'projectId': os.environ.get('GOOGLE_CLOUD_PROJECT', 'lingu-480600'),
            })

    db = LiveFirestoreDb()
    report = migrate_once(
        db=db,
        commit=args.commit,
        class_id=args.class_id.strip(),
        student_uid=args.student_uid.strip(),
    )
    print(report.render(mode))


if __name__ == '__main__':
    main()
