"""Enrollment repository — the first Postgres twin (INERT in this increment).

Enrollments are the lowest-blast-radius first cutover candidate: the
deterministic Firestore composite key `{class_id}_{student_uid}` maps to a
Postgres unique key, the student reference is a Firebase UID (stable across
both stores, no resolution needed), and the row has no ref-leak or sentinel
coupling.

These functions take Postgres-native INPUTS — `class_id` is the resolved
Postgres UUID, `student_uid` is the Firebase UID (the router resolves the
Firestore string `class_id` -> UUID via `resolution.resolve_legacy_id` before
calling, and owns the Session lifecycle). But the serialized OUTPUT is
Firestore-shaped: foreign keys (`class_id`, `student_membership_id`) are
emitted as the PARENT's `legacy_firestore_id` (its Firestore doc id), resolved
by JOIN in the read queries — NOT the Postgres UUID. This is the read-side
serializer invariant (READ_CUTOVER.md §3.0): a caller that does
`get_class(enrollment['class_id'])` must receive a Firestore class id, or the
lookup silently misses. Emitting `str(row.class_id)` (the UUID) was the
original twin's bug (defect D1).

Nothing here is wired into a route yet.
"""

from __future__ import annotations

import datetime
import uuid
from typing import Any

from sqlalchemy import func, select

from backend.db.models.org import Class, Enrollment, Membership, Organization
from backend.db.repository.resolution import resolve_legacy_id


def _utcnow() -> datetime.datetime:
    """Timezone-aware now() for explicit updated_at bumps (no onupdate trigger)."""
    return datetime.datetime.now(datetime.timezone.utc)


def _serialize(
    row: Enrollment,
    class_legacy_id: str | None,
    membership_legacy_id: str | None,
) -> dict[str, Any]:
    """Render an Enrollment row as the Firestore-shaped dict routes consume.

    `id` is the composite Firestore key when known (legacy_firestore_id), else
    the Postgres UUID as a string, preserving the `{class_id}_{student_uid}`
    addressing routes rely on during coexistence.

    `class_legacy_id` / `membership_legacy_id` are the parents'
    `legacy_firestore_id`s (their Firestore doc ids), supplied by the JOIN in
    the read queries. Foreign keys are emitted as these Firestore ids — never
    the Postgres UUID — so `get_class(enrollment['class_id'])` keeps resolving
    (READ_CUTOVER.md §3.0 / defect D1). `class_id` falls back to the stringified
    UUID only if a class somehow lacks a legacy id (never in coexistence);
    `student_membership_id` stays None when the FK is NULL, matching Firestore.
    """
    return {
        'id': row.legacy_firestore_id or str(row.id),
        'class_id': class_legacy_id or str(row.class_id),
        'student_uid': row.student_firebase_uid,
        'student_membership_id': membership_legacy_id,
        'status': row.status,
        'join_source': row.join_source,
        'student_number': row.student_number or '',
        'guardian_contact_required': bool(row.guardian_contact_required),
        'canvas_user_id': row.canvas_user_id or '',
        'canvas_email': row.canvas_email or '',
        'canvas_name': row.canvas_name or '',
        # Mirror the Firestore doc shape: routes read created_at for the roster
        # 'enrolledAt' (teacher.py:793). The cutover adapter is responsible for
        # any datetime->ISO coercion the route's _timestamp_to_iso expects.
        'created_at': row.created_at,
        'updated_at': row.updated_at,
    }


def create_enrollment(
    session: Any,
    class_id: uuid.UUID,
    student_uid: str,
    *,
    student_membership_id: uuid.UUID | None = None,
    status: str = 'active',
    join_source: str = 'manual',
    student_number: str = '',
    guardian_contact_required: bool = False,
    legacy_firestore_id: str | None = None,
    canvas_user_id: str = '',
    canvas_email: str = '',
    canvas_name: str = '',
) -> Enrollment:
    """Insert an enrollment. legacy_firestore_id preserves the Firestore
    composite key `{class_id}_{student_uid}` for traceability during cutover."""
    row = Enrollment(
        class_id=class_id,
        student_firebase_uid=student_uid,
        student_membership_id=student_membership_id,
        status=status,
        join_source=join_source,
        student_number=student_number,
        guardian_contact_required=guardian_contact_required,
        legacy_firestore_id=legacy_firestore_id,
        canvas_user_id=canvas_user_id,
        canvas_email=canvas_email,
        canvas_name=canvas_name,
    )
    session.add(row)
    session.flush()
    return row


def _joined_select():
    """SELECT an enrollment alongside its parents' Firestore doc ids.

    The serializer must emit `class_id`/`student_membership_id` as the parents'
    `legacy_firestore_id` (READ_CUTOVER.md §3.0), and no ORM relationship /
    reverse-id helper exists — so the FK translation is a JOIN here, resolved
    once per query (no per-row lookup). LEFT JOINs so a row is never dropped:
    the enrollment->class FK is NOT NULL (CASCADE) so that side always matches;
    student_membership_id is nullable, so its join may yield None.
    """
    return (
        select(
            Enrollment,
            Class.legacy_firestore_id,
            Membership.legacy_firestore_id,
        )
        .outerjoin(Class, Class.id == Enrollment.class_id)
        .outerjoin(Membership, Membership.id == Enrollment.student_membership_id)
    )


def get_student_class_enrollment(
    session: Any, class_id: uuid.UUID, student_uid: str
) -> dict[str, Any] | None:
    """Return the (class, student) enrollment as a Firestore-shaped dict, or None."""
    stmt = _joined_select().where(
        Enrollment.class_id == class_id,
        Enrollment.student_firebase_uid == student_uid,
    )
    result = session.execute(stmt).one_or_none()
    return _serialize(*result) if result is not None else None


def list_class_enrollments(
    session: Any, class_id: uuid.UUID, status: str | None = 'active'
) -> list[dict[str, Any]]:
    """List a class's enrollments (newest first), Firestore-shaped."""
    stmt = _joined_select().where(Enrollment.class_id == class_id)
    if status:
        stmt = stmt.where(Enrollment.status == status)
    stmt = stmt.order_by(Enrollment.updated_at.desc())
    return [_serialize(*r) for r in session.execute(stmt).all()]


def list_student_enrollments(
    session: Any, student_uid: str, status: str | None = 'active'
) -> list[dict[str, Any]]:
    """List a student's enrollments (newest first), Firestore-shaped."""
    stmt = _joined_select().where(Enrollment.student_firebase_uid == student_uid)
    if status:
        stmt = stmt.where(Enrollment.status == status)
    stmt = stmt.order_by(Enrollment.updated_at.desc())
    return [_serialize(*r) for r in session.execute(stmt).all()]


def count_org_students(session: Any, org_id: str) -> int:
    """Active-student count for an org, as a single COUNT JOIN.

    `org_id` is the org's Firestore doc id (the router passes the route's
    Firestore string; resolution happens here). Counts ACTIVE enrollments across
    ALL of the org's classes with NO class-status filter — mirroring the
    Firestore aggregate (`count_org_students`), which gathers every class id for
    the org (active or not) and counts active enrollments in them. Filtering on
    class status here would silently drop students of archived classes and drift
    the org dashboard count. Returns 0 when the org is unmigrated or class-less.
    The N+1 / 30-item ``in``-chunk dance the Firestore version needs collapses to
    one indexed JOIN here (the motivating relational win, TECH_SPEC §1)."""
    org_uuid = resolve_legacy_id(session, Organization, org_id)
    if org_uuid is None:
        return 0
    stmt = (
        select(func.count())
        .select_from(Enrollment)
        .join(Class, Class.id == Enrollment.class_id)
        .where(Class.org_id == org_uuid, Enrollment.status == 'active')
    )
    return session.execute(stmt).scalar_one() or 0


def _set_status(session: Any, class_id: uuid.UUID, student_uid: str, status: str) -> None:
    stmt = select(Enrollment).where(
        Enrollment.class_id == class_id,
        Enrollment.student_firebase_uid == student_uid,
    )
    row = session.execute(stmt).scalar_one_or_none()
    if row is not None:
        row.status = status
        # updated_at has a server_default but NO onupdate trigger (see base.py),
        # so a status change must bump it explicitly or the roster's newest-first
        # ordering and parity field-checks would see a stale timestamp.
        row.updated_at = _utcnow()
        session.flush()


def deactivate_enrollment(session: Any, class_id: uuid.UUID, student_uid: str) -> None:
    """Soft-delete: set status to 'inactive'."""
    _set_status(session, class_id, student_uid, 'inactive')


def reactivate_enrollment(session: Any, class_id: uuid.UUID, student_uid: str) -> None:
    """Reactivate a previously deactivated enrollment."""
    _set_status(session, class_id, student_uid, 'active')


def lti_reactivate_enrollment(
    session: Any,
    class_id: uuid.UUID,
    student_uid: str,
    *,
    student_membership_id: uuid.UUID | None = None,
) -> None:
    """Reactivate AND stamp the LTI-specific fields the LTI launch path writes.

    The plain `reactivate_enrollment` only flips status. The LTI reactivation
    path (services/lti/identity.py) additionally rewrites join_source='lti' and
    the resolved student_membership_id, so its Postgres shadow must mirror all
    three. No-op when the (class, student) row is not present in Postgres yet.
    """
    stmt = select(Enrollment).where(
        Enrollment.class_id == class_id,
        Enrollment.student_firebase_uid == student_uid,
    )
    row = session.execute(stmt).scalar_one_or_none()
    if row is not None:
        row.status = 'active'
        row.join_source = 'lti'
        row.student_membership_id = student_membership_id
        row.updated_at = _utcnow()
        session.flush()
