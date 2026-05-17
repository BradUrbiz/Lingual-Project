"""Cloud Functions for Lingual transactional email."""

from __future__ import annotations

import os
from typing import Any, Optional

import resend
from firebase_admin import initialize_app
from firebase_functions import firestore_fn, scheduler_fn
from firebase_functions.options import set_global_options

set_global_options(max_instances=10)
initialize_app()

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
    from_address = os.environ.get('RESEND_FROM_ADDRESS', 'Lingual <noreply@lingual.app>')
    response = resend.Emails.send({
        'from': from_address,
        'to': [_format_recipient(to_email, to_name)],
        'subject': subject,
        'html': html,
    })
    return {'mode': 'live', 'message_id': response.get('id')}
