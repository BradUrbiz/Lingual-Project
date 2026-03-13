import unittest
from unittest.mock import MagicMock, patch


class TestDisclosureLogging(unittest.TestCase):

    @patch('backend.services.disclosure_logging.get_db')
    def test_logs_new_event(self, mock_get_db):
        from backend.services.disclosure_logging import log_disclosure_if_new

        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.collection.return_value = mock_collection
        mock_query = MagicMock()
        mock_collection.where.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get.return_value = []  # No existing event

        log_disclosure_if_new(
            org_id='org1',
            actor_uid='teacher1',
            actor_role='teacher',
            student_uid='student1',
            event_type='disclosure.compliance_viewed',
            payload={'endpoint': '/api/test'},
        )

        mock_collection.add.assert_called_once()
        call_args = mock_collection.add.call_args[0][0]
        self.assertEqual(call_args['org_id'], 'org1')
        self.assertEqual(call_args['actor_id'], 'teacher1')
        self.assertEqual(call_args['event_type'], 'disclosure.compliance_viewed')

    @patch('backend.services.disclosure_logging.get_db')
    def test_skips_duplicate_event(self, mock_get_db):
        from backend.services.disclosure_logging import log_disclosure_if_new

        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.collection.return_value = mock_collection
        mock_query = MagicMock()
        mock_collection.where.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get.return_value = [MagicMock()]  # Existing event found

        log_disclosure_if_new(
            org_id='org1',
            actor_uid='teacher1',
            actor_role='teacher',
            student_uid='student1',
            event_type='disclosure.compliance_viewed',
            payload={'endpoint': '/api/test'},
        )

        mock_collection.add.assert_not_called()


if __name__ == '__main__':
    unittest.main()
