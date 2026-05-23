import unittest
from scripts.migrate_canvas_roster_decouple import migrate_once, MigrationReport


class FakeMigrationDb:
    def __init__(self):
        self.enrollments = {}      # id -> dict
        self.roster_entries = {}   # key=f'{class_id}__{canvas_user_id}' -> dict
        self.updated_enrollments = []
        self.deleted_enrollments = []
        self.upserted_roster_entries = []
        self.canvas_connections = {}   # class_id -> connection_id

    def list_all_enrollments(self):
        return list(self.enrollments.values())

    def update_enrollment_join_source(self, enrollment_id, new_join_source):
        self.enrollments[enrollment_id]['join_source'] = new_join_source
        self.updated_enrollments.append((enrollment_id, new_join_source))

    def delete_enrollment(self, enrollment_id):
        self.enrollments.pop(enrollment_id, None)
        self.deleted_enrollments.append(enrollment_id)

    def upsert_canvas_roster_entry(self, *, class_id, connection_id,
                                   canvas_user_id, canvas_email, canvas_name):
        key = f'{class_id}__{canvas_user_id}'
        self.roster_entries[key] = {
            'class_id': class_id, 'connection_id': connection_id,
            'canvas_user_id': canvas_user_id,
            'canvas_email': (canvas_email or '').lower().strip(),
            'canvas_name': canvas_name,
        }
        self.upserted_roster_entries.append(key)

    def get_canvas_connection_id_for_class(self, class_id):
        return self.canvas_connections.get(class_id, '')


class MigrateCanvasRosterDecoupleTest(unittest.TestCase):
    def test_active_canvas_enrollment_flipped_to_canvas_legacy(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'canvas',
            'canvas_email': 'alice@school.edu',
        }
        report = migrate_once(db=db, commit=True)
        self.assertEqual(db.enrollments['class-1_alice']['join_source'], 'canvas_legacy')
        self.assertEqual(db.enrollments['class-1_alice']['status'], 'active')
        self.assertEqual(report.legacy_flipped, 1)

    def test_active_join_code_enrollment_untouched(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'join_code',
        }
        migrate_once(db=db, commit=True)
        self.assertEqual(db.enrollments['class-1_alice']['join_source'], 'join_code')

    def test_pending_sync_translated_to_roster_entry_and_deleted(self):
        db = FakeMigrationDb()
        db.canvas_connections['class-1'] = 'conn-1'
        db.enrollments['class-1__cv50'] = {
            'id': 'class-1__cv50', 'class_id': 'class-1',
            'student_uid': '', 'status': 'pending_sync', 'join_source': 'canvas',
            'canvas_user_id': 'cv50', 'canvas_email': 'bob@school.edu',
            'canvas_name': 'Bob',
        }
        report = migrate_once(db=db, commit=True)
        self.assertNotIn('class-1__cv50', db.enrollments)
        self.assertIn('class-1__cv50', db.roster_entries)
        self.assertEqual(db.roster_entries['class-1__cv50']['canvas_email'],
                         'bob@school.edu')
        self.assertEqual(report.pending_sync_translated, 1)

    def test_idempotent(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'canvas',
        }
        migrate_once(db=db, commit=True)
        report = migrate_once(db=db, commit=True)
        self.assertEqual(report.legacy_flipped, 0)
        self.assertEqual(report.pending_sync_translated, 0)

    def test_dry_run_makes_no_writes(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'canvas',
        }
        db.enrollments['class-1__cv50'] = {
            'id': 'class-1__cv50', 'class_id': 'class-1',
            'student_uid': '', 'status': 'pending_sync', 'join_source': 'canvas',
            'canvas_user_id': 'cv50', 'canvas_email': 'bob@school.edu',
        }
        report = migrate_once(db=db, commit=False)
        # Report reflects what WOULD happen.
        self.assertEqual(report.legacy_flipped, 1)
        self.assertEqual(report.pending_sync_translated, 1)
        # No writes occurred.
        self.assertEqual(db.enrollments['class-1_alice']['join_source'], 'canvas')
        self.assertIn('class-1__cv50', db.enrollments)
        self.assertEqual(db.roster_entries, {})

    def test_active_enrollment_never_deleted(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'canvas',
        }
        migrate_once(db=db, commit=True)
        self.assertIn('class-1_alice', db.enrollments)


if __name__ == '__main__':
    unittest.main()
