"""Tier 1 (no DB): enrollment-chain backfill logic.

Drives backfill.py's upserts and run_backfill with a fake SQLAlchemy session to
verify the pure-transform/rename/remap behavior and the orchestration order
WITHOUT a real Postgres engine:

- field renames (suspended_by_uid/restored_by_uid, uid, removed_by_uid,
  student_uid)
- value remaps (pending_sync -> inactive, canvas -> canvas_legacy,
  org inactive -> archived)
- primary_class_ids deferred to []
- dry_run performs no writes (no add, no flush)
- run_backfill processes parent-first (organizations -> ... -> enrollments)

The fake session resolves `legacy_firestore_id` lookups against an in-memory
table keyed by (model, legacy_firestore_id), so resolution + idempotency are
exercised exactly as the repository code calls them.
"""

import unittest
import uuid

from backend.db.models.org import Class, Enrollment, Membership, Organization
from backend.db.repository import backfill


class _Stmt:
    """Minimal carrier so the fake session can introspect a select()."""

    def __init__(self, model, want_id, legacy_value):
        self.model = model
        self.want_id = want_id  # True if selecting model.id (resolution)
        self.legacy_value = legacy_value


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _NullSavepoint:
    """Stand-in for session.begin_nested(): a no-op context manager.

    __exit__ returns False so exceptions propagate (mirroring a real SAVEPOINT,
    which rolls back and re-raises).
    """

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeSession:
    """Records adds/flushes and answers legacy_firestore_id SELECTs.

    `store` maps (model, legacy_firestore_id) -> ORM row. resolve_legacy_id
    issues `select(model.id).where(model.legacy_firestore_id == fid)`; the
    idempotency check issues `select(model).where(...)`. We sniff the compiled
    WHERE to recover (model, fid) without a real engine.
    """

    def __init__(self):
        self.store: dict[tuple, object] = {}
        # Active/invited memberships indexed by (org_id, firebase_uid) for the
        # multi-role merge lookup (_active_membership), which the partial-unique
        # index memberships_org_uid_active_idx makes a single-row lookup.
        self.active_idx: dict[tuple, object] = {}
        self.added: list = []
        self.flushes = 0

    def add(self, obj):
        self.added.append(obj)
        # Assign a UUID id on insert so children can resolve the parent, and
        # register it in the store keyed by its legacy id.
        if getattr(obj, 'id', None) is None:
            obj.id = uuid.uuid4()
        fid = getattr(obj, 'legacy_firestore_id', None)
        if fid is not None:
            self.store[(type(obj), fid)] = obj
        if isinstance(obj, Membership) and getattr(obj, 'status', None) in (
            'active',
            'invited',
        ):
            self.active_idx[(obj.org_id, obj.firebase_uid)] = obj

    def flush(self):
        self.flushes += 1

    def begin_nested(self):
        return _NullSavepoint()

    def execute(self, stmt):
        parsed = _parse_stmt(stmt)
        if parsed[0] == 'active':
            _, org_id, firebase_uid = parsed
            return _Result(self.active_idx.get((org_id, firebase_uid)))
        _, model, want_id, fid = parsed
        row = self.store.get((model, fid))
        if want_id:
            return _Result(row.id if row is not None else None)
        return _Result(row)


def _parse_stmt(stmt):
    """Recover the query intent from a SQLAlchemy select().

    Two shapes are issued by backfill.py:
      - 1 WHERE criterion  -> legacy_firestore_id lookup:
          resolve_legacy_id -> select(Model.id).where(Model.legacy_firestore_id == X)
          _existing         -> select(Model).where(Model.legacy_firestore_id == X)
        Returns ('legacy', model_cls, want_id, legacy_value).
      - >1 WHERE criteria  -> _active_membership:
          select(Membership).where(org_id == X, firebase_uid == Y, status.in_(...))
        Returns ('active', org_id_value, firebase_uid_value).
    """
    crits = list(stmt._where_criteria)
    if len(crits) > 1:
        # criteria order mirrors _active_membership: [org_id==, firebase_uid==, status.in_]
        return ('active', crits[0].right.value, crits[1].right.value)

    crit = crits[0]
    model = crit.left.table  # Table object
    legacy_value = crit.right.value

    # Map the Table back to its ORM model.
    model_cls = {
        Organization.__tablename__: Organization,
        Membership.__tablename__: Membership,
        Class.__tablename__: Class,
        Enrollment.__tablename__: Enrollment,
    }[model.name]

    # Is this select(Model.id) (resolution) or select(Model) (existence)?
    cols = list(stmt.selected_columns)
    want_id = len(cols) == 1 and cols[0].name == 'id'
    return ('legacy', model_cls, want_id, legacy_value)


# --- Fixture builders --------------------------------------------------------

def _org_doc(**o):
    base = {'id': 'org1', 'name': 'Springfield High'}
    base.update(o)
    return base


def _membership_doc(**o):
    base = {'id': 'org1_userA', 'org_id': 'org1', 'uid': 'userA', 'roles': ['teacher']}
    base.update(o)
    return base


def _class_doc(**o):
    base = {'id': 'class1', 'org_id': 'org1', 'name': 'Spanish I'}
    base.update(o)
    return base


def _enrollment_doc(**o):
    base = {'id': 'class1_studentA', 'class_id': 'class1', 'student_uid': 'studentA'}
    base.update(o)
    return base


class TestOrganizationUpsert(unittest.TestCase):
    def test_renames_and_status_remap(self):
        s = _FakeSession()
        row = backfill.upsert_organization(
            s,
            _org_doc(
                status='inactive',  # legacy -> archived
                suspended_by_uid='adminX',
                restored_by_uid='adminY',
            ),
        )
        self.assertEqual(row.status, 'archived')
        # Renamed columns carry the Firestore values.
        self.assertEqual(row.suspended_by_firebase_uid, 'adminX')
        self.assertEqual(row.restored_by_firebase_uid, 'adminY')
        self.assertEqual(row.legacy_firestore_id, 'org1')
        self.assertEqual(s.flushes, 1)
        self.assertIn(row, s.added)

    def test_school_admin_uids_is_not_mapped(self):
        s = _FakeSession()
        row = backfill.upsert_organization(s, _org_doc(school_admin_uids=['a', 'b']))
        self.assertFalse(hasattr(row, 'school_admin_uids'))

    def test_name_lower_recomputed_when_missing(self):
        s = _FakeSession()
        row = backfill.upsert_organization(s, _org_doc(name='Big School', name_lower=None))
        self.assertEqual(row.name_lower, 'big school')

    def test_idempotent_updates_in_place(self):
        s = _FakeSession()
        first = backfill.upsert_organization(s, _org_doc(name='Old'))
        second = backfill.upsert_organization(s, _org_doc(name='New'))
        self.assertIs(first, second)  # same row updated, not a new insert
        self.assertEqual(second.name, 'New')
        self.assertEqual(len(s.added), 1)


class TestMembershipUpsert(unittest.TestCase):
    def _session_with_org(self):
        s = _FakeSession()
        backfill.upsert_organization(s, _org_doc())
        return s

    def test_renames_and_org_resolution(self):
        s = self._session_with_org()
        org_uuid = s.store[(Organization, 'org1')].id
        row = backfill.upsert_membership(
            s, _membership_doc(uid='userA', removed_by_uid='adminZ')
        )
        self.assertEqual(row.firebase_uid, 'userA')
        self.assertEqual(row.removed_by_firebase_uid, 'adminZ')
        self.assertEqual(row.org_id, org_uuid)  # resolved to parent UUID

    def test_primary_class_ids_deferred_to_empty(self):
        s = self._session_with_org()
        row = backfill.upsert_membership(
            s, _membership_doc(primary_class_ids=['class1', 'class2'])
        )
        self.assertEqual(row.primary_class_ids, [])

    def test_unresolved_org_raises(self):
        s = _FakeSession()  # no org backfilled
        with self.assertRaises(backfill.UnresolvedParentError):
            backfill.upsert_membership(s, _membership_doc(org_id='ghost'))


class TestClassUpsert(unittest.TestCase):
    def test_resolves_org_and_defaults_locale(self):
        s = _FakeSession()
        backfill.upsert_organization(s, _org_doc())
        org_uuid = s.store[(Organization, 'org1')].id
        row = backfill.upsert_class(s, _class_doc())
        self.assertEqual(row.org_id, org_uuid)
        self.assertEqual(row.learning_locale, 'ko-KR')

    def test_unresolved_org_raises(self):
        s = _FakeSession()
        with self.assertRaises(backfill.UnresolvedParentError):
            backfill.upsert_class(s, _class_doc(org_id='ghost'))


class TestEnrollmentUpsert(unittest.TestCase):
    def _session_with_class(self):
        s = _FakeSession()
        backfill.upsert_organization(s, _org_doc())
        backfill.upsert_class(s, _class_doc())
        return s

    def test_student_uid_renamed_not_resolved(self):
        s = self._session_with_class()
        row = backfill.upsert_enrollment(s, _enrollment_doc(student_uid='studentA'))
        # Renamed verbatim — a Firebase UID, never resolved to a UUID.
        self.assertEqual(row.student_firebase_uid, 'studentA')

    def test_status_and_join_source_remapped(self):
        s = self._session_with_class()
        row = backfill.upsert_enrollment(
            s, _enrollment_doc(status='pending_sync', join_source='canvas')
        )
        self.assertEqual(row.status, 'inactive')
        self.assertEqual(row.join_source, 'canvas_legacy')

    def test_class_resolved_to_uuid(self):
        s = self._session_with_class()
        class_uuid = s.store[(Class, 'class1')].id
        row = backfill.upsert_enrollment(s, _enrollment_doc())
        self.assertEqual(row.class_id, class_uuid)

    def test_membership_resolved_only_when_present(self):
        s = self._session_with_class()
        backfill.upsert_membership(s, _membership_doc())
        membership_uuid = s.store[(Membership, 'org1_userA')].id

        # Present -> resolved.
        row = backfill.upsert_enrollment(
            s, _enrollment_doc(student_membership_id='org1_userA')
        )
        self.assertEqual(row.student_membership_id, membership_uuid)

        # Absent -> None (optional nullable FK).
        row2 = backfill.upsert_enrollment(s, _enrollment_doc(id='class1_studentB'))
        self.assertIsNone(row2.student_membership_id)

    def test_unresolved_class_raises(self):
        s = _FakeSession()
        backfill.upsert_organization(s, _org_doc())
        with self.assertRaises(backfill.UnresolvedParentError):
            backfill.upsert_enrollment(s, _enrollment_doc(class_id='ghost'))


class TestRunBackfillOrchestration(unittest.TestCase):
    def test_parent_first_full_chain(self):
        s = _FakeSession()
        stats = backfill.run_backfill(
            s,
            organizations=[_org_doc()],
            memberships=[_membership_doc()],
            classes=[_class_doc()],
            enrollments=[_enrollment_doc(status='pending_sync', join_source='canvas')],
        )
        for entity in ('organizations', 'memberships', 'classes', 'enrollments'):
            self.assertEqual(stats[entity]['inserted'], 1, entity)
            self.assertEqual(stats[entity]['errors'], [], entity)
        # Remaps survived the full chain.
        enrollment = s.store[(Enrollment, 'class1_studentA')]
        self.assertEqual(enrollment.status, 'inactive')
        self.assertEqual(enrollment.join_source, 'canvas_legacy')

    def test_enrollment_before_class_would_fail_proves_order_matters(self):
        # Sanity: feeding ONLY an enrollment (no parents) errors — confirms the
        # chain genuinely depends on parents being processed first.
        s = _FakeSession()
        stats = backfill.run_backfill(s, enrollments=[_enrollment_doc()])
        self.assertEqual(stats['enrollments']['inserted'], 0)
        self.assertEqual(len(stats['enrollments']['errors']), 1)

    def test_second_run_reports_updates_not_inserts(self):
        s = _FakeSession()
        kwargs = dict(
            organizations=[_org_doc()],
            memberships=[_membership_doc()],
            classes=[_class_doc()],
            enrollments=[_enrollment_doc()],
        )
        backfill.run_backfill(s, **kwargs)
        stats = backfill.run_backfill(s, **kwargs)
        for entity in ('organizations', 'memberships', 'classes', 'enrollments'):
            self.assertEqual(stats[entity]['updated'], 1, entity)
            self.assertEqual(stats[entity]['inserted'], 0, entity)
        # No new ORM rows added on the second run — updates happened in place.
        self.assertEqual(len(s.added), 4)

    def test_per_row_error_does_not_abort_entity(self):
        s = _FakeSession()
        backfill.upsert_organization(s, _org_doc())
        # One resolvable class, one with a ghost org.
        stats = backfill.run_backfill(
            s,
            classes=[_class_doc(id='good', org_id='org1'), _class_doc(id='bad', org_id='ghost')],
        )
        self.assertEqual(stats['classes']['inserted'], 1)
        self.assertEqual(len(stats['classes']['errors']), 1)
        self.assertEqual(stats['classes']['errors'][0]['id'], 'bad')

    def test_missing_firestore_id_is_rejected_not_inserted(self):
        # C1: a doc with no 'id' must be an error, never a NULL-keyed insert.
        s = _FakeSession()
        stats = backfill.run_backfill(s, organizations=[_org_doc(id=None)])
        self.assertEqual(stats['organizations']['inserted'], 0)
        self.assertEqual(len(stats['organizations']['errors']), 1)
        self.assertEqual(s.added, [])

    def test_unresolved_membership_fk_recorded_as_warning(self):
        # H1: present-but-unresolved student_membership_id -> NULL FK + a warning
        # (vs a genuinely absent membership, which is silent).
        s = _FakeSession()
        backfill.upsert_organization(s, _org_doc())
        backfill.upsert_class(s, _class_doc())
        stats = backfill.run_backfill(
            s, enrollments=[_enrollment_doc(student_membership_id='ghost_member')]
        )
        self.assertEqual(stats['enrollments']['inserted'], 1)
        self.assertEqual(stats['enrollments']['errors'], [])
        self.assertEqual(len(stats['enrollments']['warnings']), 1)
        self.assertIn('ghost_member', stats['enrollments']['warnings'][0]['warning'])


class TestDryRun(unittest.TestCase):
    def test_dry_run_performs_no_writes(self):
        s = _FakeSession()
        stats = backfill.run_backfill(
            s,
            organizations=[_org_doc()],
            memberships=[_membership_doc()],
            classes=[_class_doc()],
            enrollments=[_enrollment_doc()],
            dry_run=True,
        )
        # No rows added, no flushes — caller rolls back.
        self.assertEqual(s.added, [])
        self.assertEqual(s.flushes, 0)
        # But it still counts would-be inserts.
        self.assertEqual(stats['organizations']['inserted'], 1)

    def test_dry_run_reports_unresolved_parents_as_errors(self):
        # No parents written; in a dry run every child is unresolved.
        s = _FakeSession()
        stats = backfill.run_backfill(
            s,
            memberships=[_membership_doc()],
            enrollments=[_enrollment_doc()],
            dry_run=True,
        )
        self.assertEqual(len(stats['memberships']['errors']), 1)
        self.assertEqual(len(stats['enrollments']['errors']), 1)
        self.assertEqual(s.added, [])

    def test_dry_run_flags_would_be_null_membership_fk(self):
        # H2: the dry pass must surface the same silent NULL-FK downgrade the real
        # run would do, so the operator's pre-flight is not blind to it.
        s = _FakeSession()
        backfill.upsert_organization(s, _org_doc())
        backfill.upsert_class(s, _class_doc())
        added_before = len(s.added)
        stats = backfill.run_backfill(
            s,
            enrollments=[_enrollment_doc(student_membership_id='ghost_member')],
            dry_run=True,
        )
        self.assertEqual(stats['enrollments']['inserted'], 1)  # would-be insert
        self.assertEqual(len(stats['enrollments']['warnings']), 1)
        self.assertEqual(len(s.added), added_before)  # dry run wrote nothing


class TestSummarizeStats(unittest.TestCase):
    def test_compacts_counts_and_flattens_errors(self):
        stats = {
            'organizations': {'inserted': 2, 'updated': 1, 'skipped': 0, 'errors': [], 'warnings': []},
            'enrollments': {
                'inserted': 1,
                'updated': 0,
                'skipped': 0,
                'errors': [{'id': 'c_x', 'error': 'boom'}],
                'warnings': [{'id': 'c_y', 'warning': 'fk null'}],
            },
        }
        counts, error_summary = backfill._summarize_stats(stats)
        self.assertEqual(counts['organizations'], {
            'inserted': 2, 'updated': 1, 'skipped': 0, 'errors': 0, 'warnings': 0,
        })
        self.assertEqual(counts['enrollments']['errors'], 1)
        self.assertEqual(counts['enrollments']['warnings'], 1)
        self.assertEqual(len(error_summary), 1)
        self.assertIn('boom', error_summary[0])
        self.assertIn('enrollments', error_summary[0])


class TestMultiRoleMembershipMerge(unittest.TestCase):
    """A user with several roles in one org is stored in Firestore as separate
    single-role membership docs (different write paths, different doc-ids). PG
    models one membership per (org,uid) with a roles[] array + a partial-unique
    index over active/invited, so the upsert UNIONs roles into the existing active
    row instead of inserting a colliding one. See backfill._merge_roles."""

    def _seed_org(self):
        s = _FakeSession()
        backfill.upsert_organization(s, _org_doc())
        return s

    def test_union_helper_dedupes_preserving_order(self):
        self.assertEqual(backfill._merge_roles(['teacher'], ['student']), ['teacher', 'student'])
        self.assertEqual(backfill._merge_roles(['student'], ['student']), ['student'])
        self.assertEqual(backfill._merge_roles([], ['teacher']), ['teacher'])
        self.assertEqual(backfill._merge_roles(['a', 'b'], ['b', 'c']), ['a', 'b', 'c'])

    def test_second_active_doc_merges_roles_into_sibling(self):
        s = self._seed_org()
        warns: list = []
        first = backfill.upsert_membership(
            s, _membership_doc(id='m_teacher', uid='u1', roles=['teacher'], status='active'),
            warnings=warns,
        )
        second = backfill.upsert_membership(
            s, _membership_doc(id='m_student', uid='u1', roles=['student'], status='active'),
            warnings=warns,
        )
        # Same row returned; no second Membership added; roles unioned.
        self.assertIs(second, first)
        memberships_added = [o for o in s.added if isinstance(o, Membership)]
        self.assertEqual(len(memberships_added), 1)
        self.assertEqual(first.roles, ['teacher', 'student'])
        self.assertEqual(first.legacy_firestore_id, 'm_teacher')
        self.assertEqual(len(warns), 1)
        self.assertIn('merged roles', warns[0]['warning'])
        self.assertEqual(warns[0]['id'], 'm_student')

    def test_merge_is_order_independent(self):
        # student-first then teacher yields the same union as the reverse.
        s = self._seed_org()
        backfill.upsert_membership(s, _membership_doc(id='m_s', uid='u1', roles=['student'], status='active'))
        row = backfill.upsert_membership(s, _membership_doc(id='m_t', uid='u1', roles=['teacher'], status='active'))
        self.assertEqual(set(row.roles), {'student', 'teacher'})
        self.assertEqual(len([o for o in s.added if isinstance(o, Membership)]), 1)

    def test_rerun_unions_not_clobbers(self):
        # Re-running both docs (in either order) must not drop a merged role.
        s = self._seed_org()
        d_t = _membership_doc(id='m_t', uid='u1', roles=['teacher'], status='active')
        d_s = _membership_doc(id='m_s', uid='u1', roles=['student'], status='active')
        backfill.upsert_membership(s, d_t)
        backfill.upsert_membership(s, d_s)
        # Re-run primary doc first (its legacy-id UPDATE branch must union, not overwrite).
        row = backfill.upsert_membership(s, d_t)
        backfill.upsert_membership(s, d_s)
        self.assertEqual(set(row.roles), {'teacher', 'student'})
        self.assertEqual(len([o for o in s.added if isinstance(o, Membership)]), 1)

    def test_removed_doc_does_not_merge_into_active(self):
        # A removed doc is outside the partial-unique index, so it inserts as its
        # own row rather than merging into the active sibling.
        s = self._seed_org()
        backfill.upsert_membership(s, _membership_doc(id='m_active', uid='u1', roles=['student'], status='active'))
        backfill.upsert_membership(s, _membership_doc(id='m_removed', uid='u1', roles=['teacher'], status='removed'))
        self.assertEqual(len([o for o in s.added if isinstance(o, Membership)]), 2)

    def test_run_backfill_counts_merge_as_update_with_warning(self):
        s = _FakeSession()
        stats = backfill.run_backfill(
            s,
            organizations=[_org_doc()],
            memberships=[
                _membership_doc(id='m_t', uid='u1', roles=['teacher'], status='active'),
                _membership_doc(id='m_s', uid='u1', roles=['student'], status='active'),
            ],
        )
        ms = stats['memberships']
        self.assertEqual(ms['inserted'], 1)
        self.assertEqual(ms['updated'], 1)  # the merge, not a phantom insert
        self.assertEqual(ms['errors'], [])
        self.assertEqual(len(ms['warnings']), 1)

    def test_dry_run_predicts_merge_as_update(self):
        s = _FakeSession()
        stats = backfill.run_backfill(
            s,
            organizations=[_org_doc()],
            memberships=[
                _membership_doc(id='m_t', uid='u1', roles=['teacher'], status='active'),
                _membership_doc(id='m_s', uid='u1', roles=['student'], status='active'),
            ],
            dry_run=True,
        )
        ms = stats['memberships']
        self.assertEqual(ms['inserted'], 1)
        self.assertEqual(ms['updated'], 1)
        self.assertEqual(len(ms['warnings']), 1)
        # Dry run writes nothing.
        self.assertEqual([o for o in s.added if isinstance(o, Membership)], [])


if __name__ == '__main__':
    unittest.main()
