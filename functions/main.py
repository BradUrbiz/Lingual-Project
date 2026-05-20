"""Cloud Functions for Lingual transactional email."""

from __future__ import annotations

import datetime
import os
from pathlib import Path
from typing import Any, Optional

import resend
from firebase_admin import firestore as fb_firestore, initialize_app
from firebase_functions import firestore_fn, scheduler_fn
from firebase_functions.options import set_global_options
from jinja2 import Environment, FileSystemLoader, select_autoescape

set_global_options(max_instances=10)
initialize_app()

# RESEND_API_KEY is declared as a secret on each @firestore_fn / @scheduler_fn
# decorator (`secrets=['RESEND_API_KEY']`) so the Functions 2nd gen runtime
# mounts it into the function's env. Without the per-decorator declaration,
# os.environ['RESEND_API_KEY'] would be unset even when the secret exists in
# Secret Manager, and the function would silently fall into dev-mode (sent_dev).
# Provision the secret with: `firebase functions:secrets:set RESEND_API_KEY`.

DEV_MODE_SENTINEL = {'mode': 'dev', 'message_id': None}


def _format_recipient(email: str, name: Optional[str]) -> str:
    if name:
        return f"{name} <{email}>"
    return email


def send_via_resend(
    *,
    to_email: str,
    to_name: Optional[str],
    subject: str,
    html: str,
) -> dict[str, Any]:
    """Send via Resend, or return a dev sentinel if the API key is unset."""
    api_key = os.environ.get('RESEND_API_KEY')
    if not api_key:
        print(f"[resend:dev] would send to {to_email!r} subject={subject!r}")
        return DEV_MODE_SENTINEL

    resend.api_key = api_key
    from_address = os.environ.get('RESEND_FROM_ADDRESS', 'Lingual <noreply@send.l1ngual.com>')
    response = resend.Emails.send({
        'from': from_address,
        'to': [_format_recipient(to_email, to_name)],
        'subject': subject,
        'html': html,
    })
    return {'mode': 'live', 'message_id': response.get('id')}


_TEMPLATES_DIR = Path(__file__).parent / 'templates'
_JINJA_ENV = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(['html', 'j2']),
)

_TEMPLATE_SUBJECTS = {
    # Plan 1
    'school_request_to_lingual':
        lambda data: f"New school registration: {data['org_name']}",
    # Plan 3
    'school_request_approved':
        lambda data: f"Your school {data['org_name']} is now on Lingual",
    'school_request_declined':
        lambda data: "Your school registration needs more info",
    'teacher_invitation':
        lambda data: f"{data['org_name']} is inviting you to teach on Lingual",
    # Plan 4
    'teacher_join_request_to_admin':
        lambda data: f"New teacher request to join {data['org_name']}",
    'teacher_join_approved':
        lambda data: f"Welcome to {data['org_name']} on Lingual",
    'teacher_join_declined':
        lambda data: f"Your request to join {data['org_name']} was not approved",
    # Plan 5: Lingual-admin org lifecycle
    'org_suspended':
        lambda data: f"{data['org_name']} has been suspended on Lingual",
    'org_restored':
        lambda data: f"{data['org_name']} access has been restored on Lingual",
}


def render_template(template_id: str, data: dict[str, Any]) -> tuple[str, str]:
    """Return (subject, html) for the given template_id + merge data."""
    if template_id not in _TEMPLATE_SUBJECTS:
        raise KeyError(f"Unknown template_id: {template_id!r}")
    template = _JINJA_ENV.get_template(f"{template_id}.html.j2")
    html = template.render(**data)
    subject = _TEMPLATE_SUBJECTS[template_id](data)
    return subject, html


MAX_OUTBOX_ATTEMPTS = 5


def _claim_pending_outbox_email(ref) -> dict[str, Any] | None:
    """Atomically claim a pending outbox email before calling the provider.

    Firestore/Eventarc triggers are at-least-once. A transaction keeps duplicate
    trigger deliveries from sending the same email twice: only one invocation
    can observe status='pending' and move it to 'sending'.
    """
    transaction = fb_firestore.client().transaction()

    @fb_firestore.transactional
    def _claim(tx):
        snapshot = ref.get(transaction=tx)
        if getattr(snapshot, 'exists', True) is False:
            return None
        current = snapshot.to_dict() or {}
        if current.get('status') != 'pending':
            return None

        attempt = int(current.get('attempt_count') or 0) + 1
        update_payload = {
            'status': 'sending',
            'attempt_count': attempt,
            'last_attempt_at': fb_firestore.SERVER_TIMESTAMP,
        }
        tx.update(ref, update_payload)

        claimed = dict(current)
        claimed.update(update_payload)
        return claimed

    return _claim(transaction)


def _send_outbox_email_impl(event) -> None:
    """Business logic for send_outbox_email; extracted so tests can call it directly.

    Only processes docs with status='pending'. All other statuses (including
    'failed') are ignored here. The retry sweep promotes failed→pending, and
    that promotion write fires this trigger again — so the trigger never sees
    'failed' directly.
    """
    if event.data is None or event.data.after is None:
        return
    after = event.data.after.to_dict() or {}
    status = after.get('status')
    if status != 'pending':
        return

    ref = event.data.after.reference
    claimed = _claim_pending_outbox_email(ref)
    if claimed is None:
        return
    attempt = int(claimed.get('attempt_count') or 0)

    try:
        subject, html = render_template(
            claimed['template_id'], claimed.get('template_data') or {}
        )
        recipient = claimed.get('recipient') or {}
        result = send_via_resend(
            to_email=recipient.get('email'),
            to_name=recipient.get('name'),
            subject=subject,
            html=html,
        )
    except Exception as exc:  # noqa: BLE001
        terminal = attempt >= MAX_OUTBOX_ATTEMPTS
        ref.update({
            'status': 'dead_letter' if terminal else 'failed',
            'attempt_count': attempt,
            'error': str(exc),
        })
        return

    if result.get('mode') == 'dev':
        ref.update({
            'status': 'sent_dev',
            'sent_at': fb_firestore.SERVER_TIMESTAMP,
        })
        return

    ref.update({
        'status': 'sent',
        'sent_at': fb_firestore.SERVER_TIMESTAMP,
        'resend_message_id': result.get('message_id'),
    })


# Use on_document_written (not on_document_created) so the retry sweep's
# 'failed' -> 'pending' promotion write re-triggers this function. The
# trigger only processes status='pending'; all other statuses ('failed',
# 'sending', 'sent', 'sent_dev', 'dead_letter') are ignored by the
# early-exit guard. The sweep promotes failed→pending and the new write
# fires this trigger; the trigger never sees 'failed' directly.
@firestore_fn.on_document_written(
    document='outbox_emails/{emailId}',
    secrets=['RESEND_API_KEY'],
)
def send_outbox_email(event):
    """Send pending outbox emails. Triggered by new writes and sweep promotions."""
    return _send_outbox_email_impl(event)


def _retry_outbox_sweep_impl() -> None:
    """Promote 'failed' docs with retry budget; kick stuck 'pending' docs.

    Two responsibilities:
    1. failed → pending when attempt_count < MAX_OUTBOX_ATTEMPTS. The promotion
       write fires the on_document_written trigger, which retries the send.
    2. Touch stuck 'pending' docs that the trigger never processed (e.g., docs
       queued before this function deployed, or docs with future scheduled_for
       whose time has now passed). The touch write fires the trigger.

    Filters attempt_count in Python (rather than a Firestore composite query)
    so the index requirement stays at (status) for now.
    """
    db = fb_firestore.client()
    now = datetime.datetime.now(datetime.timezone.utc)

    # Part 1: promote failed → pending
    for doc in db.collection('outbox_emails').where('status', '==', 'failed').stream():
        data = doc.to_dict() or {}
        attempt_count = int(data.get('attempt_count') or 0)
        if attempt_count < MAX_OUTBOX_ATTEMPTS:
            doc.reference.update({'status': 'pending'})

    # Part 2: kick stuck pending docs (trigger never ran — attempt_count still 0)
    for doc in db.collection('outbox_emails').where('status', '==', 'pending').stream():
        data = doc.to_dict() or {}
        if int(data.get('attempt_count') or 0) > 0:
            continue  # trigger already started this one
        scheduled_for = data.get('scheduled_for')
        if scheduled_for is not None and hasattr(scheduled_for, 'astimezone'):
            try:
                due = scheduled_for.astimezone(datetime.timezone.utc) <= now
            except Exception:
                due = True
            if not due:
                continue
        doc.reference.update({'last_swept_at': fb_firestore.SERVER_TIMESTAMP})


@scheduler_fn.on_schedule(
    schedule='every 5 minutes',
    secrets=['RESEND_API_KEY'],
)
def retry_outbox_sweep(event) -> None:
    """Cloud Function wrapper: delegates to the pure impl for testability."""
    _retry_outbox_sweep_impl()
