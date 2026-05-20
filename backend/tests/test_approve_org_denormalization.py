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

# A wizard-shaped request matching what Plan 3 actually submits.
# Mirrors `_build_school_request_payload(enriched=...)` field names.
_PENDING_WIZARD_REQUEST = {
    'status': 'pending',
    'school_name': 'Bravo Elementary',
    'org_type': 'school',
    'requester_uid': 'u-wizard',
    'website_url': 'https://bravo.example.edu',
    'school_type': 'elementary',
    'public_private': 'public',        # NOTE: request field name (org uses `public_or_private`)
    'grade_size': '50-200',
    'country': 'US',                    # denormalized in #47
    'location': {
        'country': 'US',
        'state': 'CA',
        'city': 'Bravoville',
    },
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


def _run_approve(transactional_passthrough: bool = True, *, request_doc=None):
    """Helper: build mocks, call approve_school_request, return the transaction mock.

    Pass ``request_doc`` to override the stub pending request (defaults to
    ``_PENDING_REQUEST`` for the original denormalization tests).
    """
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
    snap.to_dict.return_value = dict(request_doc if request_doc is not None else _PENDING_REQUEST)
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


class ApproveOrgWizardPayloadTests(unittest.TestCase):
    """Round-4 regression: Plan 3 wizard's enriched fields (school_type,
    country, state, website_url, public_or_private, grade_size) must
    propagate from the request to the new org so the Plan 5 list/detail
    surfaces don't render blanks. See LIMITATIONS #49.
    """

    def _org_payload(self, transaction_mock, org_ref):
        for call in transaction_mock.set.call_args_list:
            args, _ = call
            if args and args[0] is org_ref:
                return args[1]
        raise AssertionError('transaction.set(org_ref, ...) was never called')

    def test_wizard_metadata_propagates_to_org(self):
        transaction, org_ref = _run_approve(request_doc=_PENDING_WIZARD_REQUEST)
        payload = self._org_payload(transaction, org_ref)
        self.assertEqual(payload.get('school_type'), 'elementary')
        self.assertEqual(payload.get('country'), 'US')
        self.assertEqual(payload.get('state'), 'CA')
        self.assertEqual(payload.get('website_url'), 'https://bravo.example.edu')
        self.assertEqual(payload.get('grade_size'), '50-200')

    def test_public_private_remapped_to_public_or_private(self):
        """Field name maps from request schema (`public_private`) to org
        schema (`public_or_private`) — `list_organizations` filters on the
        latter. Without this mapping the publicOrPrivate filter would miss
        every newly approved wizard org."""
        transaction, org_ref = _run_approve(request_doc=_PENDING_WIZARD_REQUEST)
        payload = self._org_payload(transaction, org_ref)
        self.assertEqual(payload.get('public_or_private'), 'public')
        # Request-side name must NOT leak to the org doc.
        self.assertNotIn('public_private', payload)

    def test_country_falls_back_to_location_country(self):
        """Pre-#47 wizard rows only have `location.country`. Approval must
        still copy that into the top-level `country` field so the org list
        country filter works."""
        legacy_wizard = dict(_PENDING_WIZARD_REQUEST)
        legacy_wizard.pop('country')  # simulate pre-denormalization row
        transaction, org_ref = _run_approve(request_doc=legacy_wizard)
        payload = self._org_payload(transaction, org_ref)
        self.assertEqual(payload.get('country'), 'US')

    def test_minimal_request_does_not_error(self):
        """Defensive: requests without any wizard fields (e.g. legacy
        scripted submissions or smoke tests) still approve cleanly."""
        transaction, org_ref = _run_approve()  # uses _PENDING_REQUEST (no wizard fields)
        payload = self._org_payload(transaction, org_ref)
        # New fields are present but None — the org doc has stable shape.
        self.assertIn('school_type', payload)
        self.assertIsNone(payload.get('school_type'))
        self.assertIsNone(payload.get('public_or_private'))
        self.assertIsNone(payload.get('state'))


if __name__ == '__main__':
    unittest.main()
