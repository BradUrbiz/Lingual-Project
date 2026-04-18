from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping


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
    get_user_proficiency_context: Callable[[], str]
    build_system_prompt: Callable[..., str]
    get_school_request_context: Callable[[], Any]
    set_active_school_membership: Callable[[str], Any]
    allowed_learning_locales: set[str]
    allowed_minigame_types: set[str]
    supported_ui_languages: set[str]
