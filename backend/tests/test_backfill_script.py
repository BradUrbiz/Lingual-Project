"""Tier 1 (no DB, no Firestore): the backfill operator-script glue.

Verifies scripts/backfill_postgres_school_domain.read_chain reads every doc from
each chain collection and stamps the doc id, against a fake Firestore client.
The heavy lifting (run_backfill, parity, ledger) is covered by the library tests
(test_backfill_logic / test_backfill_postgres).
"""

import unittest

from scripts.backfill_postgres_school_domain import read_chain


class _FakeSnap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return dict(self._data)


class _FakeCollection:
    def __init__(self, snaps):
        self._snaps = snaps

    def stream(self):
        return iter(self._snaps)


class _FakeFirestore:
    """db.collection(name).stream() -> snaps. `data` maps name -> [(id, dict)]."""

    def __init__(self, data):
        self._data = data

    def collection(self, name):
        return _FakeCollection([_FakeSnap(i, d) for i, d in self._data.get(name, [])])


class TestReadChain(unittest.TestCase):
    def test_reads_all_collections_and_stamps_id(self):
        db = _FakeFirestore({
            'organizations': [('org1', {'name': 'A'})],
            'memberships': [('org1_u', {'org_id': 'org1', 'uid': 'u'})],
            'classes': [('class1', {'org_id': 'org1', 'name': 'C'})],
            'enrollments': [
                ('class1_u', {'class_id': 'class1', 'student_uid': 'u'}),
                ('class1_v', {'class_id': 'class1', 'student_uid': 'v'}),
            ],
            'assignments': [('asg1', {'org_id': 'org1', 'class_id': 'class1', 'title': 'A1'})],
        })
        chain = read_chain(db)

        self.assertEqual(
            set(chain),
            {'organizations', 'memberships', 'classes', 'enrollments', 'assignments'},
        )
        self.assertEqual(chain['organizations'][0]['id'], 'org1')
        self.assertEqual(chain['organizations'][0]['name'], 'A')
        self.assertEqual(len(chain['enrollments']), 2)
        self.assertEqual(
            {d['id'] for d in chain['enrollments']}, {'class1_u', 'class1_v'}
        )

    def test_empty_collections_yield_empty_lists(self):
        chain = read_chain(_FakeFirestore({}))
        for name in ('organizations', 'memberships', 'classes', 'enrollments'):
            self.assertEqual(chain[name], [])


if __name__ == '__main__':
    unittest.main()
