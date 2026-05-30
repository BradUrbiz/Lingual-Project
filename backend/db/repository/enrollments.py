"""Enrollment repository — the first Postgres twin (INERT in this increment).

Enrollments are the lowest-blast-radius first cutover candidate: the
deterministic Firestore composite key `{class_id}_{student_uid}` maps to a
Postgres unique key, the student reference is a Firebase UID (stable across
both stores, no resolution needed), and the row has no ref-leak or sentinel
coupling.

These functions operate in Postgres-native terms: `class_id` is the resolved
Postgres UUID and `student_uid` is the Firebase UID. They serialize rows back
into the Firestore-shaped dicts that routes already consume (note the
`student_firebase_uid` -> `student_uid` rename), so the eventual `deps.db`
adapter is a thin pass-through. The adapter (a cutover-increment concern)
resolves Firestore string `class_id`s to UUIDs via
`resolution.resolve_legacy_id` and owns the Session lifecycle.

Nothing here is wired into a route yet.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select

from backend.db.models.org import Enrollment

# Firestore-shaped keys, in the order routes expect them.
_RENAME = {'student_firebase_uid': 'student_uid'}


def _serialize(row: Enrollment) -> dict[str, Any]:
    """Render an Enrollment row as the Firestore-shaped dict routes consume.

    `id` is the composite Firestore key when known (legacy_firestore_id), else
    the Postgres UUID as a string, preserving the `{class_id}_{student_uid}`
    addressing routes rely on during coexistence.
    """
    return {
        'id': row.legacy_firestore_id or str(row.id),
        'class_id': str(row.class_id),
        'student_uid': row.student_firebase_uid,
        'student_membership_id': (
            str(row.student_membership_id) if row.student_membership_id else None
        ),
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


def get_student_class_enrollment(
    session: Any, class_id: uuid.UUID, student_uid: str
) -> dict[str, Any] | None:
    """Return the (class, student) enrollment as a Firestore-shaped dict, or None."""
    stmt = select(Enrollment).where(
        Enrollment.class_id == class_id,
        Enrollment.student_firebase_uid == student_uid,
    )
    row = session.execute(stmt).scalar_one_or_none()
    return _serialize(row) if row is not None else None


def list_class_enrollments(
    session: Any, class_id: uuid.UUID, status: str | None = 'active'
) -> list[dict[str, Any]]:
    """List a class's enrollments (newest first), Firestore-shaped."""
    stmt = select(Enrollment).where(Enrollment.class_id == class_id)
    if status:
        stmt = stmt.where(Enrollment.status == status)
    stmt = stmt.order_by(Enrollment.updated_at.desc())
    return [_serialize(r) for r in session.execute(stmt).scalars().all()]


def list_student_enrollments(
    session: Any, student_uid: str, status: str | None = 'active'
) -> list[dict[str, Any]]:
    """List a student's enrollments (newest first), Firestore-shaped."""
    stmt = select(Enrollment).where(Enrollment.student_firebase_uid == student_uid)
    if status:
        stmt = stmt.where(Enrollment.status == status)
    stmt = stmt.order_by(Enrollment.updated_at.desc())
    return [_serialize(r) for r in session.execute(stmt).scalars().all()]


def _set_status(session: Any, class_id: uuid.UUID, student_uid: str, status: str) -> None:
    stmt = select(Enrollment).where(
        Enrollment.class_id == class_id,
        Enrollment.student_firebase_uid == student_uid,
    )
    row = session.execute(stmt).scalar_one_or_none()
    if row is not None:
        row.status = status
        session.flush()


def deactivate_enrollment(session: Any, class_id: uuid.UUID, student_uid: str) -> None:
    """Soft-delete: set status to 'inactive'."""
    _set_status(session, class_id, student_uid, 'inactive')


def reactivate_enrollment(session: Any, class_id: uuid.UUID, student_uid: str) -> None:
    """Reactivate a previously deactivated enrollment."""
    _set_status(session, class_id, student_uid, 'active')
