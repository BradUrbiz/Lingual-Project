import unittest

from scripts.migrate_legacy_enrollment_ids import MigrationReport, migrate_once


class FakeMigrationDb:
    def __init__(self):
        self.enrollments = {}
        self.created = []
        self.deleted = []

    def list_all_enrollments(self):
        return list(self.enrollments.values())

    def get_enrollment_by_id(self, enrollment_id):
        row = self.enrollments.get(enrollment_id)
        return dict(row) if row else None

    def set_enrollment(self, enrollment_id, payload):
        self.enrollments[enrollment_id] = {"id": enrollment_id, **payload}
        self.created.append(enrollment_id)

    def delete_enrollment(self, enrollment_id):
        self.enrollments.pop(enrollment_id, None)
        self.deleted.append(enrollment_id)


class MigrateLegacyEnrollmentIdsTest(unittest.TestCase):
    def test_migrates_legacy_enrollment_to_deterministic_id(self):
        db = FakeMigrationDb()
        db.enrollments["class-1__4007"] = {
            "id": "class-1__4007",
            "class_id": "class-1",
            "student_uid": "student-1",
            "status": "active",
            "join_source": "canvas",
            "student_membership_id": "org_student-1",
        }

        report = migrate_once(db=db, commit=True)

        self.assertEqual(report.migrated, 1)
        self.assertIn("class-1_student-1", db.enrollments)
        self.assertNotIn("class-1__4007", db.enrollments)
        self.assertEqual(db.enrollments["class-1_student-1"]["join_source"], "canvas")

    def test_dry_run_reports_without_writing(self):
        db = FakeMigrationDb()
        db.enrollments["class-1__4007"] = {
            "id": "class-1__4007",
            "class_id": "class-1",
            "student_uid": "student-1",
            "status": "active",
        }

        report = migrate_once(db=db, commit=False)

        self.assertEqual(report.migrated, 1)
        self.assertIn("class-1__4007", db.enrollments)
        self.assertNotIn("class-1_student-1", db.enrollments)
        self.assertEqual(db.created, [])
        self.assertEqual(db.deleted, [])

    def test_skips_conflict_when_target_deterministic_doc_already_exists(self):
        db = FakeMigrationDb()
        db.enrollments["class-1__4007"] = {
            "id": "class-1__4007",
            "class_id": "class-1",
            "student_uid": "student-1",
            "status": "active",
        }
        db.enrollments["class-1_student-1"] = {
            "id": "class-1_student-1",
            "class_id": "class-1",
            "student_uid": "student-1",
            "status": "active",
        }

        report = migrate_once(db=db, commit=True)

        self.assertEqual(report.skipped_conflicts, 1)
        self.assertIn("class-1__4007", db.enrollments)
        self.assertIn("class-1_student-1", db.enrollments)
        self.assertEqual(db.created, [])
        self.assertEqual(db.deleted, [])

    def test_ignores_already_deterministic_or_malformed_rows(self):
        db = FakeMigrationDb()
        db.enrollments["class-1_student-1"] = {
            "id": "class-1_student-1",
            "class_id": "class-1",
            "student_uid": "student-1",
            "status": "active",
        }
        db.enrollments["legacy-without-student"] = {
            "id": "legacy-without-student",
            "class_id": "class-1",
            "student_uid": "",
            "status": "active",
        }

        report = migrate_once(db=db, commit=True)

        self.assertEqual(report.untouched, 1)
        self.assertEqual(report.skipped_malformed, 1)

    def test_can_scope_migration_to_one_class(self):
        db = FakeMigrationDb()
        db.enrollments["class-1__4007"] = {
            "id": "class-1__4007",
            "class_id": "class-1",
            "student_uid": "student-1",
            "status": "active",
        }
        db.enrollments["class-2__9999"] = {
            "id": "class-2__9999",
            "class_id": "class-2",
            "student_uid": "student-2",
            "status": "active",
        }

        report = migrate_once(db=db, commit=True, class_id="class-1")

        self.assertEqual(report.migrated, 1)
        self.assertIn("class-1_student-1", db.enrollments)
        self.assertIn("class-2__9999", db.enrollments)
        self.assertNotIn("class-2_student-2", db.enrollments)


if __name__ == "__main__":
    unittest.main()
