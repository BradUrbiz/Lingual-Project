"""
Test harness endpoints for E2E testing.

Only registered when FLASK_ENV is 'development' or 'testing'.
Provides seed/teardown endpoints so Playwright tests can set up
and clean up test data without going through Firebase Auth.

NEVER deploy this to production.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from flask import Blueprint, jsonify, request, session

from backend.route_deps import RouteDeps

# Guard: refuse to load in production
_FLASK_ENV = os.environ.get("FLASK_ENV", "development")
if _FLASK_ENV == "production":
    raise ImportError("test_harness must not be imported in production")

TEST_ORG_NAME = "E2E Test School"
TEST_TEACHER_UID = "e2e-teacher-1"
TEST_TEACHER_EMAIL = "e2e-teacher@test.lingual.dev"
TEST_STUDENT_UID = "e2e-student-1"
TEST_STUDENT_EMAIL = "e2e-student@test.lingual.dev"
TEST_ADMIN_UID = "e2e-admin-1"
TEST_ADMIN_EMAIL = "e2e-admin@test.lingual.dev"
E2E_TAG = "__e2e_test__"

# Fixed deterministic IDs so seed is idempotent
E2E_ORG_ID = "e2e-org-001"
E2E_TEACHER_MEM_ID = "e2e-mem-teacher-001"
E2E_STUDENT_MEM_ID = "e2e-mem-student-001"
E2E_ADMIN_MEM_ID = "e2e-mem-admin-001"
E2E_CLASS_ID = "e2e-class-001"


def create_test_harness_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint("test_harness", __name__)

    def _ensure_user(uid: str, email: str, name: str, age: int, profile_extras: dict | None = None):
        """Create or update a user in Firestore."""
        existing = deps.db.get_user(uid)
        profile = {
            "display_name": name,
            "age": age,
            "ui_language": "en",
            "learning_locale": "fr-FR",
            "assessment_preference": "skip",
            **(profile_extras or {}),
        }
        if not existing:
            deps.db.create_user(
                uid=uid,
                email=email,
                name=name,
            )
        deps.db.update_user_profile(uid, **profile)
        return uid

    @bp.route("/api/test/seed", methods=["POST"])
    def api_test_seed():
        """
        Seed a complete E2E test scenario.

        Creates: org, teacher (teacher+school_admin), student, class, enrollment,
        curriculum mapping, published assignment.

        Returns all IDs needed by Playwright tests.
        """
        try:
            data = request.get_json(silent=True) or {}
            org_name = data.get("orgName", TEST_ORG_NAME)
            class_name = data.get("className", "E2E French 101")
            assignment_title = data.get("assignmentTitle", "E2E Practice Assignment")

            # 1. Create users
            _ensure_user(TEST_TEACHER_UID, TEST_TEACHER_EMAIL, "E2E Teacher", 35)
            _ensure_user(TEST_STUDENT_UID, TEST_STUDENT_EMAIL, "E2E Student", 16)
            _ensure_user(TEST_ADMIN_UID, TEST_ADMIN_EMAIL, "E2E Admin", 40)

            # Set lingual_admin flag on the admin user for testing
            if hasattr(deps.db, 'get_user_ref'):
                deps.db.get_user_ref(TEST_ADMIN_UID).update({"lingual_admin": True})

            org_id = E2E_ORG_ID
            teacher_mem_id = E2E_TEACHER_MEM_ID
            student_mem_id = E2E_STUDENT_MEM_ID
            admin_mem_id = E2E_ADMIN_MEM_ID
            class_id = E2E_CLASS_ID

            # 2. Create organization (idempotent — fixed ID)
            if not deps.db.get_organization(org_id):
                deps.db.create_organization(
                    name=org_name,
                    org_type="school",
                    status="active",
                    pilot_stage="beta",
                    org_id=org_id,
                )

            # 3. Create memberships (idempotent — fixed IDs)
            if not deps.db.get_membership(teacher_mem_id):
                deps.db.create_membership(
                    org_id=org_id,
                    uid=TEST_TEACHER_UID,
                    roles=["teacher", "school_admin"],
                    status="active",
                    membership_id=teacher_mem_id,
                )
            if not deps.db.get_membership(student_mem_id):
                deps.db.create_membership(
                    org_id=org_id,
                    uid=TEST_STUDENT_UID,
                    roles=["student"],
                    status="active",
                    membership_id=student_mem_id,
                )
            if not deps.db.get_membership(admin_mem_id):
                deps.db.create_membership(
                    org_id=org_id,
                    uid=TEST_ADMIN_UID,
                    roles=["school_admin"],
                    status="active",
                    membership_id=admin_mem_id,
                )

            # 4. Create class (idempotent — fixed ID)
            if not deps.db.get_class(class_id):
                deps.db.create_class(
                    org_id=org_id,
                    name=class_name,
                    learning_locale="fr-FR",
                    term="E2E Test Term",
                    subject="French",
                    grade_band="9-12",
                    teacher_membership_ids=[teacher_mem_id],
                    class_id=class_id,
                )
            deps.db.add_primary_class_to_membership(teacher_mem_id, class_id)
            deps.db.add_primary_class_to_membership(admin_mem_id, class_id)

            # 5. Enroll student (idempotent — fixed composite key)
            enrollment_id = f"{class_id}_{TEST_STUDENT_UID}"
            existing_enrollment = deps.db.get_student_class_enrollment(class_id, TEST_STUDENT_UID)
            if not existing_enrollment:
                enrollment_id = deps.db.create_enrollment(
                    class_id=class_id,
                    student_uid=TEST_STUDENT_UID,
                    student_membership_id=student_mem_id,
                    join_source="e2e_test",
                )
            elif existing_enrollment.get("status") != "active":
                deps.db.reactivate_enrollment(class_id, TEST_STUDENT_UID)

            # 6. Generate join code
            join_code = deps.db.generate_class_join_code(class_id)

            # 7. Create a published Canvas-first assignment (C2: no mapping row).
            assignment_id = deps.db.create_assignment(
                org_id=org_id,
                class_id=class_id,
                title=assignment_title,
                description="E2E test assignment for automated testing",
                status="published",
                task_type="information_gap",
                release_at=None,
                due_at=None,
                modality_override={"mode": "hybrid", "text_fallback_enabled": True},
                max_attempts=None,
                success_criteria=["Complete the practice task"],
                created_by_uid=TEST_TEACHER_UID,
                instructions="Practice ordering at a French cafe.",
                generated_scenario="You are ordering a drink at a French cafe and greeting the barista.",
                target_expressions=["bonjour", "comment ca va"],
                focus_grammar=["present tense"],
                teacher_notes="E2E test assignment",
                sql_engine=deps.sql_engine,
            )

            # 8. Set up compliance (student is minor, voice granted for testing)
            deps.db.upsert_student_compliance_record(org_id, TEST_STUDENT_UID, {
                "is_minor": True,
                "voice_consent_status": "granted",
                "guardian_consent_status": "granted",
                "text_allowed": True,
                "retention_policy_id": "standard_school",
            })

            return jsonify({
                "success": True,
                "seed": {
                    "orgId": org_id,
                    "orgName": org_name,
                    "teacherUid": TEST_TEACHER_UID,
                    "teacherEmail": TEST_TEACHER_EMAIL,
                    "teacherMembershipId": teacher_mem_id,
                    "studentUid": TEST_STUDENT_UID,
                    "studentEmail": TEST_STUDENT_EMAIL,
                    "studentMembershipId": student_mem_id,
                    "adminUid": TEST_ADMIN_UID,
                    "adminEmail": TEST_ADMIN_EMAIL,
                    "adminMembershipId": admin_mem_id,
                    "classId": class_id,
                    "className": class_name,
                    "joinCode": join_code,
                    "enrollmentId": enrollment_id,
                    "assignmentId": assignment_id,
                    "assignmentTitle": assignment_title,
                    "packageId": "",
                    "moduleId": "",
                    "situationId": "",
                    "e2eTag": E2E_TAG,
                },
            }), 201

        except Exception as exc:
            import traceback
            traceback.print_exc()
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/test/login", methods=["POST"])
    def api_test_login():
        """
        Bypass Firebase Auth and set a session directly.

        Accepts: { "uid": "...", "membershipId": "..." }
        If membershipId is provided, that membership is activated.
        Otherwise picks the most recent membership for the user.
        """
        try:
            data = request.get_json(silent=True) or {}
            uid = data.get("uid", TEST_TEACHER_UID)
            # Default membership IDs for known test users
            default_mids = {
                TEST_TEACHER_UID: E2E_TEACHER_MEM_ID,
                TEST_STUDENT_UID: E2E_STUDENT_MEM_ID,
                TEST_ADMIN_UID: E2E_ADMIN_MEM_ID,
            }
            preferred_membership_id = data.get("membershipId") or default_mids.get(uid)
            user = deps.db.get_user(uid)
            if not user:
                # Auto-create if name and email are provided
                name = data.get("name", "")
                email = data.get("email", "")
                if name and email:
                    _ensure_user(uid, email, name, data.get("age", 16))
                    user = deps.db.get_user(uid)
                else:
                    return jsonify({"success": False, "error": f"User {uid} not found. Provide name and email to auto-create."}), 404

            school_context = deps.db.resolve_user_school_context(
                uid,
                preferred_active_membership_id=preferred_membership_id,
            )
            active_mid = school_context.get("active_membership_id") or ""
            session["user"] = {
                "uid": uid,
                "email": user.get("email", ""),
                "name": user.get("name", ""),
                "active_membership_id": active_mid,
            }
            deps.db.set_user_last_active_membership(uid, active_mid)

            return jsonify({
                "success": True,
                "user": {
                    "uid": uid,
                    "email": user.get("email"),
                    "name": user.get("name"),
                    "activeMembershipId": active_mid,
                    "activeOrganizationId": school_context.get("active_organization_id"),
                    "activeRoles": school_context.get("active_roles", []),
                },
            })

        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/test/teardown", methods=["POST"])
    def api_test_teardown():
        """
        Clean up E2E test data.

        Deletes all records created by the seed endpoint.
        Accepts: { "orgId": "..." } to scope the cleanup.
        """
        try:
            data = request.get_json(silent=True) or {}
            org_id = data.get("orgId")

            if not org_id:
                return jsonify({"success": False, "error": "orgId is required"}), 400

            deleted = {
                "assignments": 0,
                "enrollments": 0,
                "classes": 0,
                "memberships": 0,
                "practice_sessions": 0,
                "learning_events": 0,
                "compliance_records": 0,
                "consent_events": 0,
            }

            # Delete in dependency order
            if hasattr(deps.db, "delete_org_test_data"):
                deleted = deps.db.delete_org_test_data(org_id)
            else:
                # Fallback: log what would be deleted
                pass

            session.clear()

            return jsonify({
                "success": True,
                "deleted": deleted,
                "orgId": org_id,
            })

        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/test/session", methods=["GET"])
    def api_test_session():
        """Return the current session state (for debugging)."""
        user = session.get("user")
        return jsonify({
            "success": True,
            "loggedIn": user is not None,
            "user": user,
        })

    @bp.route("/api/test/verify", methods=["GET"])
    def api_test_verify():
        """
        Return the same user payload shape as /api/auth/verify.

        Used by the frontend E2E auth bypass to populate AuthContext
        with the full User object including memberships.
        """
        user_session = session.get("user")
        if not user_session:
            return jsonify({"success": False, "error": "Not logged in. Call /api/test/login first."}), 401

        uid = user_session.get("uid", "")
        user = deps.db.get_user(uid)
        if not user:
            return jsonify({"success": False, "error": f"User {uid} not found."}), 404

        preferred_mid = user_session.get("active_membership_id")
        school_context = deps.db.resolve_user_school_context(uid, preferred_active_membership_id=preferred_mid)

        # Import and reuse the same builder as the real auth endpoint
        from backend.routes.auth import build_auth_user_payload
        user_payload = build_auth_user_payload(
            uid=uid,
            email=user.get("email", ""),
            name=user.get("name", ""),
            school_context=school_context,
        )

        # Enrich with profile fields the frontend expects
        profile = user.get("profile", {}) if isinstance(user.get("profile"), dict) else {}
        user_payload["profile"] = profile

        # Include lingual_admin flag if set
        if user.get("lingual_admin"):
            user_payload["lingualAdmin"] = True

        return jsonify({"success": True, "user": user_payload})

    return bp
