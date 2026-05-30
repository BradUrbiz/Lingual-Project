"""Cloud SQL for PostgreSQL engine factory.

Two connection paths behind one entry point (`get_engine`):

- **Prod (Cloud Run):** the Cloud SQL Python Connector. Selected when
  `INSTANCE_CONNECTION_NAME` is set. No proxy sidecar, IAM-mTLS, optional
  passwordless IAM auth (`DB_IAM_AUTH=1`). Uses the pure-python `pg8000`
  driver so the Docker image needs no system build deps.
- **Local dev / CI:** a plain TCP DSN via `DATABASE_URL`
  (e.g. a `cloud-sql-proxy` or a local Postgres). The connector code path
  never runs locally.

Design rules:
- **Side-effect-free import.** No engine, connector, or network at import time.
- **Lazy, process-singleton engine** built post-fork on first use (forking a
  process that already owns connector/refresh threads is the classic Cloud SQL
  footgun under gunicorn). Memoized with a module-level handle.
- **Feature-gated.** Absent `INSTANCE_CONNECTION_NAME` and `DATABASE_URL`,
  `sql_enabled()` is False and `get_engine()` raises a clear error rather than
  the app crashing at boot — runtime is still Firestore.
"""

from __future__ import annotations

import os
import threading
from typing import Any

# Pool sized to the fixed gunicorn ceiling (--workers 1 --threads 8, Dockerfile).
_POOL_KWARGS = dict(
    pool_size=8,
    max_overflow=2,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=30,
    future=True,
)

_engine: Any = None
_connector: Any = None
_lock = threading.Lock()


def sql_enabled() -> bool:
    """True when a Postgres connection target is configured.

    Either the Cloud SQL connector (INSTANCE_CONNECTION_NAME) or a local TCP
    DSN (DATABASE_URL) counts. When False, no Postgres-backed feature should
    attempt a connection; callers fall back to Firestore.
    """
    return bool(
        os.environ.get('INSTANCE_CONNECTION_NAME')
        or os.environ.get('DATABASE_URL')
    )


def _missing_var(name: str) -> str:
    return (
        f'{name} is required to build the Postgres engine. Set '
        'INSTANCE_CONNECTION_NAME + DB_USER + DB_NAME (+ DB_PASS unless '
        'DB_IAM_AUTH=1) for Cloud SQL, or DATABASE_URL for local TCP.'
    )


def _connector_singleton() -> Any:
    """Lazily build one Cloud SQL Connector per process.

    LAZY refresh strategy: Cloud Run throttles CPU between requests and would
    starve a background refresh thread, so refresh on demand instead.
    """
    global _connector
    if _connector is None:
        from google.cloud.sql.connector import Connector, RefreshStrategy

        _connector = Connector(refresh_strategy=RefreshStrategy.LAZY)
    return _connector


def _getconn() -> Any:
    """`creator=` callback for the connector-backed engine (pg8000 connection)."""
    instance = os.environ.get('INSTANCE_CONNECTION_NAME')
    if not instance:
        raise RuntimeError(_missing_var('INSTANCE_CONNECTION_NAME'))
    db_user = os.environ.get('DB_USER')
    db_name = os.environ.get('DB_NAME')
    if not db_user or not db_name:
        raise RuntimeError(_missing_var('DB_USER/DB_NAME'))

    use_iam = os.environ.get('DB_IAM_AUTH') == '1'
    kwargs: dict[str, Any] = {
        'driver': 'pg8000',
        'user': db_user,
        'db': db_name,
        'ip_type': os.environ.get('DB_IP_TYPE', 'PUBLIC'),
    }
    if use_iam:
        kwargs['enable_iam_auth'] = True
    else:
        db_pass = os.environ.get('DB_PASS')
        if not db_pass:
            raise RuntimeError(_missing_var('DB_PASS (or set DB_IAM_AUTH=1)'))
        kwargs['password'] = db_pass

    return _connector_singleton().connect(instance, **kwargs)


def _build_engine() -> Any:
    from sqlalchemy import create_engine

    database_url = os.environ.get('DATABASE_URL')
    if database_url:
        # Local / CI TCP path. The connector is never touched.
        return create_engine(database_url, **_POOL_KWARGS)

    if not os.environ.get('INSTANCE_CONNECTION_NAME'):
        raise RuntimeError(_missing_var('INSTANCE_CONNECTION_NAME'))

    # Cloud SQL connector path. The dialect URL is a placeholder; `creator`
    # supplies the real connection.
    return create_engine('postgresql+pg8000://', creator=_getconn, **_POOL_KWARGS)


def get_engine() -> Any:
    """Return the lazy process-singleton SQLAlchemy engine.

    Built on first call (post-fork), memoized thereafter. Raises if no
    Postgres target is configured — callers should gate on `sql_enabled()`.
    """
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                _engine = _build_engine()
    return _engine


def dispose_engine() -> None:
    """Dispose the engine and close the connector. For tests and shutdown."""
    global _engine, _connector
    with _lock:
        if _engine is not None:
            _engine.dispose()
            _engine = None
        if _connector is not None:
            _connector.close()
            _connector = None
