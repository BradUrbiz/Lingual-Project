"""Classes read adapter (Postgres -> Firestore-shaped dicts).

Slice 6 of the read cutover (READ_CUTOVER.md §3.2, §5) — the highest-blast-radius
slice (authz + AI-tutor prompt assembly + compliance-gated practice + student join).
Session-injected; the `ReadRouter` owns the Session lifecycle + flag gating.

Routes the class-entity readers that the now-backfilled junctions support:
  get_class(id)                         -> raw class doc shape (+ id)
  list_org_classes(org_id, status)      -> classes in an org, updated_at DESC
  list_teacher_classes(mem_id, status)  -> classes a teacher membership teaches
  get_class_by_join_code(code)          -> the active-code class (student join)

(`list_student_classes` + `list_org_classes_summary` ride slice 7 — they need the
enrollments JOIN, not yet read-cut.)

FK inversions + junction reconstruction (the read-side dual of the §3.8a writes):
  org_id           -> organizations.legacy_firestore_id   (JOIN; DEFECT D2 — the
                      assignment_resolver authz gate compares it to a Firestore id)
  teacher_membership_ids[] -> [memberships.legacy_firestore_id] via class_teachers
                      (so `active_membership_id in teacher_membership_ids` authz holds)
  join_code/_active/_generated_at -> the MOST-RECENT class_join_codes row. Firestore
                      keeps join_code on the class doc when deactivated (only flips
                      join_code_active), so we surface the latest code regardless of
                      active, with its flag — NOT just the active one. Absent when the
                      class never had a code (matches Firestore omitting the fields).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from backend.db.models.org import (
    Class,
    ClassJoinCode,
    ClassTeacher,
    Membership,
    Organization,
)
from backend.db.repository.resolution import resolve_legacy_id


def _teacher_ids_by_class(session: Any, class_uuids: list) -> dict:
    """class UUID -> sorted list of teacher membership legacy ids (one query).
    Sorted for determinism; order is not semantically meaningful (authz uses `in`)."""
    if not class_uuids:
        return {}
    rows = session.execute(
        select(ClassTeacher.class_id, Membership.legacy_firestore_id)
        .join(Membership, Membership.id == ClassTeacher.membership_id)
        .where(ClassTeacher.class_id.in_(class_uuids))
    ).all()
    out: dict = {}
    for class_id, legacy in rows:
        out.setdefault(class_id, []).append(legacy)
    for ids in out.values():
        ids.sort()
    return out


def _latest_join_code_by_class(session: Any, class_uuids: list) -> dict:
    """class UUID -> (code, active, generated_at) for the most-recent code row.
    DISTINCT ON keeps the current Firestore-denormalized code (active or not)."""
    if not class_uuids:
        return {}
    rows = session.execute(
        select(
            ClassJoinCode.class_id,
            ClassJoinCode.code,
            ClassJoinCode.active,
            ClassJoinCode.generated_at,
        )
        .where(ClassJoinCode.class_id.in_(class_uuids))
        .distinct(ClassJoinCode.class_id)
        .order_by(
            ClassJoinCode.class_id,
            ClassJoinCode.generated_at.desc(),
            ClassJoinCode.created_at.desc(),
        )
    ).all()
    return {class_id: (code, active, gen) for class_id, code, active, gen in rows}


def _serialize_class(row: Class, org_legacy_id, teacher_ids: list, jc) -> dict[str, Any]:
    """Render a Class row (+ its junctions) as the Firestore `get_class` doc shape."""
    out: dict[str, Any] = {
        'id': row.legacy_firestore_id or str(row.id),
        'org_id': org_legacy_id,                      # DEFECT D2: legacy id, not UUID
        'name': row.name,
        'term': row.term,
        'subject': row.subject,
        'learning_locale': row.learning_locale,
        'teacher_membership_ids': teacher_ids,
        'grade_band': row.grade_band,
        'status': row.status,
        'canvas_course_id': row.canvas_course_id,
        'created_at': row.created_at,
        'updated_at': row.updated_at,
    }
    if jc is not None:
        code, active, generated_at = jc
        out['join_code'] = code
        out['join_code_active'] = bool(active)
        out['join_code_generated_at'] = generated_at
    return out


def _hydrate(session: Any, rows: list) -> list[dict[str, Any]]:
    """Serialize (Class, org_legacy) rows, batching the junction lookups."""
    class_uuids = [c.id for c, _ in rows]
    teachers = _teacher_ids_by_class(session, class_uuids)
    codes = _latest_join_code_by_class(session, class_uuids)
    return [
        _serialize_class(c, org_legacy, teachers.get(c.id, []), codes.get(c.id))
        for c, org_legacy in rows
    ]


def get_class(session: Any, class_id: str) -> dict[str, Any] | None:
    """Point-get one class by its Firestore doc id. None if unmigrated/absent."""
    result = session.execute(
        select(Class, Organization.legacy_firestore_id)
        .outerjoin(Organization, Organization.id == Class.org_id)
        .where(Class.legacy_firestore_id == class_id)
    ).one_or_none()
    if result is None:
        return None
    return _hydrate(session, [result])[0]


def list_org_classes(session: Any, org_id: str, status: str = 'active') -> list[dict[str, Any]]:
    """Classes for an org (org_id is a Firestore id), updated_at DESC, status-filtered."""
    stmt = (
        select(Class, Organization.legacy_firestore_id)
        .join(Organization, Organization.id == Class.org_id)
        .where(Organization.legacy_firestore_id == org_id)
    )
    if status:
        stmt = stmt.where(Class.status == status)
    stmt = stmt.order_by(Class.updated_at.desc())
    return _hydrate(session, session.execute(stmt).all())


def list_teacher_classes(session: Any, membership_id: str, status: str = 'active') -> list[dict[str, Any]]:
    """Classes a teacher membership teaches (via class_teachers), updated_at DESC."""
    muuid = resolve_legacy_id(session, Membership, membership_id)
    if muuid is None:
        return []
    stmt = (
        select(Class, Organization.legacy_firestore_id)
        .join(ClassTeacher, ClassTeacher.class_id == Class.id)
        .outerjoin(Organization, Organization.id == Class.org_id)
        .where(ClassTeacher.membership_id == muuid)
    )
    if status:
        stmt = stmt.where(Class.status == status)
    stmt = stmt.order_by(Class.updated_at.desc())
    return _hydrate(session, session.execute(stmt).all())


def get_class_by_join_code(session: Any, code: str) -> dict[str, Any] | None:
    """The single active class whose ACTIVE join code matches (student join lookup).
    Mirrors the Firestore filter: join_code == code AND join_code_active AND
    status == 'active'."""
    result = session.execute(
        select(Class, Organization.legacy_firestore_id)
        .join(ClassJoinCode, ClassJoinCode.class_id == Class.id)
        .outerjoin(Organization, Organization.id == Class.org_id)
        .where(
            ClassJoinCode.code == code,
            ClassJoinCode.active.is_(True),
            Class.status == 'active',
        )
        .limit(1)
    ).first()
    if result is None:
        return None
    return _hydrate(session, [result])[0]
