"""Suspended-org enforcement helper.

Any code path that mutates org-scoped data or initiates a billable session
calls `enforce_org_active(org_id)`. On a suspended org the helper raises
`SuspendedOrgError`; routes translate that to a 403 with a stable payload
shape so frontends can render a consistent "school suspended" message.

The helper accepts an optional ``db`` argument so test fakes (or any
non-Firestore handle that exposes ``get_organization``) can stand in for
the module-level ``database`` import. Production callers omit it.
"""
from __future__ import annotations

from typing import Any

import database


class SuspendedOrgError(Exception):
    def __init__(self, *, org_id: str, reason: str | None, until=None):
        self.org_id = org_id
        self.reason = reason
        self.until = until
        super().__init__(f'organization {org_id} is suspended')

    def to_payload(self) -> dict:
        payload = {'error': 'org_suspended', 'reason': self.reason}
        if self.until is not None:
            payload['until'] = self.until
        return payload


def _lookup_org(org_id: str, db: Any | None):
    """Resolve an org dict through ``db`` if provided, else the module."""
    if db is not None:
        getter = getattr(db, 'get_organization', None)
        if callable(getter):
            return getter(org_id)
    return database.get_organization(org_id)


def is_org_suspended(org_id: str | None, *, db: Any | None = None) -> bool:
    if not org_id:
        return False
    org = _lookup_org(org_id, db)
    if not org:
        return False
    return org.get('status') == database.ORG_STATUS_SUSPENDED


def enforce_org_active(org_id: str | None, *, db: Any | None = None) -> None:
    """Raise SuspendedOrgError if the org is suspended. No-op when org_id is empty.

    Pass ``db`` to look up the org through an injected handle (e.g.
    ``deps.db`` or a test fake). When omitted, the module-level
    ``database.get_organization`` is used, which is the production path.
    """
    if not org_id:
        return
    org = _lookup_org(org_id, db)
    if not org:
        return
    if org.get('status') == database.ORG_STATUS_SUSPENDED:
        raise SuspendedOrgError(
            org_id=org_id,
            reason=org.get('suspend_reason'),
            until=org.get('suspended_until'),
        )
