from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.services.compliance import create_consent_event, resolve_student_compliance_record, upsert_student_compliance_record

DEFAULT_GUARDIAN_NOTICE_VERSION = "guardian_beta_v1"
DEFAULT_CONSENT_SCOPE = "voice_school_beta"
DEFAULT_GUARDIAN_CONSENT_SCOPE = DEFAULT_CONSENT_SCOPE
DEFAULT_GUARDIAN_CONSENT_SCOPE = DEFAULT_CONSENT_SCOPE
DEFAULT_PACKET_TTL_DAYS = 14
MAX_PACKET_TTL_DAYS = 30
SUPPORTED_DELIVERY_METHODS = {"secure_link", "downloadable_notice"}
SUPPORTED_CONTACT_CHANNELS = {"email", "phone", "paper", "other"}
ACTIVE_PACKET_STATUSES = {"draft", "issued", "viewed"}
DECISION_PACKET_STATUSES = {"issued", "viewed"}
TERMINAL_PACKET_STATUSES = {"granted", "revoked", "expired", "canceled"}

GUARDIAN_NOTICE_TEMPLATES: dict[str, dict[str, Any]] = {
    DEFAULT_GUARDIAN_NOTICE_VERSION: {
        "version": DEFAULT_GUARDIAN_NOTICE_VERSION,
        "title": "Guardian consent for Lingual school voice practice",
        "summary": "The school is requesting guardian consent before this student uses voice-enabled Lingual practice.",
        "bullets": [
            "Voice sessions may process the student's spoken responses for assignment-aligned language practice.",
            "The school can still assign text practice even if voice consent is not granted.",
            "Raw audio retention follows the school's configured policy and may be disabled entirely.",
        ],
    }
}


class GuardianPacketError(Exception):
    """Base error for guardian packet operations."""


class GuardianPacketNotFoundError(GuardianPacketError):
    """Raised when a guardian packet cannot be found."""


class GuardianPacketStateError(GuardianPacketError):
    """Raised when a guardian packet action is not valid for the current state."""


def _normalize_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    if hasattr(value, "isoformat"):
        try:
            iso = value.isoformat()
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(UTC)
        except Exception:
            return None
    if hasattr(value, "seconds"):
        return datetime.fromtimestamp(value.seconds, UTC)
    return None


def _timestamp_to_iso(value: Any) -> str | None:
    timestamp = _coerce_datetime(value)
    return timestamp.isoformat() if timestamp else None


def normalize_guardian_notice_version(value: Any) -> str:
    version = _normalize_string(value)
    return version if version in GUARDIAN_NOTICE_TEMPLATES else DEFAULT_GUARDIAN_NOTICE_VERSION


def normalize_delivery_method(value: Any) -> str:
    normalized = _normalize_string(value).lower()
    return normalized if normalized in SUPPORTED_DELIVERY_METHODS else "secure_link"


def normalize_contact_channel(value: Any) -> str:
    normalized = _normalize_string(value).lower()
    return normalized if normalized in SUPPORTED_CONTACT_CHANNELS else "other"


def normalize_packet_status(value: Any) -> str:
    normalized = _normalize_string(value).lower()
    if normalized in ACTIVE_PACKET_STATUSES | TERMINAL_PACKET_STATUSES:
        return normalized
    return "draft"


def _hash_guardian_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_guardian_token() -> str:
    return secrets.token_urlsafe(24)


def build_guardian_notice(version: str) -> dict[str, Any]:
    template = GUARDIAN_NOTICE_TEMPLATES.get(version) or GUARDIAN_NOTICE_TEMPLATES[DEFAULT_GUARDIAN_NOTICE_VERSION]
    return dict(template)


def normalize_guardian_packet(
    packet: dict[str, Any] | None,
    *,
    org_id: str,
    class_id: str,
    student_uid: str,
) -> dict[str, Any]:
    packet = packet if isinstance(packet, dict) else {}
    notice_version = normalize_guardian_notice_version(packet.get("notice_version"))
    delivery_method = normalize_delivery_method(packet.get("delivery_method"))
    status = normalize_packet_status(packet.get("status"))
    reminder_count = packet.get("reminder_count")
    if not isinstance(reminder_count, int):
        reminder_count = 0
    token_hash = _normalize_string(packet.get("token_hash"))
    token_last_four = _normalize_string(packet.get("token_last_four"))

    return {
        "id": _normalize_string(packet.get("id")),
        "org_id": org_id,
        "class_id": class_id,
        "student_uid": student_uid,
        "notice_version": notice_version,
        "consent_scope": _normalize_string(packet.get("consent_scope")) or DEFAULT_CONSENT_SCOPE,
        "contact_channel": normalize_contact_channel(packet.get("contact_channel")),
        "contact_destination_hint": _normalize_string(packet.get("contact_destination_hint")),
        "delivery_method": delivery_method,
        "status": status,
        "token_hash": token_hash,
        "token_last_four": token_last_four,
        "response_method": _normalize_string(packet.get("response_method")),
        "evidence_ref": _normalize_string(packet.get("evidence_ref")),
        "reminder_count": max(0, reminder_count),
        "expires_at": _coerce_datetime(packet.get("expires_at")),
        "issued_at": _coerce_datetime(packet.get("issued_at")),
        "last_sent_at": _coerce_datetime(packet.get("last_sent_at")),
        "acted_at": _coerce_datetime(packet.get("acted_at")),
        "created_by_uid": _normalize_string(packet.get("created_by_uid")),
        "created_at": _coerce_datetime(packet.get("created_at")),
        "updated_at": _coerce_datetime(packet.get("updated_at")),
    }


def serialize_guardian_packet(packet: dict[str, Any] | None, *, raw_token: str | None = None) -> dict[str, Any] | None:
    if not packet:
        return None
    packet = normalize_guardian_packet(
        packet,
        org_id=packet.get("org_id", ""),
        class_id=packet.get("class_id", ""),
        student_uid=packet.get("student_uid", ""),
    )
    serialized = {
        "id": packet.get("id"),
        "orgId": packet.get("org_id"),
        "classId": packet.get("class_id"),
        "studentUid": packet.get("student_uid"),
        "noticeVersion": packet.get("notice_version"),
        "consentScope": packet.get("consent_scope"),
        "contactChannel": packet.get("contact_channel"),
        "contactDestinationHint": packet.get("contact_destination_hint"),
        "deliveryMethod": packet.get("delivery_method"),
        "status": packet.get("status"),
        "tokenLastFour": packet.get("token_last_four"),
        "responseMethod": packet.get("response_method"),
        "evidenceRef": packet.get("evidence_ref"),
        "reminderCount": packet.get("reminder_count", 0),
        "expiresAt": _timestamp_to_iso(packet.get("expires_at")),
        "issuedAt": _timestamp_to_iso(packet.get("issued_at")),
        "lastSentAt": _timestamp_to_iso(packet.get("last_sent_at")),
        "actedAt": _timestamp_to_iso(packet.get("acted_at")),
        "createdByUid": packet.get("created_by_uid"),
        "createdAt": _timestamp_to_iso(packet.get("created_at")),
        "updatedAt": _timestamp_to_iso(packet.get("updated_at")),
        "canResend": packet.get("status") in {"issued", "viewed", "expired"},
        "canCancel": packet.get("status") in {"draft", "issued", "viewed"},
        "isTerminal": packet.get("status") in TERMINAL_PACKET_STATUSES,
    }
    if raw_token:
        serialized["guardianLinkToken"] = raw_token
    return serialized


def _packet_event_payload(packet: dict[str, Any], *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "classId": packet.get("class_id"),
        "packetId": packet.get("id"),
        "noticeVersion": packet.get("notice_version"),
        "consentScope": packet.get("consent_scope"),
        "deliveryMethod": packet.get("delivery_method"),
        "contactChannel": packet.get("contact_channel"),
    }
    if extra:
        payload.update(extra)
    return payload


def _expire_packet_if_needed(deps: Any, packet: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_guardian_packet(
        packet,
        org_id=packet.get("org_id", ""),
        class_id=packet.get("class_id", ""),
        student_uid=packet.get("student_uid", ""),
    )
    expires_at = normalized.get("expires_at")
    if normalized.get("status") in {"issued", "viewed"} and expires_at and expires_at <= datetime.now(UTC):
        updates = {
            "status": "expired",
            "token_hash": "",
            "token_last_four": "",
            "acted_at": datetime.now(UTC),
            "response_method": "expired",
        }
        if hasattr(deps.db, "update_guardian_consent_packet"):
            deps.db.update_guardian_consent_packet(normalized["id"], updates)
        create_consent_event(
            deps,
            org_id=normalized.get("org_id", ""),
            student_uid=normalized.get("student_uid", ""),
            event_type="guardian_packet.expired",
            actor_type="system",
            actor_id="guardian_packet_expiry",
            payload=_packet_event_payload(normalized),
        )
        normalized.update(updates)
    return normalized


def _list_student_packets(deps: Any, *, class_id: str, student_uid: str) -> list[dict[str, Any]]:
    if not hasattr(deps.db, "list_class_guardian_consent_packets"):
        return []
    packets = deps.db.list_class_guardian_consent_packets(class_id, student_uid=student_uid)
    normalized_packets = []
    for packet in packets:
        normalized_packets.append(_expire_packet_if_needed(deps, packet))
    normalized_packets.sort(
        key=lambda item: item.get("updated_at") or item.get("created_at") or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    return normalized_packets


def list_student_guardian_packets(deps: Any, *, class_id: str, student_uid: str) -> list[dict[str, Any]]:
    return _list_student_packets(deps, class_id=class_id, student_uid=student_uid)


def get_latest_guardian_packet(deps: Any, *, class_id: str, student_uid: str) -> dict[str, Any] | None:
    packets = _list_student_packets(deps, class_id=class_id, student_uid=student_uid)
    return packets[0] if packets else None


def get_latest_guardian_consent_packet_for_student(deps: Any, *, class_id: str, student_uid: str) -> dict[str, Any] | None:
    return get_latest_guardian_packet(deps, class_id=class_id, student_uid=student_uid)


def get_latest_guardian_packets_for_class(deps: Any, *, class_id: str) -> dict[str, dict[str, Any]]:
    if not hasattr(deps.db, "list_class_guardian_consent_packets"):
        return {}
    latest_by_student: dict[str, dict[str, Any]] = {}
    packets = deps.db.list_class_guardian_consent_packets(class_id)
    for packet in packets:
        normalized = _expire_packet_if_needed(deps, packet)
        student_uid = normalized.get("student_uid", "")
        if not student_uid or student_uid in latest_by_student:
            continue
        latest_by_student[student_uid] = normalized
    return latest_by_student


def _cancel_active_packets_for_student(
    deps: Any,
    *,
    org_id: str,
    class_id: str,
    student_uid: str,
    actor_type: str,
    actor_id: str,
) -> None:
    packets = _list_student_packets(deps, class_id=class_id, student_uid=student_uid)
    for packet in packets:
        if packet.get("status") not in {"draft", "issued", "viewed"}:
            continue
        if hasattr(deps.db, "update_guardian_consent_packet"):
            deps.db.update_guardian_consent_packet(packet["id"], {
                "status": "canceled",
                "response_method": "superseded",
                "acted_at": datetime.now(UTC),
                "token_hash": "",
                "token_last_four": "",
            })
        create_consent_event(
            deps,
            org_id=org_id,
            student_uid=student_uid,
            event_type="guardian_packet.canceled",
            actor_type=actor_type,
            actor_id=actor_id,
            payload=_packet_event_payload(packet, extra={"reason": "superseded_by_new_issue"}),
        )


def issue_guardian_packet(
    deps: Any,
    *,
    org_id: str,
    class_id: str,
    student_uid: str,
    actor_type: str,
    actor_id: str,
    created_by_uid: str | None = None,
    notice_version: str = DEFAULT_GUARDIAN_NOTICE_VERSION,
    consent_scope: str = DEFAULT_CONSENT_SCOPE,
    contact_channel: str = "email",
    contact_destination_hint: str = "",
    delivery_method: str = "secure_link",
    expires_in_days: int = DEFAULT_PACKET_TTL_DAYS,
) -> tuple[dict[str, Any], str | None]:
    compliance_record = resolve_student_compliance_record(deps, org_id=org_id, student_uid=student_uid)
    if not compliance_record.get("is_minor"):
        raise GuardianPacketStateError("Guardian packets are only required for minor students.")

    _cancel_active_packets_for_student(
        deps,
        org_id=org_id,
        class_id=class_id,
        student_uid=student_uid,
        actor_type=actor_type,
        actor_id=actor_id,
    )

    delivery_method = normalize_delivery_method(delivery_method)
    notice_version = normalize_guardian_notice_version(notice_version)
    contact_channel = normalize_contact_channel(contact_channel)
    try:
        expires_in_days = int(expires_in_days)
    except Exception:
        expires_in_days = DEFAULT_PACKET_TTL_DAYS
    expires_in_days = min(max(1, expires_in_days), MAX_PACKET_TTL_DAYS)
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=expires_in_days)

    raw_token = _new_guardian_token() if delivery_method == "secure_link" else None
    token_hash = _hash_guardian_token(raw_token) if raw_token else ""
    token_last_four = raw_token[-4:] if raw_token else ""

    packet_id = deps.db.create_guardian_consent_packet(
        org_id=org_id,
        class_id=class_id,
        student_uid=student_uid,
        notice_version=notice_version,
        consent_scope=_normalize_string(consent_scope) or DEFAULT_CONSENT_SCOPE,
        contact_channel=contact_channel,
        contact_destination_hint=_normalize_string(contact_destination_hint),
        delivery_method=delivery_method,
        status="issued",
        token_hash=token_hash,
        token_last_four=token_last_four,
        response_method="",
        evidence_ref="",
        reminder_count=0,
        expires_at=expires_at,
        issued_at=now,
        last_sent_at=now,
        acted_at=None,
        created_by_uid=created_by_uid or actor_id,
    )
    packet = deps.db.get_guardian_consent_packet(packet_id)
    packet = normalize_guardian_packet(packet, org_id=org_id, class_id=class_id, student_uid=student_uid)
    create_consent_event(
        deps,
        org_id=org_id,
        student_uid=student_uid,
        event_type="guardian_packet.issued",
        actor_type=actor_type,
        actor_id=actor_id,
        payload=_packet_event_payload(packet),
    )
    return packet, raw_token


def _get_packet_or_raise(deps: Any, packet_id: str) -> dict[str, Any]:
    if not hasattr(deps.db, "get_guardian_consent_packet"):
        raise GuardianPacketNotFoundError("Guardian packet not found.")
    packet = deps.db.get_guardian_consent_packet(packet_id)
    if not packet:
        raise GuardianPacketNotFoundError("Guardian packet not found.")
    return normalize_guardian_packet(
        packet,
        org_id=packet.get("org_id", ""),
        class_id=packet.get("class_id", ""),
        student_uid=packet.get("student_uid", ""),
    )


def resend_guardian_packet(
    deps: Any,
    *,
    packet_id: str,
    actor_type: str,
    actor_id: str,
) -> tuple[dict[str, Any], str | None]:
    packet = _expire_packet_if_needed(deps, _get_packet_or_raise(deps, packet_id))
    if packet.get("status") in {"granted", "revoked", "canceled"}:
        raise GuardianPacketStateError("Completed or canceled packets cannot be resent.")

    now = datetime.now(UTC)
    ttl_days = DEFAULT_PACKET_TTL_DAYS
    issued_at = packet.get("issued_at")
    expires_at = packet.get("expires_at")
    if issued_at and expires_at:
        ttl_days = max(1, min(MAX_PACKET_TTL_DAYS, int((expires_at - issued_at).days or DEFAULT_PACKET_TTL_DAYS)))
    new_expires_at = now + timedelta(days=ttl_days)

    raw_token = _new_guardian_token() if packet.get("delivery_method") == "secure_link" else None
    updates = {
        "status": "issued",
        "token_hash": _hash_guardian_token(raw_token) if raw_token else packet.get("token_hash", ""),
        "token_last_four": raw_token[-4:] if raw_token else packet.get("token_last_four", ""),
        "last_sent_at": now,
        "expires_at": new_expires_at,
        "reminder_count": int(packet.get("reminder_count") or 0) + 1,
    }
    if hasattr(deps.db, "update_guardian_consent_packet"):
        deps.db.update_guardian_consent_packet(packet_id, updates)
    packet.update(updates)
    create_consent_event(
        deps,
        org_id=packet.get("org_id", ""),
        student_uid=packet.get("student_uid", ""),
        event_type="guardian_packet.resent",
        actor_type=actor_type,
        actor_id=actor_id,
        payload=_packet_event_payload(packet),
    )
    return packet, raw_token


def cancel_guardian_packet(
    deps: Any,
    *,
    packet_id: str,
    actor_type: str,
    actor_id: str,
) -> dict[str, Any]:
    packet = _expire_packet_if_needed(deps, _get_packet_or_raise(deps, packet_id))
    if packet.get("status") in TERMINAL_PACKET_STATUSES:
        raise GuardianPacketStateError("This guardian packet can no longer be canceled.")
    updates = {
        "status": "canceled",
        "response_method": "staff_canceled",
        "acted_at": datetime.now(UTC),
        "token_hash": "",
        "token_last_four": "",
    }
    if hasattr(deps.db, "update_guardian_consent_packet"):
        deps.db.update_guardian_consent_packet(packet_id, updates)
    packet.update(updates)
    create_consent_event(
        deps,
        org_id=packet.get("org_id", ""),
        student_uid=packet.get("student_uid", ""),
        event_type="guardian_packet.canceled",
        actor_type=actor_type,
        actor_id=actor_id,
        payload=_packet_event_payload(packet),
    )
    return packet


def resolve_guardian_packet_for_token(deps: Any, token: str) -> dict[str, Any]:
    token_hash = _hash_guardian_token(token)
    if not hasattr(deps.db, "find_guardian_consent_packet_by_token_hash"):
        raise GuardianPacketNotFoundError("Guardian packet not found.")
    packet = deps.db.find_guardian_consent_packet_by_token_hash(token_hash)
    if not packet:
        raise GuardianPacketNotFoundError("Guardian packet not found.")
    packet = _expire_packet_if_needed(deps, packet)
    status = packet.get("status")
    if status == "canceled":
        raise GuardianPacketStateError("This guardian packet was canceled.")
    if status == "expired":
        raise GuardianPacketStateError("This guardian packet has expired.")
    if status == "issued":
        updates = {
            "status": "viewed",
        }
        if hasattr(deps.db, "update_guardian_consent_packet"):
            deps.db.update_guardian_consent_packet(packet["id"], updates)
        packet.update(updates)
        create_consent_event(
            deps,
            org_id=packet.get("org_id", ""),
            student_uid=packet.get("student_uid", ""),
            event_type="guardian_packet.viewed",
            actor_type="guardian",
            actor_id=packet["id"],
            payload=_packet_event_payload(packet),
        )
    return normalize_guardian_packet(
        packet,
        org_id=packet.get("org_id", ""),
        class_id=packet.get("class_id", ""),
        student_uid=packet.get("student_uid", ""),
    )


def apply_guardian_packet_decision(
    deps: Any,
    *,
    token: str,
    decision: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    packet = resolve_guardian_packet_for_token(deps, token)
    if packet.get("status") not in DECISION_PACKET_STATUSES:
        raise GuardianPacketStateError("This guardian packet is no longer awaiting a decision.")
    normalized_decision = _normalize_string(decision).lower()
    if normalized_decision not in {"granted", "revoked"}:
        raise GuardianPacketStateError("Decision must be granted or revoked.")

    updates = {
        "status": normalized_decision,
        "response_method": "secure_link",
        "acted_at": datetime.now(UTC),
        "token_hash": "",
        "token_last_four": packet.get("token_last_four", ""),
    }
    if hasattr(deps.db, "update_guardian_consent_packet"):
        deps.db.update_guardian_consent_packet(packet["id"], updates)
    packet.update(updates)

    compliance_record = upsert_student_compliance_record(
        deps,
        org_id=packet.get("org_id", ""),
        student_uid=packet.get("student_uid", ""),
        updates={
            "guardian_consent_status": normalized_decision,
            "last_verified_at": datetime.now(UTC),
        },
    )
    create_consent_event(
        deps,
        org_id=packet.get("org_id", ""),
        student_uid=packet.get("student_uid", ""),
        event_type=f"guardian_packet.{normalized_decision}",
        actor_type="guardian",
        actor_id=packet["id"],
        payload=_packet_event_payload(packet, extra={"responseMethod": "secure_link"}),
    )
    return packet, compliance_record


def serialize_guardian_packet_notice(
    packet: dict[str, Any],
    *,
    class_record: dict[str, Any] | None = None,
    student_user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    notice = build_guardian_notice(packet.get("notice_version", DEFAULT_GUARDIAN_NOTICE_VERSION))
    profile = student_user.get("profile") if isinstance(student_user, dict) and isinstance(student_user.get("profile"), dict) else {}
    return {
        "packet": serialize_guardian_packet(packet),
        "notice": notice,
        "student": {
            "displayName": _normalize_string(profile.get("display_name")) or _normalize_string(student_user.get("name")) or "Student",
        },
        "class": {
            "name": _normalize_string((class_record or {}).get("name")),
            "subject": _normalize_string((class_record or {}).get("subject")),
        },
    }


def normalize_guardian_delivery_method(value: Any) -> str:
    return normalize_delivery_method(value)


def normalize_guardian_contact_channel(value: Any) -> str:
    return normalize_contact_channel(value)


def serialize_guardian_consent_packet(packet: dict[str, Any] | None, *, raw_token: str | None = None) -> dict[str, Any] | None:
    return serialize_guardian_packet(packet, raw_token=raw_token)


def issue_guardian_consent_packet(*args, **kwargs):
    return issue_guardian_packet(*args, **kwargs)


def resend_guardian_consent_packet(*args, **kwargs):
    return resend_guardian_packet(*args, **kwargs)


def cancel_guardian_consent_packet(*args, **kwargs):
    return cancel_guardian_packet(*args, **kwargs)


normalize_guardian_delivery_method = normalize_delivery_method
normalize_guardian_contact_channel = normalize_contact_channel
serialize_guardian_consent_packet = serialize_guardian_packet
issue_guardian_consent_packet = issue_guardian_packet
resend_guardian_consent_packet = resend_guardian_packet
cancel_guardian_consent_packet = cancel_guardian_packet


def get_latest_guardian_consent_packet_for_student(
    deps: Any,
    *,
    class_id: str,
    student_uid: str,
) -> dict[str, Any] | None:
    return get_latest_guardian_packet(deps, class_id=class_id, student_uid=student_uid)


def get_latest_guardian_packets_for_class(
    deps: Any,
    *,
    class_id: str,
) -> dict[str, dict[str, Any]]:
    if not hasattr(deps.db, "list_class_guardian_consent_packets"):
        return {}
    packets = deps.db.list_class_guardian_consent_packets(class_id, limit=500)
    latest_by_student: dict[str, dict[str, Any]] = {}
    for packet in packets:
        student_uid = _normalize_string(packet.get("student_uid"))
        if not student_uid or student_uid in latest_by_student:
            continue
        latest_by_student[student_uid] = _expire_packet_if_needed(deps, packet)
    return latest_by_student


def get_guardian_consent_packet_by_token(
    deps: Any,
    *,
    token: str,
    mark_viewed: bool = True,
) -> dict[str, Any]:
    if mark_viewed:
        return resolve_guardian_packet_for_token(deps, token)
    token_hash = _hash_guardian_token(token)
    if not hasattr(deps.db, "find_guardian_consent_packet_by_token_hash"):
        raise GuardianPacketNotFoundError("Guardian packet not found.")
    packet = deps.db.find_guardian_consent_packet_by_token_hash(token_hash)
    if not packet:
        raise GuardianPacketNotFoundError("Guardian packet not found.")
    return _expire_packet_if_needed(deps, packet)


def record_guardian_consent_decision(
    deps: Any,
    *,
    token: str,
    decision: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    return apply_guardian_packet_decision(deps, token=token, decision=decision)


def build_guardian_consent_public_payload(
    deps: Any,
    *,
    packet: dict[str, Any],
) -> dict[str, Any]:
    class_record = deps.db.get_class(packet.get("class_id")) if hasattr(deps.db, "get_class") else {}
    organization = deps.db.get_organization(packet.get("org_id")) if hasattr(deps.db, "get_organization") else {}
    student_user = deps.db.get_user(packet.get("student_uid")) if hasattr(deps.db, "get_user") else {}
    notice_payload = serialize_guardian_packet_notice(
        packet,
        class_record=class_record,
        student_user=student_user,
    )
    return {
        "packet": notice_payload.get("packet"),
        "organizationName": _normalize_string((organization or {}).get("name")),
        "className": notice_payload.get("class", {}).get("name", ""),
        "studentDisplayName": notice_payload.get("student", {}).get("displayName", "Student"),
        "noticeTitle": notice_payload.get("notice", {}).get("title", ""),
        "noticeBody": notice_payload.get("notice", {}).get("summary", ""),
        "noticeBullets": notice_payload.get("notice", {}).get("bullets", []),
    }
