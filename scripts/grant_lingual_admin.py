"""Grant (or revoke) Lingual Admin — the platform-level superadmin role.

Sets the platform flag ``users/{uid}.lingual_admin = True`` for each target
email. ``database.resolve_user_school_context`` unions this flag into the
``lingual_admin`` authority enforced by the ``_require_lingual_admin`` route
guard (``backend/routes/lingual_admin.py``) and the frontend
``LingualAdminRoute``.

Why the flag rather than a membership role: ``lingual_admin`` is platform-level
and not scoped to any organization, so the org-bound membership model does not
fit. The flag is a first-class source in the union (see
``database.list_lingual_admin_emails`` and ``resolve_user_school_context``).

Email -> uid is resolved via a Firestore equality query on the top-level
``email`` field (Firebase Auth's get_user_by_email is avoided so this works
regardless of the ADC quota-project configuration).

Idempotent. Run with --dry-run first.

Usage:
    python3 scripts/grant_lingual_admin.py --dry-run \\
        --email ezraaslan10@gmail.com --email bradurbiz@gmail.com
    python3 scripts/grant_lingual_admin.py \\
        --email ezraaslan10@gmail.com --email bradurbiz@gmail.com
    python3 scripts/grant_lingual_admin.py --revoke --email foo@example.com
"""
from __future__ import annotations

import argparse
import os
import sys

import firebase_admin
from firebase_admin import firestore


def _resolve_uid(db, email: str) -> list[str]:
    """Return all user-doc ids whose top-level `email` equals `email`."""
    rows = db.collection("users").where("email", "==", email).stream()
    return [doc.id for doc in rows]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grant/revoke Lingual Admin by email.")
    parser.add_argument("--email", action="append", default=[], required=True,
                        help="Target email (repeatable).")
    parser.add_argument("--revoke", action="store_true",
                        help="Set lingual_admin=False instead of True.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report intended changes without writing.")
    args = parser.parse_args(argv)

    target_value = not args.revoke  # grant -> True, revoke -> False
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "lingu-480600")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={"projectId": project})
    db = firestore.client()

    print(f"Project: {project}  action: {'REVOKE' if args.revoke else 'GRANT'}  "
          f"dry_run: {args.dry_run}\n")

    changed = unchanged = errored = 0
    for email in args.email:
        uids = _resolve_uid(db, email)
        if len(uids) == 0:
            print(f"[ERROR] {email}: no user doc with this email — skipping")
            errored += 1
            continue
        if len(uids) > 1:
            print(f"[ERROR] {email}: matches {len(uids)} docs {uids} — ambiguous, skipping")
            errored += 1
            continue

        uid = uids[0]
        ref = db.collection("users").document(uid)
        current = bool((ref.get().to_dict() or {}).get("lingual_admin"))
        if current == target_value:
            print(f"[skip ] {email} (uid={uid}): already lingual_admin={current}")
            unchanged += 1
            continue

        print(f"{'[DRY] ' if args.dry_run else '[write]'} {email} (uid={uid}): "
              f"lingual_admin {current} -> {target_value}")
        if not args.dry_run:
            ref.update({"lingual_admin": target_value})
        changed += 1

    print(f"\nDone. changed={changed} unchanged={unchanged} errored={errored}")
    return 1 if errored else 0


if __name__ == "__main__":
    sys.exit(main())
