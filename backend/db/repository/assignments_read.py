"""Assignments read adapter (Postgres -> Firestore-shaped dicts).

Slice A of the analytics-family read cutover (ANALYTICS_MIGRATION.md). Routes the
two assignment readers the dual-write + backfill now support:
  get_assignment(id)                       -> raw assignment doc shape (+ id)
  list_class_assignments(class_id, status) -> a class's assignments (status-filtered)

Session-injected; the `ReadRouter` owns the Session lifecycle + flag gating.

FK inversions (the read-side dual of the §3.8a writes — emit the parent's Firestore
doc id, NEVER the PG UUID, so downstream id comparisons hold):
  org_id   -> organizations.legacy_firestore_id  (JOIN)
  class_id -> classes.legacy_firestore_id        (JOIN) — the assignment_resolver +
              practice routes compare class_id to a Firestore id.
Field rename back to the Firestore key: created_by_firebase_uid -> created_by_uid.

These readers only use the parent rows for their stable `legacy_firestore_id`
(store-invariant), not to serve class/org ENTITY data — so the router gates them on
READ_PG_ASSIGNMENTS alone (no cross-family `also`), unlike list_student_classes.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from backend.db.models.assignment import Assignment
from backend.db.models.org import Class, Organization


def _iso_or_empty(value) -> str:
    """release_at/due_at match the Firestore stored SHAPE: an ISO string when set,
    '' when unset (Firestore's create default). Emitting a raw datetime here would
    make serialize_assignment pass it through unconverted, so the flag=1 API would
    render RFC-1123 instead of the ISO string the SPA already receives."""
    return value.isoformat() if value is not None else ''


def _serialize_assignment(row: Assignment, org_legacy_id, class_legacy_id) -> dict[str, Any]:
    """Render an Assignment row as the Firestore `get_assignment` doc shape."""
    return {
        'id': row.legacy_firestore_id or str(row.id),
        'org_id': org_legacy_id,              # FK legacy id, not UUID
        'class_id': class_legacy_id,          # FK legacy id, not UUID
        'title': row.title,
        'description': row.description,
        'status': row.status,
        'release_at': _iso_or_empty(row.release_at),
        'due_at': _iso_or_empty(row.due_at),
        'modality_override': row.modality_override,
        'max_attempts': row.max_attempts,
        'task_type': row.task_type,
        'success_criteria': list(row.success_criteria or []),
        # Renamed back: created_by_firebase_uid -> Firestore created_by_uid.
        'created_by_uid': row.created_by_firebase_uid,
        'canvas_module_item_id': row.canvas_module_item_id or '',  # Firestore stores ''
        'instructions': row.instructions,
        'canvas_module_item_ref': row.canvas_module_item_ref,
        'objectives': list(row.objectives or []),
        'target_expressions': list(row.target_expressions or []),
        'target_vocabulary': list(row.target_vocabulary or []),
        'focus_grammar': list(row.focus_grammar or []),
        'generated_scenario': row.generated_scenario,
        'teacher_notes': row.teacher_notes,
        'student_instructions': row.student_instructions,
        'target_language_intensity': row.target_language_intensity,
        # LTI grade-passback config — read by api_get_grade_config off this dict;
        # MUST be present or the grade-config GET returns null at flag=1.
        'grade_metric': row.grade_metric,
        'grade_points': row.grade_points,
        'created_at': row.created_at,
        'updated_at': row.updated_at,
    }


def get_assignment(session: Any, assignment_id: str) -> dict[str, Any] | None:
    """Point-get one assignment by its Firestore doc id. None if unmigrated/absent."""
    result = session.execute(
        select(
            Assignment,
            Organization.legacy_firestore_id,
            Class.legacy_firestore_id,
        )
        .outerjoin(Organization, Organization.id == Assignment.org_id)
        .outerjoin(Class, Class.id == Assignment.class_id)
        .where(Assignment.legacy_firestore_id == assignment_id)
    ).one_or_none()
    if result is None:
        return None
    row, org_legacy, class_legacy = result
    return _serialize_assignment(row, org_legacy, class_legacy)


def list_class_assignments(
    session: Any, class_id: str, statuses: Any = None
) -> list[dict[str, Any]]:
    """A class's assignments (class_id is a Firestore doc id), optionally filtered to
    `statuses`. Mirrors the Firestore reader, which returns ALL statuses when none is
    given. Ordered by created_at for determinism (the Firestore reader is unordered;
    the shadow diffs by id-set, so order is not compared)."""
    # Match the Firestore reader's _normalize_string_list: a NON-list `statuses`
    # (incl. a bare string) means NO filter — never iterate a string into chars.
    allowed = {s for s in statuses if s} if isinstance(statuses, (list, tuple)) else set()
    stmt = (
        select(
            Assignment,
            Organization.legacy_firestore_id,
            Class.legacy_firestore_id,
        )
        .join(Class, Class.id == Assignment.class_id)
        .outerjoin(Organization, Organization.id == Assignment.org_id)
        .where(Class.legacy_firestore_id == class_id)
    )
    if allowed:
        stmt = stmt.where(Assignment.status.in_(allowed))
    stmt = stmt.order_by(Assignment.created_at)
    return [
        _serialize_assignment(row, org_legacy, class_legacy)
        for row, org_legacy, class_legacy in session.execute(stmt).all()
    ]
