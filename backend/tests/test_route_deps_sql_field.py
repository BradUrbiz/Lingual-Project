"""Tier 1 (no DB): RouteDeps stays backward-compatible after adding sql_engine.

Guards the default-factory compat promise: every existing RouteDeps(...) and
make_test_deps call that omits sql_engine must still construct, and the default
provider must be the inert no-op (returns None).
"""

import unittest

from backend.route_deps import RouteDeps, _no_sql_engine


def _minimal_deps(**overrides):
    base = dict(
        db=None,
        firebase_auth=None,
        get_current_user_uid=lambda: None,
        get_openai_client=lambda: None,
        get_assessment=lambda: {},
        compute_results=lambda a, b: {},
        get_proficiency_description=lambda **k: {},
        login_required=lambda f: f,
        get_user_proficiency_context=lambda: '',
        build_system_prompt=lambda **k: '',
        get_school_request_context=lambda: None,
        set_active_school_membership=lambda x: None,
        allowed_learning_locales=set(),
        allowed_minigame_types=set(),
        supported_ui_languages=set(),
    )
    base.update(overrides)
    return RouteDeps(**base)


class TestRouteDepsSqlField(unittest.TestCase):
    def test_constructs_without_sql_engine(self):
        deps = _minimal_deps()
        self.assertIs(deps.sql_engine, _no_sql_engine)

    def test_default_provider_returns_none(self):
        deps = _minimal_deps()
        self.assertIsNone(deps.sql_engine())

    def test_accepts_explicit_provider(self):
        sentinel = object()
        deps = _minimal_deps(sql_engine=lambda: sentinel)
        self.assertIs(deps.sql_engine(), sentinel)


if __name__ == '__main__':
    unittest.main()
