"""Operator script: TERM-SCOPE backfill of practice_sessions Firestore -> Postgres.

MANDATORY before enabling DUAL_WRITE_ANALYTICS_SESSIONS=1 (ANALYTICS_MIGRATION
§3.1/§5b.4). Pure forward-only dual-write leaves pre-cutover sessions Firestore-
only, which (a) makes the session-summary shadow soak permanently noisy and
(b) blocks Firestore write retirement. The term-scope backfill closes that gap:
it imports every practice_session from the active academic term onward.

Reads `practice_sessions` from Firestore filtered to `started_at >= --term-start`
and upserts them via the tested `backend.db.repository.backfill.upsert_practice_session`
(resolves org+class+assignment -> UUIDs; renames student_uid -> student_firebase_uid;
idempotent by legacy_firestore_id). Each row runs inside a SAVEPOINT so one bad
row (e.g. an unresolved parent, a status CHECK violation) is reported, not fatal.

SCOPE: practice_sessions ONLY. learning_events are Slice C — a separate chunked
bulk-insert backfill (§3.3). Run Slice A's chain backfill first so assignment
FKs resolve.

"Term start" is OPERATOR-SUPPLIED: there is no structured academic calendar in
the data model (class.term is free text, e.g. "Spring 2026"). Pass the first day
of the current term as an ISO date.

Connection: Postgres from `backend.db.sql.get_engine()` (set DATABASE_URL or
INSTANCE_CONNECTION_NAME + DB_* + DB_IAM_AUTH). Firestore via ADC.

Usage:
  python3 -m scripts.backfill_practice_sessions_term --dry-run --term-start 2026-01-01
  python3 -m scripts.backfill_practice_sessions_term --write   --term-start 2026-01-01
  python3 -m scripts.backfill_practice_sessions_term --parity  --term-start 2026-01-01
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
import sys

logger = logging.getLogger('backfill_practice_sessions')


def _parse_term_start(value: str) -> datetime.datetime:
    """ISO date/datetime -> tz-aware UTC datetime (sessions started_at >= this)."""
    dt = datetime.datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def _get_firestore_client():
    import firebase_admin
    from firebase_admin import firestore

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return firestore.client()


def read_sessions(db, term_start: datetime.datetime) -> list[dict]:
    """Read practice_session docs with started_at >= term_start, each carrying its id."""
    docs: list[dict] = []
    for snap in (
        db.collection('practice_sessions').where('started_at', '>=', term_start).stream()
    ):
        data = snap.to_dict() or {}
        data['id'] = snap.id
        docs.append(data)
    logger.info(
        'read %d practice_session docs from Firestore (started_at >= %s)',
        len(docs),
        term_start.date(),
    )
    return docs


def _make_session():
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


def run(mode: str, term_start: datetime.datetime) -> int:
    from sqlalchemy import select

    from backend.db.models.practice import PracticeSession
    from backend.db.repository import backfill

    db = _get_firestore_client()
    sessions = read_sessions(db, term_start)
    fs_ids = {d['id'] for d in sessions if d.get('id')}

    pg_session = _make_session()
    try:
        if mode == 'parity':
            # id-set diff: term-scoped Firestore ids vs ALL PG session ids. Forward
            # dual-write (post-flip) may add PG rows outside the term window, so
            # `extra_in_postgres` is informational; `missing_in_postgres` is the gate.
            pg_ids = {
                r
                for r in pg_session.execute(
                    select(PracticeSession.legacy_firestore_id)
                ).scalars().all()
                if r is not None
            }
            missing = sorted(fs_ids - pg_ids)
            extra = sorted(pg_ids - fs_ids)
            report = {
                'firestore_count': len(fs_ids),
                'postgres_count': len(pg_ids),
                'missing_in_postgres': missing[:50],
                'missing_in_postgres_total': len(missing),
                'extra_in_postgres': extra[:50],
                'extra_in_postgres_total': len(extra),
                'in_sync': not missing,
            }
            _print_report('parity (term-scoped Firestore vs all Postgres)', report)
            return 0 if not missing else 1

        dry_run = mode == 'dry-run'
        # Keys must match backfill._empty_stats() — finish_import_run's _summarize_stats
        # reads 'skipped' (+ inserted/updated/errors) when writing the ledger row.
        stats: dict = {'inserted': 0, 'updated': 0, 'skipped': 0, 'errors': [], 'warnings': []}
        run_row = None
        if not dry_run:
            run_row = backfill.start_import_run(
                pg_session, source=f'practice_sessions_term:{term_start.date()}'
            )

        for doc in sessions:
            legacy_id = doc.get('id')
            if not legacy_id:
                stats['errors'].append({'id': None, 'error': 'session doc missing Firestore id'})
                continue
            existed = backfill._existing(pg_session, PracticeSession, legacy_id) is not None
            try:
                with pg_session.begin_nested():  # SAVEPOINT — isolate per-row failure
                    backfill.upsert_practice_session(pg_session, doc, warnings=stats['warnings'])
                # Count would-be inserts/updates in BOTH modes: in dry-run the row is
                # resolved + flushed inside the SAVEPOINT then the whole tx is rolled
                # back at the end, so the count reflects what --write WOULD do.
                stats['updated' if existed else 'inserted'] += 1
            except backfill.UnresolvedParentError as exc:
                stats['errors'].append({'id': legacy_id, 'error': str(exc)})
            except Exception as exc:  # noqa: BLE001 — report per-row, never abort the run
                stats['errors'].append({'id': legacy_id, 'error': str(exc)})

        if dry_run:
            pg_session.rollback()
            _print_report('dry-run (no writes)', stats)
            return 0

        assert run_row is not None  # set above whenever not dry_run (dry_run returned early)
        backfill.finish_import_run(
            pg_session,
            run_row,
            {'practice_sessions': stats},
            finished_at=datetime.datetime.now(datetime.UTC),
        )
        pg_session.commit()
        _print_report('write (committed)', stats)
        return 1 if stats['errors'] else 0
    except Exception:
        pg_session.rollback()
        raise
    finally:
        pg_session.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true', help='report would-be result; no writes')
    group.add_argument('--write', action='store_true', help='write + commit + ledger')
    group.add_argument('--parity', action='store_true', help='compare Firestore vs Postgres id-sets')
    parser.add_argument(
        '--term-start',
        required=True,
        help='ISO date (YYYY-MM-DD): include sessions with started_at >= this date',
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format='[backfill_sessions] %(message)s')
    term_start = _parse_term_start(args.term_start)
    mode = 'dry-run' if args.dry_run else 'write' if args.write else 'parity'
    return run(mode, term_start)


if __name__ == '__main__':
    sys.exit(main())
