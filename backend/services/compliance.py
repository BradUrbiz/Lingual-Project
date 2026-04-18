from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

SUPPORTED_CONSENT_STATUSES = {"unknown", "granted", "revoked", "not_required"}
TEACHER_ALLOWED_ROLES = {"teacher", "school_admin"}
DEFAULT_RETENTION_POLICY_ID = "standard_school"
SUPPORTED_MODALITY_MODES = {"text_only", "voice_only", "hybrid"}

RETENTION_POLICIES: dict[str, dict[str, Any]] = {
    "standard_school": {
        "id": "standard_school",
        "label": "Standard school retention",
        "raw_audio_storage_allowed": True,
        "raw_audio_retention_days": 30,
        "transcript_retention_days": 365,
        "analytics_retention_days": 730,
    },
    "no_raw_audio": {
        "id": "no_raw_audio",
        "label": "No raw audio retention",
        "raw_audio_storage_allowed": False,
        "raw_audio_retention_days": 0,
        "transcript_retention_days": 365,
        "analytics_retention_days": 730,
    },
}


def _normalize_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _normalize_bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


def normalize_modality_policy(policy: Any) -> dict[str, Any]:
    normalized = {
        "mode": "hybrid",
        "voice_minutes_cap": None,
        "text_fallback_enabled": True,
    }
    if isinstance(policy, dict):
        mode = _normalize_string(policy.get("mode"))
        voice_minutes_cap = policy.get("voice_minutes_cap", policy.get("voiceMinutesCap"))
        text_fallback_enabled = policy.get(
            "text_fallback_enabled",
            policy.get("textFallbackEnabled"),
        )
        if mode in SUPPORTED_MODALITY_MODES:
            normalized["mode"] = mode
        if isinstance(voice_minutes_cap, int):
            normalized["voice_minutes_cap"] = max(0, voice_minutes_cap)
        if isinstance(text_fallback_enabled, bool):
            normalized["text_fallback_enabled"] = text_fallback_enabled
    return normalized


def serialize_modality_policy(policy: Any) -> dict[str, Any]:
    normalized = normalize_modality_policy(policy)
    return {
        "mode": normalized["mode"],
        "voiceMinutesCap": normalized["voice_minutes_cap"],
        "textFallbackEnabled": normalized["text_fallback_enabled"],
    }


def _timestamp_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "seconds"):
        return datetime.fromtimestamp(value.seconds, UTC).isoformat()
    return str(value)


def normalize_consent_status(value: Any, *, allow_not_required: bool = True) -> str:
    normalized = _normalize_string(value).lower()
    if normalized not in SUPPORTED_CONSENT_STATUSES:
        return "unknown"
    if normalized == "not_required" and not allow_not_required:
        return "unknown"
    return normalized


def get_retention_policy(policy_id: Any) -> dict[str, Any]:
    normalized = _normalize_string(policy_id) or DEFAULT_RETENTION_POLICY_ID
    policy = RETENTION_POLICIES.get(normalized) or RETENTION_POLICIES[DEFAULT_RETENTION_POLICY_ID]
    return dict(policy)


def serialize_retention_policy(policy: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": policy.get("id", DEFAULT_RETENTION_POLICY_ID),
        "label": policy.get("label", "Standard school retention"),
        "rawAudioStorageAllowed": bool(policy.get("raw_audio_storage_allowed", True)),
        "rawAudioRetentionDays": policy.get("raw_audio_retention_days"),
        "transcriptRetentionDays": policy.get("transcript_retention_days"),
        "analyticsRetentionDays": policy.get("analytics_retention_days"),
    }


def _derive_is_minor(user: dict[str, Any] | None) -> bool:
    profile = user.get("profile", {}) if isinstance(user, dict) else {}
    age = profile.get("age")
    if isinstance(age, int):
        return age < 18
    return True


def _compute_voice_allowed(
    *,
    is_minor: bool,
    guardian_consent_status: str,
    voice_consent_status: str,
) -> bool:
    if voice_consent_status != "granted":
        return False
    if is_minor and guardian_consent_status != "granted":
        return False
    return True


def normalize_student_compliance_record(
    record: dict[str, Any] | None,
    *,
    org_id: str,
    student_uid: str,
    user: dict[str, Any] | None = None,
    organization: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record = record if isinstance(record, dict) else {}
    is_minor = _normalize_bool(record.get("is_minor"), default=_derive_is_minor(user))
    guardian_consent_status = normalize_consent_status(
        record.get("guardian_consent_status"),
        allow_not_required=not is_minor,
    )
    if not is_minor:
        guardian_consent_status = "not_required"
    voice_consent_status = normalize_consent_status(
        record.get("voice_consent_status"),
        allow_not_required=False,
    )
    text_allowed = _normalize_bool(record.get("text_allowed"), default=True)
    retention_policy_id = (
        _normalize_string(record.get("retention_policy_id"))
        or _normalize_string((organization or {}).get("default_retention_policy"))
        or DEFAULT_RETENTION_POLICY_ID
    )
    retention_policy = get_retention_policy(retention_policy_id)

    return {
        "id": _normalize_string(record.get("id")) or f"{org_id}_{student_uid}",
        "org_id": org_id,
        "student_uid": student_uid,
        "is_minor": is_minor,
        "guardian_consent_status": guardian_consent_status,
        "voice_consent_status": voice_consent_status,
        "text_allowed": text_allowed,
        "voice_allowed": _compute_voice_allowed(
            is_minor=is_minor,
            guardian_consent_status=guardian_consent_status,
            voice_consent_status=voice_consent_status,
        ),
        "retention_policy_id": retention_policy["id"],
        "school_agreement_version": _normalize_string(record.get("school_agreement_version")),
        "last_verified_at": record.get("last_verified_at"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
    }


def serialize_student_compliance_record(record: dict[str, Any]) -> dict[str, Any]:
    retention_policy = get_retention_policy(record.get("retention_policy_id"))
    return {
        "id": record.get("id"),
        "orgId": record.get("org_id"),
        "studentUid": record.get("student_uid"),
        "isMinor": bool(record.get("is_minor")),
        "guardianConsentStatus": record.get("guardian_consent_status", "unknown"),
        "voiceConsentStatus": record.get("voice_consent_status", "unknown"),
        "textAllowed": bool(record.get("text_allowed", True)),
        "voiceAllowed": bool(record.get("voice_allowed", False)),
        "retentionPolicyId": retention_policy.get("id", DEFAULT_RETENTION_POLICY_ID),
        "retentionPolicy": serialize_retention_policy(retention_policy),
        "schoolAgreementVersion": record.get("school_agreement_version", ""),
        "lastVerifiedAt": _timestamp_to_iso(record.get("last_verified_at")),
        "createdAt": _timestamp_to_iso(record.get("created_at")),
        "updatedAt": _timestamp_to_iso(record.get("updated_at")),
    }


def resolve_student_compliance_record(
    deps: Any,
    *,
    org_id: str,
    student_uid: str,
) -> dict[str, Any]:
    organization = deps.db.get_organization(org_id) if hasattr(deps.db, "get_organization") else None
    user = deps.db.get_user(student_uid) if hasattr(deps.db, "get_user") else None

    if not hasattr(deps.db, "get_student_compliance_record"):
        legacy_policy_id = _normalize_string((organization or {}).get("default_retention_policy")) or DEFAULT_RETENTION_POLICY_ID
        return {
            "id": f"{org_id}_{student_uid}",
            "org_id": org_id,
            "student_uid": student_uid,
            "is_minor": _derive_is_minor(user),
            "guardian_consent_status": "granted" if _derive_is_minor(user) else "not_required",
            "voice_consent_status": "granted",
            "text_allowed": True,
            "voice_allowed": True,
            "retention_policy_id": legacy_policy_id,
            "school_agreement_version": "",
            "last_verified_at": None,
            "created_at": None,
            "updated_at": None,
        }

    stored = deps.db.get_student_compliance_record(org_id, student_uid)
    return normalize_student_compliance_record(
        stored,
        org_id=org_id,
        student_uid=student_uid,
        user=user,
        organization=organization,
    )


def upsert_student_compliance_record(
    deps: Any,
    *,
    org_id: str,
    student_uid: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    current = resolve_student_compliance_record(deps, org_id=org_id, student_uid=student_uid)
    merged = {
        **current,
        **(updates if isinstance(updates, dict) else {}),
    }
    normalized = normalize_student_compliance_record(
        merged,
        org_id=org_id,
        student_uid=student_uid,
        user=deps.db.get_user(student_uid) if hasattr(deps.db, "get_user") else None,
        organization=deps.db.get_organization(org_id) if hasattr(deps.db, "get_organization") else None,
    )
    if hasattr(deps.db, "upsert_student_compliance_record"):
        deps.db.upsert_student_compliance_record(org_id, student_uid, normalized)
    return normalized


def auto_grant_voice_consent_for_pilot(
    db: Any,
    *,
    org_id: str,
    student_uid: str,
) -> None:
    """Pilot: auto-grant voice + guardian consent on student enrollment.

    Pilot schools opt in to voice practice as part of onboarding, so each
    student enrollment writes a compliance record with voice_consent_status
    and (for minors) guardian_consent_status set to ``granted``. Teachers and
    admins can still revoke per-student on the compliance page — an explicit
    ``revoked`` value is never overridden. Idempotent: when the record is
    already fully granted, no write happens. To restore the explicit-consent
    flow, revert this helper and its callers.
    """
    if not hasattr(db, "upsert_student_compliance_record"):
        return
    user = db.get_user(student_uid) if hasattr(db, "get_user") else None
    organization = db.get_organization(org_id) if hasattr(db, "get_organization") else None
    stored = (
        db.get_student_compliance_record(org_id, student_uid)
        if hasattr(db, "get_student_compliance_record")
        else None
    )
    current = normalize_student_compliance_record(
        stored,
        org_id=org_id,
        student_uid=student_uid,
        user=user,
        organization=organization,
    )

    updates: dict[str, Any] = {}
    if current.get("voice_consent_status") not in {"granted", "revoked"}:
        updates["voice_consent_status"] = "granted"
    if current.get("is_minor") and current.get("guardian_consent_status") not in {"granted", "revoked"}:
        updates["guardian_consent_status"] = "granted"
    if not updates:
        return

    merged = {**current, **updates}
    normalized = normalize_student_compliance_record(
        merged,
        org_id=org_id,
        student_uid=student_uid,
        user=user,
        organization=organization,
    )
    db.upsert_student_compliance_record(org_id, student_uid, normalized)


def create_consent_event(
    deps: Any,
    *,
    org_id: str,
    student_uid: str = "",
    scope_type: str = "",
    scope_id: str = "",
    event_type: str,
    actor_type: str,
    actor_id: str,
    payload: dict[str, Any] | None = None,
    evidence_ref: str = "",
) -> None:
    if not hasattr(deps.db, "create_consent_event"):
        return
    deps.db.create_consent_event(
        org_id=org_id,
        student_uid=student_uid,
        scope_type=scope_type or ("student" if student_uid else "org"),
        scope_id=scope_id or student_uid or org_id,
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        payload=payload or {},
        evidence_ref=evidence_ref,
    )


def build_voice_block_reasons(record: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if record.get("is_minor") and record.get("guardian_consent_status") != "granted":
        reasons.append("Guardian consent is required before voice practice can start.")
    if record.get("voice_consent_status") != "granted":
        reasons.append("Voice consent has not been granted for this student.")
    return reasons


def apply_launch_compliance(
    modality_policy: dict[str, Any] | None,
    compliance_record: dict[str, Any],
    *,
    teacher_preview: bool = False,
) -> dict[str, Any]:
    requested_policy = normalize_modality_policy(modality_policy or {})
    requested_mode = requested_policy.get("mode", "hybrid")
    text_allowed_by_record = bool(compliance_record.get("text_allowed", True))
    voice_allowed_by_record = bool(compliance_record.get("voice_allowed", False))
    fallback_enabled = bool(requested_policy.get("text_fallback_enabled", True))
    blocked_reasons: list[str] = []
    fallback_applied = False

    if teacher_preview:
        effective_mode = requested_mode
        voice_allowed = requested_mode in {"voice_only", "hybrid"}
        text_allowed = requested_mode in {"text_only", "hybrid"}
    elif requested_mode == "text_only":
        effective_mode = "text_only"
        voice_allowed = False
        text_allowed = text_allowed_by_record
        if not text_allowed:
            blocked_reasons.append("Text practice is disabled for this student.")
    elif requested_mode in {"voice_only", "hybrid"}:
        if voice_allowed_by_record:
            voice_allowed = True
            if requested_mode == "voice_only":
                effective_mode = "voice_only"
                text_allowed = False
            else:
                effective_mode = "hybrid" if text_allowed_by_record else "voice_only"
                text_allowed = text_allowed_by_record
        else:
            blocked_reasons.extend(build_voice_block_reasons(compliance_record))
            if fallback_enabled and text_allowed_by_record:
                fallback_applied = True
                effective_mode = "text_only"
                voice_allowed = False
                text_allowed = True
            else:
                effective_mode = requested_mode
                voice_allowed = False
                text_allowed = False
                if not fallback_enabled:
                    blocked_reasons.append("Text fallback is disabled for this assignment.")
                elif not text_allowed_by_record:
                    blocked_reasons.append("Text practice is disabled for this student.")
    else:
        effective_mode = "hybrid"
        voice_allowed = voice_allowed_by_record
        text_allowed = text_allowed_by_record

    retention_policy = get_retention_policy(compliance_record.get("retention_policy_id"))
    return {
        "configuredMode": requested_mode,
        "modality": {
            **serialize_modality_policy(requested_policy),
            "mode": effective_mode,
        },
        "voiceAllowed": voice_allowed,
        "textAllowed": text_allowed,
        "fallbackApplied": fallback_applied,
        "blockedReasons": list(dict.fromkeys(reason for reason in blocked_reasons if reason)),
        "retentionPolicy": serialize_retention_policy(retention_policy),
    }


def resolve_assignment_launch(
    deps: Any,
    *,
    org_id: str,
    student_uid: str,
    modality_policy: dict[str, Any] | None,
    teacher_preview: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    compliance_record = resolve_student_compliance_record(
        deps,
        org_id=org_id,
        student_uid=student_uid,
    )
    return apply_launch_compliance(
        modality_policy,
        compliance_record,
        teacher_preview=teacher_preview,
    ), compliance_record


def is_school_voice_context(context: Any | None) -> bool:
    if not context:
        return False
    if not getattr(context, "active_organization_id", None):
        return False
    active_roles = set(getattr(context, "active_roles", ()) or ())
    return "student" in active_roles
