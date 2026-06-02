"""Flag-gated Postgres shadow-write for the ANALYTICS family — Slice A: assignments.

Companion to `dual_write.py` (enrollments) and `dual_write_school_chain.py`
(org/membership/class): the SAME fail-open `_run` contract, gated on its OWN flag
DUAL_WRITE_ASSIGNMENTS. Assignments are the FK PARENT of practice_sessions and
learning_events, so they migrate first (ANALYTICS_MIGRATION.md Slice A); the
session/event shadows land in later slices and will live here too.

Mirror strategy (assignments are LOW-CHURN curriculum docs, not a hot path):
  - CREATE / EDIT reuse the idempotent `backfill.upsert_assignment`. The Firestore
    write is a full `doc_ref.set()` (create, or overwrite when an id is supplied),
    so one idempotent upsert faithfully mirrors both. upsert_assignment resolves
    org_id + class_id -> UUIDs and raises UnresolvedParentError (a quiet
    coexistence no-op, swallowed by `_run`) when a parent is not in Postgres yet.
  - The Canvas link/unlink path touches one PG column (canvas_module_item_id) via a
    TARGETED UPDATE keyed by legacy_firestore_id — never an upsert, which would
    clobber the NOT-NULL content fields with a partial doc.

NOT mirrored: `set_assignment_grade_config` writes grade_metric/grade_points, which
are Firestore-only LTI fields with NO column on the PG Assignment model — out of
scope for this slice (see ANALYTICS_MIGRATION.md §1).

Heavy imports stay lazy inside function bodies; flag-OFF cost is os + logging.
"""

from __future__ import annotations

import datetime
import os
from typing import Any

# Shared, safety-critical infra (one copy of the open-session / SET LOCAL
# statement_timeout / swallow-and-log contract, and the SERVER_TIMESTAMP
# sentinel scrub) — reused exactly as the school-chain shadow reuses it.
from backend.db.dual_write import _run
from backend.db.dual_write_school_chain import _strip_sentinels


def _enabled_assignments() -> bool:
    """Read the flag on EVERY call (not a module constant). OFF unless '1'."""
    return os.environ.get('DUAL_WRITE_ASSIGNMENTS') == '1'


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def shadow_create_assignment(
    sql_engine: Any, *, assignment_id: str, assignment_data: dict[str, Any]
) -> None:
    """Mirror an assignment CREATE/EDIT into Postgres (idempotent upsert).

    `assignment_data` is the same dict the Firestore write used; `assignment_id`
    is the Firestore doc id (becomes legacy_firestore_id). Idempotent by that key,
    so a create and a later full-`set()` edit both converge. upsert_assignment
    resolves org_id + class_id and raises UnresolvedParentError (quiet no-op via
    `_run`) if either parent is not migrated yet.
    """
    if not _enabled_assignments():
        return
    from backend.db.repository import backfill

    doc = {**_strip_sentinels(assignment_data), 'id': assignment_id}

    def op(session: Any) -> None:
        backfill.upsert_assignment(session, doc)

    _run(sql_engine, 'create_assignment', op)


def shadow_update_assignment_canvas_link(
    sql_engine: Any, *, assignment_id: str, canvas_module_item_id: str | None
) -> None:
    """Mirror link/unlink_assignment_to_canvas_item: targeted UPDATE of the
    canvas_module_item_id column ONLY (link sets the item id; unlink clears it to
    '').  Keyed by legacy_firestore_id; no-op when the assignment row is absent.
    Never an upsert — a partial doc would clobber the NOT-NULL content fields."""
    if not _enabled_assignments():
        return
    from sqlalchemy import update

    from backend.db.models.assignment import Assignment

    def op(session: Any) -> None:
        session.execute(
            update(Assignment)
            .where(Assignment.legacy_firestore_id == assignment_id)
            .values(
                # Firestore stores '' on unlink; mirror '' -> NULL on the nullable
                # PG column so the read adapter renders it back as '' consistently.
                canvas_module_item_id=canvas_module_item_id or None,
                updated_at=_utcnow(),
            )
        )

    _run(sql_engine, 'update_assignment_canvas_link', op)


def shadow_set_assignment_grade_config(
    sql_engine: Any, *, assignment_id: str, grade_metric: Any, grade_points: Any
) -> None:
    """Mirror set_assignment_grade_config: targeted UPDATE of the LTI grade fields
    ONLY (so the PG read adapter is a faithful inverse of get_assignment — the
    grade-config GET reads metric/points off that dict). Keyed by
    legacy_firestore_id; no-op when the assignment row is absent. Never an upsert."""
    if not _enabled_assignments():
        return
    from sqlalchemy import update

    from backend.db.models.assignment import Assignment

    def op(session: Any) -> None:
        session.execute(
            update(Assignment)
            .where(Assignment.legacy_firestore_id == assignment_id)
            .values(grade_metric=grade_metric, grade_points=grade_points, updated_at=_utcnow())
        )

    _run(sql_engine, 'set_assignment_grade_config', op)
