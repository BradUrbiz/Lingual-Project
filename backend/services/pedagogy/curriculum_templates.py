from __future__ import annotations

from typing import Any


def _normalize_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _normalize_i18n_text(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        str(locale).strip(): text.strip()
        for locale, text in value.items()
        if isinstance(locale, str) and locale.strip() and isinstance(text, str) and text.strip()
    }


def serialize_activity_template(template: dict[str, Any] | None) -> dict[str, Any]:
    template = template if isinstance(template, dict) else {}
    interaction = template.get("interactionPattern", {}) if isinstance(template.get("interactionPattern"), dict) else {}

    return {
        "id": _normalize_string(template.get("id")),
        "title": _normalize_i18n_text(template.get("title")),
        "mode": _normalize_string(template.get("mode")),
        "assistantRole": _normalize_string(template.get("assistantRole")),
        "interactionPattern": {
            "openingMoves": _normalize_string_list(interaction.get("openingMoves")),
            "sustainMoves": _normalize_string_list(interaction.get("sustainMoves")),
            "closingMoves": _normalize_string_list(interaction.get("closingMoves")),
            "completionRule": _normalize_string(interaction.get("completionRule")),
        },
        "promptCues": _normalize_string_list(template.get("promptCues")),
    }


def build_activity_template_index(package: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    package = package if isinstance(package, dict) else {}
    templates_obj = package.get("templates", {}) if isinstance(package.get("templates"), dict) else {}
    template_index: dict[str, dict[str, Any]] = {}

    for template in templates_obj.get("activityTemplates", []) or []:
        if not isinstance(template, dict):
            continue
        serialized = serialize_activity_template(template)
        template_id = serialized.get("id")
        if template_id:
            template_index[template_id] = serialized

    return template_index


def resolve_activity_templates(
    package: dict[str, Any] | None,
    *,
    template_refs: list[str] | None,
) -> list[dict[str, Any]]:
    refs = _normalize_string_list(template_refs)
    if not refs:
        return []

    template_index = build_activity_template_index(package)
    resolved: list[dict[str, Any]] = []
    for template_ref in refs:
        template = template_index.get(template_ref)
        if template:
            resolved.append(template)
    return resolved
