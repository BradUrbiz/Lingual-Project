"""
Integration tests that verify Firestore compound queries work against the emulator.

These tests catch OBS-6: FakeDb can't detect missing composite indexes.
Each test exercises a query from database.py that requires a composite index
defined in firestore.indexes.json.

Usage:
    # Start emulator in background, run tests, then stop:
    make test-emulator

    # Or manually:
    JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home \
      firebase emulators:exec --only firestore --project lingu-480600 \
      'FIRESTORE_EMULATOR_HOST=localhost:8787 python3 -m unittest backend.tests.test_firestore_indexes -v'

Requires:
    - Java runtime (Temurin)
    - Firebase CLI
    - FIRESTORE_EMULATOR_HOST=localhost:8787 env var
"""

import os
import unittest
from datetime import UTC, datetime

# Skip entire module if emulator is not running
EMULATOR_HOST = os.environ.get("FIRESTORE_EMULATOR_HOST")
if not EMULATOR_HOST:
    raise unittest.SkipTest(
        "FIRESTORE_EMULATOR_HOST not set — skipping emulator integration tests. "
        "Run with: make test-emulator"
    )

# Must set emulator host BEFORE importing firebase_admin
os.environ["FIRESTORE_EMULATOR_HOST"] = EMULATOR_HOST

import firebase_admin
from firebase_admin import firestore as admin_firestore

# Initialize a test-only Firebase app pointing at the emulator
_app = None
_db = None


def _get_db():
    global _app, _db
    if _db is None:
        if _app is None:
            _app = firebase_admin.initialize_app(
                options={"projectId": "lingu-test-emulator"},
                name="emulator-test",
            )
        _db = admin_firestore.client(app=_app)
    return _db


def _clear_collection(collection_name: str):
    """Delete all documents in a collection (emulator only)."""
    db = _get_db()
    docs = db.collection(collection_name).limit(500).stream()
    for doc in docs:
        doc.reference.delete()


class FirestoreIndexTestBase(unittest.TestCase):
    """Base class that clears test collections before each test."""

    COLLECTIONS_TO_CLEAR = [
        "memberships",
        "classes",
        "enrollments",
        "organizations",
        "canvas_course_content",
    ]

    def setUp(self):
        self.db = _get_db()
        for collection in self.COLLECTIONS_TO_CLEAR:
            _clear_collection(collection)

    def _create_doc(self, collection: str, doc_id: str | None = None, **data):
        """Create a document and return its ID."""
        if doc_id:
            ref = self.db.collection(collection).document(doc_id)
            ref.set(data)
            return doc_id
        else:
            _, ref = self.db.collection(collection).add(data)
            return ref.id


class TestMembershipIndexes(FirestoreIndexTestBase):
    """Index: memberships (uid ASC, status ASC)"""

    def test_query_memberships_by_uid_and_status(self):
        """Compound query: uid + status filter (used by get_user_memberships)."""
        self._create_doc(
            "memberships",
            uid="user-1",
            orgId="org-1",
            roles=["teacher"],
            status="active",
        )
        self._create_doc(
            "memberships",
            uid="user-1",
            orgId="org-2",
            roles=["student"],
            status="inactive",
        )
        self._create_doc(
            "memberships",
            uid="user-2",
            orgId="org-1",
            roles=["teacher"],
            status="active",
        )

        # This is the exact query from database.py get_user_memberships()
        results = list(
            self.db.collection("memberships")
            .where("uid", "==", "user-1")
            .where("status", "in", sorted(["active", "invited"]))
            .stream()
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].to_dict()["orgId"], "org-1")


class TestClassIndexes(FirestoreIndexTestBase):
    """Indexes on the classes collection."""

    def _seed_classes(self):
        now = datetime.now(UTC)
        self._create_doc(
            "classes",
            org_id="org-1",
            name="French 101",
            status="active",
            teacher_membership_ids=["mem-1"],
            updated_at=now,
        )
        self._create_doc(
            "classes",
            org_id="org-1",
            name="French 201",
            status="active",
            teacher_membership_ids=["mem-1", "mem-2"],
            updated_at=now,
        )
        self._create_doc(
            "classes",
            org_id="org-2",
            name="Korean 101",
            status="active",
            teacher_membership_ids=["mem-3"],
            updated_at=now,
        )
        self._create_doc(
            "classes",
            org_id="org-1",
            name="Archived Class",
            status="archived",
            teacher_membership_ids=["mem-1"],
            updated_at=now,
        )

    def test_query_classes_by_org_status_ordered(self):
        """Compound query: org_id + status + order_by updated_at DESC (used by list_org_classes)."""
        self._seed_classes()

        results = list(
            self.db.collection("classes")
            .where("org_id", "==", "org-1")
            .where("status", "==", "active")
            .order_by("updated_at", direction=admin_firestore.Query.DESCENDING)
            .stream()
        )

        self.assertEqual(len(results), 2)
        names = [r.to_dict()["name"] for r in results]
        self.assertIn("French 101", names)
        self.assertIn("French 201", names)
        self.assertNotIn("Archived Class", names)
        self.assertNotIn("Korean 101", names)

    def test_query_classes_by_teacher_membership_status_ordered(self):
        """Compound query: teacher_membership_ids CONTAINS + status + order_by updated_at DESC
        (used by list_teacher_classes)."""
        self._seed_classes()

        results = list(
            self.db.collection("classes")
            .where("teacher_membership_ids", "array_contains", "mem-1")
            .where("status", "==", "active")
            .order_by("updated_at", direction=admin_firestore.Query.DESCENDING)
            .stream()
        )

        self.assertEqual(len(results), 2)
        names = [r.to_dict()["name"] for r in results]
        self.assertIn("French 101", names)
        self.assertIn("French 201", names)


class TestEnrollmentIndexes(FirestoreIndexTestBase):
    """Indexes on the enrollments collection."""

    def _seed_enrollments(self):
        now = datetime.now(UTC)
        self._create_doc(
            "enrollments",
            class_id="class-1",
            student_uid="stu-1",
            canvas_email="",
            status="active",
            updated_at=now,
        )
        self._create_doc(
            "enrollments",
            class_id="class-1",
            student_uid="stu-2",
            canvas_email="stu2@school.edu",
            status="active",
            updated_at=now,
        )
        self._create_doc(
            "enrollments",
            class_id="class-2",
            student_uid="stu-1",
            canvas_email="",
            status="active",
            updated_at=now,
        )
        self._create_doc(
            "enrollments",
            class_id="class-1",
            student_uid="stu-3",
            canvas_email="stu3@school.edu",
            status="inactive",
            updated_at=now,
        )

    def test_query_enrollments_by_class_status_ordered(self):
        """Compound query: class_id + status + order_by updated_at DESC
        (used by list_class_enrollments)."""
        self._seed_enrollments()

        results = list(
            self.db.collection("enrollments")
            .where("class_id", "==", "class-1")
            .where("status", "==", "active")
            .order_by("updated_at", direction=admin_firestore.Query.DESCENDING)
            .stream()
        )

        self.assertEqual(len(results), 2)
        uids = {r.to_dict()["student_uid"] for r in results}
        self.assertEqual(uids, {"stu-1", "stu-2"})

    def test_query_enrollments_by_student_status_ordered(self):
        """Compound query: student_uid + status + order_by updated_at DESC
        (used by list_student_enrollments)."""
        self._seed_enrollments()

        results = list(
            self.db.collection("enrollments")
            .where("student_uid", "==", "stu-1")
            .where("status", "==", "active")
            .order_by("updated_at", direction=admin_firestore.Query.DESCENDING)
            .stream()
        )

        self.assertEqual(len(results), 2)
        class_ids = {r.to_dict()["class_id"] for r in results}
        self.assertEqual(class_ids, {"class-1", "class-2"})

    def test_query_enrollments_by_canvas_email_status(self):
        """Compound query: canvas_email + status
        (used by list_pending_canvas_enrollments_by_email)."""
        self._seed_enrollments()

        results = list(
            self.db.collection("enrollments")
            .where("canvas_email", "==", "stu2@school.edu")
            .where("status", "==", "active")
            .stream()
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].to_dict()["student_uid"], "stu-2")


class TestCanvasCourseContentIndex(FirestoreIndexTestBase):
    """Index: canvas_course_content (class_id ASC, canvas_module_position ASC, item_position ASC)"""

    def test_query_canvas_content_ordered(self):
        """Compound query: class_id + ordered by module_position + item_position."""
        self._create_doc(
            "canvas_course_content",
            class_id="class-1",
            canvas_module_position=2,
            item_position=1,
            title="Module 2 Item 1",
        )
        self._create_doc(
            "canvas_course_content",
            class_id="class-1",
            canvas_module_position=1,
            item_position=2,
            title="Module 1 Item 2",
        )
        self._create_doc(
            "canvas_course_content",
            class_id="class-1",
            canvas_module_position=1,
            item_position=1,
            title="Module 1 Item 1",
        )
        self._create_doc(
            "canvas_course_content",
            class_id="class-2",
            canvas_module_position=1,
            item_position=1,
            title="Other class",
        )

        results = list(
            self.db.collection("canvas_course_content")
            .where("class_id", "==", "class-1")
            .order_by("canvas_module_position")
            .order_by("item_position")
            .stream()
        )

        self.assertEqual(len(results), 3)
        titles = [r.to_dict()["title"] for r in results]
        self.assertEqual(titles, ["Module 1 Item 1", "Module 1 Item 2", "Module 2 Item 1"])


if __name__ == "__main__":
    unittest.main()
