"""Tests for backend.services.audit and database accessors."""
import unittest
from unittest.mock import MagicMock, patch

import database
from backend.services.audit import AuditAction, AuditLogger


class AuditActionEnumTests(unittest.TestCase):
    def test_enum_values(self):
        self.assertEqual(AuditAction.REQUEST_APPROVED.value, 'request_approved')
        self.assertEqual(AuditAction.REQUEST_DECLINED.value, 'request_declined')
        self.assertEqual(AuditAction.ORG_SUSPENDED.value, 'org_suspended')
        self.assertEqual(AuditAction.ORG_RESTORED.value, 'org_restored')
        self.assertEqual(AuditAction.ORG_METADATA_EDITED.value, 'org_metadata_edited')
        self.assertEqual(AuditAction.ORG_VIEWED_DETAIL.value, 'org_viewed_detail')
        self.assertEqual(AuditAction.MEMBERSHIP_REMOVED.value, 'membership_removed')


class DatabaseAuditCollectionTests(unittest.TestCase):
    def test_collection_constant(self):
        self.assertEqual(database.LINGUAL_ADMIN_AUDIT_COLLECTION, 'lingual_admin_audit')

    @patch('database.get_db')
    def test_accessor_returns_collection(self, mock_get_db):
        mock_col = MagicMock(name='collection')
        mock_get_db.return_value.collection.return_value = mock_col
        result = database.get_lingual_admin_audit_collection()
        mock_get_db.return_value.collection.assert_called_once_with('lingual_admin_audit')
        self.assertIs(result, mock_col)


class AuditLoggerTests(unittest.TestCase):
    def test_log_writes_one_doc(self):
        fake_col = MagicMock(name='collection')
        fake_add = fake_col.add
        fake_add.return_value = (None, MagicMock(id='audit123'))
        logger = AuditLogger(collection_factory=lambda: fake_col)
        audit_id = logger.log(
            actor_uid='admin-uid',
            action=AuditAction.ORG_SUSPENDED,
            target_type='organization',
            target_id='org-1',
            target_org_id='org-1',
            metadata={'reason': 'fraud'},
            ip_hash='abc',
            user_agent='test-ua',
        )
        self.assertEqual(audit_id, 'audit123')
        args, _ = fake_add.call_args
        doc = args[0]
        self.assertEqual(doc['actor_uid'], 'admin-uid')
        self.assertEqual(doc['action'], 'org_suspended')
        self.assertEqual(doc['target'], {'type': 'organization', 'id': 'org-1'})
        self.assertEqual(doc['target_org_id'], 'org-1')
        self.assertEqual(doc['metadata'], {'reason': 'fraud'})
        self.assertEqual(doc['ip_hash'], 'abc')
        self.assertEqual(doc['user_agent'], 'test-ua')
        self.assertIn('created_at', doc)  # SERVER_TIMESTAMP sentinel

    def test_log_is_failsoft(self):
        """A failing audit write must not raise."""
        fake_col = MagicMock(name='collection')
        fake_col.add.side_effect = RuntimeError('Firestore down')
        logger = AuditLogger(collection_factory=lambda: fake_col)
        # Should NOT raise.
        result = logger.log(
            actor_uid='u',
            action=AuditAction.ORG_VIEWED_DETAIL,
            target_type='organization',
            target_id='org-1',
            target_org_id='org-1',
            metadata={},
            ip_hash='',
            user_agent='',
        )
        self.assertIsNone(result)

    def test_log_accepts_string_action_for_legacy_callers(self):
        fake_col = MagicMock(name='collection')
        fake_col.add.return_value = (None, MagicMock(id='id'))
        logger = AuditLogger(collection_factory=lambda: fake_col)
        logger.log(
            actor_uid='u',
            action='request_approved',  # string accepted as well
            target_type='school_request',
            target_id='req-1',
            target_org_id=None,
            metadata={},
            ip_hash='',
            user_agent='',
        )
        args, _ = fake_col.add.call_args
        self.assertEqual(args[0]['action'], 'request_approved')


class AuditLoggerBuildDocTests(unittest.TestCase):
    """`build_audit_doc` returns a dict without writing — used by state-
    transition helpers that need to batch audit with business writes."""

    def test_returns_well_formed_doc(self):
        fake_col = MagicMock(name='collection')
        logger = AuditLogger(collection_factory=lambda: fake_col)
        doc = logger.build_audit_doc(
            actor_uid='u',
            action=AuditAction.ORG_SUSPENDED,
            target_type='organization',
            target_id='o-1',
            target_org_id='o-1',
            metadata={'reason': 'fraud'},
            ip_hash='h',
            user_agent='ua',
        )
        self.assertEqual(doc['actor_uid'], 'u')
        self.assertEqual(doc['action'], 'org_suspended')
        self.assertEqual(doc['target'], {'type': 'organization', 'id': 'o-1'})
        self.assertIn('created_at', doc)
        fake_col.add.assert_not_called()  # build must NOT write
