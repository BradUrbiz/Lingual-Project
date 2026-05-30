"""Email verification (6-digit code) at signup.

State lives in the `email_verification` map on the user doc. Reads/writes go
through the injected `db` (database module in prod, FakeDb in tests) so the
logic is unit-testable without Firestore. The outbox email is enqueued via the
real Firestore client (`database.get_db()`), matching the route convention.
"""
from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

STATUS_PENDING = 'pending'
STATUS_VERIFIED = 'verified'

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_RESENDS = 5  # per pending verification window

_FIELD = 'email_verification'


def _now(now: datetime | None = None) -> datetime:
    return now or datetime.now(UTC)


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def generate_code() -> str:
    """A 6-digit numeric code, 100000–999999 (no leading-zero ambiguity)."""
    return f"{secrets.randbelow(900000) + 100000}"


def hash_code(uid: str, code: str) -> str:
    pepper = os.environ.get('SECRET_KEY', '')
    return hashlib.sha256(f"{pepper}:{uid}:{code}".encode()).hexdigest()


def is_pending(user_doc) -> bool:
    return ((user_doc or {}).get(_FIELD) or {}).get('status') == STATUS_PENDING


def start_verification(db, uid: str, *, now: datetime | None = None) -> str:
    """Generate a fresh code, write pending state, return the plaintext code."""
    code = generate_code()
    ts = _now(now)
    db.update_user(uid, {_FIELD: {
        'status': STATUS_PENDING,
        'code_hash': hash_code(uid, code),
        'expires_at': (ts + CODE_TTL).isoformat(),
        'attempts': 0,
        'last_sent_at': ts.isoformat(),
        'resend_count': 0,
    }})
    return code


@dataclass
class ConfirmResult:
    ok: bool
    error: str | None = None


def confirm(db, uid: str, code: str, *, now: datetime | None = None) -> ConfirmResult:
    user = db.get_user(uid) or {}
    record = user.get(_FIELD) or {}

    if record.get('status') == STATUS_VERIFIED:
        return ConfirmResult(ok=True)  # idempotent

    code_hash = record.get('code_hash')
    if not code_hash:
        return ConfirmResult(ok=False, error='invalid_code')

    expires_at = _parse(record.get('expires_at'))
    if expires_at is None or _now(now) > expires_at:
        return ConfirmResult(ok=False, error='expired')

    attempts = record.get('attempts', 0)
    if attempts >= MAX_ATTEMPTS:
        return ConfirmResult(ok=False, error='too_many_attempts')

    if hash_code(uid, str(code).strip()) != code_hash:
        attempts += 1
        db.update_user(uid, {_FIELD: {'attempts': attempts}})
        if attempts >= MAX_ATTEMPTS:
            return ConfirmResult(ok=False, error='too_many_attempts')
        return ConfirmResult(ok=False, error='invalid_code')

    db.update_user(uid, {_FIELD: {
        'status': STATUS_VERIFIED,
        'verified_at': _now(now).isoformat(),
        'code_hash': None,
    }})
    return ConfirmResult(ok=True)


@dataclass
class ResendResult:
    allowed: bool
    code: str | None = None
    cooldown_seconds: int = 0


def resend(db, uid: str, *, now: datetime | None = None) -> ResendResult:
    ts = _now(now)
    user = db.get_user(uid) or {}
    record = user.get(_FIELD) or {}

    if record.get('status') == STATUS_VERIFIED:
        return ResendResult(allowed=False)

    last_sent = _parse(record.get('last_sent_at'))
    if last_sent is not None:
        elapsed = (ts - last_sent).total_seconds()
        if elapsed < RESEND_COOLDOWN.total_seconds():
            return ResendResult(
                allowed=False,
                cooldown_seconds=int(RESEND_COOLDOWN.total_seconds() - elapsed),
            )

    resend_count = record.get('resend_count', 0)
    if resend_count >= MAX_RESENDS:
        return ResendResult(allowed=False)

    code = generate_code()
    db.update_user(uid, {_FIELD: {
        'status': STATUS_PENDING,
        'code_hash': hash_code(uid, code),
        'expires_at': (ts + CODE_TTL).isoformat(),
        'attempts': 0,
        'last_sent_at': ts.isoformat(),
        'resend_count': resend_count + 1,
    }})
    return ResendResult(
        allowed=True,
        code=code,
        cooldown_seconds=int(RESEND_COOLDOWN.total_seconds()),
    )
