"""Regression: approve_school_request must populate the denormalized org fields
inside the same Firestore transaction as the rest of the approval writes.

Before this fix, the `org_data` dict inside `database.approve_school_request`
wrote only `name/type/status/...` and skipped both `name_lower` (needed for
the orgs-list ordering in Plan 5) and `school_admin_uids` (needed for restore
fan-out and Plan 4 teacher-join admin lookup). Membership was written via
`transaction.set(...)` directly, bypassing `create_membership`'s
`_sync_org_admin_uids` side effect, so the array was never populated.

This test inspects the call args captured on the mocked transaction and
asserts both denormalized fields land in the SAME `transaction.set(org_ref, ...)`
payload that creates the org doc.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import database


_PENDING_REQUEST = {
    'status': 'pending',
    'school_name': '  Alpha High School  ',  # whitespace + mixed case on purpose
    'org_type': 'school',
    'requester_uid': 'u-requester',
}

_AUDIT_ENTRY = {
    'actor_uid': 'admin',
    'action': 'request_approved',
    'target': {'type': 'school_request', 'id': 'req-1'},
    'target_org_id': None,
    'metadata': {},
    'ip_hash': '',
    'user_agent': '',
}


def _run_approve(transactional_passthrough: bool = True):
    """Helper: build mocks, call approve_school_request, return the transaction mock."""
    request_ref = MagicMock(name='request_ref')
    org_ref = MagicMock(name='org_ref')
    org_ref.id = 'org-new'
    membership_ref = MagicMock(name='membership_ref')
    membership_ref.id = 'mem-new'
    user_ref = MagicMock(name='user_ref')
    audit_ref = MagicMock(name='audit_ref')

    # `client.collection(name).document(id)` indirection — return the right ref by collection name.
    def collection_side_effect(name):
        coll = MagicMock()
        if name == 'school_requests':
            coll.document.return_value = request_ref
        elif name == 'organizations':
            coll.document.return_value = org_ref
        elif name == 'memberships':
            coll.document.return_value = membership_ref
        elif name == 'users':
            coll.document.return_value = user_ref
        elif name == database.LINGUAL_ADMIN_AUDIT_COLLECTION:
            coll.document.return_value = audit_ref
        else:
            coll.document.return_value = MagicMock()
        return coll

    client = MagicMock(name='client')
    client.collection.side_effect = collection_side_effect

    transaction = MagicMock(name='transaction')
    client.transaction.return_value = transaction

    snap = MagicMock()
    snap.exists = True
    snap.to_dict.return_value = dict(_PENDING_REQUEST)
    request_ref.get.return_value = snap

    # Patch `firestore.transactional` to a passthrough so the inner `_approve`
    # runs synchronously with our mock transaction.
    def passthrough(func):
        return func

    patches = [
        patch('database.get_db', return_value=client),
        patch('database.firestore.transactional', side_effect=passthrough),
    ]
    for p in patches:
        p.start()
    try:
        database.approve_school_request(
            request_id='req-1',
            reviewer_uid='admin',
            audit_entry=dict(_AUDIT_ENTRY),
        )
    finally:
        for p in patches:
            p.stop()
    return transaction, org_ref


class ApproveOrgDenormalizationTests(unittest.TestCase):
    def _org_payload(self, transaction_mock, org_ref):
        """Find the transaction.set(org_ref, payload) call and return payload."""
        for call in transaction_mock.set.call_args_list:
            args, _ = call
            if args and args[0] is org_ref:
                return args[1]
        raise AssertionError('transaction.set(org_ref, ...) was never called')

    def test_org_data_includes_name_lower_normalized(self):
        transaction, org_ref = _run_approve()
        payload = self._org_payload(transaction, org_ref)
        # Whitespace stripped, case lowered — must match the ordering used by
        # `list_organizations(order_by name_lower)`.
        self.assertEqual(payload.get('name_lower'), 'alpha high school')

    def test_org_data_includes_school_admin_uids_with_requester(self):
        transaction, org_ref = _run_approve()
        payload = self._org_payload(transaction, org_ref)
        # The new org's `school_admin_uids` must be denormalized at write time;
        # without this Plan 4's teacher-join admin lookup misses every newly
        # approved org.
        self.assertEqual(payload.get('school_admin_uids'), ['u-requester'])

    def test_org_data_keeps_existing_fields(self):
        """Regression guard: don't accidentally drop the pre-existing fields."""
        transaction, org_ref = _run_approve()
        payload = self._org_payload(transaction, org_ref)
        self.assertEqual(payload.get('name'), '  Alpha High School  ')
        self.assertEqual(payload.get('type'), 'school')
        self.assertEqual(payload.get('status'), 'active')
        self.assertEqual(payload.get('pilot_stage'), 'beta')


if __name__ == '__main__':
    unittest.main()
