from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import UTC, datetime

from flask import Blueprint, Response, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.disclosure_logging import log_disclosure_if_new
from backend.services.compliance import (
    build_voice_block_reasons,
    create_consent_event,
    normalize_consent_status,
    normalize_student_compliance_record,
    serialize_student_compliance_record,
    upsert_student_compliance_record,
)
from backend.services.deletion_requests import (
    DeletionRequestError,
    DeletionRequestNotFoundError,
    DeletionRequestStateError,
    approve_deletion_request,
    create_deletion_request,
    execute_deletion,
    get_deletion_request_detail,
    list_org_deletion_requests,
    reject_deletion_request,
    serialize_deletion_execution_run,
    serialize_deletion_request,
)
from backend.services.guardian_packets import serialize_guardian_consent_packet
from backend.services.membership_context import SchoolContextPermissionError

ADMIN_ROLES = {"school_admin"}


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


def _require_admin_context(deps: RouteDeps):
    context = deps.get_school_request_context()
    context.require_any_role(ADMIN_ROLES)
    if not context.active_organization_id:
        raise SchoolContextPermissionError("No active organization selected.")
    return context


def _require_admin_or_teacher_context(deps: RouteDeps):
    context = deps.get_school_request_context()
    context.require_any_role({"teacher", "school_admin"})
    if not context.active_organization_id:
        raise SchoolContextPermissionError("No active organization selected.")
    return context


def create_admin_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint("admin_routes", __name__)

    @bp.route("/api/admin/deletion-requests", methods=["GET"])
    @deps.login_required
    def api_list_deletion_requests():
        try:
            context = _require_admin_context(deps)
            org_id = context.active_organization_id

            status_filter = request.args.get("status")
            filter_list = None
            if status_filter:
                filter_list = [s.strip() for s in status_filter.split(",") if s.strip()]

            requests_list = list_org_deletion_requests(
                deps, org_id=org_id, status_filter=filter_list,
            )
            return jsonify({
                "success": True,
                "requests": [serialize_deletion_request(r) for r in requests_list],
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"List deletion requests error: {exc}")
            return jsonify({"success": False, "error": "Failed to list deletion requests."}), 500

    @bp.route("/api/admin/deletion-requests", methods=["POST"])
    @deps.login_required
    def api_create_deletion_request():
        try:
            context = _require_admin_or_teacher_context(deps)
            org_id = context.active_organization_id
            data = request.get_json(silent=True) or {}

            scope_type = (data.get("scopeType") or "").strip()
            scope_id = (data.get("scopeId") or "").strip()
            request_reason = (data.get("requestReason") or "").strip()

            if not scope_type or not scope_id:
                return jsonify({"success": False, "error": "scopeType and scopeId are required."}), 400

            new_request = create_deletion_request(
                deps,
                org_id=org_id,
                scope_type=scope_type,
                scope_id=scope_id,
                requested_by_uid=context.uid,
                request_reason=request_reason,
                actor_roles=set(context.active_roles),
            )
            return jsonify({
                "success": True,
                "request": serialize_deletion_request(new_request),
            }), 201
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except DeletionRequestError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
        except Exception as exc:
            print(f"Create deletion request error: {exc}")
            return jsonify({"success": False, "error": "Failed to create deletion request."}), 500

    @bp.route("/api/admin/deletion-requests/<request_id>", methods=["GET"])
    @deps.login_required
    def api_get_deletion_request(request_id):
        try:
            context = _require_admin_context(deps)
            detail = get_deletion_request_detail(deps, request_id=request_id)

            if detail.get("org_id") != context.active_organization_id:
                return jsonify({"success": False, "error": "Not found."}), 404

            runs = detail.pop("runs", [])
            return jsonify({
                "success": True,
                "request": serialize_deletion_request(detail),
                "runs": [serialize_deletion_execution_run(r) for r in runs],
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except DeletionRequestNotFoundError:
            return jsonify({"success": False, "error": "Deletion request not found."}), 404
        except Exception as exc:
            print(f"Get deletion request error: {exc}")
            return jsonify({"success": False, "error": "Failed to get deletion request."}), 500

    @bp.route("/api/admin/deletion-requests/<request_id>/approve", methods=["POST"])
    @deps.login_required
    def api_approve_deletion_request(request_id):
        try:
            context = _require_admin_context(deps)
            data = request.get_json(silent=True) or {}

            # Verify org ownership before approving
            existing = deps.db.get_deletion_request(request_id)
            if not existing or existing.get("org_id") != context.active_organization_id:
                return jsonify({"success": False, "error": "Not found."}), 404

            updated = approve_deletion_request(
                deps,
                request_id=request_id,
                approved_by_uid=context.uid,
                review_notes=data.get("reviewNotes", ""),
            )
            return jsonify({
                "success": True,
                "request": serialize_deletion_request(updated),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except DeletionRequestNotFoundError:
            return jsonify({"success": False, "error": "Deletion request not found."}), 404
        except DeletionRequestStateError as exc:
            return jsonify({"success": False, "error": str(exc)}), 409
        except Exception as exc:
            print(f"Approve deletion request error: {exc}")
            return jsonify({"success": False, "error": "Failed to approve deletion request."}), 500

    @bp.route("/api/admin/deletion-requests/<request_id>/reject", methods=["POST"])
    @deps.login_required
    def api_reject_deletion_request(request_id):
        try:
            context = _require_admin_context(deps)
            data = request.get_json(silent=True) or {}

            existing = deps.db.get_deletion_request(request_id)
            if not existing or existing.get("org_id") != context.active_organization_id:
                return jsonify({"success": False, "error": "Not found."}), 404

            updated = reject_deletion_request(
                deps,
                request_id=request_id,
                rejected_by_uid=context.uid,
                review_notes=data.get("reviewNotes", ""),
            )
            return jsonify({
                "success": True,
                "request": serialize_deletion_request(updated),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except DeletionRequestNotFoundError:
            return jsonify({"success": False, "error": "Deletion request not found."}), 404
        except DeletionRequestStateError as exc:
            return jsonify({"success": False, "error": str(exc)}), 409
        except Exception as exc:
            print(f"Reject deletion request error: {exc}")
            return jsonify({"success": False, "error": "Failed to reject deletion request."}), 500

    @bp.route("/api/admin/deletion-requests/<request_id>/execute", methods=["POST"])
    @deps.login_required
    def api_execute_deletion_request(request_id):
        try:
            context = _require_admin_context(deps)

            existing = deps.db.get_deletion_request(request_id)
            if not existing or existing.get("org_id") != context.active_organization_id:
                return jsonify({"success": False, "error": "Not found."}), 404

            updated_request, run = execute_deletion(
                deps,
                request_id=request_id,
                executor_uid=context.uid,
            )
            return jsonify({
                "success": True,
                "request": serialize_deletion_request(updated_request),
                "run": serialize_deletion_execution_run(run),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except DeletionRequestNotFoundError:
            return jsonify({"success": False, "error": "Deletion request not found."}), 404
        except DeletionRequestStateError as exc:
            return jsonify({"success": False, "error": str(exc)}), 409
        except Exception as exc:
            print(f"Execute deletion request error: {exc}")
            return jsonify({"success": False, "error": "Failed to execute deletion request."}), 500

    @bp.route("/api/admin/deletion-requests/<request_id>/retry", methods=["POST"])
    @deps.login_required
    def api_retry_deletion_request(request_id):
        try:
            context = _require_admin_context(deps)

            existing = deps.db.get_deletion_request(request_id)
            if not existing or existing.get("org_id") != context.active_organization_id:
                return jsonify({"success": False, "error": "Not found."}), 404

            updated_request, run = execute_deletion(
                deps,
                request_id=request_id,
                executor_uid=context.uid,
            )
            return jsonify({
                "success": True,
                "request": serialize_deletion_request(updated_request),
                "run": serialize_deletion_execution_run(run),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except DeletionRequestNotFoundError:
            return jsonify({"success": False, "error": "Deletion request not found."}), 404
        except DeletionRequestStateError as exc:
            return jsonify({"success": False, "error": str(exc)}), 409
        except Exception as exc:
            print(f"Retry deletion request error: {exc}")
            return jsonify({"success": False, "error": "Failed to retry deletion request."}), 500

    # ── Org-wide compliance endpoints ────────────────────────────

    def _build_org_compliance_roster(deps, org_id):
        """Build org-wide compliance roster with summary metrics."""
        records = (
            deps.db.list_org_student_compliance_records(org_id)
            if hasattr(deps.db, "list_org_student_compliance_records")
            else []
        )
        classes = (
            deps.db.list_org_classes(org_id)
            if hasattr(deps.db, "list_org_classes")
            else []
        )
        class_map = {c.get("id", ""): c for c in classes}

        # Build enrollment → class mapping
        enrollment_class_map: dict[str, list[str]] = {}
        enrollment_class_names: dict[str, list[str]] = {}
        for cls in classes:
            class_id = cls.get("id", "")
            enrollments = (
                deps.db.list_class_enrollments(class_id)
                if hasattr(deps.db, "list_class_enrollments")
                else []
            )
            for enrollment in enrollments:
                uid = _normalize_string(enrollment.get("student_uid"))
                if uid:
                    enrollment_class_map.setdefault(uid, []).append(class_id)
                    enrollment_class_names.setdefault(uid, []).append(
                        cls.get("name", class_id)
                    )

        summary = {
            "studentCount": 0,
            "voiceAllowedCount": 0,
            "voiceBlockedCount": 0,
            "guardianActionRequiredCount": 0,
            "unknownConsentCount": 0,
            "rawAudioRestrictedCount": 0,
            "textBlockedCount": 0,
        }
        students = []

        for raw_record in records:
            student_uid = _normalize_string(raw_record.get("student_uid"))
            if not student_uid:
                continue
            user = deps.db.get_user(student_uid) if hasattr(deps.db, "get_user") else None
            record = normalize_student_compliance_record(
                raw_record,
                org_id=org_id,
                student_uid=student_uid,
                user=user,
            )
            serialized = serialize_student_compliance_record(record)
            blocked_reasons = build_voice_block_reasons(record)
            if not record.get("text_allowed", True):
                blocked_reasons.append("Text practice is disabled for this student.")

            students.append({
                "uid": student_uid,
                "displayName": _get_user_display_name(user, fallback=student_uid),
                "classIds": enrollment_class_map.get(student_uid, []),
                "classNames": enrollment_class_names.get(student_uid, []),
                "compliance": serialized,
                "blockedReasons": list(dict.fromkeys(r for r in blocked_reasons if r)),
            })

            summary["studentCount"] += 1
            if serialized.get("voiceAllowed"):
                summary["voiceAllowedCount"] += 1
            else:
                summary["voiceBlockedCount"] += 1
            if record.get("is_minor") and record.get("guardian_consent_status") != "granted":
                summary["guardianActionRequiredCount"] += 1
            if (
                record.get("voice_consent_status") == "unknown"
                or (record.get("is_minor") and record.get("guardian_consent_status") == "unknown")
            ):
                summary["unknownConsentCount"] += 1
            if not record.get("text_allowed", True):
                summary["textBlockedCount"] += 1
            rp = record.get("retention_policy_id", "")
            if rp == "no_raw_audio" or not serialized.get("retentionPolicy", {}).get("rawAudioStorageAllowed", True):
                summary["rawAudioRestrictedCount"] += 1

        return {"summary": summary, "students": students}

    @bp.route("/api/admin/compliance/summary", methods=["GET"])
    @deps.login_required
    def api_get_org_compliance_summary():
        try:
            context = _require_admin_context(deps)
            org_id = context.active_organization_id
            roster = _build_org_compliance_roster(deps, org_id)
            return jsonify({"success": True, "summary": roster["summary"]})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Org compliance summary error: {exc}")
            return jsonify({"success": False, "error": "Failed to load compliance summary."}), 500

    @bp.route("/api/admin/compliance/roster", methods=["GET"])
    @deps.login_required
    def api_get_org_compliance_roster():
        try:
            context = _require_admin_context(deps)
            org_id = context.active_organization_id
            roster = _build_org_compliance_roster(deps, org_id)

            # Optional filters
            status_filter = request.args.get("consentStatus")
            class_filter = request.args.get("classId")
            search_query = _normalize_string(request.args.get("search"))

            students = roster["students"]
            if status_filter:
                if status_filter == "voice_blocked":
                    students = [s for s in students if not s["compliance"].get("voiceAllowed")]
                elif status_filter == "voice_allowed":
                    students = [s for s in students if s["compliance"].get("voiceAllowed")]
                elif status_filter == "guardian_action_required":
                    students = [
                        s for s in students
                        if s["compliance"].get("isMinor")
                        and s["compliance"].get("guardianConsentStatus") != "granted"
                    ]
                elif status_filter == "unknown_consent":
                    students = [
                        s for s in students
                        if s["compliance"].get("voiceConsentStatus") == "unknown"
                        or (
                            s["compliance"].get("isMinor")
                            and s["compliance"].get("guardianConsentStatus") == "unknown"
                        )
                    ]
            if class_filter:
                students = [s for s in students if class_filter in s.get("classIds", [])]
            if search_query:
                q = search_query.lower()
                students = [
                    s for s in students
                    if q in s.get("displayName", "").lower() or q in s.get("uid", "").lower()
                ]

            log_disclosure_if_new(
                org_id=org_id,
                actor_uid=context.uid,
                actor_role='school_admin',
                student_uid='',
                event_type='disclosure.compliance_viewed',
                payload={'endpoint': '/api/admin/compliance/roster', 'student_count': len(students)},
            )
            return jsonify({
                "success": True,
                "summary": roster["summary"],
                "students": students,
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Org compliance roster error: {exc}")
            return jsonify({"success": False, "error": "Failed to load compliance roster."}), 500

    @bp.route("/api/admin/compliance/guardian-packets", methods=["GET"])
    @deps.login_required
    def api_get_org_guardian_packets():
        try:
            context = _require_admin_context(deps)
            org_id = context.active_organization_id

            packets = (
                deps.db.list_org_guardian_consent_packets(org_id)
                if hasattr(deps.db, "list_org_guardian_consent_packets")
                else []
            )

            status_filter = request.args.get("status")
            serialized = []
            for packet in packets:
                s = serialize_guardian_consent_packet(packet)
                if s and (not status_filter or s.get("status") == status_filter):
                    serialized.append(s)

            # Build summary counts
            status_counts: dict[str, int] = {}
            for p in serialized:
                st = p.get("status", "unknown")
                status_counts[st] = status_counts.get(st, 0) + 1

            return jsonify({
                "success": True,
                "packets": serialized,
                "statusCounts": status_counts,
                "totalCount": len(serialized),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Org guardian packets error: {exc}")
            return jsonify({"success": False, "error": "Failed to load guardian packets."}), 500

    @bp.route("/api/admin/compliance/audit-export", methods=["GET"])
    @deps.login_required
    def api_export_org_compliance_audit():
        try:
            context = _require_admin_context(deps)
            org_id = context.active_organization_id

            events = (
                deps.db.list_consent_events(org_id, limit=5000)
                if hasattr(deps.db, "list_consent_events")
                else []
            )

            # Collect unique student UIDs for display name lookup
            student_uids = {
                _normalize_string(e.get("student_uid"))
                for e in events
                if _normalize_string(e.get("student_uid"))
            }
            student_names = {}
            for uid in student_uids:
                user = deps.db.get_user(uid) if hasattr(deps.db, "get_user") else None
                student_names[uid] = _get_user_display_name(user, fallback=uid)

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
            for event in events:
                student_uid = _normalize_string(event.get("student_uid"))
                payload = event.get("payload")
                writer.writerow([
                    _timestamp_to_iso(event.get("created_at")) or "",
                    _normalize_string(event.get("event_type")),
                    _normalize_string(event.get("actor_type")),
                    _normalize_string(event.get("actor_id")),
                    _normalize_string(event.get("scope_type")),
                    _normalize_string(event.get("scope_id")),
                    student_uid,
                    student_names.get(student_uid, ""),
                    _normalize_string(event.get("evidence_ref")),
                    json.dumps(payload, default=str) if payload else "",
                ])

            create_consent_event(
                deps,
                org_id=org_id,
                student_uid="",
                scope_type="org",
                scope_id=org_id,
                event_type="audit.org_exported",
                actor_type="school_admin",
                actor_id=context.uid,
                payload={"eventCount": len(events)},
            )

            csv_content = buffer.getvalue()
            timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
            filename = f"org_compliance_audit_{timestamp}.csv"

            return Response(
                csv_content,
                mimetype="text/csv",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Org compliance audit export error: {exc}")
            return jsonify({"success": False, "error": "Failed to export audit data."}), 500

    @bp.route("/api/admin/compliance/bulk-update", methods=["PUT"])
    @deps.login_required
    def api_bulk_update_org_compliance():
        try:
            context = _require_admin_context(deps)
            org_id = context.active_organization_id
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

            # Validate all UIDs belong to this org
            existing_records = (
                deps.db.list_org_student_compliance_records(org_id)
                if hasattr(deps.db, "list_org_student_compliance_records")
                else []
            )
            known_uids = {
                _normalize_string(r.get("student_uid"))
                for r in existing_records
                if _normalize_string(r.get("student_uid"))
            }
            missing_uids = [uid for uid in student_uids if uid not in known_uids]
            if missing_uids:
                return jsonify({
                    "success": False,
                    "error": "One or more selected students do not have compliance records in this organization.",
                    "missingStudentUids": missing_uids,
                }), 400

            batch_id = uuid.uuid4().hex
            reason = _normalize_string(data.get("reason"))
            updated_fields = sorted(key for key in updates.keys() if key != "last_verified_at")

            for student_uid in student_uids:
                upsert_student_compliance_record(
                    deps,
                    org_id=org_id,
                    student_uid=student_uid,
                    updates=updates,
                )
                create_consent_event(
                    deps,
                    org_id=org_id,
                    student_uid=student_uid,
                    scope_type="org",
                    scope_id=org_id,
                    event_type="consent.org_bulk_updated",
                    actor_type="school_admin",
                    actor_id=context.uid,
                    payload={
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
            print(f"Org compliance bulk update error: {exc}")
            return jsonify({"success": False, "error": "Failed to update compliance records."}), 500

    return bp
