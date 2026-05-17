import unittest
from unittest.mock import MagicMock, patch

from database import get_student_class_enrollment


def _doc(*, exists, doc_id="", data=None):
    record = MagicMock()
    record.exists = exists
    record.id = doc_id
    record.to_dict = lambda: dict(data) if data is not None else None
    return record


class GetStudentClassEnrollmentTest(unittest.TestCase):
    def test_returns_deterministic_enrollment_when_present(self):
        deterministic = _doc(
            exists=True,
            doc_id="class-1_student-1",
            data={"class_id": "class-1", "student_uid": "student-1", "status": "active"},
        )

        with patch("database.get_enrollment_ref") as mock_ref, patch(
            "database.list_student_enrollments"
        ) as mock_list:
            mock_ref.return_value.get.return_value = deterministic

            result = get_student_class_enrollment("class-1", "student-1")

        self.assertEqual(result["id"], "class-1_student-1")
        self.assertEqual(result["status"], "active")
        mock_list.assert_not_called()

    def test_falls_back_to_legacy_enrollment_when_deterministic_doc_is_missing(self):
        missing = _doc(exists=False)
        legacy_rows = [
            {"id": "class-9_student-1", "class_id": "class-9", "student_uid": "student-1", "status": "active"},
            {"id": "class-1__4007", "class_id": "class-1", "student_uid": "student-1", "status": "active"},
        ]

        with patch("database.get_enrollment_ref") as mock_ref, patch(
            "database.list_student_enrollments"
        ) as mock_list:
            mock_ref.return_value.get.return_value = missing
            mock_list.return_value = legacy_rows

            result = get_student_class_enrollment("class-1", "student-1")

        self.assertEqual(result["id"], "class-1__4007")
        self.assertEqual(result["class_id"], "class-1")
        self.assertEqual(result["student_uid"], "student-1")
        mock_list.assert_called_once_with("student-1", status=None)

    def test_prefers_active_legacy_enrollment_over_inactive_deterministic_doc(self):
        inactive = _doc(
            exists=True,
            doc_id="class-1_student-1",
            data={"class_id": "class-1", "student_uid": "student-1", "status": "inactive"},
        )
        legacy_rows = [
            {"id": "class-1_student-1", "class_id": "class-1", "student_uid": "student-1", "status": "inactive"},
            {"id": "class-1__4007", "class_id": "class-1", "student_uid": "student-1", "status": "active"},
        ]

        with patch("database.get_enrollment_ref") as mock_ref, patch(
            "database.list_student_enrollments"
        ) as mock_list:
            mock_ref.return_value.get.return_value = inactive
            mock_list.return_value = legacy_rows

            result = get_student_class_enrollment("class-1", "student-1")

        self.assertEqual(result["id"], "class-1__4007")
        self.assertEqual(result["status"], "active")

    def test_returns_none_when_neither_deterministic_nor_legacy_enrollment_exists(self):
        missing = _doc(exists=False)

        with patch("database.get_enrollment_ref") as mock_ref, patch(
            "database.list_student_enrollments"
        ) as mock_list:
            mock_ref.return_value.get.return_value = missing
            mock_list.return_value = []

            result = get_student_class_enrollment("class-1", "student-1")

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
