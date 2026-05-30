"""Tier 1 (no DB): the legacy_firestore_id -> UUID resolution helper.

The helper is the coexistence-window load-bearing primitive (TECH_SPEC 3.8a).
Driven against a fake session so it needs no Postgres.
"""

import unittest
import uuid

from backend.db.models.org import Membership
from backend.db.repository.resolution import resolve_legacy_id


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    """Resolves against an in-memory {firestore_id -> uuid} map.

    Inspects the compiled WHERE parameter so the test exercises the real
    select(...).where(model.legacy_firestore_id == fid) statement.
    """

    def __init__(self, mapping):
        self.mapping = mapping
        self.calls = 0

    def execute(self, stmt):
        self.calls += 1
        # Pull the bound legacy_firestore_id value out of the compiled statement.
        params = stmt.compile().params
        fid = next(iter(params.values()))
        return _FakeResult(self.mapping.get(fid))


class TestResolveLegacyId(unittest.TestCase):
    def setUp(self):
        self.uid = uuid.uuid4()
        self.session = _FakeSession({'org123_userA': self.uid})

    def test_found_returns_uuid(self):
        self.assertEqual(
            resolve_legacy_id(self.session, Membership, 'org123_userA'), self.uid
        )

    def test_unmapped_returns_none(self):
        self.assertIsNone(resolve_legacy_id(self.session, Membership, 'org999_ghost'))

    def test_empty_input_short_circuits(self):
        # Falsy input must not touch the session at all.
        self.assertIsNone(resolve_legacy_id(self.session, Membership, ''))
        self.assertIsNone(resolve_legacy_id(self.session, Membership, None))
        self.assertEqual(self.session.calls, 0)


if __name__ == '__main__':
    unittest.main()
