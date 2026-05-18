import unittest
from unittest.mock import MagicMock, patch

import database


class CreateSchoolRequestEnrichedTest(unittest.TestCase):
    @patch('database.get_school_requests_collection')
    def test_legacy_thin_payload_still_works(self, mock_coll):
        doc_ref = MagicMock()
        doc_ref.id = 'req-1'
        mock_coll.return_value.document.return_value = doc_ref

        request_id = database.create_school_request(
            requester_uid='uid-1',
            requester_email='a@b.test',
            requester_name='Ada',
            school_name='SF Friends',
            org_type='school',
        )

        self.assertEqual(request_id, 'req-1')
        payload = doc_ref.set.call_args[0][0]
        self.assertEqual(payload['school_name'], 'SF Friends')
        self.assertEqual(payload['status'], 'pending')
        # Enriched fields are NOT written when omitted.
        self.assertNotIn('location', payload)
        self.assertNotIn('admin_identity', payload)

    @patch('database.get_school_requests_collection')
    def test_enriched_payload_is_merged(self, mock_coll):
        doc_ref = MagicMock()
        doc_ref.id = 'req-2'
        mock_coll.return_value.document.return_value = doc_ref

        enriched = {
            'location': {'country': 'US', 'state': 'CA', 'county': 'San Francisco'},
            'school_type': 'k12',
            'public_private': 'private',
            'grade_size': '50-100',
            'official_email_domains': ['@ssfs.org'],
            'admin_identity': {
                'full_name': 'Ada Lovelace',
                'school_email': 'ada@ssfs.org',
                'role_title': 'Principal',
                'authorization_attestation': {
                    'confirmed_at': '2026-05-18T12:00:00Z',
                    'ip_hash': 'sha256:...',
                    'user_agent': 'Mozilla/5.0',
                },
            },
            'integration': {
                'canvas_url': 'ssfs.instructure.com',
                'canvas_integration_types': ['lti13', 'roster_sync'],
            },
            'curriculum': {
                'grade_ranges': ['g6_8', 'g9_12'],
                'languages_taught': ['es', 'fr'],
                'course_frameworks': ['ap', 'actfl'],
            },
            'pre_invited_teachers': ['t1@ssfs.org', 't2@ssfs.org'],
        }

        database.create_school_request(
            requester_uid='uid-2',
            requester_email='ada@ssfs.org',
            requester_name='Ada',
            school_name='SF Friends',
            org_type='school',
            enriched=enriched,
        )

        payload = doc_ref.set.call_args[0][0]
        self.assertEqual(payload['school_type'], 'k12')
        self.assertEqual(payload['location']['state'], 'CA')
        self.assertEqual(payload['admin_identity']['role_title'], 'Principal')
        self.assertEqual(payload['integration']['canvas_integration_types'],
                         ['lti13', 'roster_sync'])
        self.assertEqual(payload['curriculum']['languages_taught'], ['es', 'fr'])
        self.assertEqual(payload['pre_invited_teachers'],
                         ['t1@ssfs.org', 't2@ssfs.org'])
        # Status default still applies.
        self.assertEqual(payload['status'], 'pending')


if __name__ == '__main__':
    unittest.main()
