"""Outbox writer for transactional emails.

Business code calls `enqueue_outbox_email(...)` (added in Task 8) to write a
document into `outbox_emails/`. A Cloud Function trigger picks the document
up and sends via Resend (see functions/main.py).

This module is intentionally narrow: render-time logic, retries, and provider
integration live in the Cloud Function, not here.
"""

from __future__ import annotations

import os
import re
from enum import Enum
from typing import Any

from firebase_admin import firestore

OUTBOX_EMAILS_COLLECTION = 'outbox_emails'

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Test-mode safety guard. When `LINGUAL_BLOCK_OUTBOX_WRITES=1` is set in the
# environment, `enqueue_outbox_email` refuses to write to Firestore and raises
# `OutboxBlockedInTestMode`. The submit/approve/reject route handlers already
# wrap each enqueue call in try/except (intentional fan-out resilience), so
# the error is caught and logged — tests still exercise the full route code
# path, but no real outbox doc lands in production Firestore.
#
# Why this is needed: the route handlers call `database.get_db()` directly
# (not via a deps abstraction), so a test that exercises a route with the
# prod service account in scope will write real outbox docs to prod, which
# the deployed Cloud Function will then process and send. This actually
# happened during the Plan 3 ship — see LIMITATIONS #29.
#
# Set automatically in backend/tests/conftest.py so every backend test
# inherits the guard. Production env never has this set.
_OUTBOX_BLOCK_ENV_VAR = 'LINGUAL_BLOCK_OUTBOX_WRITES'


class OutboxBlockedInTestMode(RuntimeError):
    """Raised by enqueue_outbox_email when LINGUAL_BLOCK_OUTBOX_WRITES is set.

    Caught by the route's existing outbox try/except wrappers — propagates as
    a logged warning rather than a 500. Tests can assert on this class to
    verify the guard fired.
    """


class OutboxTemplate(str, Enum):
    # Plan 1: school request → Lingual admin notification
    SCHOOL_REQUEST_TO_LINGUAL = 'school_request_to_lingual'
    # Plan 3: school request decision + admin pre-invite of teachers
    SCHOOL_REQUEST_APPROVED = 'school_request_approved'
    SCHOOL_REQUEST_DECLINED = 'school_request_declined'
    TEACHER_INVITATION = 'teacher_invitation'
    # Plan 4: teacher → school admin join workflow
    TEACHER_JOIN_REQUEST_TO_ADMIN = 'teacher_join_request_to_admin'
    TEACHER_JOIN_APPROVED = 'teacher_join_approved'
    TEACHER_JOIN_DECLINED = 'teacher_join_declined'
    # Plan 5: Lingual-admin org lifecycle (suspend / restore)
    ORG_SUSPENDED = 'org_suspended'
    ORG_RESTORED = 'org_restored'


def enqueue_outbox_email(
    *,
    db: Any,
    recipient_email: str,
    recipient_name: str | None,
    template: OutboxTemplate,
    template_data: dict[str, Any],
    related_entity_type: str | None = None,
    related_entity_id: str | None = None,
    created_by_uid: str | None = None,
    scheduled_for: Any | None = None,
    transaction: Any | None = None,
) -> str:
    """Write a `pending` outbox email document.

    Pass `transaction` to enqueue atomically with other Firestore writes.
    Returns the new document id.
    """
    if os.environ.get(_OUTBOX_BLOCK_ENV_VAR) == '1':
        raise OutboxBlockedInTestMode(
            f'Outbox writes are blocked: {_OUTBOX_BLOCK_ENV_VAR}=1. '
            f'Would have written template={template.value} to {recipient_email!r}.'
        )
    if not _EMAIL_RE.match(recipient_email or ''):
        raise ValueError(f"Invalid recipient_email: {recipient_email!r}")
    if not isinstance(template_data, dict):
        raise ValueError("template_data must be a dict")

    doc_ref = db.collection(OUTBOX_EMAILS_COLLECTION).document()
    payload: dict[str, Any] = {
        'recipient': {'email': recipient_email, 'name': recipient_name},
        'template_id': template.value,
        'template_data': template_data,
        'status': 'pending',
        'scheduled_for': scheduled_for or firestore.SERVER_TIMESTAMP,
        'attempt_count': 0,
        'created_at': firestore.SERVER_TIMESTAMP,
        'created_by_uid': created_by_uid,
    }
    if related_entity_type and related_entity_id:
        payload['related_entity'] = {
            'type': related_entity_type,
            'id': related_entity_id,
        }
    if transaction is not None:
        transaction.set(doc_ref, payload)
    else:
        doc_ref.set(payload)
    return doc_ref.id
