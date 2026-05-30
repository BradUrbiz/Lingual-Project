"""Postgres repository seam.

These modules are the data-access primitives for the staged Firestore -> Postgres
cutover. They are INERT in this increment: no route imports or calls them yet.
At cutover, a thin delegating adapter on `deps.db` will flip a function group
from Firestore to these, resolving Firestore string ids -> UUIDs via
`resolution.resolve_legacy_id` and managing the SQLAlchemy session.
"""
