import unittest

from backend.services.canvas.sync import (
    SyncResult,
    reconcile_canvas_roster_entries,
    flatten_course_content,
)


class FakeRosterDb:
    """In-memory db for the new roster-entries sync. Records every call so
    tests can assert the invariant that NO enrollment-mutation happens."""

    def __init__(self):
        self.roster_entries = {}  # key=f"{class_id}__{canvas_user_id}" -> dict
        self.upsert_calls = []
        self.delete_calls = []
        # Enrollment-side tracking: if the service ever calls any of these,
        # the test fails.
        self.enrollment_mutations = []

    # -- roster-entries surface used by the service --
    def upsert_canvas_roster_entry(self, *, class_id, connection_id,
                                   canvas_user_id, canvas_email, canvas_name):
        key = f'{class_id}__{canvas_user_id}'
        self.roster_entries[key] = {
            'class_id': class_id, 'connection_id': connection_id,
            'canvas_user_id': canvas_user_id,
            'canvas_email': (canvas_email or '').lower().strip(),
            'canvas_name': canvas_name,
        }
        self.upsert_calls.append(key)

    def delete_canvas_roster_entry(self, class_id, canvas_user_id):
        key = f'{class_id}__{canvas_user_id}'
        self.roster_entries.pop(key, None)
        self.delete_calls.append(key)

    def list_canvas_roster_entries(self, class_id):
        return [e for e in self.roster_entries.values() if e.get('class_id') == class_id]

    # -- enrollment surface: any call here is a bug --
    def __getattr__(self, name):
        if name in {
            'create_enrollment', 'delete_enrollment',
            'deactivate_canvas_enrollment', 'list_class_enrollments',
            'activate_pending_canvas_enrollment',
            'list_pending_canvas_enrollments_by_email',
            'create_membership', 'get_membership',
            'add_primary_class_to_membership', 'get_user_by_email',
        }:
            def tripwire(*args, **kwargs):
                self.enrollment_mutations.append((name, args, kwargs))
                raise AssertionError(
                    f'sync service called enrollment-side method {name!r} — '
                    f'should only touch canvas_roster_entries'
                )
            return tripwire
        raise AttributeError(name)

    def replace_canvas_course_content_for_connection(self, connection_id, class_id, items):
        # sync_course_content calls this; unchanged behavior, tracked for completeness.
        self._replaced_content = (connection_id, class_id, items)


class ReconcileCanvasRosterEntriesTest(unittest.TestCase):
    def _canvas_students(self, *tuples):
        """Build Canvas student payloads from (id, email, name) tuples."""
        return [{'id': i, 'email': e, 'name': n, 'sis_user_id': None}
                for i, e, n in tuples]

    def test_upsert_for_each_canvas_student_zero_enrollment_mutations(self):
        db = FakeRosterDb()
        students = self._canvas_students(
            (50, 'alice@school.edu', 'Alice'),
            (51, 'bob@school.edu', 'Bob'),
        )
        result = reconcile_canvas_roster_entries(
            db=db, class_id='class-1', connection_id='conn-1',
            canvas_students=students,
        )
        self.assertEqual(result.entries_upserted, 2)
        self.assertEqual(result.entries_removed, 0)
        self.assertEqual(result.total_canvas_students, 2)
        self.assertEqual(set(db.roster_entries.keys()),
                         {'class-1__50', 'class-1__51'})
        self.assertEqual(db.enrollment_mutations, [])

    def test_removes_entry_when_student_dropped_from_canvas(self):
        db = FakeRosterDb()
        db.roster_entries['class-1__50'] = {
            'class_id': 'class-1', 'canvas_user_id': '50',
            'canvas_email': 'alice@school.edu', 'canvas_name': 'Alice',
        }
        result = reconcile_canvas_roster_entries(
            db=db, class_id='class-1', connection_id='conn-1',
            canvas_students=[],
        )
        self.assertEqual(result.entries_removed, 1)
        self.assertEqual(result.entries_upserted, 0)
        self.assertNotIn('class-1__50', db.roster_entries)
        self.assertEqual(db.enrollment_mutations, [])

    def test_idempotent_when_roster_unchanged(self):
        db = FakeRosterDb()
        students = self._canvas_students((50, 'alice@school.edu', 'Alice'))
        reconcile_canvas_roster_entries(
            db=db, class_id='class-1', connection_id='conn-1',
            canvas_students=students,
        )
        db.upsert_calls.clear()
        db.delete_calls.clear()
        result = reconcile_canvas_roster_entries(
            db=db, class_id='class-1', connection_id='conn-1',
            canvas_students=students,
        )
        # Each canvas student is re-upserted on every sync (refreshes synced_at);
        # nothing is deleted because the roster is unchanged.
        self.assertEqual(result.entries_upserted, 1)
        self.assertEqual(result.entries_removed, 0)

    def test_lowercases_and_trims_canvas_email(self):
        db = FakeRosterDb()
        students = self._canvas_students((50, '  Alice@School.Edu ', 'Alice'))
        reconcile_canvas_roster_entries(
            db=db, class_id='class-1', connection_id='conn-1',
            canvas_students=students,
        )
        self.assertEqual(db.roster_entries['class-1__50']['canvas_email'],
                         'alice@school.edu')

    def test_scopes_deletion_to_this_class_only(self):
        """Entries for other classes must not be deleted when this class's roster changes."""
        db = FakeRosterDb()
        db.roster_entries['other-class__99'] = {
            'class_id': 'other-class', 'canvas_user_id': '99',
            'canvas_email': 'x@y.edu', 'canvas_name': 'X',
        }
        reconcile_canvas_roster_entries(
            db=db, class_id='class-1', connection_id='conn-1',
            canvas_students=[],
        )
        self.assertIn('other-class__99', db.roster_entries)


class SyncResultTest(unittest.TestCase):
    def test_to_dict(self):
        r = SyncResult(entries_upserted=3, entries_removed=1, total_canvas_students=3)
        d = r.to_dict()
        self.assertEqual(d['entries_upserted'], 3)
        self.assertEqual(d['entries_removed'], 1)
        self.assertEqual(d['total_canvas_students'], 3)


class FlattenCourseContentTest(unittest.TestCase):
    # UNCHANGED — sync_course_content is out of scope for this plan.
    def test_flattens_modules_and_items(self):
        modules = [
            {'id': 10, 'name': 'Week 1', 'position': 1},
            {'id': 11, 'name': 'Week 2', 'position': 2},
        ]
        items_by_module = {
            10: [
                {'id': 100, 'title': 'Reading', 'type': 'Page', 'position': 1},
                {'id': 101, 'title': 'Quiz', 'type': 'Quiz', 'position': 2},
            ],
            11: [
                {'id': 200, 'title': 'Essay', 'type': 'Assignment', 'position': 1},
            ],
        }
        flat = flatten_course_content('conn1', 'class-1', modules, items_by_module)
        self.assertEqual(len(flat), 3)
        self.assertEqual(flat[0]['canvas_module_name'], 'Week 1')
        self.assertEqual(flat[2]['canvas_module_position'], 2)

    def test_empty_modules(self):
        self.assertEqual(flatten_course_content('conn1', 'class-1', [], {}), [])


if __name__ == '__main__':
    unittest.main()
