"""Outbox writer for transactional emails.

Business code calls `enqueue_outbox_email(...)` (added in Task 8) to write a
document into `outbox_emails/`. A Cloud Function trigger picks the document
up and sends via Resend (see functions/main.py).

This module is intentionally narrow: render-time logic, retries, and provider
integration live in the Cloud Function, not here.
"""

from __future__ import annotations

from enum import Enum

OUTBOX_EMAILS_COLLECTION = 'outbox_emails'


class OutboxTemplate(str, Enum):
    SCHOOL_REQUEST_TO_LINGUAL = 'school_request_to_lingual'
