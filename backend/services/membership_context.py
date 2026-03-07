from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


class SchoolContextError(Exception):
    """Base error for school membership context resolution."""


class SchoolContextNotFoundError(SchoolContextError):
    """Raised when a requested membership or school context does not exist."""


class SchoolContextPermissionError(PermissionError, SchoolContextError):
    """Raised when the current user lacks the required school role."""


@dataclass(frozen=True)
class SchoolRequestContext:
    """Resolved school membership context for the current request."""

    uid: str
    memberships: tuple[dict[str, Any], ...]
    active_membership: dict[str, Any] | None
    active_membership_id: str | None
    active_organization_id: str | None
    active_roles: tuple[str, ...]
    allowed_class_ids: tuple[str, ...]

    def has_role(self, role: str) -> bool:
        return role in self.active_roles

    def has_any_role(self, roles: Iterable[str]) -> bool:
        return any(role in self.active_roles for role in roles)

    def require_any_role(self, roles: Iterable[str]) -> "SchoolRequestContext":
        role_list = tuple(role for role in roles if isinstance(role, str) and role)
        if self.has_any_role(role_list):
            return self
        expected_roles = ", ".join(role_list) if role_list else "school membership"
        raise SchoolContextPermissionError(f"Required role not present. Expected one of: {expected_roles}.")

    def to_dict(self) -> dict[str, Any]:
        return {
            "uid": self.uid,
            "memberships": [dict(membership) for membership in self.memberships],
            "active_membership": dict(self.active_membership) if self.active_membership else None,
            "active_membership_id": self.active_membership_id,
            "active_organization_id": self.active_organization_id,
            "active_roles": list(self.active_roles),
            "allowed_class_ids": list(self.allowed_class_ids),
        }


def build_school_request_context(uid: str, school_context: dict[str, Any] | None) -> SchoolRequestContext:
    school_context = school_context or {}
    active_membership = school_context.get("active_membership")
    if isinstance(active_membership, dict):
        normalized_active_membership = dict(active_membership)
    else:
        normalized_active_membership = None

    memberships = school_context.get("memberships") or []
    normalized_memberships = tuple(
        dict(membership)
        for membership in memberships
        if isinstance(membership, dict)
    )
    active_roles = tuple(
        role
        for role in (school_context.get("active_roles") or [])
        if isinstance(role, str) and role
    )
    allowed_class_ids = tuple(
        class_id
        for class_id in (normalized_active_membership or {}).get("primaryClassIds", [])
        if isinstance(class_id, str) and class_id
    )

    return SchoolRequestContext(
        uid=uid,
        memberships=normalized_memberships,
        active_membership=normalized_active_membership,
        active_membership_id=school_context.get("active_membership_id"),
        active_organization_id=school_context.get("active_organization_id"),
        active_roles=active_roles,
        allowed_class_ids=allowed_class_ids,
    )


def resolve_school_request_context(db: Any, uid: str, preferred_active_membership_id: str | None = None) -> SchoolRequestContext:
    school_context = db.resolve_user_school_context(
        uid,
        preferred_active_membership_id=preferred_active_membership_id,
    )
    return build_school_request_context(uid, school_context)
