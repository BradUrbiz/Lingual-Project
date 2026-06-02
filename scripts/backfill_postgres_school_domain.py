"""Operator script: backfill the school-domain enrollment chain Firestore -> Postgres.

Reads the `organizations`, `memberships`, `classes`, and `enrollments` Firestore
collections and writes them into Postgres via the slice-2a backfill library
(`backend/db/repository/backfill.py`), parent-first, idempotently. Records a
`migration_import_runs` ledger row. This is the thin operator glue around the
tested `run_backfill` core.

Connection: Postgres comes from `backend.db.sql.get_engine()` — set DATABASE_URL
(local / cloud-sql-proxy) or INSTANCE_CONNECTION_NAME + DB_* (Cloud SQL
connector). Firestore uses application-default Firebase credentials.

PRECONDITION (write mode): run the pre-backfill uniqueness scans first
(POSTGRES_SCHEMA.md "Pre-backfill uniqueness scans") and abort on violation. The
per-row SAVEPOINT keeps a stray collision to one error row, but does not replace
the scan.

Usage:
  python3 -m scripts.backfill_postgres_school_domain --dry-run   # no writes; report would-be result
  python3 -m scripts.backfill_postgres_school_domain --write     # write + commit + ledger
  python3 -m scripts.backfill_postgres_school_domain --parity    # compare Firestore vs Postgres id-sets

Scope: the school-domain chain — organizations, memberships, classes, enrollments,
and assignments (ANALYTICS_MIGRATION Slice A; assignments resolve org + class, so
they ride this unified parent-first run rather than a separate script). Compliance /
Canvas / LTI / practice_sessions / learning_events are out of scope (their own
cutover increments).
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
import sys

logger = logging.getLogger('backfill_postgres')

# Parent-first; `_PIPELINE` in backfill.py enforces org -> membership -> class ->
# enrollment -> assignment ordering so each child resolves its parents' UUIDs.
_COLLECTIONS = ('organizations', 'memberships', 'classes', 'enrollments', 'assignments')


def _get_firestore_client():
    """Initialize Firebase Admin if needed; return a Firestore client."""
    import firebase_admin
    from firebase_admin import firestore

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return firestore.client()


def read_chain(db) -> dict[str, list[dict]]:
    """Read every doc from each collection as a dict carrying its doc id.

    Returns {collection: [ {**doc, 'id': doc_id}, ... ]} for the four chain
    collections, in dependency order.
    """
    chain: dict[str, list[dict]] = {}
    for name in _COLLECTIONS:
        docs = []
        for snap in db.collection(name).stream():
            data = snap.to_dict() or {}
            data['id'] = snap.id
            docs.append(data)
        chain[name] = docs
        logger.info('read %d %s docs from Firestore', len(docs), name)
    return chain


def _make_session():
    """Open a SQLAlchemy Session against the configured Postgres engine."""
    from sqlalchemy.orm import Session

    from backend.db.sql import get_engine, sql_enabled

    if not sql_enabled():
        raise SystemExit(
            'No Postgres target configured. Set DATABASE_URL (local) or '
            'INSTANCE_CONNECTION_NAME + DB_USER + DB_NAME (Cloud SQL).'
        )
    return Session(get_engine())


def _print_report(title: str, payload: dict) -> None:
    print(f'\n=== {title} ===')
    print(json.dumps(payload, indent=2, default=str))


def run(mode: str) -> int:
    """Execute the requested mode. Returns a process exit code."""
    from backend.db.repository import backfill

    db = _get_firestore_client()
    chain = read_chain(db)

    session = _make_session()
    try:
        if mode == 'parity':
            report = backfill.parity_report(session, **chain)
            _print_report('parity (Firestore vs Postgres)', report)
            return 0 if all(e['in_sync'] for e in report.values()) else 1

        dry_run = mode == 'dry-run'
        run_row = None
        if not dry_run:
            run_row = backfill.start_import_run(session, source='enrollment_chain')

        stats = backfill.run_backfill(session, dry_run=dry_run, **chain)

        if dry_run:
            session.rollback()  # belt-and-suspenders: dry_run does no writes anyway
            _print_report('dry-run (no writes)', stats)
            return 0

        backfill.finish_import_run(
            session, run_row, stats, finished_at=datetime.datetime.now(datetime.UTC)
        )
        session.commit()
        _print_report('write (committed)', stats)
        had_errors = any(e['errors'] for e in stats.values())
        return 1 if had_errors else 0
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true', help='report would-be result; no writes')
    group.add_argument('--write', action='store_true', help='write + commit + ledger')
    group.add_argument('--parity', action='store_true', help='compare Firestore vs Postgres id-sets')
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format='[backfill] %(message)s')
    mode = 'dry-run' if args.dry_run else 'write' if args.write else 'parity'
    return run(mode)


if __name__ == '__main__':
    sys.exit(main())
