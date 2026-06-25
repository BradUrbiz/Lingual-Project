"""Verify RouteDeps carries an AuditLogger that routes can call via DI.

This is the precedent that closes the LIMITATIONS #29 pattern (routes calling
`database.get_db()` directly) at the audit boundary: blueprints should reach
the audit logger via `deps.audit_logger`, never by importing the service or
`database` module at module load.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.route_deps import RouteDeps
from backend.services.audit import AuditAction, AuditLogger


def _make_minimal_deps(audit_logger: AuditLogger) -> RouteDeps:
    """Construct a RouteDeps with stub callables for every required field."""
    return RouteDeps(
        db=MagicMock(),
        firebase_auth=MagicMock(),
        get_current_user_uid=lambda: None,
        get_openai_client=lambda: None,
        get_assessment=lambda: {},
        compute_results=lambda *_a, **_kw: {},
        get_proficiency_description=lambda *_a, **_kw: {},
        login_required=lambda fn: fn,
        get_user_proficiency_context=lambda **_: '',
        build_system_prompt=lambda *_a, **_kw: '',
        get_school_request_context=lambda: None,
        set_active_school_membership=lambda _mid: None,
        allowed_learning_locales=set(),
        allowed_minigame_types=set(),
        supported_ui_languages=set(),
        audit_logger=audit_logger,
    )


class RouteDepsAuditLoggerTests(unittest.TestCase):
    def test_deps_has_audit_logger(self):
        deps = _make_minimal_deps(
            AuditLogger(collection_factory=lambda: MagicMock())
        )
        self.assertTrue(hasattr(deps, 'audit_logger'))

    def test_audit_logger_is_callable_via_deps(self):
        fake_col = MagicMock()
        fake_col.add.return_value = (None, MagicMock(id='a1'))
        logger = AuditLogger(collection_factory=lambda: fake_col)
        deps = _make_minimal_deps(logger)
        out = deps.audit_logger.log(
            actor_uid='u',
            action=AuditAction.ORG_VIEWED_DETAIL,
            target_type='organization',
            target_id='o',
            target_org_id='o',
            metadata={},
            ip_hash='',
            user_agent='',
        )
        self.assertEqual(out, 'a1')


if __name__ == '__main__':
    unittest.main()
