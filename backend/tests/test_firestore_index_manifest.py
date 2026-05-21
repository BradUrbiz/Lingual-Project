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

    def test_lingual_admin_school_request_list_indexes_exist(self):
        """Plan 5 request list needs cursor-compatible composite indexes.

        `database.list_school_requests` always orders by the selected leading
        field and then `__name__` for stable pagination. Firestore's single
        field indexes cover the unfiltered list, so these composite manifest
        entries cover the visible Lingual admin request-list filters:
        status, schoolType, and status+schoolType.
        """
        sort_tails = {
            "requested_at_desc": [
                ("created_at", "DESCENDING")
            ],
            "requested_at_asc": [
                ("created_at", "ASCENDING")
            ],
            "name": [
                ("school_name", "ASCENDING")
            ],
        }
        filter_prefixes = {
            "status": [("status", "ASCENDING")],
            "school_type": [("school_type", "ASCENDING")],
            "status_school_type": [
                ("status", "ASCENDING"),
                ("school_type", "ASCENDING"),
            ],
        }

        for filter_label, prefix in filter_prefixes.items():
            for sort_label, tail in sort_tails.items():
                with self.subTest(filter=filter_label, sort=sort_label):
                    self.assertTrue(
                        self._has_index("school_requests", prefix + tail),
                        "firestore.indexes.json is missing school_requests "
                        f"index for {filter_label} + {sort_label}",
                    )


if __name__ == "__main__":
    unittest.main()
