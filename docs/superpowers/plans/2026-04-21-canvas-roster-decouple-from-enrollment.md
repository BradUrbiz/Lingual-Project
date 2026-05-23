# Canvas Roster Decouple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove passive Canvas roster auto-enrollment. Move roster data to a dedicated `canvas_roster_entries` collection. Add teacher-side "on roster" badges and a "not yet joined" gap view. Leave `sync_course_content`, LTI deep-link launch, and join code flow untouched.

**Architecture:** Enrollments become sovereign — written only by join code or LTI. Canvas roster sync writes exclusively to `canvas_roster_entries/{class_id}__{canvas_user_id}` (composite ID → pure upsert/delete by key). The teacher class roster endpoint attaches an `isOnCanvasRoster` flag via an indexed lookup on `(class_id, canvas_email)`. A new endpoint returns the gap list (roster entries without a matching enrollment). A one-time migration grandfathers existing `canvas` enrollments to `canvas_legacy` and translates `pending_sync` placeholders into the new collection.

**Tech Stack:** Python 3 / Flask / Firestore (firebase-admin). React 19 / TypeScript / Vite. Unittest (backend) / Vitest (frontend).

**Spec reference:** `docs/superpowers/specs/2026-04-21-canvas-roster-decouple-from-enrollment-design.md`

**Deploy order when shipping (single PR, ordered rollout):**

1. Backend code merged + deployed (auto-enroll dies immediately in prod).
2. Migration script runs (`--dry-run` → review → `--commit`).
3. Frontend merged + deployed (UI reflects migrated data).

---

## File Structure

Files created / modified by this plan:

**Backend — create:**
- `scripts/migrate_canvas_roster_decouple.py` — one-time idempotent migration.
- `backend/tests/test_migrate_canvas_roster_decouple.py` — migration script tests.

**Backend — modify:**
- `database.py` — new `canvas_roster_entries/` helpers; remove `list_pending_canvas_enrollments_by_email` + `activate_pending_canvas_enrollment`; docstring bump for `create_enrollment` (adds `'canvas_legacy'`).
- `backend/services/canvas/sync.py` — replace `reconcile_enrollments` with `reconcile_canvas_roster_entries`; redefine `SyncResult`. `sync_course_content` / `flatten_course_content` unchanged.
- `backend/routes/auth.py` — delete the pending-sync activation block (current lines 45–70).
- `backend/routes/integrations.py` — response shape tracks new `SyncResult`.
- `backend/routes/teacher.py` — `api_get_class_roster`: add `isOnCanvasRoster`, remove the `pending_sync` shadow list. Add new route `api_get_canvas_roster_gap`.
- `firestore.indexes.json` — composite index on `canvas_roster_entries (class_id, canvas_email)`.

**Backend — tests modified/deleted:**
- `backend/tests/test_canvas_sync.py` — full rewrite (drops every enrollment-mutation assertion; replaces with `canvas_roster_entries`-only assertions).
- `backend/tests/test_auth_memberships.py` — delete pending-sync activation cases; add negative case proving login does not create an enrollment from a roster entry.
- `backend/tests/test_auth_routes.py` — delete `test_activates_pending_canvas_enrollment`.
- `backend/tests/test_canvas_foundation.py` — delete `test_activate_pending_canvas_enrollment`.
- `backend/tests/test_teacher_routes.py` (or whichever file covers teacher roster — confirm at task time) — add `isOnCanvasRoster` cases; new gap endpoint tests.

**Frontend — modify:**
- `frontend/src/types/school.ts` — extend `ClassRosterStudent`; add `CanvasRosterGapEntry`, `CanvasRosterGapSummary`.
- `frontend/src/api/teacher.ts` — new `getClassCanvasRosterGap` method.
- `frontend/src/pages/TeacherDashboardPage.tsx` — roster dialog: remove `pending_sync` branch, add "On Canvas roster" badge, add "Canvas roster — not yet joined" section. Fetch gap alongside roster.
- `frontend/src/pages/TeacherDashboardPage.test.tsx` — extend tests to cover new rendering.
- `frontend/src/components/canvas/CanvasSyncStatus.tsx` (locate exact file at task time) — updated result copy + CTA text.

**Docs — modify (after implementation verified):**
- `docs/school-integration/TECH_SPEC.md`
- `docs/school-integration/LIMITATIONS.md`
- `docs/school-integration/TASKS.md`
- `docs/school-integration/BDD_SCENARIOS.md`

---

## Phase 1 — Backend: data layer and roster sync

### Task 1: Firestore index + `canvas_roster_entries` database helpers

**Files:**
- Modify: `firestore.indexes.json`
- Modify: `database.py` (append a new section after the existing Canvas content helpers around line 2241)
- Create: `backend/tests/test_canvas_roster_entries_db.py`

- [ ] **Step 1: Add the Firestore composite index.**

Open `firestore.indexes.json`. Before the closing `]` of the top-level `"indexes"` array (around line 266, after the `consent_events` entry), add:

```json
    ,{
      "collectionGroup": "canvas_roster_entries",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "class_id",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "canvas_email",
          "order": "ASCENDING"
        }
      ]
    }
```

- [ ] **Step 2: Write the failing test for `upsert_canvas_roster_entry` and `list_canvas_roster_entries`.**

Create `backend/tests/test_canvas_roster_entries_db.py`:

```python
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

    # ---- doc ref / collection stubs ----
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


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 3: Run the test to confirm it fails.**

```bash
python3 -m unittest backend.tests.test_canvas_roster_entries_db -v
```

Expected: `ImportError` / `AttributeError` — `upsert_canvas_roster_entry` does not exist in `database.py`.

- [ ] **Step 4: Add helpers to `database.py` (append after line 2241, before `list_pending_canvas_enrollments_by_email`).**

```python
# ── canvas_roster_entries collection ──────────────────────────────────
#
# canvas_roster_entries is the Canvas-truth view of who's on the class
# roster, kept separate from enrollments/. Sync writes here; enrollment
# creation never writes here. A roster entry is informational only —
# enrollment only happens via join code or LTI launch.

def get_canvas_roster_entries_collection():
    return get_db().collection('canvas_roster_entries')


def _canvas_roster_entry_ref(class_id, canvas_user_id):
    return get_canvas_roster_entries_collection().document(
        f'{class_id}__{canvas_user_id}'
    )


def upsert_canvas_roster_entry(*, class_id, connection_id, canvas_user_id,
                               canvas_email, canvas_name):
    """Idempotent upsert of a single Canvas roster entry.

    Key: {class_id}__{canvas_user_id}. Preserves created_at on re-upsert,
    refreshes synced_at / canvas_email / canvas_name / connection_id.
    """
    ref = _canvas_roster_entry_ref(class_id, canvas_user_id)
    existing = ref.get()
    payload = {
        'class_id': class_id,
        'connection_id': connection_id,
        'canvas_user_id': str(canvas_user_id),
        'canvas_email': (canvas_email or '').lower().strip(),
        'canvas_name': canvas_name or '',
        'synced_at': firestore.SERVER_TIMESTAMP,
    }
    if existing.exists:
        ref.update(payload)
    else:
        payload['created_at'] = firestore.SERVER_TIMESTAMP
        ref.set(payload)


def delete_canvas_roster_entry(class_id, canvas_user_id):
    _canvas_roster_entry_ref(class_id, canvas_user_id).delete()


def list_canvas_roster_entries(class_id):
    docs = (
        get_canvas_roster_entries_collection()
        .where('class_id', '==', class_id)
        .stream()
    )
    results = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        results.append(data)
    return results


def get_canvas_roster_entry_by_email(class_id, email):
    """Single-entry lookup used by the 'on Canvas roster' badge."""
    if not email:
        return None
    docs = (
        get_canvas_roster_entries_collection()
        .where('class_id', '==', class_id)
        .where('canvas_email', '==', email.lower().strip())
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def count_canvas_roster_entries(class_id):
    """Count of roster entries for a class. Falls back to len(list) if
    the aggregation API is unavailable in tests."""
    try:
        agg = (
            get_canvas_roster_entries_collection()
            .where('class_id', '==', class_id)
            .count()
            .get()
        )
        return int(agg[0][0].value)
    except Exception:
        return len(list_canvas_roster_entries(class_id))
```

- [ ] **Step 5: Run the test to confirm it passes.**

```bash
python3 -m unittest backend.tests.test_canvas_roster_entries_db -v
```

Expected: PASS.

- [ ] **Step 6: Extend the test file with the remaining helpers (`list`, `by_email`, `delete`, `count`, idempotent re-upsert).**

Append to `backend/tests/test_canvas_roster_entries_db.py`:

```python
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
```

Run and confirm all pass:

```bash
python3 -m unittest backend.tests.test_canvas_roster_entries_db -v
```

- [ ] **Step 7: Commit.**

```bash
git add firestore.indexes.json database.py backend/tests/test_canvas_roster_entries_db.py
git commit -m "feat(canvas): add canvas_roster_entries collection helpers + index"
```

---

### Task 2: Rewrite the Canvas roster sync service

**Files:**
- Modify: `backend/services/canvas/sync.py`
- Rewrite: `backend/tests/test_canvas_sync.py`

This is the core rule change. After this task, `reconcile_enrollments` no longer exists — it's replaced by `reconcile_canvas_roster_entries`, which writes only to `canvas_roster_entries/` and never to `enrollments/`.

- [ ] **Step 1: Delete the existing `backend/tests/test_canvas_sync.py` content** for `ReconcileEnrollmentsTest` and `SyncResultTest` classes; keep `FlattenCourseContentTest` as-is.

Rewrite the file to this contents (FakeSyncDb is rebuilt to mirror the new contract):

```python
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
        from backend.services.canvas.sync import flatten_course_content
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
        from backend.services.canvas.sync import flatten_course_content
        self.assertEqual(flatten_course_content('conn1', 'class-1', [], {}), [])


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
python3 -m unittest backend.tests.test_canvas_sync -v
```

Expected: `ImportError` for `reconcile_canvas_roster_entries`, and `SyncResult` signature mismatch.

- [ ] **Step 3: Rewrite `backend/services/canvas/sync.py`. Replace the entire file contents.**

```python
from dataclasses import dataclass


@dataclass
class SyncResult:
    entries_upserted: int = 0
    entries_removed: int = 0
    total_canvas_students: int = 0

    def to_dict(self) -> dict:
        return {
            'entries_upserted': self.entries_upserted,
            'entries_removed': self.entries_removed,
            'total_canvas_students': self.total_canvas_students,
        }


def reconcile_canvas_roster_entries(*, db, class_id: str, connection_id: str,
                                    canvas_students: list[dict]) -> SyncResult:
    """Reconcile Canvas roster with canvas_roster_entries/.

    Contract: this function writes to canvas_roster_entries/ ONLY. It does
    not read or write enrollments/, memberships/, or users/. Enrollments
    are produced exclusively by explicit student action (join code) or by
    LTI deep-link launch — Canvas PAT sync is advisory only.

    - Each Canvas student → upsert canvas_roster_entries/{class_id}__{canvas_user_id}.
    - Each existing entry in the DB whose canvas_user_id is NOT in the
      current Canvas payload → delete.
    """
    result = SyncResult(total_canvas_students=len(canvas_students))

    canvas_ids_in_payload = {str(s['id']) for s in canvas_students}

    for student in canvas_students:
        canvas_user_id = str(student['id'])
        email = (student.get('email') or '').lower().strip()
        canvas_name = (student.get('name') or student.get('sortable_name') or '').strip()
        db.upsert_canvas_roster_entry(
            class_id=class_id,
            connection_id=connection_id,
            canvas_user_id=canvas_user_id,
            canvas_email=email,
            canvas_name=canvas_name,
        )
        result.entries_upserted += 1

    for existing in db.list_canvas_roster_entries(class_id):
        if str(existing.get('canvas_user_id', '')) not in canvas_ids_in_payload:
            db.delete_canvas_roster_entry(class_id, str(existing['canvas_user_id']))
            result.entries_removed += 1

    return result


def flatten_course_content(connection_id: str, class_id: str,
                           modules: list[dict],
                           items_by_module: dict[int, list[dict]]) -> list[dict]:
    """Flatten Canvas modules and their items into a list of content records."""
    flat: list[dict] = []
    for module in modules:
        module_id = module['id']
        module_items = items_by_module.get(module_id, [])
        for item in module_items:
            content_details = item.get('content_details') or {}
            flat.append({
                'connection_id': connection_id,
                'class_id': class_id,
                'canvas_module_id': str(module_id),
                'canvas_module_name': module.get('name', ''),
                'canvas_module_position': module.get('position', 0),
                'item_id': str(item.get('id', '')),
                'item_title': item.get('title', ''),
                'item_type': item.get('type', ''),
                'item_position': item.get('position', 0),
                'item_html_url': item.get('html_url', ''),
                'due_at': content_details.get('due_at'),
                'points_possible': content_details.get('points_possible'),
            })
    return flat


def sync_roster(*, db, connection: dict, canvas_client) -> SyncResult:
    """Full roster sync: fetch Canvas students, reconcile canvas_roster_entries."""
    class_id = connection['class_id']
    canvas_course_id = connection['canvas_course_id']
    connection_id = connection.get('id') or connection.get('connection_id') or ''
    canvas_students = canvas_client.get_students(canvas_course_id)
    return reconcile_canvas_roster_entries(
        db=db,
        class_id=class_id,
        connection_id=connection_id,
        canvas_students=canvas_students,
    )


def sync_course_content(*, db, connection: dict, canvas_client) -> int:
    """Full course content sync: fetch modules + items, replace content records.

    UNCHANGED by the roster-decouple plan. Course content is still synced
    on every sync call; only the roster half moves to canvas_roster_entries.
    """
    canvas_course_id = connection['canvas_course_id']
    modules = canvas_client.get_modules(canvas_course_id)
    items_by_module: dict[int, list[dict]] = {}
    for module in modules:
        items_by_module[module['id']] = canvas_client.get_module_items(
            canvas_course_id, str(module['id']),
        )
    flat = flatten_course_content(
        connection['id'], connection['class_id'], modules, items_by_module,
    )
    db.replace_canvas_course_content_for_connection(
        connection['id'], connection['class_id'], flat,
    )
    return len(flat)
```

Note: the import of `auto_grant_voice_consent_for_pilot` is removed (it was only used inside the deleted email-match branch).

- [ ] **Step 4: Run tests to verify they now pass.**

```bash
python3 -m unittest backend.tests.test_canvas_sync -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/services/canvas/sync.py backend/tests/test_canvas_sync.py
git commit -m "feat(canvas): rewrite roster sync to write canvas_roster_entries only"
```

---

### Task 3: Update the integrations route response shape

**Files:**
- Modify: `backend/routes/integrations.py`
- Modify: `backend/tests/test_canvas_routes.py` (if such a test exists — confirm at task time; otherwise skip the test update)

The old roster result payload was `{matched, unmatched, deactivated, created, unchanged}`. New payload is `{entries_upserted, entries_removed, total_canvas_students}`.

- [ ] **Step 1: Verify `backend/routes/integrations.py` currently returns the old shape.**

```bash
grep -n "roster_result\|roster.to_dict" backend/routes/integrations.py
```

Expected: hits on lines ~123, ~132, ~146, ~205, ~216.

- [ ] **Step 2: Locate any existing integrations test coverage.**

```bash
ls backend/tests/test_canvas_routes.py 2>/dev/null && grep -n "matched\|unmatched" backend/tests/test_canvas_routes.py
```

If tests reference old fields, update them in Step 5. If no integrations-route test exists yet, skip the test change.

- [ ] **Step 3: Apply the code change — no text-content change to `integrations.py` is needed.**

`integrations.py` calls `roster_result.to_dict()` and returns it directly under the `"roster"` key. Since Task 2 changed `SyncResult.to_dict` to the new shape, the route transparently returns the new payload. Confirm by inspection:

```bash
grep -n "roster.*to_dict" backend/routes/integrations.py
```

If the route currently does any manual field access (e.g. `roster_result.matched`), rewrite that access. Based on current code it uses `.to_dict()` only — no changes needed.

- [ ] **Step 4: Run the backend tests that touch integrations.**

```bash
python3 -m unittest backend.tests.test_canvas_routes backend.tests.test_canvas_sync -v
```

Expected: PASS. If `test_canvas_routes.py` asserts the old payload keys, update those assertions to the new keys (`entries_upserted`, `entries_removed`, `total_canvas_students`).

- [ ] **Step 5: Commit (only if any test file or code was touched).**

```bash
git add backend/routes/integrations.py backend/tests/test_canvas_routes.py
git commit -m "chore(canvas): track new SyncResult shape in integrations route tests"
```

(If no test changes were needed, skip this commit.)

---

### Task 4: Remove pending-sync activation from `auth.py`

**Files:**
- Modify: `backend/routes/auth.py`
- Modify: `backend/tests/test_auth_memberships.py`
- Modify: `backend/tests/test_auth_routes.py`
- Modify: `backend/tests/test_canvas_foundation.py`

- [ ] **Step 1: Add a failing negative test in `test_auth_memberships.py`.**

Open `backend/tests/test_auth_memberships.py`. Replace the `test_activates_pending_canvas_enrollment_on_login` test (and its siblings `test_activates_multi_org_pending_enrollments` and any other pending-sync activation tests) with a single negative-assertion test. Keep the surrounding fixtures that are still relevant for other tests in the file.

New test to add (append in the same TestCase class that previously held `test_activates_pending_canvas_enrollment_on_login`):

```python
    def test_login_does_not_create_enrollment_from_canvas_roster_entry(self):
        """A student with no existing enrollment whose email appears in
        canvas_roster_entries must NOT be enrolled just by logging in.
        They stay unenrolled until they enter a join code."""

        # Set up: roster entry exists for this class, no enrollment exists.
        self.db.roster_entries['class-1__cv50'] = {
            'class_id': 'class-1', 'canvas_user_id': 'cv50',
            'canvas_email': 'alice@school.edu', 'canvas_name': 'Alice',
        }
        # The fake db here must NOT expose list_pending_canvas_enrollments_by_email
        # or activate_pending_canvas_enrollment (removed in this change).
        self.assertFalse(hasattr(self.db, 'list_pending_canvas_enrollments_by_email'))
        self.assertFalse(hasattr(self.db, 'activate_pending_canvas_enrollment'))

        # Login flow runs …
        response = self.client.post('/api/auth/verify',
                                    json={'idToken': 'valid-token-alice'})
        self.assertEqual(response.status_code, 200)

        # … and no enrollment was created.
        self.assertEqual(len(self.db.created_enrollments), 0)
```

Remove the existing tests that asserted activation occurred. Remove any fake-db methods on the test's DB stub that implemented `list_pending_canvas_enrollments_by_email` or `activate_pending_canvas_enrollment` (grep near line 69 and line 219 of the existing file).

- [ ] **Step 2: Apply the same deletions in `test_auth_routes.py` and `test_canvas_foundation.py`.**

In `backend/tests/test_auth_routes.py`:
- Delete `test_activates_pending_canvas_enrollment` (around line 242–260).
- Delete the `activate_pending_canvas_enrollment` method on the fake db (around line 69).

In `backend/tests/test_canvas_foundation.py`:
- Delete `test_activate_pending_canvas_enrollment` (around line 361).
- Delete the `activate_pending_canvas_enrollment` method on the fake db (around line 141).
- Keep the `pending_sync` *data shape* tests — those still document the pre-migration state and are used by the migration script tests (Task 8).

- [ ] **Step 3: Run the auth tests to verify they fail (new negative test fails because the server still runs the activation block).**

```bash
python3 -m unittest backend.tests.test_auth_memberships backend.tests.test_auth_routes -v
```

Expected: the new negative test FAILS. Old deleted tests are gone, so the suite is smaller.

- [ ] **Step 4: Delete the activation block in `backend/routes/auth.py` (lines 45–70 of the current file).**

Replace this block:

```python
            deps.db.get_or_create_user(uid, email, name)

            # Activate any pending Canvas enrollments matching this user's email.
            if email and hasattr(deps.db, 'list_pending_canvas_enrollments_by_email'):
                pending = deps.db.list_pending_canvas_enrollments_by_email(email)
                for enrollment in pending:
                    enrollment_id = enrollment.get('id', '')
                    class_record = deps.db.get_class(enrollment.get('class_id', ''))
                    if not class_record:
                        continue
                    org_id = class_record.get('org_id', '')
                    membership_id = f'{org_id}_{uid}'
                    if not deps.db.get_membership(membership_id):
                        deps.db.create_membership(
                            org_id=org_id,
                            uid=uid,
                            roles=['student'],
                            primary_class_ids=[enrollment.get('class_id', '')],
                            membership_id=membership_id,
                        )
                    else:
                        if hasattr(deps.db, 'add_primary_class_to_membership'):
                            deps.db.add_primary_class_to_membership(
                                membership_id, enrollment.get('class_id', ''),
                            )
                    deps.db.activate_pending_canvas_enrollment(
                        enrollment_id, uid, membership_id,
                    )

            preferred_active_membership_id = (session.get('user') or {}).get('active_membership_id')
```

With:

```python
            deps.db.get_or_create_user(uid, email, name)

            preferred_active_membership_id = (session.get('user') or {}).get('active_membership_id')
```

- [ ] **Step 5: Run the tests to verify they now pass.**

```bash
python3 -m unittest backend.tests.test_auth_memberships backend.tests.test_auth_routes backend.tests.test_canvas_foundation -v
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add backend/routes/auth.py backend/tests/test_auth_memberships.py backend/tests/test_auth_routes.py backend/tests/test_canvas_foundation.py
git commit -m "fix(auth): stop auto-enrolling canvas-rostered students on login"
```

---

### Task 5: Remove unused DB methods

**Files:**
- Modify: `database.py`

After Task 4 nothing calls `list_pending_canvas_enrollments_by_email` or `activate_pending_canvas_enrollment`. Remove them so stale callers would fail at import time rather than silently going through old logic.

- [ ] **Step 1: Verify no production caller remains.**

```bash
grep -rn "list_pending_canvas_enrollments_by_email\|activate_pending_canvas_enrollment" backend/ scripts/ main.py database.py
```

Expected results: only references are the definitions in `database.py` (lines 2244 and 2262) plus the test fake-db references you're removing as part of Task 8 (migration). If any *production* caller exists outside `backend/tests/`, stop and investigate.

- [ ] **Step 2: Delete the two functions from `database.py`.**

Remove lines starting at `def list_pending_canvas_enrollments_by_email(email):` through the end of `def activate_pending_canvas_enrollment(...)`'s body (around lines 2244–2269 of the current file). Leave `def link_assignment_to_canvas_item` (the next function) intact.

- [ ] **Step 3: Update the `create_enrollment` docstring to document `canvas_legacy`.**

Open `database.py` around line 100 where the schema comment block lists `join_source` values. Change:

```python
    - join_source: str ('manual' | 'join_code' | 'canvas')
```

to:

```python
    - join_source: str ('manual' | 'join_code' | 'canvas_legacy' | 'lti')
      (note: 'canvas' was historically used by Canvas PAT sync and may still
      appear in older rows. Current Canvas PAT sync no longer writes
      enrollments — see canvas_roster_entries/. 'canvas_legacy' marks
      rows grandfathered by the 2026-04-21 migration.)
```

- [ ] **Step 4: Run the full backend test suite.**

```bash
python3 -m unittest discover backend/tests -v
```

Expected: all tests PASS. No `AttributeError` on any fake db.

- [ ] **Step 5: Commit.**

```bash
git add database.py
git commit -m "refactor(db): remove unused pending-canvas-enrollment activation helpers"
```

---

### Task 6: Update `api_get_class_roster` — add `isOnCanvasRoster`, drop pending-sync list

**Files:**
- Modify: `backend/routes/teacher.py`
- Modify: `backend/tests/test_teacher_routes.py` (confirm location at task time; search if missing)

- [ ] **Step 1: Locate the existing teacher roster test.**

```bash
grep -rn "api_get_class_roster\|classes/.*/roster" backend/tests/
```

Use the identified test file. If no test exists for this route, add `backend/tests/test_teacher_routes.py` with a minimal harness that mirrors other teacher-route test files (confirm pattern from `backend/tests/test_admin_routes.py`).

- [ ] **Step 2: Write the failing test for `isOnCanvasRoster`.**

Add to the identified roster test file:

```python
    def test_roster_marks_students_on_canvas_roster(self):
        # enrollment: alice joined via join code, email matches canvas roster
        self.db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice-uid', 'status': 'active',
            'join_source': 'join_code',
        }
        self.db.users['alice-uid'] = {
            'uid': 'alice-uid', 'email': 'alice@school.edu', 'name': 'Alice',
        }
        # canvas roster entry with matching email
        self.db.roster_entries['class-1__cv50'] = {
            'class_id': 'class-1', 'canvas_user_id': 'cv50',
            'canvas_email': 'alice@school.edu', 'canvas_name': 'Alice',
        }
        # class has a canvas connection
        self.db.canvas_connections['conn-1'] = {
            'id': 'conn-1', 'class_id': 'class-1',
        }

        response = self.client.get('/api/teacher/classes/class-1/roster')
        self.assertEqual(response.status_code, 200)
        roster = response.get_json()['roster']
        self.assertEqual(len(roster), 1)
        self.assertEqual(roster[0]['uid'], 'alice-uid')
        self.assertTrue(roster[0]['isOnCanvasRoster'])

    def test_roster_marks_students_not_on_canvas_roster(self):
        self.db.enrollments['class-1_bob'] = {
            'id': 'class-1_bob', 'class_id': 'class-1',
            'student_uid': 'bob-uid', 'status': 'active',
            'join_source': 'join_code',
        }
        self.db.users['bob-uid'] = {
            'uid': 'bob-uid', 'email': 'bob@school.edu', 'name': 'Bob',
        }
        self.db.canvas_connections['conn-1'] = {
            'id': 'conn-1', 'class_id': 'class-1',
        }
        # NO roster entry for bob.
        response = self.client.get('/api/teacher/classes/class-1/roster')
        self.assertEqual(response.status_code, 200)
        roster = response.get_json()['roster']
        self.assertFalse(roster[0]['isOnCanvasRoster'])

    def test_roster_omits_field_when_no_canvas_connection(self):
        self.db.enrollments['class-2_carol'] = {
            'id': 'class-2_carol', 'class_id': 'class-2',
            'student_uid': 'carol-uid', 'status': 'active',
            'join_source': 'join_code',
        }
        self.db.users['carol-uid'] = {
            'uid': 'carol-uid', 'email': 'carol@school.edu', 'name': 'Carol',
        }
        # No canvas_connections entry for class-2.
        response = self.client.get('/api/teacher/classes/class-2/roster')
        roster = response.get_json()['roster']
        self.assertNotIn('isOnCanvasRoster', roster[0])

    def test_roster_does_not_include_pending_sync_rows(self):
        """After decoupling, pending_sync enrollments are gone (migration) and
        even if stale ones exist, the roster endpoint should not list them."""
        self.db.enrollments['class-1__cv99'] = {
            'id': 'class-1__cv99', 'class_id': 'class-1',
            'student_uid': '', 'status': 'pending_sync',
            'join_source': 'canvas',
            'canvas_email': 'ghost@school.edu', 'canvas_name': 'Ghost',
        }
        response = self.client.get('/api/teacher/classes/class-1/roster')
        roster = response.get_json()['roster']
        # No row with status 'pending_sync' in the payload.
        self.assertEqual([s for s in roster if s.get('status') == 'pending_sync'], [])
```

The test harness' fake db needs the following attributes: `enrollments`, `users`, `roster_entries`, `canvas_connections`, and methods `list_class_enrollments(class_id[, status])`, `get_user(uid)`, `get_canvas_connection_by_class(class_id)`, `get_canvas_roster_entry_by_email(class_id, email)`. Extend the fixture as needed to match existing patterns in the chosen test file.

- [ ] **Step 3: Run the tests to confirm they fail.**

```bash
python3 -m unittest <teacher-routes-test-file> -v
```

Expected: new tests fail (`isOnCanvasRoster` key missing; `pending_sync` rows still appear).

- [ ] **Step 4: Rewrite `api_get_class_roster` in `backend/routes/teacher.py` (lines ~758–804).**

Replace the block with:

```python
    @bp.route("/api/teacher/classes/<class_id>/roster")
    @deps.login_required
    def api_get_class_roster(class_id):
        try:
            _context, class_record = _require_teacher_class_context(deps, class_id)
            active_enrollments = deps.db.list_class_enrollments(class_id)

            # Is this class Canvas-connected? If not, skip the badge lookup.
            has_canvas_connection = (
                deps.db.get_canvas_connection_by_class(class_id) is not None
                if hasattr(deps.db, "get_canvas_connection_by_class")
                else False
            )

            students = []
            for enrollment in active_enrollments:
                student_uid = _normalize_string(enrollment.get("student_uid"))
                if not student_uid:
                    # Defensive: post-migration any row without a student_uid is
                    # stale (e.g. an un-migrated pending_sync). Do not surface it.
                    continue
                user = deps.db.get_user(student_uid) if hasattr(deps.db, "get_user") else None
                row = {
                    "uid": student_uid,
                    "displayName": _get_user_display_name(user, fallback=student_uid),
                    "studentNumber": _normalize_string(enrollment.get("student_number")),
                    "joinSource": _normalize_string(enrollment.get("join_source")),
                    "enrolledAt": _timestamp_to_iso(enrollment.get("created_at")),
                    "status": _normalize_string(enrollment.get("status")) or "active",
                }
                if has_canvas_connection and hasattr(deps.db, "get_canvas_roster_entry_by_email"):
                    email = (user or {}).get("email", "") if user else ""
                    entry = deps.db.get_canvas_roster_entry_by_email(class_id, email) if email else None
                    row["isOnCanvasRoster"] = bool(entry)
                students.append(row)

            students.sort(key=lambda item: item.get("displayName", "").lower())
            return jsonify({"success": True, "roster": students})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Class roster error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
```

Changes vs the old code: no second `pending_enrollments` query, no `pending_sync` shadow rows in the payload, no `canvasEmail`/`canvasName` on enrollment rows (those were only populated for pending rows — canvas identity for *enrolled* students is now surfaced via the badge flag only). Added `isOnCanvasRoster`.

- [ ] **Step 5: Run the tests to confirm they pass.**

```bash
python3 -m unittest <teacher-routes-test-file> -v
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add backend/routes/teacher.py backend/tests/<teacher-routes-test-file>
git commit -m "feat(teacher): mark students on canvas roster; drop pending_sync shadow rows"
```

---

### Task 7: New `GET /api/teacher/classes/<class_id>/canvas-roster-gap` endpoint

**Files:**
- Modify: `backend/routes/teacher.py`
- Modify: the teacher-routes test file from Task 6

- [ ] **Step 1: Write the failing test.**

Add to the teacher-routes test file:

```python
    def test_canvas_roster_gap_lists_unjoined_students(self):
        # class has two Canvas-rostered students; only Alice has joined.
        self.db.canvas_connections['conn-1'] = {
            'id': 'conn-1', 'class_id': 'class-1',
        }
        self.db.roster_entries['class-1__cv50'] = {
            'class_id': 'class-1', 'canvas_user_id': 'cv50',
            'canvas_email': 'alice@school.edu', 'canvas_name': 'Alice',
            'synced_at': '2026-04-21T00:00:00Z',
        }
        self.db.roster_entries['class-1__cv51'] = {
            'class_id': 'class-1', 'canvas_user_id': 'cv51',
            'canvas_email': 'bob@school.edu', 'canvas_name': 'Bob',
            'synced_at': '2026-04-21T00:00:00Z',
        }
        self.db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice-uid', 'status': 'active',
            'join_source': 'join_code',
        }
        self.db.users['alice-uid'] = {
            'uid': 'alice-uid', 'email': 'alice@school.edu', 'name': 'Alice',
        }

        response = self.client.get('/api/teacher/classes/class-1/canvas-roster-gap')
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body['summary'], {
            'canvas_total': 2, 'joined': 1, 'not_joined': 1,
        })
        self.assertEqual(len(body['gap']), 1)
        self.assertEqual(body['gap'][0]['canvas_email'], 'bob@school.edu')

    def test_canvas_roster_gap_empty_when_class_has_no_canvas_connection(self):
        response = self.client.get('/api/teacher/classes/class-2/canvas-roster-gap')
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body['gap'], [])
        self.assertIsNone(body['summary'])

    def test_canvas_roster_gap_positive_empty_state(self):
        """When every rostered student has joined, gap is empty and summary reflects parity."""
        self.db.canvas_connections['conn-1'] = {
            'id': 'conn-1', 'class_id': 'class-1',
        }
        self.db.roster_entries['class-1__cv50'] = {
            'class_id': 'class-1', 'canvas_user_id': 'cv50',
            'canvas_email': 'alice@school.edu', 'canvas_name': 'Alice',
        }
        self.db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice-uid', 'status': 'active',
            'join_source': 'join_code',
        }
        self.db.users['alice-uid'] = {
            'uid': 'alice-uid', 'email': 'alice@school.edu', 'name': 'Alice',
        }

        response = self.client.get('/api/teacher/classes/class-1/canvas-roster-gap')
        body = response.get_json()
        self.assertEqual(body['gap'], [])
        self.assertEqual(body['summary'], {
            'canvas_total': 1, 'joined': 1, 'not_joined': 0,
        })
```

- [ ] **Step 2: Run tests to confirm failure.**

```bash
python3 -m unittest <teacher-routes-test-file> -v
```

Expected: 404 (route does not exist yet).

- [ ] **Step 3: Add the route immediately after `api_get_class_roster` in `backend/routes/teacher.py`.**

```python
    @bp.route("/api/teacher/classes/<class_id>/canvas-roster-gap")
    @deps.login_required
    def api_get_canvas_roster_gap(class_id):
        try:
            _context, class_record = _require_teacher_class_context(deps, class_id)

            has_canvas_connection = (
                deps.db.get_canvas_connection_by_class(class_id) is not None
                if hasattr(deps.db, "get_canvas_connection_by_class")
                else False
            )
            if not has_canvas_connection:
                return jsonify({"success": True, "gap": [], "summary": None})

            roster_entries = deps.db.list_canvas_roster_entries(class_id)
            enrollments = deps.db.list_class_enrollments(class_id)

            # Collect emails of currently-enrolled students.
            joined_emails = set()
            for enrollment in enrollments:
                student_uid = enrollment.get("student_uid")
                if not student_uid:
                    continue
                user = deps.db.get_user(student_uid) if hasattr(deps.db, "get_user") else None
                email = ((user or {}).get("email") or "").lower().strip()
                if email:
                    joined_emails.add(email)

            gap = []
            for entry in roster_entries:
                entry_email = (entry.get("canvas_email") or "").lower().strip()
                if entry_email and entry_email not in joined_emails:
                    gap.append({
                        "canvas_name": entry.get("canvas_name", ""),
                        "canvas_email": entry.get("canvas_email", ""),
                        "synced_at": _timestamp_to_iso(entry.get("synced_at")),
                    })
            gap.sort(key=lambda item: item.get("canvas_name", "").lower())

            summary = {
                "canvas_total": len(roster_entries),
                "joined": len(roster_entries) - len(gap),
                "not_joined": len(gap),
            }
            return jsonify({"success": True, "gap": gap, "summary": summary})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Canvas roster gap error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
```

- [ ] **Step 4: Run tests — should pass.**

```bash
python3 -m unittest <teacher-routes-test-file> -v
```

- [ ] **Step 5: Commit.**

```bash
git add backend/routes/teacher.py backend/tests/<teacher-routes-test-file>
git commit -m "feat(teacher): add canvas-roster-gap endpoint"
```

---

## Phase 2 — Migration

### Task 8: Migration script — `migrate_canvas_roster_decouple.py`

**Files:**
- Create: `scripts/migrate_canvas_roster_decouple.py`
- Create: `backend/tests/test_migrate_canvas_roster_decouple.py`

Migration rules:
1. `enrollments/{id}` with `join_source == 'canvas'` AND `status == 'active'` → update `join_source = 'canvas_legacy'`.
2. `enrollments/{id}` with `status == 'pending_sync'` → translate Canvas fields into `canvas_roster_entries/{class_id}__{canvas_user_id}`, then delete the enrollment row.
3. All other rows: untouched.
4. Running the script twice yields the same outcome (idempotent).
5. Dry-run by default; `--commit` to write.

- [ ] **Step 1: Write the failing test file.**

Create `backend/tests/test_migrate_canvas_roster_decouple.py`:

```python
import unittest
from scripts.migrate_canvas_roster_decouple import migrate_once, MigrationReport


class FakeMigrationDb:
    def __init__(self):
        self.enrollments = {}      # id -> dict
        self.roster_entries = {}   # key=f'{class_id}__{canvas_user_id}' -> dict
        self.updated_enrollments = []
        self.deleted_enrollments = []
        self.upserted_roster_entries = []
        self.canvas_connections = {}   # class_id -> connection_id lookup

    def list_all_enrollments(self):
        return list(self.enrollments.values())

    def update_enrollment_join_source(self, enrollment_id, new_join_source):
        self.enrollments[enrollment_id]['join_source'] = new_join_source
        self.updated_enrollments.append((enrollment_id, new_join_source))

    def delete_enrollment(self, enrollment_id):
        self.enrollments.pop(enrollment_id, None)
        self.deleted_enrollments.append(enrollment_id)

    def upsert_canvas_roster_entry(self, *, class_id, connection_id,
                                   canvas_user_id, canvas_email, canvas_name):
        key = f'{class_id}__{canvas_user_id}'
        self.roster_entries[key] = {
            'class_id': class_id, 'connection_id': connection_id,
            'canvas_user_id': canvas_user_id,
            'canvas_email': (canvas_email or '').lower().strip(),
            'canvas_name': canvas_name,
        }
        self.upserted_roster_entries.append(key)

    def get_canvas_connection_id_for_class(self, class_id):
        return self.canvas_connections.get(class_id, '')


class MigrateCanvasRosterDecoupleTest(unittest.TestCase):
    def test_active_canvas_enrollment_flipped_to_canvas_legacy(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'canvas',
            'canvas_email': 'alice@school.edu',
        }
        report = migrate_once(db=db, commit=True)
        self.assertEqual(db.enrollments['class-1_alice']['join_source'], 'canvas_legacy')
        self.assertEqual(db.enrollments['class-1_alice']['status'], 'active')  # unchanged
        self.assertEqual(report.legacy_flipped, 1)

    def test_active_join_code_enrollment_untouched(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'join_code',
        }
        migrate_once(db=db, commit=True)
        self.assertEqual(db.enrollments['class-1_alice']['join_source'], 'join_code')

    def test_pending_sync_translated_to_roster_entry_and_deleted(self):
        db = FakeMigrationDb()
        db.canvas_connections['class-1'] = 'conn-1'
        db.enrollments['class-1__cv50'] = {
            'id': 'class-1__cv50', 'class_id': 'class-1',
            'student_uid': '', 'status': 'pending_sync', 'join_source': 'canvas',
            'canvas_user_id': 'cv50', 'canvas_email': 'bob@school.edu',
            'canvas_name': 'Bob',
        }
        report = migrate_once(db=db, commit=True)
        self.assertNotIn('class-1__cv50', db.enrollments)
        self.assertIn('class-1__cv50', db.roster_entries)
        self.assertEqual(db.roster_entries['class-1__cv50']['canvas_email'],
                         'bob@school.edu')
        self.assertEqual(report.pending_sync_translated, 1)

    def test_idempotent(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'canvas',
        }
        migrate_once(db=db, commit=True)
        # second run: nothing to do, no assertion failures.
        report = migrate_once(db=db, commit=True)
        self.assertEqual(report.legacy_flipped, 0)
        self.assertEqual(report.pending_sync_translated, 0)

    def test_dry_run_makes_no_writes(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'canvas',
        }
        db.enrollments['class-1__cv50'] = {
            'id': 'class-1__cv50', 'class_id': 'class-1',
            'student_uid': '', 'status': 'pending_sync', 'join_source': 'canvas',
            'canvas_user_id': 'cv50', 'canvas_email': 'bob@school.edu',
        }
        report = migrate_once(db=db, commit=False)
        # Report reflects what WOULD happen.
        self.assertEqual(report.legacy_flipped, 1)
        self.assertEqual(report.pending_sync_translated, 1)
        # No writes occurred.
        self.assertEqual(db.enrollments['class-1_alice']['join_source'], 'canvas')
        self.assertIn('class-1__cv50', db.enrollments)
        self.assertEqual(db.roster_entries, {})

    def test_active_enrollment_never_deleted(self):
        db = FakeMigrationDb()
        db.enrollments['class-1_alice'] = {
            'id': 'class-1_alice', 'class_id': 'class-1',
            'student_uid': 'alice', 'status': 'active', 'join_source': 'canvas',
        }
        migrate_once(db=db, commit=True)
        self.assertIn('class-1_alice', db.enrollments)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run to confirm import failure.**

```bash
python3 -m unittest backend.tests.test_migrate_canvas_roster_decouple -v
```

Expected: `ModuleNotFoundError` on `scripts.migrate_canvas_roster_decouple`.

- [ ] **Step 3: Create the migration script.**

Create `scripts/migrate_canvas_roster_decouple.py`:

```python
"""One-time migration: decouple Canvas roster from enrollments.

Run with --dry-run (default) or --commit. Idempotent.

Rules:
  * enrollments{join_source='canvas', status='active'} → join_source='canvas_legacy'
  * enrollments{status='pending_sync'} → canvas_roster_entries upsert + delete enrollment
  * everything else: untouched. ACTIVE ENROLLMENTS ARE NEVER DELETED.

Usage:
    python3 scripts/migrate_canvas_roster_decouple.py               # dry-run
    python3 scripts/migrate_canvas_roster_decouple.py --commit      # live
"""
import argparse
import os
import sys
from dataclasses import dataclass

# Allow running directly from repo root.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


@dataclass
class MigrationReport:
    legacy_flipped: int = 0
    pending_sync_translated: int = 0
    untouched: int = 0

    def render(self, mode: str) -> str:
        return (
            f"[{mode}] legacy_flipped={self.legacy_flipped} "
            f"pending_sync_translated={self.pending_sync_translated} "
            f"untouched={self.untouched}"
        )


def migrate_once(*, db, commit: bool) -> MigrationReport:
    """Pure function; accepts any db-like object exposing:
      - list_all_enrollments() -> list of dicts
      - update_enrollment_join_source(enrollment_id, new_value)
      - delete_enrollment(enrollment_id)
      - upsert_canvas_roster_entry(class_id, connection_id, canvas_user_id,
                                   canvas_email, canvas_name)
      - get_canvas_connection_id_for_class(class_id) -> str (may be '')
    """
    report = MigrationReport()
    for row in db.list_all_enrollments():
        enrollment_id = row.get('id', '')
        class_id = row.get('class_id', '')
        status = row.get('status', '')
        join_source = row.get('join_source', '')

        if status == 'active' and join_source == 'canvas':
            if commit:
                db.update_enrollment_join_source(enrollment_id, 'canvas_legacy')
            report.legacy_flipped += 1

        elif status == 'pending_sync':
            canvas_user_id = str(row.get('canvas_user_id', ''))
            if not canvas_user_id:
                # Defensive: a pending_sync row without a canvas_user_id is malformed.
                # Skip it, count as untouched.
                report.untouched += 1
                continue
            if commit:
                db.upsert_canvas_roster_entry(
                    class_id=class_id,
                    connection_id=db.get_canvas_connection_id_for_class(class_id),
                    canvas_user_id=canvas_user_id,
                    canvas_email=row.get('canvas_email', ''),
                    canvas_name=row.get('canvas_name', ''),
                )
                db.delete_enrollment(enrollment_id)
            report.pending_sync_translated += 1

        else:
            report.untouched += 1

    return report


class LiveFirestoreDb:
    """Adapter bridging the migration's small surface onto real Firestore."""

    def __init__(self):
        import database  # app module
        self._db = database

    def list_all_enrollments(self):
        from database import get_enrollments_collection
        docs = get_enrollments_collection().stream()
        rows = []
        for doc in docs:
            data = doc.to_dict() or {}
            data['id'] = doc.id
            rows.append(data)
        return rows

    def update_enrollment_join_source(self, enrollment_id, new_join_source):
        from database import get_enrollment_ref, firestore
        get_enrollment_ref(enrollment_id).update({
            'join_source': new_join_source,
            'updated_at': firestore.SERVER_TIMESTAMP,
        })

    def delete_enrollment(self, enrollment_id):
        from database import get_enrollment_ref
        get_enrollment_ref(enrollment_id).delete()

    def upsert_canvas_roster_entry(self, **kwargs):
        from database import upsert_canvas_roster_entry
        upsert_canvas_roster_entry(**kwargs)

    def get_canvas_connection_id_for_class(self, class_id):
        from database import get_canvas_connection_by_class
        connection = get_canvas_connection_by_class(class_id) or {}
        return connection.get('id', '')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', action='store_true',
                        help='Write changes to Firestore. Default is dry-run.')
    args = parser.parse_args()

    mode = 'COMMIT' if args.commit else 'DRY-RUN'
    print(f'Canvas roster decouple migration — mode={mode}')

    # Initialize firebase_admin before database is imported.
    import firebase_admin
    from firebase_admin import credentials
    if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        cred = credentials.Certificate(os.environ['GOOGLE_APPLICATION_CREDENTIALS'])
        try:
            firebase_admin.initialize_app(cred)
        except ValueError:
            pass  # Already initialized

    db = LiveFirestoreDb()
    report = migrate_once(db=db, commit=args.commit)
    print(report.render(mode))


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run the test suite — confirm all pass.**

```bash
python3 -m unittest backend.tests.test_migrate_canvas_roster_decouple -v
```

- [ ] **Step 5: Dry-run against live Firestore (informational only, no writes).**

```bash
python3 scripts/migrate_canvas_roster_decouple.py
```

Expected output form: `[DRY-RUN] legacy_flipped=N pending_sync_translated=M untouched=K`. Capture the numbers — you'll want them for the PR description.

- [ ] **Step 6: Commit.**

```bash
git add scripts/migrate_canvas_roster_decouple.py backend/tests/test_migrate_canvas_roster_decouple.py
git commit -m "feat(migration): decouple canvas roster from enrollments"
```

The actual `--commit` run happens at deploy time (between backend deploy and frontend deploy), not during implementation.

---

## Phase 3 — Frontend: badges, gap view, sync copy

### Task 9: Extend frontend types

**Files:**
- Modify: `frontend/src/types/school.ts`

- [ ] **Step 1: Extend `ClassRosterStudent` and add gap types.**

Open `frontend/src/types/school.ts`. Replace the existing `ClassRosterStudent` interface (around line 251) with:

```typescript
export interface ClassRosterStudent {
  uid: string;
  displayName: string;
  studentNumber?: string;
  joinSource?: string;
  enrolledAt?: string | null;
  status: string;
  // Set to true/false only when the class has a Canvas connection.
  // Undefined when no Canvas connection exists for the class.
  isOnCanvasRoster?: boolean;
}

export interface CanvasRosterGapEntry {
  canvas_name: string;
  canvas_email: string;
  synced_at?: string | null;
}

export interface CanvasRosterGapSummary {
  canvas_total: number;
  joined: number;
  not_joined: number;
}

export interface CanvasRosterGapResponse {
  gap: CanvasRosterGapEntry[];
  summary: CanvasRosterGapSummary | null;
}
```

- [ ] **Step 2: Re-export the new types from `frontend/src/types/index.ts`.**

```bash
grep -n "ClassRosterStudent" frontend/src/types/index.ts
```

Extend that re-export:

```typescript
  ClassRosterStudent,
  CanvasRosterGapEntry,
  CanvasRosterGapSummary,
  CanvasRosterGapResponse,
```

- [ ] **Step 3: Run the frontend type check.**

```bash
cd frontend && npm run build
```

Expected: no type errors (type additions only; no consumer breakage yet).

- [ ] **Step 4: Commit.**

```bash
git add frontend/src/types/school.ts frontend/src/types/index.ts
git commit -m "types(frontend): extend roster type with isOnCanvasRoster; add gap types"
```

---

### Task 10: Add `getClassCanvasRosterGap` API method

**Files:**
- Modify: `frontend/src/api/teacher.ts`

- [ ] **Step 1: Add the method and its response type.**

Open `frontend/src/api/teacher.ts`. Find the roster management section (around line 270 — just after `getClassRoster`). Add below `removeStudentFromClass`:

```typescript
import type {
  // ... existing imports ...
  CanvasRosterGapResponse,
} from '@/types';

// (existing code above) …

interface CanvasRosterGapApiResponse {
  success: boolean;
  gap: CanvasRosterGapResponse['gap'];
  summary: CanvasRosterGapResponse['summary'];
}

export const getClassCanvasRosterGap = async (
  classId: string,
): Promise<CanvasRosterGapResponse> => {
  const response = await api.get<CanvasRosterGapApiResponse>(
    `/teacher/classes/${classId}/canvas-roster-gap`,
  );
  return { gap: response.data.gap, summary: response.data.summary };
};
```

- [ ] **Step 2: Verify the build.**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/api/teacher.ts
git commit -m "feat(api): add getClassCanvasRosterGap"
```

---

### Task 11: Update `TeacherDashboardPage` roster dialog — badges + drop pending-sync render

**Files:**
- Modify: `frontend/src/pages/TeacherDashboardPage.tsx`

- [ ] **Step 1: Replace the roster row render logic (lines ~1200–1241).**

Find the `roster.map((student, idx) => { ... })` block. Replace with:

```tsx
                {roster.map((student, idx) => {
                  const key = student.uid || `row-${idx}`;
                  const joinedLabel =
                    student.joinSource === 'join_code'
                      ? 'Joined via code'
                      : student.joinSource === 'lti'
                      ? 'Joined via Canvas LTI'
                      : student.joinSource === 'canvas_legacy'
                      ? 'Legacy Canvas enrollment'
                      : student.joinSource || 'Enrolled';
                  const enrolledSuffix = student.enrolledAt
                    ? ` · ${new Date(student.enrolledAt).toLocaleDateString()}`
                    : '';
                  const subtitle = `${joinedLabel}${enrolledSuffix}`;
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-foreground truncate">
                            {student.displayName}
                          </p>
                          {student.isOnCanvasRoster === true && (
                            <span className="rounded-full border border-emerald-500/40 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                              On Canvas roster
                            </span>
                          )}
                          {student.isOnCanvasRoster === false && (
                            <span className="rounded-full border border-muted bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Not on Canvas roster
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{subtitle}</p>
                      </div>
                      {student.uid && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStudent(student.uid)}
                          disabled={removingUid === student.uid}
                          className="text-destructive hover:text-destructive"
                        >
                          {removingUid === student.uid ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
```

Key changes: removed `isPending` branch and the "Canvas pending" amber badge; added the green/muted `isOnCanvasRoster` badges; removed references to `student.canvasEmail`/`student.canvasName` (no longer part of the roster payload).

- [ ] **Step 2: Verify the build + lint pass.**

```bash
cd frontend && npm run build && npm run lint
```

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/pages/TeacherDashboardPage.tsx
git commit -m "feat(teacher-ui): render on-canvas-roster badges; drop pending_sync row rendering"
```

---

### Task 12: Add "Canvas roster — not yet joined" gap section to the roster dialog

**Files:**
- Modify: `frontend/src/pages/TeacherDashboardPage.tsx`

- [ ] **Step 1: Import the new API and types.**

Add to the existing `@/api/teacher` import block near line 36:

```typescript
import {
  // existing:
  getTeacherDashboard,
  createTeacherClass,
  generateClassJoinCode,
  getClassJoinCode,
  deactivateClassJoinCode,
  getClassRoster,
  removeStudentFromClass,
  // new:
  getClassCanvasRosterGap,
} from '@/api/teacher';
```

And add to the `@/types` import near line 59:

```typescript
import type {
  ClassJoinCodeData,
  ClassRosterStudent,
  CreateTeacherClassPayload,
  TeacherDashboardData,
  TeacherInvitation,
  // new:
  CanvasRosterGapEntry,
  CanvasRosterGapSummary,
} from '@/types';
```

- [ ] **Step 2: Add gap state + fetch.**

Near the existing "Roster state" block (around line 94), add:

```typescript
  // Canvas roster gap state
  const [canvasRosterGap, setCanvasRosterGap] = useState<CanvasRosterGapEntry[]>([]);
  const [canvasRosterSummary, setCanvasRosterSummary] =
    useState<CanvasRosterGapSummary | null>(null);
```

Find the function that opens the roster dialog and loads the roster (search for `setRosterClassId` + `setRoster(` + `getClassRoster`). In that async loader, add a parallel fetch for the gap:

```typescript
  const loadRosterForClass = async (classId: string) => {
    setRosterClassId(classId);
    setRosterLoading(true);
    try {
      const [students, gapResponse] = await Promise.all([
        getClassRoster(classId),
        getClassCanvasRosterGap(classId),
      ]);
      setRoster(students);
      setCanvasRosterGap(gapResponse.gap);
      setCanvasRosterSummary(gapResponse.summary);
    } finally {
      setRosterLoading(false);
    }
  };
```

If the existing open-roster code is inlined rather than extracted into a function, either refactor to use `loadRosterForClass` or inline the parallel fetch at the call site — whichever minimizes diff. The test in Task 13 will exercise whichever shape lands.

- [ ] **Step 3: Render the gap section in the roster dialog.**

Locate the roster dialog JSX (starting around line 1167 with `<Dialog open={rosterClassId !== null} ...>`). After the closing `</div>` of the main roster list (right before the `DialogContent` closes around line 1244), insert:

```tsx
            {canvasRosterSummary && (
              <div className="mt-6 space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Canvas roster — not yet joined
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {canvasRosterSummary.joined} of {canvasRosterSummary.canvas_total}{' '}
                    Canvas students joined
                  </span>
                </div>
                {canvasRosterGap.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    All Canvas-rostered students have joined via class code.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Share the class code with these students to enroll them.
                    </p>
                    <ul className="space-y-1">
                      {canvasRosterGap.map((entry) => (
                        <li
                          key={entry.canvas_email}
                          className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2 text-sm"
                        >
                          <span className="truncate">{entry.canvas_name || entry.canvas_email}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {entry.canvas_email}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
```

When the class has no Canvas connection, the API returns `summary === null` and the entire block is hidden.

- [ ] **Step 4: Run build + lint + tests.**

```bash
cd frontend && npm run build && npm run lint && npm run test -- --run src/pages/TeacherDashboardPage.test.tsx
```

The existing test file may need updates for the new `getClassCanvasRosterGap` mock — see Task 13 for that. Minimum bar here: build + lint clean.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/pages/TeacherDashboardPage.tsx
git commit -m "feat(teacher-ui): add canvas roster gap section to roster dialog"
```

---

### Task 13: Update `TeacherDashboardPage.test.tsx`

**Files:**
- Modify: `frontend/src/pages/TeacherDashboardPage.test.tsx`

- [ ] **Step 1: Mock the new API in the existing mock block.**

Open `frontend/src/pages/TeacherDashboardPage.test.tsx`. Extend the `vi.mock('@/api/teacher', ...)` block (currently at lines 22–26) with `getClassCanvasRosterGap: vi.fn()`:

```typescript
vi.mock('@/api/teacher', () => ({
  getTeacherDashboard: vi.fn(),
  createTeacherClass: vi.fn(),
  generateClassJoinCode: vi.fn(),
  getClassJoinCode: vi.fn(),
  deactivateClassJoinCode: vi.fn(),
  getClassRoster: vi.fn(),
  removeStudentFromClass: vi.fn(),
  getClassCanvasRosterGap: vi.fn(),
}));
```

- [ ] **Step 2: Add a shared test helper that opens the roster dialog.**

Inside the test file, near the existing `beforeEach` block, add:

```tsx
const openRosterForFirstClass = async () => {
  // The dashboard renders a roster-trigger button per class card that calls
  // openRosterDialog(classId) (see TeacherDashboardPage.tsx line ~663).
  // The button is identified by its accessible name — the icon-only button
  // carries an aria-label matching /roster/i. If the button is rendered
  // with a tooltip instead of aria-label, use the Users lucide icon's role
  // or add a data-testid to the component as part of this change.
  const rosterButton = await screen.findByRole('button', { name: /roster/i });
  fireEvent.click(rosterButton);
};
```

If `findByRole('button', { name: /roster/i })` does not resolve (because the existing button has no accessible name), add `aria-label="View roster"` to the button at `TeacherDashboardPage.tsx:661-665` as part of Task 12 and update the Step 3 JSX in Task 12 accordingly.

- [ ] **Step 3: Add the four roster-badge / gap tests.**

Add a new `describe('canvas roster badges and gap section', ...)` block, and within it the four cases below. Each test seeds the dashboard payload to contain one class, awaits the dialog open, then asserts on the rendered chrome.

```tsx
describe('canvas roster badges and gap section', () => {
  beforeEach(async () => {
    const { getTeacherDashboard } = await import('@/api/teacher');
    vi.mocked(getTeacherDashboard).mockResolvedValue({
      // Use whatever shape TeacherDashboardData requires in this test file.
      // At minimum, one class summary with a stable id:
      classes: [{ id: 'class-1', name: 'French 2', assignmentsCount: 0, studentsCount: 1 }],
      summary: {},
    } as any);
  });

  it('renders a green "On Canvas roster" badge for matched students', async () => {
    const { getClassRoster, getClassCanvasRosterGap } = await import('@/api/teacher');
    vi.mocked(getClassRoster).mockResolvedValue([
      {
        uid: 'alice-uid', displayName: 'Alice', status: 'active',
        joinSource: 'join_code', isOnCanvasRoster: true,
      },
    ]);
    vi.mocked(getClassCanvasRosterGap).mockResolvedValue({
      gap: [], summary: { canvas_total: 1, joined: 1, not_joined: 0 },
    });
    render(<TeacherDashboardPage />);
    await openRosterForFirstClass();
    expect(await screen.findByText(/On Canvas roster/i)).toBeInTheDocument();
  });

  it('renders a muted "Not on Canvas roster" badge for unmatched students', async () => {
    const { getClassRoster, getClassCanvasRosterGap } = await import('@/api/teacher');
    vi.mocked(getClassRoster).mockResolvedValue([
      {
        uid: 'bob-uid', displayName: 'Bob', status: 'active',
        joinSource: 'join_code', isOnCanvasRoster: false,
      },
    ]);
    vi.mocked(getClassCanvasRosterGap).mockResolvedValue({
      gap: [], summary: { canvas_total: 0, joined: 0, not_joined: 0 },
    });
    render(<TeacherDashboardPage />);
    await openRosterForFirstClass();
    expect(await screen.findByText(/Not on Canvas roster/i)).toBeInTheDocument();
  });

  it('hides the gap section when class has no Canvas connection', async () => {
    const { getClassRoster, getClassCanvasRosterGap } = await import('@/api/teacher');
    vi.mocked(getClassRoster).mockResolvedValue([
      { uid: 'carol-uid', displayName: 'Carol', status: 'active', joinSource: 'join_code' },
    ]);
    vi.mocked(getClassCanvasRosterGap).mockResolvedValue({ gap: [], summary: null });
    render(<TeacherDashboardPage />);
    await openRosterForFirstClass();
    expect(
      screen.queryByText(/Canvas roster — not yet joined/i),
    ).not.toBeInTheDocument();
  });

  it('shows gap entries with summary line', async () => {
    const { getClassRoster, getClassCanvasRosterGap } = await import('@/api/teacher');
    vi.mocked(getClassRoster).mockResolvedValue([
      { uid: 'alice-uid', displayName: 'Alice', status: 'active', joinSource: 'join_code', isOnCanvasRoster: true },
    ]);
    vi.mocked(getClassCanvasRosterGap).mockResolvedValue({
      gap: [{ canvas_name: 'Bob', canvas_email: 'bob@school.edu' }],
      summary: { canvas_total: 2, joined: 1, not_joined: 1 },
    });
    render(<TeacherDashboardPage />);
    await openRosterForFirstClass();
    expect(await screen.findByText(/1 of 2 Canvas students joined/)).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});
```

If the `TeacherDashboardData` mock shape in the existing test file differs from the snippet above (likely — the file uses the real type), copy the real mock shape from the other passing tests in the same file.

- [ ] **Step 2: Run.**

```bash
cd frontend && npm run test -- --run src/pages/TeacherDashboardPage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/pages/TeacherDashboardPage.test.tsx
git commit -m "test(teacher-ui): cover canvas roster badge and gap rendering"
```

---

### Task 14: Update Canvas sync status copy (button label + result text)

**Files:**
- Modify: whichever component renders the Canvas sync result after the `/api/teacher/classes/<id>/canvas/sync` call.

- [ ] **Step 1: Locate the component.**

```bash
grep -rn "canvas/sync\|canvasSync\|roster.matched\|roster.unmatched" frontend/src/
```

Expected hits include a `CanvasSyncStatus` or similar component file plus any call sites in the assignment builder.

- [ ] **Step 2: Replace the result-text snippet.**

Find the line that reads fields like `roster.matched`, `roster.unmatched`, `roster.created`. Replace with the new shape:

```tsx
// Before:
<p>{`${roster.matched} matched, ${roster.unmatched} unmatched, ${roster.deactivated} removed.`}</p>

// After:
<p>
  {`${roster.entries_upserted} Canvas student${roster.entries_upserted === 1 ? '' : 's'} captured` +
   `${roster.entries_removed > 0 ? `, ${roster.entries_removed} dropped from roster` : ''}.`}
</p>
```

And the CTA:

```tsx
// Before: "Sync Canvas roster"
// After:  "Refresh Canvas roster"
```

Helper text (tooltip or description line near the button):

```
Updates the Canvas roster list and refreshes course content.
Does not add or remove students from your class — share your class code to enroll students.
```

- [ ] **Step 3: If a typed `RosterSyncResult` interface exists in the frontend, update it.**

```typescript
export interface RosterSyncResult {
  entries_upserted: number;
  entries_removed: number;
  total_canvas_students: number;
}
```

- [ ] **Step 4: Run build + any tests that cover the sync UI.**

```bash
cd frontend && npm run build && npm run lint
```

Update any snapshot / text assertions that referenced the old copy.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/<sync-status-file> frontend/src/types/<any>
git commit -m "feat(canvas-sync-ui): rename CTA to 'Refresh Canvas roster'; new result copy"
```

---

## Phase 4 — Docs

### Task 15: Update school-integration docs

**Files:**
- Modify: `docs/school-integration/TECH_SPEC.md`
- Modify: `docs/school-integration/LIMITATIONS.md`
- Modify: `docs/school-integration/TASKS.md`
- Modify: `docs/school-integration/BDD_SCENARIOS.md`

- [ ] **Step 1: `TECH_SPEC.md` — document the new collection + invariant.**

Find the Firestore schema section that lists collections. Add, next to the `enrollments/` entry:

```markdown
`canvas_roster_entries/{class_id}__{canvas_user_id}` — Canvas-truth view of
the class roster (NOT enrollment). Written only by Canvas PAT sync. Fields:
`class_id`, `connection_id`, `canvas_user_id`, `canvas_email`, `canvas_name`,
`synced_at`, `created_at`. Used to render the "on Canvas roster" badge and
the "not yet joined" gap view. Does not grant class access.
```

Find the Canvas integration section. Add a bolded invariant line:

```markdown
**Invariant:** Canvas PAT sync never writes to `enrollments/`. Enrollments
are created only by explicit student action (join code) or consent-by-click
(LTI deep-link launch).
```

- [ ] **Step 2: `LIMITATIONS.md` — supersede item 12, add new items.**

Append to item 12's body:

```markdown
**2026-04-21 update:** passive email-match auto-enroll is removed. Canvas
PAT sync now writes only to `canvas_roster_entries/`; enrollments come
exclusively from join code or LTI. Existing Canvas-sourced active
enrollments were grandfathered with `join_source='canvas_legacy'`.
```

Append a new item:

```markdown
20. Canvas roster confirmation signal uses email equality only.
Impact: the teacher-side "On Canvas roster" badge matches by exact
lowercased email equality. Students whose Lingual account email differs
from their Canvas roster email (different provider, personal vs school)
will not get a matched badge even when they are on the Canvas roster by
name. Teachers can visually confirm via the student's display name.
Planned follow-up: add a teacher-side manual "link to Canvas roster
entry" action, and/or a second-tier match via `canvas_user_id` derived
from LTI session history.
```

- [ ] **Step 3: `TASKS.md` — mark items done.**

Find any line referring to Canvas roster auto-enroll (likely under the "roster workflows" or "Canvas LMS integration" phase). Change `[ ]` to `[x]`, append a dated note:

```markdown
- [x] Decouple Canvas roster from Lingual enrollments (2026-04-21). See
  `docs/superpowers/specs/2026-04-21-canvas-roster-decouple-from-enrollment-design.md`.
```

- [ ] **Step 4: `BDD_SCENARIOS.md` — add scenarios.**

Add under the roster / Canvas section:

```gherkin
Scenario: Canvas PAT sync does not enroll students
  Given a class connected to Canvas with 5 students on the Canvas roster
  When the teacher triggers Canvas sync
  Then 5 canvas_roster_entries rows are created for that class
  And 0 enrollments are created

Scenario: Student joining a Canvas-rostered class via code sees a matched badge
  Given a class with a Canvas roster that includes alice@school.edu
  And alice has a Lingual account using alice@school.edu
  When alice enters the class join code
  Then an active enrollment is created for alice with join_source='join_code'
  And the teacher's roster view shows alice with an "On Canvas roster" badge

Scenario: Teacher sees unjoined Canvas roster students in the gap section
  Given a class with a 3-student Canvas roster
  And only 1 of those students has entered the join code
  When the teacher opens the class roster dialog
  Then the gap section lists the 2 students who haven't joined
  And the summary line reads "1 of 3 Canvas students joined"

Scenario: Login does not auto-enroll a Canvas-rostered student
  Given a student's email is on a Canvas roster for class-1 (canvas_roster_entries row exists)
  And no enrollment exists for that student in class-1
  When the student logs into Lingual
  Then no enrollment is created
  And the student does not see class-1 in their class list
```

- [ ] **Step 5: Commit.**

```bash
git add docs/school-integration/TECH_SPEC.md docs/school-integration/LIMITATIONS.md docs/school-integration/TASKS.md docs/school-integration/BDD_SCENARIOS.md
git commit -m "docs: document canvas roster / enrollment decoupling"
```

---

## Final verification

After all commits, run the full test suites and confirm a clean build:

```bash
# Backend
python3 -m unittest discover backend/tests -v

# Frontend
cd frontend && npm run build && npm run lint && npm run test -- --run
```

Before opening the PR, dispatch the agents specified in `CLAUDE.md`:

1. `spec-agent` — confirm spec/impl alignment.
2. `cross-layer-review` — contract between new backend endpoint and new frontend consumer; confirm the decoupling invariant holds across all touched surfaces.
3. `doc-sync` — confirm `TECH_SPEC.md`, `LIMITATIONS.md`, `TASKS.md`, `BDD_SCENARIOS.md` are consistent.

PR description should include the dry-run numbers from Task 8 Step 5 so the reviewer can sanity-check the expected migration impact.
