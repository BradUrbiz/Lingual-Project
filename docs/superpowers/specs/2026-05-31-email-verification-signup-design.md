# Email Verification at Signup (6-digit code)

**Date:** 2026-05-31
**Status:** Design — approved decisions, pending spec review
**Scope:** Require new email/password signups (student, teacher, school admin) to verify
their email with a 6-digit code before they can use the app. Existing accounts and
Google sign-ins are unaffected.

## 1. Goal & Constraints

When a user creates a Lingual account with email + password, they must enter a 6-digit
code emailed to that address before gaining access to any app surface (assessment,
classes, practice, joining). This proves the email is real and reachable.

**Hard constraints:**
- **Existing accounts are grandfathered** — no backfill, no lockout, no re-verification.
- **Google sign-in is auto-verified** — Google already asserts `email_verified: true`;
  no code step.
- Stay on Firestore (no new persistence system — TECH_SPEC §1).
- Reuse the existing outbox → Cloud Function → Resend email pipeline.

## 2. Confirmed Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Verification method | **6-digit numeric code** (not Firebase link) | Matches request; branded email via Resend; no "leave app, click, return" friction. |
| Gate strictness | **Hard gate at signup** | User cannot enter the app until verified. |
| Google sign-in | **Auto-verified** | Provider already verified the email. |
| Code in email | **Body only**, generic subject | Code not exposed in notification previews / subject logs. |
| Firebase Auth sync | **Best-effort** `emailVerified=true` on confirm | Firestore authoritative; Firebase write wrapped so failure never blocks verification. |

## 3. Architecture

### 3.1 The gate mechanism (load-bearing)

Every protected backend route funnels through `login_required`, which today is simply
`'user' in session`. The session is minted in one place — `verify_auth`
(`POST /api/auth/verify`) — which already decodes the Firebase token.

- In `verify_auth`, on a **brand-new** account whose token is **not** already verified by
  the provider (i.e. email/password, not Google), we start verification and set
  `session['user']['email_verified'] = False`.
- `login_required` gains one guard: if `session['user'].get('email_verified') is False`,
  return `403 {success: false, error: 'email_verification_required'}`.

**Why `is False` (not falsy):** existing pre-deploy sessions and Google users never have
the `email_verified` session key, so it reads `None` and passes. Only accounts we
*explicitly* mark pending get blocked. This grandfathers everyone with no backfill or
cutoff date. Because every protected route already uses `login_required`, this gates the
entire app from a single edit — no per-route decoration, no per-request Firestore read.

### 3.2 New-account + provider detection

`verify_auth` determines verification requirement from the decoded token and whether the
user doc already existed:

```
existing = deps.db.get_user(uid)          # None ⇒ brand new
deps.db.get_or_create_user(uid, email, name)
provider_verified = bool(decoded_token.get('email_verified'))   # Google ⇒ True

if existing is None and not provider_verified:
    start_email_verification(deps.db, uid, email, name)   # generate + email code
    requires_verification = True
else:
    status = (existing or {}).get('email_verification', {}).get('status')
    requires_verification = (status == 'pending')          # returning, not-yet-verified

session['user'] = { ..., 'email_verified': not requires_verification }
```

- Brand-new Google account: `provider_verified` True ⇒ never starts verification.
- Returning unverified user (signed up earlier, never finished): `status == 'pending'`
  ⇒ gated again, can resend/confirm.
- Existing verified / grandfathered / LTI-provisioned users: no `email_verification`
  field ⇒ not gated. (LTI/Canvas users are provisioned via the LTI launch path, never the
  password-signup path, so they are naturally exempt.)

### 3.3 Verification state (user-doc subfield)

A new `email_verification` map, written only for new email/password accounts:

```
email_verification: {
  status:       'pending' | 'verified',
  code_hash:    <sha256(SECRET_KEY + uid + code)>,   # present only while pending; cleared on success
  expires_at:   <timestamp>,        # now + 10 min
  attempts:     <int>,              # wrong attempts against the current code
  last_sent_at: <timestamp>,        # for resend cooldown
  resend_count: <int>,              # for hourly resend cap
  verified_at:  <timestamp>,        # set on success
}
```

Missing field ⇒ grandfathered/Google ⇒ treated as verified. The code is **hashed**
(never stored plaintext) and **cleared** on success, so no sensitive material lingers in
the user doc. Stored on the user doc (not a separate collection) because it is short-lived,
strictly per-user, and read together with the user we already fetch in `verify_auth`.

### 3.4 Service: `backend/services/email_verification.py`

Isolated, composed by the auth blueprint. Takes `db` like `enqueue_outbox_email`.

| Function | Responsibility |
|----------|----------------|
| `start_email_verification(db, uid, email, name)` | Generate code, write hashed state (`status=pending`, fresh `expires_at`, `attempts=0`), enqueue outbox email. Used at signup. |
| `resend_email_verification(db, uid) -> {cooldown_seconds}` | Enforce cooldown + hourly cap, regenerate code, re-enqueue. |
| `confirm_email_verification(db, uid, code) -> Result` | Validate not-expired / attempts-left / hash match. On success: `status=verified`, clear `code_hash`, set `verified_at`; best-effort `firebase_auth.update_user(uid, email_verified=True)`. On failure: increment `attempts`, return distinct error. |
| `is_pending(user_doc) -> bool` | Pure gate helper. |

**Parameters:** code = `secrets.randbelow(900000) + 100000` (100000–999999). TTL = 10 min.
Max attempts = 5 (then code is dead; must resend). Resend cooldown = 60 s; hourly cap = 5.
Pepper = `SECRET_KEY` (already required in prod).

**Result error codes:** `invalid_code`, `expired`, `too_many_attempts`.

### 3.5 Endpoints (`backend/routes/auth.py`)

These must work **while pending**, so they read `session['user']['uid']` directly and do
**not** use the verification-augmented `login_required` (a missing/empty session ⇒ 401).

- `POST /api/auth/email-verification/resend`
  → `resend_email_verification`; returns `{ success, cooldownSeconds }` or `429` when on cooldown.
- `POST /api/auth/email-verification/confirm` `{ code }`
  → `confirm_email_verification`; on success sets `session['user']['email_verified'] = True`
  and returns `{ success: true }`; on failure returns `{ success: false, error: <code> }`.

`build_auth_user_payload` gains `emailVerificationRequired: <bool>` so the frontend knows
to show the gate.

### 3.6 Email template (outbox → Resend)

- `OutboxTemplate.EMAIL_VERIFICATION_CODE = 'email_verification_code'`.
- Subject lambda: `lambda data: "Verify your Lingual email"` (code not in subject).
- `functions/templates/email_verification_code.html.j2`: greeting, large code block,
  "expires in 10 minutes", "ignore this email if you didn't sign up for Lingual."
- `template_data = { 'name': <recipient name>, 'code': <6 digits> }`.

`start_email_verification` and `resend_email_verification` call `enqueue_outbox_email(...)`
with this template. In dev (no `RESEND_API_KEY`) the Cloud Function logs a sentinel — code
also visible in backend logs for local testing.

### 3.7 Frontend

Follow the existing `LegacyRoleMigrationModal` convention (a blocking modal rendered by
`AuthProvider` when a user-state flag is set).

- `types`: add `emailVerificationRequired?: boolean` to `User`.
- `AuthProvider` renders a **non-dismissible** `EmailVerificationGate` whenever
  `user.emailVerificationRequired` is true. This single component covers signup, page
  reload, and re-login — no special signup-wizard step needed.
- `EmailVerificationGate`: shows the masked target email, a 6-digit input, a "Verify"
  button, a "Resend code" button with a live cooldown countdown, distinct error messages
  (`invalid_code` / `expired` / `too_many_attempts`), and a "Wrong email? Sign out" escape.
- `api/auth.ts`: `confirmEmailVerification(code)` and `resendEmailVerification()` client fns.
- On successful confirm, call `refreshUser()` so `emailVerificationRequired` flips to false
  and the gate unmounts, mirroring how `handleLegacyRolePick` refreshes after migration.

## 4. Edge Cases

- **Abandoned verification:** account sits `pending` indefinitely; user simply can't use the
  app. Acceptable for beta (stale-pending cleanup is out of scope).
- **Resend spam:** cooldown (60 s) + hourly cap (5) on the server; frontend mirrors cooldown.
- **Expired/locked code:** distinct errors steer the user to "Resend code."
- **Direct API access while pending:** every `login_required` route returns
  `403 email_verification_required` — defense in depth behind the frontend gate.
- **E2E test bypass:** the `/api/test/verify` harness session never sets `email_verified`,
  so the key is absent ⇒ `None` ⇒ not gated. Existing E2E flows unaffected.

## 5. Scope

**In:** code generation + hashed storage + TTL/attempts/rate-limit, outbox email + template,
two endpoints, `verify_auth` + `login_required` changes, `EmailVerificationGate` UI,
backend + frontend tests.

**Out (future):** email-change re-verification, admin "force resend", stale-pending account
cleanup, email-template i18n (templates are English-only today).

## 6. Testing Strategy

**Backend (`backend/tests/`):**
- `email_verification` service: code gen range, hash match/mismatch, expiry, attempt
  lockout at 5, resend cooldown/cap, confirm flips status + clears hash.
- `verify_auth`: new password account ⇒ pending + outbox enqueued + session
  `email_verified=False`; new Google account ⇒ verified, no enqueue; existing account
  ⇒ unchanged; returning pending account ⇒ gated.
- `login_required`: pending session ⇒ 403; verified ⇒ pass; legacy session (no key) ⇒ pass.
- Endpoints: confirm happy path + each error code; resend cooldown ⇒ 429.
- Outbox writes are blocked in tests via `LINGUAL_BLOCK_OUTBOX_WRITES` (existing guard);
  assert the enqueue was attempted.

**Frontend (`frontend/src/`):**
- `EmailVerificationGate`: renders on `emailVerificationRequired`, submits code, shows error
  states, resend cooldown disables button, sign-out escape.
- `AuthContext`: confirm success triggers `refreshUser`.

## 7. File-Level Change List

**Backend**
- `backend/services/email_verification.py` — new service.
- `backend/services/outbox.py` — add `EMAIL_VERIFICATION_CODE` enum value.
- `backend/routes/auth.py` — verification logic in `verify_auth`, two new endpoints,
  `emailVerificationRequired` in payload.
- `main.py` — augment `login_required` with the pending-verification guard.
- `database.py` — helpers to read/write the `email_verification` subfield if not done inline.
- `functions/main.py` — add subject lambda for the new template.
- `functions/templates/email_verification_code.html.j2` — new template.

**Frontend**
- `frontend/src/types/` — `emailVerificationRequired` on `User`.
- `frontend/src/api/auth.ts` — `confirmEmailVerification`, `resendEmailVerification`.
- `frontend/src/components/EmailVerificationGate.tsx` — new gate modal.
- `frontend/src/contexts/AuthContext.tsx` — render gate when flag set; refresh on confirm.

**Docs**
- `docs/school-integration/LIMITATIONS.md` — note grandfathering + out-of-scope items.
- `docs/school-integration/TASKS.md` — mark the item.
