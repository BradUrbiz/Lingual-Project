"""Email verification (6-digit code) at signup.

State lives in the `email_verification` map on the user doc. Reads/writes go
through the injected `db` (database module in prod, FakeDb in tests) so the
logic is unit-testable without Firestore. The outbox email is enqueued via the
real Firestore client (`database.get_db()`), matching the route convention.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import database
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email

STATUS_PENDING = 'pending'
STATUS_VERIFIED = 'verified'

CODE_TTL = timedelta(minutes=10)
# Wrong-guess budget *per code*. A resend issues a fresh code and intentionally
# resets this (a legit user who mistyped an old code shouldn't be locked out on
# their first try with the new one). Total brute-force surface is therefore
# bounded by MAX_ATTEMPTS * (1 + MAX_RESENDS) = 30 guesses against a 900k space,
# further rate-limited by RESEND_COOLDOWN — negligible.
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_RESENDS = 5  # fresh codes per pending verification window

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


def build_pending_state(uid: str, code: str, *, now: datetime | None = None,
                        resend_count: int = 0) -> dict:
    """The `email_verification` map for a freshly-issued pending code.

    Shared by the signup-time atomic create, `start_verification`, and
    `resend` so the pending-record shape stays in one place.
    """
    ts = _now(now)
    return {
        'status': STATUS_PENDING,
        'code_hash': hash_code(uid, code),
        'expires_at': (ts + CODE_TTL).isoformat(),
        'attempts': 0,
        'last_sent_at': ts.isoformat(),
        'resend_count': resend_count,
    }


def start_verification(db, uid: str, *, now: datetime | None = None) -> str:
    """Generate a fresh code, write pending state to an existing user doc, and
    return the plaintext code. (Brand-new signups create the doc and this state
    atomically via `database.create_user_with_verification` instead.)"""
    code = generate_code()
    db.update_user(uid, {_FIELD: build_pending_state(uid, code, now=now)})
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

    if not hmac.compare_digest(hash_code(uid, str(code).strip()), code_hash):
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

    expires_at = _parse(record.get('expires_at'))
    code_expired = expires_at is None or ts > expires_at
    resend_count = record.get('resend_count', 0)
    # The cap bounds resends within an *active* window (anti email-bombing).
    # Once the current code has expired a fresh window opens (counter resets),
    # so a legitimate user who exhausted resends and let the code lapse can
    # still recover instead of being permanently stranded.
    if resend_count >= MAX_RESENDS and not code_expired:
        return ResendResult(allowed=False)

    new_count = 1 if code_expired else resend_count + 1
    code = generate_code()
    db.update_user(uid, {_FIELD: build_pending_state(uid, code, now=ts, resend_count=new_count)})
    return ResendResult(
        allowed=True,
        code=code,
        cooldown_seconds=int(RESEND_COOLDOWN.total_seconds()),
    )


def send_verification_code_email(recipient_email: str, recipient_name: str | None,
                                 code: str, *, db=None) -> None:
    """Enqueue the verification-code email via the outbox pipeline.

    Uses the real Firestore client by default (route convention). Callers wrap
    this in try/except so a delivery-layer failure never blocks verification.
    """
    # Dev convenience: locally there is no Resend/Cloud Function to deliver the
    # email, so surface the code in the backend console for testing. Gated on
    # FLASK_ENV=development — never fires in production — and emitted before the
    # enqueue so it still prints if the outbox write fails.
    if os.environ.get('FLASK_ENV') == 'development':
        print(f"[email-verification:dev] code for {recipient_email}: {code}")
    enqueue_outbox_email(
        db=db if db is not None else database.get_db(),
        recipient_email=recipient_email,
        recipient_name=recipient_name,
        template=OutboxTemplate.EMAIL_VERIFICATION_CODE,
        template_data={'name': recipient_name or '', 'code': code},
    )
