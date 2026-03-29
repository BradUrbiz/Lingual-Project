import unittest

from backend.services.membership_context import (
    SchoolContextPermissionError,
    SchoolRequestContext,
    build_school_request_context,
    resolve_school_request_context,
)


# ---------------------------------------------------------------------------
# SchoolRequestContext — construction and role checks
# ---------------------------------------------------------------------------
class TestSchoolRequestContextRoleChecks(unittest.TestCase):

    def _make_context(self, roles=("teacher",), class_ids=("class-1",)):
        return SchoolRequestContext(
            uid="user-1",
            memberships=({"id": "mem-1", "roles": list(roles), "primaryClassIds": list(class_ids)},),
            active_membership={"id": "mem-1", "roles": list(roles), "primaryClassIds": list(class_ids)},
            active_membership_id="mem-1",
            active_organization_id="org-1",
            active_roles=roles,
            allowed_class_ids=class_ids,
        )

    def test_has_role_true(self):
        ctx = self._make_context(roles=("teacher",))
        self.assertTrue(ctx.has_role("teacher"))

    def test_has_role_false(self):
        ctx = self._make_context(roles=("teacher",))
        self.assertFalse(ctx.has_role("school_admin"))

    def test_has_any_role_true(self):
        ctx = self._make_context(roles=("teacher",))
        self.assertTrue(ctx.has_any_role({"teacher", "school_admin"}))

    def test_has_any_role_false(self):
        ctx = self._make_context(roles=("student",))
        self.assertFalse(ctx.has_any_role({"teacher", "school_admin"}))

    def test_require_any_role_passes(self):
        ctx = self._make_context(roles=("school_admin",))
        result = ctx.require_any_role({"teacher", "school_admin"})
        self.assertIs(result, ctx)

    def test_require_any_role_raises(self):
        ctx = self._make_context(roles=("student",))
        with self.assertRaises(SchoolContextPermissionError) as cm:
            ctx.require_any_role({"teacher", "school_admin"})
        self.assertIn("Expected one of", str(cm.exception))

    def test_require_any_role_filters_non_string(self):
        ctx = self._make_context(roles=("teacher",))
        result = ctx.require_any_role(["teacher", None, "", 42])
        self.assertIs(result, ctx)

    def test_frozen_dataclass(self):
        ctx = self._make_context()
        with self.assertRaises(AttributeError):
            ctx.uid = "other"


class TestSchoolRequestContextProperties(unittest.TestCase):

    def test_allowed_class_ids(self):
        ctx = SchoolRequestContext(
            uid="u-1",
            memberships=(),
            active_membership={"id": "m-1", "primaryClassIds": ["c-1", "c-2"]},
            active_membership_id="m-1",
            active_organization_id="org-1",
            active_roles=("teacher",),
            allowed_class_ids=("c-1", "c-2"),
        )
        self.assertEqual(ctx.allowed_class_ids, ("c-1", "c-2"))

    def test_to_dict_round_trips(self):
        ctx = SchoolRequestContext(
            uid="u-1",
            memberships=({"id": "m-1", "roles": ["teacher"]},),
            active_membership={"id": "m-1", "roles": ["teacher"]},
            active_membership_id="m-1",
            active_organization_id="org-1",
            active_roles=("teacher",),
            allowed_class_ids=("c-1",),
        )
        d = ctx.to_dict()
        self.assertEqual(d["uid"], "u-1")
        self.assertEqual(d["active_roles"], ["teacher"])
        self.assertEqual(d["allowed_class_ids"], ["c-1"])
        self.assertIsInstance(d["memberships"], list)


# ---------------------------------------------------------------------------
# build_school_request_context
# ---------------------------------------------------------------------------
class TestBuildSchoolRequestContext(unittest.TestCase):

    def test_builds_from_valid_dict(self):
        ctx = build_school_request_context("u-1", {
            "memberships": [{"id": "m-1", "roles": ["teacher"]}, {"id": "m-2", "roles": ["student"]}],
            "active_membership": {"id": "m-1", "roles": ["teacher"], "primaryClassIds": ["c-1"]},
            "active_membership_id": "m-1",
            "active_organization_id": "org-1",
            "active_roles": ["teacher"],
        })
        self.assertEqual(ctx.uid, "u-1")
        self.assertEqual(ctx.active_membership_id, "m-1")
        self.assertEqual(ctx.active_organization_id, "org-1")
        self.assertEqual(ctx.active_roles, ("teacher",))
        self.assertEqual(ctx.allowed_class_ids, ("c-1",))
        self.assertEqual(len(ctx.memberships), 2)

    def test_builds_from_none(self):
        ctx = build_school_request_context("u-1", None)
        self.assertEqual(ctx.uid, "u-1")
        self.assertIsNone(ctx.active_membership)
        self.assertIsNone(ctx.active_membership_id)
        self.assertEqual(ctx.active_roles, ())
        self.assertEqual(ctx.allowed_class_ids, ())

    def test_builds_from_empty_dict(self):
        ctx = build_school_request_context("u-1", {})
        self.assertEqual(ctx.memberships, ())
        self.assertEqual(ctx.active_roles, ())

    def test_filters_non_string_roles(self):
        ctx = build_school_request_context("u-1", {
            "active_roles": ["teacher", None, 42, "", "school_admin"],
        })
        self.assertEqual(ctx.active_roles, ("teacher", "school_admin"))

    def test_filters_non_dict_memberships(self):
        ctx = build_school_request_context("u-1", {
            "memberships": [{"id": "m-1"}, "invalid", None, 42],
        })
        self.assertEqual(len(ctx.memberships), 1)

    def test_allowed_class_ids_from_primary_class_ids(self):
        ctx = build_school_request_context("u-1", {
            "active_membership": {"id": "m-1", "primaryClassIds": ["c-1", "c-2", None, ""]},
        })
        self.assertEqual(ctx.allowed_class_ids, ("c-1", "c-2"))

    def test_no_allowed_classes_without_active_membership(self):
        ctx = build_school_request_context("u-1", {
            "active_membership": None,
        })
        self.assertEqual(ctx.allowed_class_ids, ())


# ---------------------------------------------------------------------------
# resolve_school_request_context
# ---------------------------------------------------------------------------
class TestResolveSchoolRequestContext(unittest.TestCase):

    def test_delegates_to_db_and_builds(self):
        class FakeDb:
            def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
                return {
                    "memberships": [{"id": "m-1", "roles": ["teacher"]}],
                    "active_membership": {"id": "m-1", "roles": ["teacher"], "primaryClassIds": ["c-1"]},
                    "active_membership_id": "m-1",
                    "active_organization_id": "org-1",
                    "active_roles": ["teacher"],
                }

        ctx = resolve_school_request_context(FakeDb(), "u-1")
        self.assertEqual(ctx.uid, "u-1")
        self.assertEqual(ctx.active_roles, ("teacher",))

    def test_passes_preferred_membership_id(self):
        class FakeDb:
            def __init__(self):
                self.last_preferred = None

            def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
                self.last_preferred = preferred_active_membership_id
                return {}

        db = FakeDb()
        resolve_school_request_context(db, "u-1", preferred_active_membership_id="m-2")
        self.assertEqual(db.last_preferred, "m-2")


if __name__ == "__main__":
    unittest.main()
