import unittest

from backend.services import outbox


class OutboxConstantsTest(unittest.TestCase):
    def test_collection_name(self):
        self.assertEqual(outbox.OUTBOX_EMAILS_COLLECTION, 'outbox_emails')

    def test_template_enum_includes_school_request_to_lingual(self):
        self.assertEqual(
            outbox.OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL.value,
            'school_request_to_lingual',
        )

    def test_template_enum_is_exhaustive_for_v1(self):
        # v1 wires only one template; later plans add more.
        self.assertEqual(
            {t.value for t in outbox.OutboxTemplate},
            {'school_request_to_lingual'},
        )
