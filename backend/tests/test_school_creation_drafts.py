import unittest

import database


class WizardEnumConstantsTest(unittest.TestCase):
    def test_school_type_values(self):
        self.assertEqual(database.ALLOWED_SCHOOL_TYPES, frozenset({
            'middle', 'high', 'k12', 'university',
            'language_academy', 'district', 'other',
        }))

    def test_public_private_values(self):
        self.assertEqual(database.ALLOWED_PUBLIC_PRIVATE, frozenset({
            'public', 'private', 'charter', 'other',
        }))

    def test_grade_size_values(self):
        self.assertEqual(database.ALLOWED_GRADE_SIZES, frozenset({
            '<50', '50-100', '100-200', '200-500', '500+',
        }))

    def test_canvas_integration_types(self):
        self.assertEqual(database.ALLOWED_CANVAS_INTEGRATION_TYPES, frozenset({
            'lti13', 'roster_sync', 'grade_passback', 'sso',
        }))

    def test_grade_ranges(self):
        self.assertEqual(database.ALLOWED_GRADE_RANGES, frozenset({
            'k_2', 'g3_5', 'g6_8', 'g9_12', 'undergrad', 'graduate', 'adult_ed',
        }))

    def test_course_frameworks(self):
        self.assertEqual(database.ALLOWED_COURSE_FRAMEWORKS, frozenset({
            'ap', 'actfl', 'cefr', 'ib', 'school_specific', 'none',
        }))

    def test_rejection_categories(self):
        self.assertEqual(database.ALLOWED_REJECTION_CATEGORIES, frozenset({
            'info_missing', 'fraud_risk', 'out_of_scope', 'duplicate', 'other',
        }))

    def test_wizard_step_range(self):
        self.assertEqual(database.WIZARD_STEP_MIN, 1)
        self.assertEqual(database.WIZARD_STEP_MAX, 4)


if __name__ == '__main__':
    unittest.main()
