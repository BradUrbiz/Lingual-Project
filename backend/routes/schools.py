from __future__ import annotations

from datetime import datetime

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.compliance import auto_grant_voice_consent_for_pilot
from backend.services.membership_context import (
    SchoolContextNotFoundError,
    SchoolContextPermissionError,
    SchoolRequestContext,
)

ORGANIZATION_TYPES = {"school", "district", "program"}
TEACHER_ALLOWED_ROLES = {"teacher", "school_admin"}


def _timestamp_to_iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "seconds"):
        return datetime.utcfromtimestamp(value.seconds).isoformat()
    return str(value)


def _normalize_string(value):
    if not isinstance(value, str):
        return ""
    return value.strip()


def _count_students_for_class(deps: RouteDeps, class_id: str) -> int:
    return len(deps.db.list_class_enrollments(class_id))


def _count_assignments_for_class(deps: RouteDeps, class_id: str) -> int:
    return len(deps.db.list_class_assignments(class_id))


def _class_canvas_linked(deps: RouteDeps, class_id: str) -> bool:
    getter = getattr(deps.db, "get_canvas_connection_by_class", None)
    if not callable(getter):
        return False
    try:
        connection = getter(class_id)
    except Exception:
        return False
    return isinstance(connection, dict)


def build_class_summary(deps: RouteDeps, class_record: dict | None) -> dict | None:
    if not isinstance(class_record, dict):
        return None

    class_id = class_record.get("id")
    if not isinstance(class_id, str) or not class_id:
        return None

    return {
        "id": class_id,
        "orgId": class_record.get("org_id"),
        "name": class_record.get("name", ""),
        "term": class_record.get("term", ""),
        "subject": class_record.get("subject", ""),
        "learningLocale": class_record.get("learning_locale", "ko-KR"),
        "teacherMembershipIds": class_record.get("teacher_membership_ids", []),
        "gradeBand": class_record.get("grade_band", ""),
        "status": class_record.get("status", "active"),
        "studentCount": _count_students_for_class(deps, class_id),
        "assignmentCount": _count_assignments_for_class(deps, class_id),
        "canvasLinked": _class_canvas_linked(deps, class_id),
        "createdAt": _timestamp_to_iso(class_record.get("created_at")),
        "updatedAt": _timestamp_to_iso(class_record.get("updated_at")),
    }


def list_accessible_teacher_classes(deps: RouteDeps, context: SchoolRequestContext) -> list[dict]:
    if not context.active_organization_id:
        return []

    if context.has_role("school_admin"):
        class_records = deps.db.list_org_classes(context.active_organization_id)
    elif context.has_role("teacher") and context.active_membership_id:
        class_records = deps.db.list_teacher_classes(context.active_membership_id)
    else:
        return []

    class_summaries = []
    for class_record in class_records:
        summary = build_class_summary(deps, class_record)
        if summary:
            class_summaries.append(summary)
    return class_summaries


def build_setup_checklist(context: SchoolRequestContext, class_summaries: list[dict]) -> list[dict]:
    total_students = sum(int(class_summary.get("studentCount") or 0) for class_summary in class_summaries)
    can_manage_school = context.has_any_role(TEACHER_ALLOWED_ROLES)

    return [
        {
            "id": "school_workspace",
            "title": "Create school workspace",
            "description": "Create an organization-level workspace for teacher-managed practice.",
            "completed": can_manage_school and bool(context.active_organization_id),
        },
        {
            "id": "first_class",
            "title": "Create first class",
            "description": "Create a class that anchors assignments, rosters, and reporting.",
            "completed": len(class_summaries) > 0,
        },
        {
            "id": "student_roster",
            "title": "Add first student",
            "description": "Roster data is needed before assignment delivery and analytics can begin.",
            "completed": total_students > 0,
        },
    ]


def build_school_payload(deps: RouteDeps, context: SchoolRequestContext) -> dict:
    teacher_classes = list_accessible_teacher_classes(deps, context)
    has_teacher_workspace = any(
        any(role in TEACHER_ALLOWED_ROLES for role in membership.get("roles", []))
        for membership in context.memberships
    )

    return {
        "memberships": [dict(membership) for membership in context.memberships],
        "activeMembership": dict(context.active_membership) if context.active_membership else None,
        "activeMembershipId": context.active_membership_id,
        "activeOrganizationId": context.active_organization_id,
        "activeRoles": list(context.active_roles),
        "allowedClassIds": list(context.allowed_class_ids),
        "teacherClasses": teacher_classes,
        "setupChecklist": build_setup_checklist(context, teacher_classes),
        "canManageSchool": context.has_any_role(TEACHER_ALLOWED_ROLES),
        "needsSchoolSetup": not has_teacher_workspace,
    }


def create_schools_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint("school_routes", __name__)

    @bp.route("/api/schools/current")
    @deps.login_required
    def api_current_school():
        try:
            context = deps.get_school_request_context()
            return jsonify({
                "success": True,
                "school": build_school_payload(deps, context),
            })
        except Exception as exc:
            print(f"School context error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/schools", methods=["POST"])
    @deps.login_required
    def api_create_school():
        try:
            uid = deps.get_current_user_uid()

            # Gate: only lingual_admin can create schools directly
            if not deps.db.get_user_field(uid, 'lingual_admin'):
                return jsonify({
                    "success": False,
                    "error": "School creation requires Lingual approval. Submit a request at /app/request-school."
                }), 403

            data = request.get_json() or {}

            org_name = _normalize_string(data.get("orgName"))
            org_type = _normalize_string(data.get("orgType")) or "school"
            class_name = _normalize_string(data.get("className"))
            term = _normalize_string(data.get("term"))
            subject = _normalize_string(data.get("subject"))
            grade_band = _normalize_string(data.get("gradeBand"))
            learning_locale = _normalize_string(data.get("learningLocale")) or "ko-KR"

            if not uid:
                raise SchoolContextPermissionError("Authentication required.")
            if not org_name:
                return jsonify({"success": False, "error": "Organization name is required."}), 400
            if org_type not in ORGANIZATION_TYPES:
                return jsonify({"success": False, "error": "Invalid organization type."}), 400
            if not class_name:
                return jsonify({"success": False, "error": "Class name is required."}), 400
            if learning_locale not in deps.allowed_learning_locales:
                return jsonify({"success": False, "error": "Invalid learning locale."}), 400

            org_id = deps.db.create_organization(
                name=org_name,
                org_type=org_type,
                pilot_stage="beta",
            )
            membership_id = deps.db.create_membership(
                org_id=org_id,
                uid=uid,
                roles=["school_admin", "teacher"],
            )
            class_id = deps.db.create_class(
                org_id=org_id,
                name=class_name,
                learning_locale=learning_locale,
                term=term,
                subject=subject,
                teacher_membership_ids=[membership_id],
                grade_band=grade_band,
            )
            deps.db.add_primary_class_to_membership(membership_id, class_id)
            deps.db.update_user_profile(uid, school_name=org_name)

            context = deps.set_active_school_membership(membership_id)
            created_class = build_class_summary(deps, deps.db.get_class(class_id))

            return jsonify({
                "success": True,
                "school": build_school_payload(deps, context),
                "createdClass": created_class,
            }), 201
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"School onboarding error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/schools/current/active-membership", methods=["POST"])
    @deps.login_required
    def api_set_active_membership():
        try:
            data = request.get_json() or {}
            membership_id = _normalize_string(data.get("membershipId"))
            if not membership_id:
                return jsonify({"success": False, "error": "membershipId is required."}), 400

            context = deps.set_active_school_membership(membership_id)
            return jsonify({
                "success": True,
                "school": build_school_payload(deps, context),
            })
        except SchoolContextNotFoundError as exc:
            return jsonify({"success": False, "error": str(exc)}), 404
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Active membership switch error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/schools/join", methods=["POST"])
    @deps.login_required
    def api_join_class_by_code():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                raise SchoolContextPermissionError("Authentication required.")

            data = request.get_json() or {}
            raw_code = _normalize_string(data.get("joinCode")).upper()
            if not raw_code or len(raw_code) != 6:
                return jsonify({"success": False, "error": "A valid 6-character join code is required."}), 400

            class_record = deps.db.get_class_by_join_code(raw_code)
            if not class_record:
                return jsonify({"success": False, "error": "Invalid or expired join code."}), 404

            class_id = class_record["id"]
            org_id = class_record["org_id"]

            existing = deps.db.get_student_class_enrollment(class_id, uid)
            if existing and existing.get("status") == "active":
                return jsonify({
                    "success": True,
                    "alreadyEnrolled": True,
                    "class": {
                        "id": class_id,
                        "name": class_record.get("name", ""),
                        "subject": class_record.get("subject", ""),
                        "learningLocale": class_record.get("learning_locale", ""),
                    },
                })

            membership_id = f"{org_id}_{uid}"
            membership = deps.db.get_membership(membership_id)
            if not membership:
                deps.db.create_membership(
                    org_id=org_id,
                    uid=uid,
                    roles=["student"],
                    primary_class_ids=[class_id],
                    membership_id=membership_id,
                )
            else:
                deps.db.add_primary_class_to_membership(membership_id, class_id)

            if existing and existing.get("status") == "inactive":
                deps.db.reactivate_enrollment(class_id, uid)
            else:
                deps.db.create_enrollment(
                    class_id=class_id,
                    student_uid=uid,
                    student_membership_id=membership_id,
                    join_source="join_code",
                )

            # Pilot: auto-grant voice + guardian consent on enrollment.
            # Teachers can still revoke per-student on the compliance page.
            # To restore explicit consent, revert the helper call here.
            auto_grant_voice_consent_for_pilot(
                deps.db, org_id=org_id, student_uid=uid,
            )

            deps.db.set_user_last_active_membership(uid, membership_id)

            return jsonify({
                "success": True,
                "alreadyEnrolled": False,
                "class": {
                    "id": class_id,
                    "name": class_record.get("name", ""),
                    "subject": class_record.get("subject", ""),
                    "learningLocale": class_record.get("learning_locale", ""),
                },
                "membershipId": membership_id,
                "enrollmentId": f"{class_id}_{uid}",
            }), 201
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Class join error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/student/classes")
    @deps.login_required
    def api_list_student_classes():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                raise SchoolContextPermissionError("Authentication required.")

            class_summaries = []
            for class_record in deps.db.list_student_classes(uid):
                summary = build_class_summary(deps, class_record)
                if summary:
                    class_summaries.append(summary)

            return jsonify({
                "success": True,
                "classes": class_summaries,
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Student classes error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/student/classes/<class_id>", methods=["DELETE"])
    @deps.login_required
    def api_leave_student_class(class_id):
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                raise SchoolContextPermissionError("Authentication required.")

            enrollment = deps.db.get_student_class_enrollment(class_id, uid)
            if not enrollment or enrollment.get("status") != "active":
                return jsonify({"success": False, "error": "Active class enrollment not found."}), 404

            membership_id = _normalize_string(enrollment.get("student_membership_id"))
            if membership_id:
                deps.db.remove_primary_class_from_membership(membership_id, class_id)
            deps.db.deactivate_enrollment(class_id, uid)

            class_record = deps.db.get_class(class_id)
            return jsonify({
                "success": True,
                "class": {
                    "id": class_id,
                    "name": (class_record or {}).get("name", ""),
                },
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            print(f"Student leave class error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    # ------------------------------------------------------------------
    # Teacher invite codes (school admin generates, teacher uses to join)
    # ------------------------------------------------------------------

    @bp.route("/api/schools/teacher-invite-code", methods=["POST"])
    @deps.login_required
    def api_generate_teacher_invite_code():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({"school_admin"})
            org_id = ctx.active_organization_id
            if not org_id:
                return jsonify({"success": False, "error": "No active organization."}), 400
            code = deps.db.generate_teacher_invite_code(org_id)
            return jsonify({"success": True, "inviteCode": code})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/schools/teacher-invite-code")
    @deps.login_required
    def api_get_teacher_invite_code():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({"school_admin"})
            org = deps.db.get_organization(ctx.active_organization_id)
            return jsonify({
                "success": True,
                "inviteCode": org.get("teacher_invite_code") if org.get("teacher_invite_code_active") else None,
                "active": bool(org.get("teacher_invite_code_active")),
                "generatedAt": str(org.get("teacher_invite_code_generated_at")) if org.get("teacher_invite_code_generated_at") else None,
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403

    @bp.route("/api/schools/teacher-invite-code", methods=["DELETE"])
    @deps.login_required
    def api_deactivate_teacher_invite_code():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({"school_admin"})
            deps.db.deactivate_teacher_invite_code(ctx.active_organization_id)
            return jsonify({"success": True})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403

    # ------------------------------------------------------------------
    # Join school as teacher (teacher enters invite code)
    # ------------------------------------------------------------------

    @bp.route("/api/schools/join-as-teacher", methods=["POST"])
    @deps.login_required
    def api_join_as_teacher():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                return jsonify({"success": False, "error": "Authentication required."}), 401

            data = request.get_json() or {}
            raw_code = (data.get("inviteCode") or "").strip().upper()
            if not raw_code or len(raw_code) != 6:
                return jsonify({"success": False, "error": "A valid 6-character invite code is required."}), 400

            org = deps.db.get_org_by_teacher_invite_code(raw_code)
            if not org:
                return jsonify({"success": False, "error": "Invalid or expired invite code."}), 404

            org_id = org["id"]

            # Check if already a member
            memberships = deps.db.get_user_memberships(uid)
            for m in memberships:
                if m.get("orgId") == org_id:
                    return jsonify({"success": False, "error": "You are already a member of this school."}), 409

            # Check if already has pending invitation
            existing_invite = deps.db.get_teacher_invitation_by_user(org_id, uid)
            if existing_invite:
                return jsonify({"success": False, "error": "You already have a pending invitation for this school."}), 409

            user = deps.db.get_user(uid)
            invitation_id = deps.db.create_teacher_invitation(
                org_id=org_id,
                uid=uid,
                email=user.get("email", "") if user else "",
                name=user.get("name", "") if user else "",
            )

            # Pilot: auto-approve teacher invitations. The invitation doc is
            # kept as an audit trail (marked approved immediately) but the
            # membership is created in the same request so the teacher can
            # start working without waiting for a school_admin to review.
            # To restore the manual-approval flow, revert this commit.
            membership_id = deps.db.create_membership(
                org_id=org_id,
                uid=uid,
                roles=["teacher"],
            )
            deps.db.set_user_last_active_membership(uid, membership_id)

            from datetime import UTC, datetime
            deps.db.update_teacher_invitation(invitation_id, {
                "status": "approved",
                "reviewed_by_uid": "system:pilot_auto_approve",
                "reviewed_at": datetime.now(UTC).isoformat(),
            })

            return jsonify({
                "success": True,
                "invitationId": invitation_id,
                "membershipId": membership_id,
                "orgName": org.get("name", ""),
                "status": "approved",
            }), 201
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    # ------------------------------------------------------------------
    # Teacher invitations (school admin reviews)
    # ------------------------------------------------------------------

    @bp.route("/api/schools/teacher-invitations")
    @deps.login_required
    def api_list_teacher_invitations():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({"school_admin"})
            status_filter = request.args.get("status")
            invitations = deps.db.list_teacher_invitations(ctx.active_organization_id, status_filter=status_filter)
            return jsonify({
                "success": True,
                "invitations": [
                    {
                        "id": inv.get("id"),
                        "orgId": inv.get("org_id"),
                        "uid": inv.get("uid"),
                        "email": inv.get("email", ""),
                        "name": inv.get("name", ""),
                        "status": inv.get("status"),
                        "createdAt": str(inv["created_at"]) if inv.get("created_at") else None,
                    }
                    for inv in invitations
                ],
            })
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403

    @bp.route("/api/schools/teacher-invitations/<invitation_id>/approve", methods=["POST"])
    @deps.login_required
    def api_approve_teacher_invitation(invitation_id):
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({"school_admin"})

            invitation = deps.db.get_teacher_invitation(invitation_id)
            if not invitation:
                return jsonify({"success": False, "error": "Invitation not found."}), 404
            if invitation.get("org_id") != ctx.active_organization_id:
                return jsonify({"success": False, "error": "Invitation does not belong to your organization."}), 403
            if invitation.get("status") != "pending":
                return jsonify({"success": False, "error": f"Invitation is already {invitation['status']}."}), 409

            membership_id = deps.db.create_membership(
                org_id=ctx.active_organization_id,
                uid=invitation["uid"],
                roles=["teacher"],
            )
            deps.db.set_user_last_active_membership(invitation["uid"], membership_id)

            from datetime import UTC, datetime
            deps.db.update_teacher_invitation(invitation_id, {
                "status": "approved",
                "reviewed_by_uid": deps.get_current_user_uid(),
                "reviewed_at": datetime.now(UTC).isoformat(),
            })

            return jsonify({"success": True, "membershipId": membership_id})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/schools/teacher-invitations/<invitation_id>/reject", methods=["POST"])
    @deps.login_required
    def api_reject_teacher_invitation(invitation_id):
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({"school_admin"})

            invitation = deps.db.get_teacher_invitation(invitation_id)
            if not invitation:
                return jsonify({"success": False, "error": "Invitation not found."}), 404
            if invitation.get("org_id") != ctx.active_organization_id:
                return jsonify({"success": False, "error": "Invitation does not belong to your organization."}), 403
            if invitation.get("status") != "pending":
                return jsonify({"success": False, "error": f"Invitation is already {invitation['status']}."}), 409

            from datetime import UTC, datetime
            deps.db.update_teacher_invitation(invitation_id, {
                "status": "rejected",
                "reviewed_by_uid": deps.get_current_user_uid(),
                "reviewed_at": datetime.now(UTC).isoformat(),
            })

            return jsonify({"success": True})
        except SchoolContextPermissionError as exc:
            return jsonify({"success": False, "error": str(exc)}), 403

    return bp
