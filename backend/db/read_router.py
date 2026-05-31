"""Flag-gated Postgres read-cutover router (school-domain migration, read phase).

Wraps the Firestore `database` module on `deps.db`. Overrides ONLY the read
methods being cut over; every other attribute (writes, not-yet-cut readers,
module constants) passes through to Firestore via ``__getattr__`` — so routes
never change and the cutover is a localized, env-flag-driven flip.

Per-entity flags (``READ_PG_*``, read on every call, default OFF) gate each
entity FAMILY, 3-state:

  ``''`` / ``'0'``  -> Firestore only (today's behavior).
  ``'shadow'``      -> Firestore authoritative + the PG read compared for parity
                       (logged + counted, never surfaced). The safe pre-flip gate.
  ``'1'``           -> PG authoritative, FAIL-OPEN to Firestore on any error /
                       no engine / unresolved id.

Firestore stays the system of record until a flag flips to ``'1'``. Reuses the
dual-write engine resolver and the same short-lived, latency-bounded Session, so
a hung or broken Postgres can never break — nor unboundedly slow — a read (the
shadow compare runs synchronously before the Firestore result is returned).

See docs/school-integration/READ_CUTOVER.md.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable

from backend.db.dual_write import _resolve_engine  # shared provider -> engine|None

_log = logging.getLogger(__name__)

# Bound a hung shadow/cutover read so it can't inflate the request. Shadow mode
# runs the PG read synchronously before returning Firestore, so this matters
# even though Firestore is authoritative. Pairs with sql.py's pool_timeout=3.
_READ_STATEMENT_TIMEOUT_MS = 5_000

# Per-process shadow-parity counters (flag -> [compared, mismatched]). A soak
# SIGNAL, not exact metrics — benign races under Cloud Run threading are fine.
# Logged at WARNING (the only level visible in prod — no logging handler is
# configured, so module INFO/DEBUG never surface) on the FIRST compare per
# process and every _SHADOW_SUMMARY_EVERY after, so a CLEAN shadow is OBSERVABLE.
# Otherwise "no MISMATCH" is indistinguishable from "the shadow never ran".
_shadow_stats: dict[str, list[int]] = {}
_SHADOW_SUMMARY_EVERY = 25

# Known-divergent organization keys to ignore in shadow parity (READ_CUTOVER.md
# §4). Surfacing these would be alert noise, not drift:
#   school_admin_uids - Firestore-denormalized; derived (not stored) in PG, and
#                       no get_organization point-get caller reads it (the LIST
#                       path is defect D3, a separate reader).
#   last_activity_at  - not maintained on the PG row yet (always None there).
#   created_at/updated_at - clock skew: Firestore SERVER_TIMESTAMP vs PG now() /
#                       app-clock on status flips (LIMITATIONS #44).
_ORG_SHADOW_IGNORE = frozenset(
    {'school_admin_uids', 'last_activity_at', 'created_at', 'updated_at'}
)


def _norm(value: Any) -> Any:
    """Normalize a value for cross-store comparison: datetimes -> ISO string, and
    Firestore-loose empties (None / '' / []) collapse to None."""
    if value is None or value == '' or value == []:
        return None
    iso = getattr(value, 'isoformat', None)
    if callable(iso):
        return iso()
    return value


def _diff_dict(fs: dict | None, pg: dict | None, ignore: frozenset) -> dict:
    """Field-level diff of two point-get dicts over the union of keys minus
    `ignore`. Returns {key: (fs_value, pg_value)} for mismatches only."""
    if fs is None and pg is None:
        return {}
    if fs is None or pg is None:
        return {'<presence>': (fs is not None, pg is not None)}
    out: dict[str, Any] = {}
    for key in (set(fs) | set(pg)) - ignore:
        a, b = _norm(fs.get(key)), _norm(pg.get(key))
        if a != b:
            out[key] = (a, b)
    return out


def _diff_list(fs: list | None, pg: list | None, ignore: frozenset) -> dict:
    """Set-by-id diff of two list reads (membership/coverage parity). Per-item
    field diff + ordering checks arrive with the list-entity slices; for now this
    surfaces rows present on one side only — the live analog of parity_report."""
    fs_ids = {r.get('id') for r in (fs or [])}
    pg_ids = {r.get('id') for r in (pg or [])}
    out: dict[str, Any] = {}
    if fs_ids - pg_ids:
        out['missing_in_pg'] = sorted(x for x in (fs_ids - pg_ids) if x is not None)
    if pg_ids - fs_ids:
        out['extra_in_pg'] = sorted(x for x in (pg_ids - fs_ids) if x is not None)
    return out


def _diff(fs: Any, pg: Any, ignore: frozenset) -> dict:
    if isinstance(fs, list) or isinstance(pg, list):
        return _diff_list(fs if isinstance(fs, list) else None,
                          pg if isinstance(pg, list) else None, ignore)
    return _diff_dict(fs, pg, ignore)


class ReadRouter:
    """Firestore-module wrapper that routes cut-over reads to Postgres per flag."""

    def __init__(self, fs_db: Any, sql_engine: Callable[[], Any]):
        self._fs = fs_db                  # the Firestore `database` module
        self._sql_engine = sql_engine     # deps.sql_engine provider (engine | None)

    def __getattr__(self, name: str) -> Any:
        # Reached only for attributes NOT defined on ReadRouter -> Firestore.
        # (Writes, not-yet-cut readers, and module constants all land here.)
        return getattr(self._fs, name)

    # --- routing core -----------------------------------------------------

    def _pg_read(self, pg_call: Callable[[Any], Any], engine: Any) -> Any:
        """Run pg_call in a short-lived, latency-bounded Session (lazy imports
        keep the flag-OFF footprint at os + logging)."""
        from sqlalchemy import text
        from sqlalchemy.orm import Session

        with Session(engine) as session:
            session.execute(
                text(f"SET LOCAL statement_timeout = '{_READ_STATEMENT_TIMEOUT_MS}ms'")
            )
            return pg_call(session)

    def _shadow_compare(self, flag, fs_result, pg_call, engine, ignore) -> None:
        """Read PG, compare to the Firestore result, log mismatches + a periodic
        rolling summary. Never raises, never mutates the response (Firestore stays
        authoritative in shadow)."""
        try:
            pg_result = self._pg_read(pg_call, engine)
        except Exception:  # noqa: BLE001 — a broken shadow read must not affect the request
            _log.exception('shadow-read %s: PG side errored', flag)
            return
        diff = _diff(fs_result, pg_result, ignore)
        stats = _shadow_stats.setdefault(flag, [0, 0])
        stats[0] += 1
        if diff:
            stats[1] += 1
            _log.warning('shadow-read MISMATCH %s [#%d]: %s', flag, stats[0], diff)
        elif stats[0] == 1 or stats[0] % _SHADOW_SUMMARY_EVERY == 0:
            # Positive "shadow is running + clean" signal (first compare + every N).
            _log.warning(
                'shadow-read %s: %d compared, %d mismatched (rolling, this instance)',
                flag, stats[0], stats[1],
            )

    def _route_read(self, flag, fs_call, pg_call, *, ignore=frozenset()):
        """The 3-state per-entity gate. See module docstring."""
        mode = os.environ.get(flag, '')
        if mode not in ('shadow', '1'):
            return fs_call()
        engine = _resolve_engine(self._sql_engine)
        if engine is None:                       # no Cloud SQL target -> Firestore
            return fs_call()
        if mode == 'shadow':
            fs_result = fs_call()
            self._shadow_compare(flag, fs_result, pg_call, engine, ignore)
            return fs_result
        try:                                     # mode == '1': PG authoritative
            return self._pg_read(pg_call, engine)
        except Exception:  # noqa: BLE001 — fail-open: any PG failure -> Firestore
            _log.exception('%s: PG read failed; fail-open to Firestore', flag)
            return fs_call()

    # --- overridden readers ----------------------------------------------

    def get_organization(self, org_id):
        """organizations point-get, routed by READ_PG_ORGANIZATIONS."""
        def pg_call(session):
            from backend.db.repository import organizations_read
            return organizations_read.get_organization(session, org_id)

        return self._route_read(
            'READ_PG_ORGANIZATIONS',
            lambda: self._fs.get_organization(org_id),
            pg_call,
            ignore=_ORG_SHADOW_IGNORE,
        )
