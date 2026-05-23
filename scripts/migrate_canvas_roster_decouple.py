"""One-time migration: decouple Canvas roster from enrollments.

Run with --dry-run (default) or --commit. Idempotent.

Rules:
  * enrollments{join_source='canvas', status='active'} -> join_source='canvas_legacy'
  * enrollments{status='pending_sync'} -> canvas_roster_entries upsert + delete enrollment
  * everything else: untouched. ACTIVE ENROLLMENTS ARE NEVER DELETED.

Usage:
    python3 scripts/migrate_canvas_roster_decouple.py               # dry-run
    python3 scripts/migrate_canvas_roster_decouple.py --commit      # live
"""
import argparse
import os
import sys
from dataclasses import dataclass

# Allow running directly from repo root.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


@dataclass
class MigrationReport:
    legacy_flipped: int = 0
    pending_sync_translated: int = 0
    untouched: int = 0

    def render(self, mode: str) -> str:
        return (
            f"[{mode}] legacy_flipped={self.legacy_flipped} "
            f"pending_sync_translated={self.pending_sync_translated} "
            f"untouched={self.untouched}"
        )


def migrate_once(*, db, commit: bool) -> MigrationReport:
    """Pure function; accepts any db-like object exposing:
      - list_all_enrollments() -> list of dicts
      - update_enrollment_join_source(enrollment_id, new_value)
      - delete_enrollment(enrollment_id)
      - upsert_canvas_roster_entry(class_id, connection_id, canvas_user_id,
                                   canvas_email, canvas_name)
      - get_canvas_connection_id_for_class(class_id) -> str (may be '')
    """
    report = MigrationReport()
    for row in db.list_all_enrollments():
        enrollment_id = row.get('id', '')
        class_id = row.get('class_id', '')
        status = row.get('status', '')
        join_source = row.get('join_source', '')

        if status == 'active' and join_source == 'canvas':
            if commit:
                db.update_enrollment_join_source(enrollment_id, 'canvas_legacy')
            report.legacy_flipped += 1

        elif status == 'pending_sync':
            canvas_user_id = str(row.get('canvas_user_id', ''))
            if not canvas_user_id:
                # Defensive: a pending_sync row without a canvas_user_id is
                # malformed. Skip it; count as untouched.
                report.untouched += 1
                continue
            if commit:
                db.upsert_canvas_roster_entry(
                    class_id=class_id,
                    connection_id=db.get_canvas_connection_id_for_class(class_id),
                    canvas_user_id=canvas_user_id,
                    canvas_email=row.get('canvas_email', ''),
                    canvas_name=row.get('canvas_name', ''),
                )
                db.delete_enrollment(enrollment_id)
            report.pending_sync_translated += 1

        else:
            report.untouched += 1

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

    def update_enrollment_join_source(self, enrollment_id, new_join_source):
        from database import get_enrollment_ref, firestore
        get_enrollment_ref(enrollment_id).update({
            'join_source': new_join_source,
            'updated_at': firestore.SERVER_TIMESTAMP,
        })

    def delete_enrollment(self, enrollment_id):
        from database import get_enrollment_ref
        get_enrollment_ref(enrollment_id).delete()

    def upsert_canvas_roster_entry(self, **kwargs):
        from database import upsert_canvas_roster_entry
        upsert_canvas_roster_entry(**kwargs)

    def get_canvas_connection_id_for_class(self, class_id):
        from database import get_canvas_connection_by_class
        connection = get_canvas_connection_by_class(class_id) or {}
        return connection.get('id', '')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', action='store_true',
                        help='Write changes to Firestore. Default is dry-run.')
    args = parser.parse_args()

    mode = 'COMMIT' if args.commit else 'DRY-RUN'
    print(f'Canvas roster decouple migration - mode={mode}')

    # Initialize firebase_admin before database is imported.
    import firebase_admin
    from firebase_admin import credentials
    if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        cred = credentials.Certificate(os.environ['GOOGLE_APPLICATION_CREDENTIALS'])
        try:
            firebase_admin.initialize_app(cred)
        except ValueError:
            pass  # Already initialized

    db = LiveFirestoreDb()
    report = migrate_once(db=db, commit=args.commit)
    print(report.render(mode))


if __name__ == '__main__':
    main()
