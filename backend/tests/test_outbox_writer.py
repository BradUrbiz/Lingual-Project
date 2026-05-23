import os
import unittest
from unittest.mock import MagicMock, patch

from backend.services import outbox
from backend.services.outbox import (
    OUTBOX_EMAILS_COLLECTION,
    OutboxBlockedInTestMode,
    OutboxTemplate,
    enqueue_outbox_email,
)
import database


class OutboxConstantsTest(unittest.TestCase):
    def test_collection_name(self):
        self.assertEqual(outbox.OUTBOX_EMAILS_COLLECTION, 'outbox_emails')

    def test_template_enum_includes_school_request_to_lingual(self):
        self.assertEqual(
            outbox.OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL.value,
            'school_request_to_lingual',
        )

    def test_template_enum_is_exhaustive_for_v1(self):
        # Plans 1 + 3 + 4 wire seven templates; Plan 5 adds the two
        # Lingual-admin org-lifecycle templates (suspend / restore). Later
        # plans append to this set.
        self.assertEqual(
            {t.value for t in outbox.OutboxTemplate},
            {
                'school_request_to_lingual',
                'school_request_approved',
                'school_request_declined',
                'teacher_invitation',
                'teacher_join_request_to_admin',
                'teacher_join_approved',
                'teacher_join_declined',
                'org_suspended',
                'org_restored',
            },
        )


class EnqueueOutboxEmailTest(unittest.TestCase):
    # These tests exercise the actual write logic, so they explicitly opt out
    # of the conftest guard (LINGUAL_BLOCK_OUTBOX_WRITES=1) by removing it for
    # the duration of each test. The guard is verified separately in
    # OutboxBlockGuardTest below.
    def setUp(self):
        self._prev_block = os.environ.pop('LINGUAL_BLOCK_OUTBOX_WRITES', None)

    def tearDown(self):
        if self._prev_block is not None:
            os.environ['LINGUAL_BLOCK_OUTBOX_WRITES'] = self._prev_block

    def test_writes_doc_with_expected_shape(self):
        db = MagicMock()
        doc_ref = MagicMock()
        db.collection.return_value.document.return_value = doc_ref

        enqueue_outbox_email(
            db=db,
            recipient_email='admin@lingual.app',
            recipient_name='Pat',
            template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
            template_data={'org_name': 'SF Friends School'},
            related_entity_type='school_request',
            related_entity_id='req-123',
            created_by_uid='uid-1',
        )

        db.collection.assert_called_once_with(OUTBOX_EMAILS_COLLECTION)
        args, _ = doc_ref.set.call_args
        payload = args[0]
        self.assertEqual(payload['recipient'], {'email': 'admin@lingual.app', 'name': 'Pat'})
        self.assertEqual(payload['template_id'], 'school_request_to_lingual')
        self.assertEqual(payload['template_data'], {'org_name': 'SF Friends School'})
        self.assertEqual(payload['status'], 'pending')
        self.assertEqual(payload['attempt_count'], 0)
        self.assertEqual(payload['related_entity'], {'type': 'school_request', 'id': 'req-123'})
        self.assertEqual(payload['created_by_uid'], 'uid-1')

    def test_rejects_invalid_recipient_email(self):
        db = MagicMock()
        with self.assertRaises(ValueError):
            enqueue_outbox_email(
                db=db,
                recipient_email='not-an-email',
                recipient_name=None,
                template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
                template_data={},
            )

    def test_uses_transaction_when_provided(self):
        db = MagicMock()
        tx = MagicMock()
        doc_ref = MagicMock()
        db.collection.return_value.document.return_value = doc_ref

        enqueue_outbox_email(
            db=db,
            transaction=tx,
            recipient_email='admin@lingual.app',
            recipient_name='Pat',
            template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
            template_data={},
        )

        tx.set.assert_called_once()
        doc_ref.set.assert_not_called()

    def test_omits_related_entity_when_not_provided(self):
        db = MagicMock()
        doc_ref = MagicMock()
        db.collection.return_value.document.return_value = doc_ref

        enqueue_outbox_email(
            db=db,
            recipient_email='admin@lingual.app',
            recipient_name=None,
            template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
            template_data={},
        )

        args, _ = doc_ref.set.call_args
        payload = args[0]
        self.assertNotIn('related_entity', payload)


class ListLingualAdminEmailsTest(unittest.TestCase):
    def _make_mem_doc(self, uid, status, roles=None):
        """Build a mock Firestore document for a membership."""
        doc = MagicMock()
        doc.to_dict.return_value = {
            'uid': uid,
            'status': status,
            'roles': roles if roles is not None else ['lingual_admin'],
        }
        return doc

    # Keep the old name as an alias so any direct callers outside this file still work.
    _make_doc = _make_mem_doc

    def _make_user_doc(self, uid, email, name=None, display_name=None, lingual_admin=True):
        """Build a mock Firestore document for a users/{uid} record."""
        doc = MagicMock()
        doc.id = uid
        profile = {}
        if display_name:
            profile['display_name'] = display_name
        doc.to_dict.return_value = {
            'email': email,
            'name': name,
            'profile': profile,
            'lingual_admin': lingual_admin,
        }
        return doc

    def _patch_legacy_users(self, user_docs):
        """Return a context-manager patch that makes the legacy users query return user_docs."""
        mock_db = MagicMock()
        mock_db.collection.return_value.where.return_value.stream.return_value = user_docs
        return patch.object(database, 'get_db', return_value=mock_db)

    def test_happy_path_active_included_revoked_excluded(self):
        """Active lingual_admin is returned; revoked one is excluded."""
        active_doc = self._make_mem_doc('uid-a', 'active')
        revoked_doc = self._make_mem_doc('uid-b', 'revoked')

        def fake_get_user(uid):
            users = {
                'uid-a': {'email': 'admin-a@lingual.app', 'name': 'Admin A', 'profile': {'display_name': 'Admin Alpha'}},
            }
            return users.get(uid)

        mock_collection = MagicMock()
        mock_collection.where.return_value.stream.return_value = [active_doc, revoked_doc]

        with patch.object(database, 'get_memberships_collection', return_value=mock_collection), \
             patch.object(database, 'get_user', side_effect=fake_get_user), \
             self._patch_legacy_users([]):
            result = database.list_lingual_admin_emails()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['uid'], 'uid-a')
        self.assertEqual(result[0]['email'], 'admin-a@lingual.app')
        self.assertEqual(result[0]['name'], 'Admin Alpha')

    def test_empty_when_no_active_lingual_admins(self):
        """Returns empty list when there are no active lingual_admin memberships or legacy flags."""
        mock_collection = MagicMock()
        mock_collection.where.return_value.stream.return_value = []

        with patch.object(database, 'get_memberships_collection', return_value=mock_collection), \
             patch.object(database, 'get_user', return_value=None), \
             self._patch_legacy_users([]):
            result = database.list_lingual_admin_emails()

        self.assertEqual(result, [])

    def test_deduplicates_same_uid_across_multiple_memberships(self):
        """A uid appearing in two active lingual_admin memberships yields one entry."""
        doc1 = self._make_mem_doc('uid-x', 'active')
        doc2 = self._make_mem_doc('uid-x', 'active')

        def fake_get_user(uid):
            return {'email': 'x@lingual.app', 'name': 'X', 'profile': {}}

        mock_collection = MagicMock()
        mock_collection.where.return_value.stream.return_value = [doc1, doc2]

        with patch.object(database, 'get_memberships_collection', return_value=mock_collection), \
             patch.object(database, 'get_user', side_effect=fake_get_user), \
             self._patch_legacy_users([]):
            result = database.list_lingual_admin_emails()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['uid'], 'uid-x')

    def test_result_sorted_by_uid(self):
        """Results are sorted alphabetically by uid for deterministic ordering."""
        doc_z = self._make_mem_doc('uid-z', 'active')
        doc_a = self._make_mem_doc('uid-a', 'active')

        def fake_get_user(uid):
            return {'email': f'{uid}@lingual.app', 'name': uid, 'profile': {}}

        mock_collection = MagicMock()
        mock_collection.where.return_value.stream.return_value = [doc_z, doc_a]

        with patch.object(database, 'get_memberships_collection', return_value=mock_collection), \
             patch.object(database, 'get_user', side_effect=fake_get_user), \
             self._patch_legacy_users([]):
            result = database.list_lingual_admin_emails()

        self.assertEqual([r['uid'] for r in result], ['uid-a', 'uid-z'])

    # ------------------------------------------------------------------
    # New tests: legacy lingual_admin flag union
    # ------------------------------------------------------------------

    def test_includes_legacy_lingual_admin_flag_users(self):
        """A user with lingual_admin=True on their user doc but no membership is included."""
        # No membership-based admins
        mock_collection = MagicMock()
        mock_collection.where.return_value.stream.return_value = []

        legacy_user = self._make_user_doc(
            uid='legacy-uid',
            email='legacy@lingual.app',
            name='Legacy Admin',
            display_name='Legacy Admin Display',
        )

        with patch.object(database, 'get_memberships_collection', return_value=mock_collection), \
             patch.object(database, 'get_user', return_value=None), \
             self._patch_legacy_users([legacy_user]):
            result = database.list_lingual_admin_emails()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['uid'], 'legacy-uid')
        self.assertEqual(result[0]['email'], 'legacy@lingual.app')
        self.assertEqual(result[0]['name'], 'Legacy Admin Display')

    def test_dedupes_when_user_has_both_membership_and_legacy_flag(self):
        """A user with both an active membership AND the legacy flag appears exactly once."""
        shared_uid = 'both-uid'
        mem_doc = self._make_mem_doc(shared_uid, 'active')

        def fake_get_user(uid):
            return {'email': 'both@lingual.app', 'name': 'Both Admin', 'profile': {'display_name': 'Both Display'}}

        mock_collection = MagicMock()
        mock_collection.where.return_value.stream.return_value = [mem_doc]

        legacy_user = self._make_user_doc(
            uid=shared_uid,
            email='both@lingual.app',
            name='Both Admin',
            display_name='Both Display',
        )

        with patch.object(database, 'get_memberships_collection', return_value=mock_collection), \
             patch.object(database, 'get_user', side_effect=fake_get_user), \
             self._patch_legacy_users([legacy_user]):
            result = database.list_lingual_admin_emails()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['uid'], shared_uid)

    def test_legacy_only_user_with_no_email_is_skipped(self):
        """A legacy-flag user whose user doc has no email field is not included."""
        mock_collection = MagicMock()
        mock_collection.where.return_value.stream.return_value = []

        no_email_doc = MagicMock()
        no_email_doc.id = 'no-email-uid'
        no_email_doc.to_dict.return_value = {
            'lingual_admin': True,
            'name': 'No Email Admin',
            'profile': {},
            # no 'email' key
        }

        with patch.object(database, 'get_memberships_collection', return_value=mock_collection), \
             patch.object(database, 'get_user', return_value=None), \
             self._patch_legacy_users([no_email_doc]):
            result = database.list_lingual_admin_emails()

        self.assertEqual(result, [])


class OutboxTemplateEnumTest(unittest.TestCase):
    def test_school_request_approved_member(self):
        from backend.services.outbox import OutboxTemplate
        self.assertEqual(
            OutboxTemplate.SCHOOL_REQUEST_APPROVED.value,
            'school_request_approved',
        )

    def test_school_request_declined_member(self):
        from backend.services.outbox import OutboxTemplate
        self.assertEqual(
            OutboxTemplate.SCHOOL_REQUEST_DECLINED.value,
            'school_request_declined',
        )

    def test_teacher_invitation_member(self):
        from backend.services.outbox import OutboxTemplate
        self.assertEqual(
            OutboxTemplate.TEACHER_INVITATION.value,
            'teacher_invitation',
        )


class OutboxBlockGuardTest(unittest.TestCase):
    """Verify that LINGUAL_BLOCK_OUTBOX_WRITES=1 prevents real outbox writes.

    Backstops the conftest-set env var that protects every test in this
    directory from leaking real Firestore writes to production. The route
    handlers wrap each enqueue call in try/except, so the OutboxBlockedInTestMode
    is caught at runtime and tests still exercise the full route path —
    they just don't pollute the live outbox queue.
    """

    def test_raises_when_env_var_is_set(self):
        db = MagicMock()
        with patch.dict(os.environ, {'LINGUAL_BLOCK_OUTBOX_WRITES': '1'}):
            with self.assertRaises(OutboxBlockedInTestMode):
                enqueue_outbox_email(
                    db=db,
                    recipient_email='someone@example.com',
                    recipient_name='Someone',
                    template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
                    template_data={'org_name': 'Should Not Write'},
                )
        db.collection.assert_not_called()

    def test_does_not_raise_when_env_var_is_unset(self):
        db = MagicMock()
        env = {k: v for k, v in os.environ.items() if k != 'LINGUAL_BLOCK_OUTBOX_WRITES'}
        with patch.dict(os.environ, env, clear=True):
            enqueue_outbox_email(
                db=db,
                recipient_email='someone@example.com',
                recipient_name='Someone',
                template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
                template_data={'org_name': 'Should Write'},
            )
        db.collection.assert_called_once_with(OUTBOX_EMAILS_COLLECTION)

    def test_does_not_raise_when_env_var_is_empty(self):
        # An empty string should NOT trigger the guard — only the literal '1'.
        db = MagicMock()
        with patch.dict(os.environ, {'LINGUAL_BLOCK_OUTBOX_WRITES': ''}):
            enqueue_outbox_email(
                db=db,
                recipient_email='someone@example.com',
                recipient_name='Someone',
                template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
                template_data={'org_name': 'Should Write'},
            )
        db.collection.assert_called_once_with(OUTBOX_EMAILS_COLLECTION)
