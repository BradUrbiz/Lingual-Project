import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
INDEXES_PATH = REPO_ROOT / "firestore.indexes.json"


class TestFirestoreIndexManifest(unittest.TestCase):
    def _load_indexes(self):
        payload = json.loads(INDEXES_PATH.read_text())
        return payload.get("indexes", [])

    def _has_index(self, collection_group, expected_fields):
        for index in self._load_indexes():
            if index.get("collectionGroup") != collection_group:
                continue

            fields = [
                (field.get("fieldPath"), field.get("order"))
                for field in index.get("fields", [])
            ]
            if fields == expected_fields:
                return True
        return False

    def test_enrollments_student_uid_updated_at_index_exists(self):
        """The join-code fallback query needs student_uid + updated_at ordering."""
        if self._has_index(
            "enrollments",
            [
                ("student_uid", "ASCENDING"),
                ("updated_at", "DESCENDING"),
            ],
        ):
            return

        self.fail(
            "firestore.indexes.json is missing the enrollments composite index "
            "for student_uid ASC + updated_at DESC"
        )

    def test_teacher_join_request_uid_status_requested_at_index_exists(self):
        """GET /api/teacher-join-requests/me needs uid + status + requested_at ordering."""
        if self._has_index(
            "teacher_join_requests",
            [
                ("uid", "ASCENDING"),
                ("status", "ASCENDING"),
                ("requested_at", "DESCENDING"),
            ],
        ):
            return

        self.fail(
            "firestore.indexes.json is missing the teacher_join_requests composite index "
            "for uid ASC + status ASC + requested_at DESC"
        )

    def test_teacher_join_request_org_status_requested_at_index_exists(self):
        """Admin pending list needs org_id + status + requested_at ordering."""
        if self._has_index(
            "teacher_join_requests",
            [
                ("org_id", "ASCENDING"),
                ("status", "ASCENDING"),
                ("requested_at", "DESCENDING"),
            ],
        ):
            return

        self.fail(
            "firestore.indexes.json is missing the teacher_join_requests composite index "
            "for org_id ASC + status ASC + requested_at DESC"
        )


if __name__ == "__main__":
    unittest.main()
