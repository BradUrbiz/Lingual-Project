"""Firestore-id -> Postgres-UUID resolution.

The load-bearing helper for the coexistence window (TECH_SPEC 3.8a): every
cross-store foreign reference resolves through the `legacy_firestore_id` unique
index. Pure and session-injected, so it is directly unit-testable.

Returns None when the Firestore id has no migrated row yet. Callers MUST handle
None — backfill must not mint phantom rows (e.g. for status='removed'
memberships referenced by a stale teacher_membership_ids array).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select


def resolve_legacy_id(session: Any, model: Any, firestore_id: str | None) -> uuid.UUID | None:
    """Map a Firestore document id to its Postgres UUID via legacy_firestore_id.

    Args:
        session: a SQLAlchemy Session (injected; mockable in tests).
        model: an ORM model class exposing `id` and `legacy_firestore_id`.
        firestore_id: the Firestore document id (or composite key) to resolve.

    Returns:
        The Postgres UUID, or None if unmapped / falsy input.
    """
    if not firestore_id:
        return None
    stmt = select(model.id).where(model.legacy_firestore_id == firestore_id)
    return session.execute(stmt).scalar_one_or_none()
