from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.routes.schools import build_class_summary, build_setup_checklist, list_accessible_teacher_classes
from backend.services.membership_context import SchoolContextPermissionError

TEACHER_ALLOWED_ROLES = {"teacher", "school_admin"}


def _normalize_string(value):
    if not isinstance(value, str):
        return ""
    return value.strip()


def _require_teacher_context(deps: RouteDeps):
    context = deps.get_school_request_context()
    context.require_any_role(TEACHER_ALLOWED_ROLES)
    if not context.active_organization_id:
        raise SchoolContextPermissionError("No active organization selected.")
    return context


def build_teacher_dashboard_payload(deps: RouteDeps, context) -> dict:
    class_summaries = list_accessible_teacher_classes(deps, context)
    student_count = sum(int(class_summary.get("studentCount") or 0) for class_summary in class_summaries)
    assignment_count = sum(int(class_summary.get("assignmentCount") or 0) for class_summary in class_summaries)
    organization_name = ""
    if context.active_membership:
        organization_name = context.active_membership.get("orgName", "")

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
            "speakingMinutes": 0,
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

    return bp
