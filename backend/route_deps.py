from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from backend.services.audit import AuditLogger


def _no_sql_engine() -> Any:
    """Default Postgres engine provider: none wired (the skeleton is inert).

    Returns None so any future Postgres-backed code can detect that Cloud SQL
    is unavailable and fall back to Firestore.
    """
    return None


@dataclass(frozen=True)
class RouteDeps:
    """Shared dependencies injected into route blueprints."""

    db: Any
    firebase_auth: Any
    get_current_user_uid: Callable[[], str | None]
    get_openai_client: Callable[[], Any]
    get_assessment: Callable[[], dict]
    compute_results: Callable[[dict, dict], dict]
    get_proficiency_description: Callable[..., Mapping[str, str]]
    login_required: Callable[[Callable[..., Any]], Callable[..., Any]]
    get_user_proficiency_context: Callable[..., str]
    build_system_prompt: Callable[..., str]
    get_school_request_context: Callable[[], Any]
    set_active_school_membership: Callable[[str], Any]
    allowed_learning_locales: set[str]
    allowed_minigame_types: set[str]
    supported_ui_languages: set[str]
    # Lingual-admin audit boundary. Blueprints reach the audit logger via
    # `deps.audit_logger` so tests can swap a FakeAuditLogger without mocking
    # Firestore. Default-factory keeps existing constructors compatible.
    audit_logger: AuditLogger = field(default_factory=AuditLogger)
    # Post-beta Postgres engine provider (Cloud SQL). INERT in the current
    # runtime — no route reads/writes use it yet. Defaulted so every existing
    # RouteDeps(...) constructor and test double stays valid. See ADR-0001.
    sql_engine: Callable[[], Any] = _no_sql_engine
