import unittest
from unittest.mock import MagicMock, patch

from database import (
    upsert_canvas_roster_entry,
    delete_canvas_roster_entry,
    list_canvas_roster_entries,
    get_canvas_roster_entry_by_email,
    count_canvas_roster_entries,
)


class FakeFirestoreStub:
    """Minimal in-memory stand-in for the firestore client used in these tests."""

    def __init__(self):
        self.docs = {}  # doc_path -> dict

    class Ref:
        def __init__(self, stub, path):
            self.stub = stub
            self.path = path

        def set(self, data, merge=False):
            if merge and self.path in self.stub.docs:
                self.stub.docs[self.path].update(data)
            else:
                self.stub.docs[self.path] = dict(data)

        def update(self, data):
            self.stub.docs.setdefault(self.path, {}).update(data)

        def delete(self):
            self.stub.docs.pop(self.path, None)

        def get(self):
            doc = self.stub.docs.get(self.path)
            m = MagicMock()
            m.exists = doc is not None
            m.to_dict = lambda: dict(doc) if doc else None
            m.id = self.path.split('/')[-1]
            return m


class CanvasRosterEntriesDbTest(unittest.TestCase):
    def test_upsert_creates_new_entry(self):
        with patch('database.get_db') as mock_get_db:
            stub = FakeFirestoreStub()
            mock_get_db.return_value.collection.return_value.document.side_effect = (
                lambda doc_id: FakeFirestoreStub.Ref(stub, f'canvas_roster_entries/{doc_id}')
            )
            upsert_canvas_roster_entry(
                class_id='class-1', connection_id='conn-1',
                canvas_user_id='cv50', canvas_email='alice@school.edu',
                canvas_name='Alice',
            )
            self.assertIn('canvas_roster_entries/class-1__cv50', stub.docs)
            entry = stub.docs['canvas_roster_entries/class-1__cv50']
            self.assertEqual(entry['class_id'], 'class-1')
            self.assertEqual(entry['canvas_user_id'], 'cv50')
            self.assertEqual(entry['canvas_email'], 'alice@school.edu')
            self.assertEqual(entry['canvas_name'], 'Alice')

    def test_upsert_updates_existing_entry_preserves_created_at(self):
        with patch('database.get_db') as mock_get_db:
            stub = FakeFirestoreStub()
            stub.docs['canvas_roster_entries/class-1__cv50'] = {
                'class_id': 'class-1', 'canvas_user_id': 'cv50',
                'canvas_email': 'alice@school.edu', 'canvas_name': 'Alice',
                'created_at': 'fixed-stamp',
            }
            mock_get_db.return_value.collection.return_value.document.side_effect = (
                lambda doc_id: FakeFirestoreStub.Ref(stub, f'canvas_roster_entries/{doc_id}')
            )
            upsert_canvas_roster_entry(
                class_id='class-1', connection_id='conn-1',
                canvas_user_id='cv50', canvas_email='Alice@School.edu',
                canvas_name='Alice Smith',
            )
            entry = stub.docs['canvas_roster_entries/class-1__cv50']
            self.assertEqual(entry['created_at'], 'fixed-stamp')
            self.assertEqual(entry['canvas_email'], 'alice@school.edu')
            self.assertEqual(entry['canvas_name'], 'Alice Smith')

    def test_delete_removes_entry(self):
        with patch('database.get_db') as mock_get_db:
            stub = FakeFirestoreStub()
            stub.docs['canvas_roster_entries/class-1__cv50'] = {'class_id': 'class-1'}
            mock_get_db.return_value.collection.return_value.document.side_effect = (
                lambda doc_id: FakeFirestoreStub.Ref(stub, f'canvas_roster_entries/{doc_id}')
            )
            delete_canvas_roster_entry('class-1', 'cv50')
            self.assertNotIn('canvas_roster_entries/class-1__cv50', stub.docs)


if __name__ == '__main__':
    unittest.main()
