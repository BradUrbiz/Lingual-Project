from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import UTC, datetime

from flask import Blueprint, Response, jsonify, request

from backend.route_deps import RouteDeps
from backend.routes.schools import build_class_summary, build_setup_checklist, list_accessible_teacher_classes
from backend.services.compliance import (
    build_voice_block_reasons,
    create_consent_event,
    normalize_consent_status,
    resolve_student_compliance_record,
    serialize_student_compliance_record,
    upsert_student_compliance_record,
)
from backend.services.guardian_packets import (
    DEFAULT_GUARDIAN_CONSENT_SCOPE,
    DEFAULT_GUARDIAN_NOTICE_VERSION,
    GuardianPacketStateError,
    cancel_guardian_consent_packet,
    get_latest_guardian_consent_packet_for_student,
    get_latest_guardian_packets_for_class,
    issue_guardian_consent_packet,
    normalize_guardian_contact_channel,
    normalize_guardian_delivery_method,
    resend_guardian_consent_packet,
    serialize_guardian_consent_packet,
)
from backend.services.membership_context import SchoolContextPermissionError

TEACHER_ALLOWED_ROLES = {"teacher", "school_admin"}


def _normalize_string(value):
    if not isinstance(value, str):
        return ""
    return value.strip()


def _timestamp_to_iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "seconds"):
        return datetime.fromtimestamp(value.seconds, UTC).isoformat()
    return str(value)


def _get_user_display_name(user: dict | None, *, fallback: str) -> str:
    if not isinstance(user, dict):
        return fallback
    profile = user.get("profile") if isinstance(user.get("profile"), dict) else {}
    return (
        _normalize_string(profile.get("display_name"))
        or _normalize_string(user.get("name"))
        or _normalize_string(user.get("email"))
        or fallback
    )


def _extract_compliance_updates(data):
    data = data if isinstance(data, dict) else {}
    updates = {}
    if "isMinor" in data:
        updates["is_minor"] = bool(data.get("isMinor"))
    if "guardianConsentStatus" in data:
        updates["guardian_consent_status"] = normalize_consent_status(data.get("guardianConsentStatus"))
    if "voiceConsentStatus" in data:
        updates["voice_consent_status"] = normalize_consent_status(
            data.get("voiceConsentStatus"),
            allow_not_required=False,
        )
    if "textAllowed" in data:
        updates["text_allowed"] = bool(data.get("textAllowed"))
    if "retentionPolicyId" in data:
        updates["retention_policy_id"] = _normalize_string(data.get("retentionPolicyId"))
    if "schoolAgreementVersion" in data:
        updates["school_agreement_version"] = _normalize_string(data.get("schoolAgreementVersion"))
    if updates:
        updates["last_verified_at"] = datetime.now(UTC)
    return updates


def build_class_compliance_payload(deps: RouteDeps, class_record: dict) -> dict:
    class_id = class_record.get("id", "")
    org_id = class_record.get("org_id", "")
    enrollments = deps.db.list_class_enrollments(class_id) if hasattr(deps.db, "list_class_enrollments") else []
    latest_guardian_packets = get_latest_guardian_packets_for_class(deps, class_id=class_id)
    students = []
    summary = {
        "studentCount": 0,
        "voiceAllowedCount": 0,
        "voiceBlockedCount": 0,
        "guardianActionRequiredCount": 0,
        "unknownConsentCount": 0,
        "rawAudioRestrictedCount": 0,
        "textBlockedCount": 0,
    }

    for enrollment in enrollments:
        student_uid = _normalize_string(enrollment.get("student_uid"))
        if not student_uid:
            continue
        user = deps.db.get_user(student_uid) if hasattr(deps.db, "get_user") else None
        compliance_record = resolve_student_compliance_record(
            deps,
            org_id=org_id,
            student_uid=student_uid,
        )
        serialized = serialize_student_compliance_record(compliance_record)
        blocked_reasons = build_voice_block_reasons(compliance_record)
        if not compliance_record.get("text_allowed", True):
            blocked_reasons.append("Text practice is disabled for this student.")

        students.append({
            "uid": student_uid,
            "displayName": _get_user_display_name(user, fallback=student_uid),
            "studentNumber": _normalize_string(enrollment.get("student_number")),
            "guardianContactRequired": bool(enrollment.get("guardian_contact_required")),
            "compliance": serialized,
            "guardianPacket": serialize_guardian_consent_packet(latest_guardian_packets.get(student_uid)),
            "blockedReasons": list(dict.fromkeys(reason for reason in blocked_reasons if reason)),
        })

        summary["studentCount"] += 1
        if serialized.get("voiceAllowed"):
            summary["voiceAllowedCount"] += 1
        else:
            summary["voiceBlockedCount"] += 1
        if compliance_record.get("is_minor") and compliance_record.get("guardian_consent_status") != "granted":
            summary["guardianActionRequiredCount"] += 1
        if (
            compliance_record.get("voice_consent_status") == "unknown"
            or (
                compliance_record.get("is_minor")
                and compliance_record.get("guardian_consent_status") == "unknown"
            )
        ):
            summary["unknownConsentCount"] += 1
        if not serialized.get("retentionPolicy", {}).get("rawAudioStorageAllowed", True):
            summary["rawAudioRestrictedCount"] += 1
        if not serialized.get("textAllowed", True):
            summary["textBlockedCount"] += 1

    students.sort(key=lambda item: item.get("displayName", "").lower())
    return {
        "class": build_class_summary(deps, class_record),
        "summary": summary,
        "students": students,
        "limitations": [
            "Beta operations are class-scoped. Guardian packet delivery and deletion execution remain admin-assisted follow-up work.",
        ],
    }


def _class_audit_event_matches(event, *, class_id: str, class_assignment_ids: set[str]) -> bool:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    scope_type = _normalize_string(event.get("scope_type"))
    scope_id = _normalize_string(event.get("scope_id"))
    assignment_id = _normalize_string(payload.get("assignmentId") or payload.get("assignment_id"))

    if scope_type == "class" and scope_id == class_id:
        return True
    if _normalize_string(payload.get("classId")) == class_id:
        return True
    return bool(assignment_id and assignment_id in class_assignment_ids)


def _serialize_audit_payload(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=True, sort_keys=True)
    if value is None:
        return ""
    return str(value)


def _require_teacher_context(deps: RouteDeps):
    context = deps.get_school_request_context()
    context.require_any_role(TEACHER_ALLOWED_ROLES)
    if not context.active_organization_id:
        raise SchoolContextPermissionError("No active organization selected.")
    return context


def _require_teacher_class_context(deps: RouteDeps, class_id: str):
    context = _require_teacher_context(deps)
    class_record = deps.db.get_class(class_id)
    if not class_record:
        raise SchoolContextPermissionError("Class not found.")
    if class_record.get("org_id") != context.active_organization_id:
        raise SchoolContextPermissionError("Class is outside the active organization.")

    teacher_membership_ids = class_record.get("teacher_membership_ids") or []
    if context.has_role("school_admin") or context.active_membership_id in teacher_membership_ids:
        return context, class_record

    raise SchoolContextPermissionError("Teacher membership does not have access to this class.")


def build_teacher_dashboard_payload(deps: RouteDeps, context) -> dict:
    class_summaries = list_accessible_teacher_classes(deps, context)
    student_count = sum(int(class_summary.get("studentCount") or 0) for class_summary in class_summaries)
    assignment_count = sum(int(class_summary.get("assignmentCount") or 0) for class_summary in class_summaries)
    organization_name = ""
    if context.active_membership:
        organization_name = context.active_membership.get("orgName", "")

    # Aggregate speaking time across all accessible classes
    total_speaking_seconds = 0
    if hasattr(deps.db, 'list_class_practice_sessions'):
        for cs in class_summaries:
            class_id = cs.get("id") or cs.get("classId", "")
            if not class_id:
                continue
            try:
                sessions = deps.db.list_class_practice_sessions(class_id)
                for session in sessions:
                    summary = session.get("session_summary") or {}
                    total_speaking_seconds += int(summary.get("estimated_speaking_time_seconds") or 0)
            except Exception:
                pass
    speaking_minutes = round(total_speaking_seconds / 60)

    alerts = []
    if not class_summaries:
        alerts.append("Create your first class to start assignment delivery and reporting.")
    elif student_count == 0:
        alerts.append("Add students to unlock assignment launch and teacher analytics.")

    return {
        "organizationName": organization_name,
        "summary": {
            "classCount": len(class_summaries),
            "studentCount": student_count,
            "speakingMinutes": speaking_minutes,
            "assignmentCount": assignment_count,
        },
        "classes": class_summaries,
        "setupChecklist": build_setup_checklist(context, class_summaries),
        "alerts": alerts,
    }


def create_teacher_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint("teacher_routes", __name__)

    @bp.route("/api/teacher/dashboard")
    @deps.login_required
    def api_teacher_dashboard():
        try:
            context = _require_teacher_context(deps)
            return jsonify({
                "success": True,
                "dashboard": build_teacher_dashboard_payload(deps, context),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Teacher dashboard error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes")
    @deps.login_required
    def api_teacher_classes():
        try:
            context = _require_teacher_context(deps)
            return jsonify({
                "success": True,
                "classes": list_accessible_teacher_classes(deps, context),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Teacher classes error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes", methods=["POST"])
    @deps.login_required
    def api_create_teacher_class():
        try:
            context = _require_teacher_context(deps)
            data = request.get_json() or {}

            class_name = _normalize_string(data.get("name"))
            term = _normalize_string(data.get("term"))
            subject = _normalize_string(data.get("subject"))
            grade_band = _normalize_string(data.get("gradeBand"))
            learning_locale = _normalize_string(data.get("learningLocale")) or "ko-KR"

            if not class_name:
                return jsonify({"success": False, "error": "Class name is required."}), 400
            if learning_locale not in deps.allowed_learning_locales:
                return jsonify({"success": False, "error": "Invalid learning locale."}), 400

            teacher_membership_ids = [context.active_membership_id] if context.active_membership_id else []
            class_id = deps.db.create_class(
                org_id=context.active_organization_id,
                name=class_name,
                learning_locale=learning_locale,
                term=term,
                subject=subject,
                teacher_membership_ids=teacher_membership_ids,
                grade_band=grade_band,
            )
            if context.active_membership_id:
                deps.db.add_primary_class_to_membership(context.active_membership_id, class_id)

            return jsonify({
                "success": True,
                "class": build_class_summary(deps, deps.db.get_class(class_id)),
            }), 201
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Teacher class creation error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/students/<student_uid>/compliance")
    @deps.login_required
    def api_get_student_compliance(class_id, student_uid):
        try:
            context, class_record = _require_teacher_class_context(deps, class_id)
            enrollment = deps.db.get_student_class_enrollment(class_id, student_uid)
            if not enrollment or enrollment.get("status") != "active":
                return jsonify({"success": False, "error": "Student is not actively enrolled in this class."}), 404

            compliance_record = resolve_student_compliance_record(
                deps,
                org_id=class_record.get("org_id", ""),
                student_uid=student_uid,
            )
            create_consent_event(
                deps,
                org_id=class_record.get("org_id", ""),
                student_uid=student_uid,
                event_type="consent.reviewed",
                actor_type="teacher" if context.has_role("teacher") else "school_admin",
                actor_id=context.uid,
                payload={"classId": class_id},
            )
            return jsonify({
                "success": True,
                "compliance": serialize_student_compliance_record(compliance_record),
                "guardianPacket": serialize_guardian_consent_packet(
                    get_latest_guardian_consent_packet_for_student(
                        deps,
                        class_id=class_id,
                        student_uid=student_uid,
                    )
                ),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Student compliance lookup error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/students/<student_uid>/compliance", methods=["PUT"])
    @deps.login_required
    def api_update_student_compliance(class_id, student_uid):
        try:
            context, class_record = _require_teacher_class_context(deps, class_id)
            enrollment = deps.db.get_student_class_enrollment(class_id, student_uid)
            if not enrollment or enrollment.get("status") != "active":
                return jsonify({"success": False, "error": "Student is not actively enrolled in this class."}), 404

            data = request.get_json(silent=True) or {}
            updates = _extract_compliance_updates(data)
            if not updates:
                return jsonify({"success": False, "error": "No compliance updates were provided."}), 400

            updated_record = upsert_student_compliance_record(
                deps,
                org_id=class_record.get("org_id", ""),
                student_uid=student_uid,
                updates=updates,
            )
            create_consent_event(
                deps,
                org_id=class_record.get("org_id", ""),
                student_uid=student_uid,
                event_type="consent.updated",
                actor_type="teacher" if context.has_role("teacher") else "school_admin",
                actor_id=context.uid,
                payload={"classId": class_id, "updates": serialize_student_compliance_record(updated_record)},
            )
            return jsonify({
                "success": True,
                "compliance": serialize_student_compliance_record(updated_record),
                "guardianPacket": serialize_guardian_consent_packet(
                    get_latest_guardian_consent_packet_for_student(
                        deps,
                        class_id=class_id,
                        student_uid=student_uid,
                    )
                ),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Student compliance update error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packet")
    @deps.login_required
    def api_get_student_guardian_packet(class_id, student_uid):
        try:
            _context, _class_record = _require_teacher_class_context(deps, class_id)
            enrollment = deps.db.get_student_class_enrollment(class_id, student_uid)
            if not enrollment or enrollment.get("status") != "active":
                return jsonify({"success": False, "error": "Student is not actively enrolled in this class."}), 404

            packet = get_latest_guardian_consent_packet_for_student(
                deps,
                class_id=class_id,
                student_uid=student_uid,
            )
            return jsonify({
                "success": True,
                "guardianPacket": serialize_guardian_consent_packet(packet),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Student guardian packet lookup error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets", methods=["POST"])
    @deps.login_required
    def api_issue_guardian_packet(class_id, student_uid):
        try:
            context, class_record = _require_teacher_class_context(deps, class_id)
            enrollment = deps.db.get_student_class_enrollment(class_id, student_uid)
            if not enrollment or enrollment.get("status") != "active":
                return jsonify({"success": False, "error": "Student is not actively enrolled in this class."}), 404

            data = request.get_json(silent=True) or {}
            actor_type = "teacher" if context.has_role("teacher") else "school_admin"
            packet, delivery_token = issue_guardian_consent_packet(
                deps,
                org_id=class_record.get("org_id", ""),
                class_id=class_id,
                student_uid=student_uid,
                actor_type=actor_type,
                actor_id=context.uid,
                notice_version=_normalize_string(data.get("noticeVersion")) or DEFAULT_GUARDIAN_NOTICE_VERSION,
                consent_scope=_normalize_string(data.get("consentScope")) or DEFAULT_GUARDIAN_CONSENT_SCOPE,
                delivery_method=normalize_guardian_delivery_method(data.get("deliveryMethod")),
                contact_channel=normalize_guardian_contact_channel(data.get("contactChannel")),
                contact_destination_hint=_normalize_string(data.get("contactDestinationHint")),
            )
            return jsonify({
                "success": True,
                "guardianPacket": serialize_guardian_consent_packet(packet),
                "deliveryToken": delivery_token,
            }), 201
        except (SchoolContextPermissionError, GuardianPacketStateError) as exc:
            status_code = 403 if isinstance(exc, SchoolContextPermissionError) else 400
            return jsonify({"success": False, "error": str(exc)}), status_code
        except Exception as exc:
            print(f"Guardian packet issue error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets/<packet_id>/resend", methods=["POST"])
    @deps.login_required
    def api_resend_guardian_packet(class_id, student_uid, packet_id):
        try:
            context, _class_record = _require_teacher_class_context(deps, class_id)
            enrollment = deps.db.get_student_class_enrollment(class_id, student_uid)
            if not enrollment or enrollment.get("status") != "active":
                return jsonify({"success": False, "error": "Student is not actively enrolled in this class."}), 404

            packet, delivery_token = resend_guardian_consent_packet(
                deps,
                packet_id=packet_id,
                actor_type="teacher" if context.has_role("teacher") else "school_admin",
                actor_id=context.uid,
            )
            if packet.get("class_id") != class_id or packet.get("student_uid") != student_uid:
                return jsonify({"success": False, "error": "Guardian consent packet is outside the requested scope."}), 404

            return jsonify({
                "success": True,
                "guardianPacket": serialize_guardian_consent_packet(packet),
                "deliveryToken": delivery_token,
            })
        except (SchoolContextPermissionError, GuardianPacketStateError) as exc:
            status_code = 403 if isinstance(exc, SchoolContextPermissionError) else 400
            return jsonify({"success": False, "error": str(exc)}), status_code
        except Exception as exc:
            print(f"Guardian packet resend error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/students/<student_uid>/guardian-consent-packets/<packet_id>/cancel", methods=["POST"])
    @deps.login_required
    def api_cancel_guardian_packet(class_id, student_uid, packet_id):
        try:
            context, _class_record = _require_teacher_class_context(deps, class_id)
            enrollment = deps.db.get_student_class_enrollment(class_id, student_uid)
            if not enrollment or enrollment.get("status") != "active":
                return jsonify({"success": False, "error": "Student is not actively enrolled in this class."}), 404

            packet = cancel_guardian_consent_packet(
                deps,
                packet_id=packet_id,
                actor_type="teacher" if context.has_role("teacher") else "school_admin",
                actor_id=context.uid,
            )
            if packet.get("class_id") != class_id or packet.get("student_uid") != student_uid:
                return jsonify({"success": False, "error": "Guardian consent packet is outside the requested scope."}), 404

            return jsonify({
                "success": True,
                "guardianPacket": serialize_guardian_consent_packet(packet),
            })
        except (SchoolContextPermissionError, GuardianPacketStateError) as exc:
            status_code = 403 if isinstance(exc, SchoolContextPermissionError) else 400
            return jsonify({"success": False, "error": str(exc)}), status_code
        except Exception as exc:
            print(f"Guardian packet cancel error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/compliance")
    @deps.login_required
    def api_get_class_compliance(class_id):
        try:
            _context, class_record = _require_teacher_class_context(deps, class_id)
            return jsonify({
                "success": True,
                "roster": build_class_compliance_payload(deps, class_record),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Class compliance roster error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/compliance/bulk", methods=["PUT"])
    @deps.login_required
    def api_bulk_update_class_compliance(class_id):
        try:
            context, class_record = _require_teacher_class_context(deps, class_id)
            data = request.get_json(silent=True) or {}
            raw_student_uids = data.get("studentUids")
            if not isinstance(raw_student_uids, list):
                return jsonify({"success": False, "error": "studentUids must be a list."}), 400

            student_uids = []
            for value in raw_student_uids:
                normalized = _normalize_string(value)
                if normalized and normalized not in student_uids:
                    student_uids.append(normalized)
            if not student_uids:
                return jsonify({"success": False, "error": "Select at least one student."}), 400

            updates = _extract_compliance_updates(data.get("updates"))
            if not updates:
                return jsonify({"success": False, "error": "No compliance updates were provided."}), 400

            enrollments = deps.db.list_class_enrollments(class_id) if hasattr(deps.db, "list_class_enrollments") else []
            active_student_uids = {
                _normalize_string(enrollment.get("student_uid"))
                for enrollment in enrollments
                if _normalize_string(enrollment.get("student_uid"))
            }
            missing_uids = [student_uid for student_uid in student_uids if student_uid not in active_student_uids]
            if missing_uids:
                return jsonify({
                    "success": False,
                    "error": "One or more selected students are not actively enrolled in this class.",
                    "missingStudentUids": missing_uids,
                }), 400

            actor_type = "teacher" if context.has_role("teacher") else "school_admin"
            batch_id = uuid.uuid4().hex
            reason = _normalize_string(data.get("reason"))
            updated_fields = sorted(key for key in updates.keys() if key != "last_verified_at")

            for student_uid in student_uids:
                upsert_student_compliance_record(
                    deps,
                    org_id=class_record.get("org_id", ""),
                    student_uid=student_uid,
                    updates=updates,
                )
                create_consent_event(
                    deps,
                    org_id=class_record.get("org_id", ""),
                    student_uid=student_uid,
                    event_type="consent.bulk_updated",
                    actor_type=actor_type,
                    actor_id=context.uid,
                    payload={
                        "classId": class_id,
                        "batchId": batch_id,
                        "updatedFields": updated_fields,
                        "reason": reason,
                    },
                )

            return jsonify({
                "success": True,
                "batchId": batch_id,
                "updatedCount": len(student_uids),
                "studentUids": student_uids,
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Class compliance bulk update error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/compliance/audit-export")
    @deps.login_required
    def api_export_class_compliance_audit(class_id):
        try:
            context, class_record = _require_teacher_class_context(deps, class_id)
            org_id = class_record.get("org_id", "")
            enrollments = deps.db.list_class_enrollments(class_id) if hasattr(deps.db, "list_class_enrollments") else []
            student_uids = {
                _normalize_string(enrollment.get("student_uid"))
                for enrollment in enrollments
                if _normalize_string(enrollment.get("student_uid"))
            }
            class_assignment_ids = {
                _normalize_string(assignment.get("id"))
                for assignment in (
                    deps.db.list_class_assignments(class_id)
                    if hasattr(deps.db, "list_class_assignments")
                    else []
                )
                if _normalize_string(assignment.get("id"))
            }
            events = deps.db.list_consent_events(org_id, limit=2000) if hasattr(deps.db, "list_consent_events") else []
            filtered_events = [
                event
                for event in events
                if _class_audit_event_matches(
                    event,
                    class_id=class_id,
                    class_assignment_ids=class_assignment_ids,
                )
            ]

            student_names = {}
            for student_uid in student_uids:
                user = deps.db.get_user(student_uid) if hasattr(deps.db, "get_user") else None
                student_names[student_uid] = _get_user_display_name(user, fallback=student_uid)

            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow([
                "created_at",
                "event_type",
                "actor_type",
                "actor_id",
                "scope_type",
                "scope_id",
                "student_uid",
                "student_display_name",
                "evidence_ref",
                "payload",
            ])
            for event in filtered_events:
                student_uid = _normalize_string(event.get("student_uid"))
                writer.writerow([
                    _timestamp_to_iso(event.get("created_at")) or "",
                    _normalize_string(event.get("event_type")),
                    _normalize_string(event.get("actor_type")),
                    _normalize_string(event.get("actor_id")),
                    _normalize_string(event.get("scope_type")) or ("student" if student_uid else ""),
                    _normalize_string(event.get("scope_id")),
                    student_uid,
                    student_names.get(student_uid, ""),
                    _normalize_string(event.get("evidence_ref")),
                    _serialize_audit_payload(event.get("payload")),
                ])

            create_consent_event(
                deps,
                org_id=org_id,
                student_uid="",
                scope_type="class",
                scope_id=class_id,
                event_type="audit.exported",
                actor_type="teacher" if context.has_role("teacher") else "school_admin",
                actor_id=context.uid,
                payload={
                    "classId": class_id,
                    "format": "csv",
                    "eventCount": len(filtered_events),
                    "studentCount": len(student_uids),
                },
            )

            filename = f"{class_id}-consent-audit-export.csv"
            return Response(
                buffer.getvalue(),
                mimetype="text/csv",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Class compliance audit export error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/join-code", methods=["POST"])
    @deps.login_required
    def api_generate_join_code(class_id):
        try:
            _context, _class_record = _require_teacher_class_context(deps, class_id)
            code = deps.db.generate_class_join_code(class_id)
            return jsonify({"success": True, "joinCode": code, "active": True})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Join code generation error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/join-code")
    @deps.login_required
    def api_get_join_code(class_id):
        try:
            _context, class_record = _require_teacher_class_context(deps, class_id)
            join_code = class_record.get("join_code")
            return jsonify({
                "success": True,
                "joinCode": join_code if join_code else None,
                "active": bool(class_record.get("join_code_active")) if join_code else False,
                "generatedAt": _timestamp_to_iso(class_record.get("join_code_generated_at")),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Join code lookup error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/join-code", methods=["DELETE"])
    @deps.login_required
    def api_deactivate_join_code(class_id):
        try:
            _context, _class_record = _require_teacher_class_context(deps, class_id)
            deps.db.deactivate_class_join_code(class_id)
            return jsonify({"success": True})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Join code deactivation error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/roster")
    @deps.login_required
    def api_get_class_roster(class_id):
        try:
            _context, _class_record = _require_teacher_class_context(deps, class_id)
            active_enrollments = deps.db.list_class_enrollments(class_id)

            # Is this class Canvas-connected? If not, skip the badge lookup.
            has_canvas_connection = (
                deps.db.get_canvas_connection_by_class(class_id) is not None
                if hasattr(deps.db, "get_canvas_connection_by_class")
                else False
            )

            students = []
            for enrollment in active_enrollments:
                student_uid = _normalize_string(enrollment.get("student_uid"))
                if not student_uid:
                    # Defensive: a row without student_uid is stale
                    # (e.g. an un-migrated pending_sync). Do not surface it.
                    continue
                user = deps.db.get_user(student_uid) if hasattr(deps.db, "get_user") else None
                row = {
                    "uid": student_uid,
                    "displayName": _get_user_display_name(user, fallback=student_uid),
                    "studentNumber": _normalize_string(enrollment.get("student_number")),
                    "joinSource": _normalize_string(enrollment.get("join_source")),
                    "enrolledAt": _timestamp_to_iso(enrollment.get("created_at")),
                    "status": _normalize_string(enrollment.get("status")) or "active",
                }
                if has_canvas_connection and hasattr(deps.db, "get_canvas_roster_entry_by_email"):
                    email = (user or {}).get("email", "") if user else ""
                    entry = (
                        deps.db.get_canvas_roster_entry_by_email(class_id, email)
                        if email else None
                    )
                    row["isOnCanvasRoster"] = bool(entry)
                students.append(row)

            students.sort(key=lambda item: item.get("displayName", "").lower())
            return jsonify({"success": True, "roster": students})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Class roster error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/teacher/classes/<class_id>/students/<student_uid>", methods=["DELETE"])
    @deps.login_required
    def api_remove_student(class_id, student_uid):
        try:
            _context, _class_record = _require_teacher_class_context(deps, class_id)
            enrollment = deps.db.get_student_class_enrollment(class_id, student_uid)
            if not enrollment:
                return jsonify({"success": False, "error": "Student enrollment not found."}), 404
            deps.db.deactivate_enrollment(class_id, student_uid)
            return jsonify({"success": True})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Student removal error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    return bp
