"""Alembic environment.

Sources the connection from backend.db.sql.get_engine() (online) or DATABASE_URL
(offline `--sql` rendering), so migrations and the app share one surface.
target_metadata is the full Base.metadata, populated by importing the models.
"""

from __future__ import annotations

import os

from alembic import context

# Import models so Base.metadata is complete for autogenerate / drift checks.
import backend.db.models  # noqa: F401
from backend.db.base import Base

config = context.config

target_metadata = Base.metadata

# Offline rendering (alembic ... --sql) needs a URL only to pick the dialect.
_OFFLINE_FALLBACK_URL = 'postgresql+pg8000://user:pass@localhost:5432/lingual'


def run_migrations_offline() -> None:
    url = os.environ.get('DATABASE_URL') or _OFFLINE_FALLBACK_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={'paramstyle': 'named'},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from backend.db.sql import get_engine

    connectable = get_engine()
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
