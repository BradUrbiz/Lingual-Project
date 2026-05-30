"""Tier 1 (no DB): pure backfill normalization transforms.

Covers the documented Firestore->Postgres value remaps + type coercions
(POSTGRES_SCHEMA.md "Backfill Normalization And ID Resolution").
"""

import datetime
import unittest

from backend.db.repository import normalization as norm


class TestValueRemaps(unittest.TestCase):
    def test_enrollment_status_remaps_pending_sync(self):
        self.assertEqual(norm.normalize_enrollment_status('pending_sync'), 'inactive')

    def test_enrollment_status_passthrough_and_default(self):
        self.assertEqual(norm.normalize_enrollment_status('active'), 'active')
        self.assertEqual(norm.normalize_enrollment_status('removed'), 'removed')
        self.assertEqual(norm.normalize_enrollment_status(None), 'active')

    def test_join_source_remaps_canvas(self):
        self.assertEqual(norm.normalize_join_source('canvas'), 'canvas_legacy')
        self.assertEqual(norm.normalize_join_source('join_code'), 'join_code')
        self.assertEqual(norm.normalize_join_source(None), 'manual')

    def test_org_status_remaps_inactive(self):
        self.assertEqual(norm.normalize_org_status('inactive'), 'archived')
        self.assertEqual(norm.normalize_org_status('active'), 'active')
        self.assertEqual(norm.normalize_org_status('suspended'), 'suspended')

    def test_target_language_intensity_legacy_values(self):
        self.assertEqual(norm.normalize_target_language_intensity('mostly_target'), 'target_led')
        self.assertEqual(
            norm.normalize_target_language_intensity('bilingual_scaffold'), 'english_led'
        )
        self.assertEqual(norm.normalize_target_language_intensity('balanced'), 'balanced')
        self.assertEqual(norm.normalize_target_language_intensity(None), 'balanced')


class TestTimestampCoercion(unittest.TestCase):
    def test_empty_and_none_become_none(self):
        self.assertIsNone(norm.parse_firestore_timestamp(''))
        self.assertIsNone(norm.parse_firestore_timestamp(None))

    def test_datetime_passthrough(self):
        dt = datetime.datetime(2026, 5, 30, 12, 0, 0)
        self.assertEqual(norm.parse_firestore_timestamp(dt), dt)

    def test_iso_string_parses(self):
        got = norm.parse_firestore_timestamp('2026-05-30T12:00:00Z')
        self.assertEqual(got.year, 2026)
        self.assertEqual(got.month, 5)
        self.assertEqual(got.day, 30)

    def test_unparseable_string_returns_none(self):
        self.assertIsNone(norm.parse_firestore_timestamp('not-a-date'))


class TestListAndJsonbCoercion(unittest.TestCase):
    def test_coerce_str_list(self):
        self.assertEqual(norm.coerce_str_list(['a', 'b']), ['a', 'b'])
        self.assertEqual(norm.coerce_str_list(None), [])
        self.assertEqual(norm.coerce_str_list([]), [])
        self.assertEqual(norm.coerce_str_list('solo'), ['solo'])
        self.assertEqual(norm.coerce_str_list([1, None, 2]), ['1', '2'])

    def test_coerce_jsonb_defaults(self):
        self.assertEqual(norm.coerce_jsonb(None), {})
        self.assertEqual(norm.coerce_jsonb(None, default=[]), [])
        self.assertEqual(norm.coerce_jsonb({'k': 1}), {'k': 1})


if __name__ == '__main__':
    unittest.main()
