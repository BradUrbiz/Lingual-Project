"""Shared identity-capture + URL helpers used by audited routes.

Centralized so Plan 3 (`school_requests.py`) and Plan 5
(`lingual_admin.py`) cannot drift. Identity capture must match across
both surfaces -- Plan 3 Codex round 2 flagged scattered helpers as a
trust-boundary risk.
"""
from __future__ import annotations

import hashlib
import os

from flask import request

_ATTESTATION_HASH_SALT_KEY = 'ATTESTATION_HASH_SALT'
_DEFAULT_PUBLIC_BASE = 'https://l1ngual.com'


def hash_ip(ip: str | None) -> str:
    """Return a 32-char salted SHA-256 prefix for storing client IPs in
    audit rows. Returns an empty string for falsy IPs so the audit column
    has a stable shape.

    Distinct from `database.hash_attestation_ip` (which returns the full
    `sha256:<hex>` form for the school-request attestation record). This
    helper is for `lingual_admin_audit` rows.
    """
    if not ip:
        return ''
    salt = os.environ.get(_ATTESTATION_HASH_SALT_KEY, 'unset-salt-dev-only')
    return hashlib.sha256(f'{salt}:{ip}'.encode()).hexdigest()[:32]


def client_ip() -> str:
    """Returns the trusted client IP from `request.remote_addr` (ProxyFix
    populates this from `X-Forwarded-For`'s first entry). Never use
    `request.access_route` -- see Plan 3 Codex round 1."""
    return request.remote_addr or ''


def user_agent() -> str:
    """Returns the first 255 chars of the `User-Agent` header (audit rows
    cap at 255 to keep doc size bounded)."""
    return request.headers.get('User-Agent', '')[:255]


def public_base_url() -> str:
    """Source of truth for external URLs (email CTAs, LTI callbacks).

    Never derived from `request.host_url` -- ProxyFix is narrow per
    Plan 3 Codex round 2, so request state may report http:// behind a
    TLS terminator. Use this helper or fail.
    """
    return os.environ.get('PUBLIC_BASE_URL', _DEFAULT_PUBLIC_BASE)
