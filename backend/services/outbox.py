"""Outbox writer for transactional emails.

Business code calls `enqueue_outbox_email(...)` (added in Task 8) to write a
document into `outbox_emails/`. A Cloud Function trigger picks the document
up and sends via Resend (see functions/main.py).

This module is intentionally narrow: render-time logic, retries, and provider
integration live in the Cloud Function, not here.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any

from firebase_admin import firestore

OUTBOX_EMAILS_COLLECTION = 'outbox_emails'

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class OutboxTemplate(str, Enum):
    SCHOOL_REQUEST_TO_LINGUAL = 'school_request_to_lingual'
    TEACHER_JOIN_REQUEST_TO_ADMIN = 'teacher_join_request_to_admin'
    TEACHER_JOIN_APPROVED = 'teacher_join_approved'
    TEACHER_JOIN_DECLINED = 'teacher_join_declined'


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
