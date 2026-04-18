"""
Shared test infrastructure for backend tests.

Provides:
- FakeDbBase: composable in-memory Firestore replacement with mixins
- Factory functions: make_organization, make_membership, make_class, etc.
- passthrough_login_required: no-op Flask decorator for tests
- SAMPLE_CURRICULUM_PACKAGE: minimal AP French sample for curriculum tests
- make_test_deps: builds a RouteDeps wired to a FakeDb + sample package
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.services.membership_context import resolve_school_request_context


# ---------------------------------------------------------------------------
# Passthrough decorator
# ---------------------------------------------------------------------------
def passthrough_login_required(func):
    """No-op login_required for test routes."""
    return func


# ---------------------------------------------------------------------------
# Factory functions — build minimal valid records
# ---------------------------------------------------------------------------
_counters: dict[str, int] = {}


def _next_id(prefix: str) -> str:
    _counters[prefix] = _counters.get(prefix, 0) + 1
    return f"{prefix}-{_counters[prefix]}"


def reset_factories():
    """Reset auto-increment counters between tests if needed."""
    _counters.clear()


def make_organization(
    org_id: str | None = None,
    name: str = "Test School",
    org_type: str = "school",
    status: str = "active",
    **extra,
) -> dict[str, Any]:
    return {
        "id": org_id or _next_id("org"),
        "name": name,
        "type": org_type,
        "status": status,
        "pilot_stage": "beta",
        **extra,
    }


def make_membership(
    membership_id: str | None = None,
    org_id: str = "org-1",
    uid: str = "user-1",
    roles: list[str] | None = None,
    status: str = "active",
    primary_class_ids: list[str] | None = None,
    **extra,
) -> dict[str, Any]:
    return {
        "id": membership_id or _next_id("mem"),
        "orgId": org_id,
        "uid": uid,
        "roles": roles or ["teacher"],
        "status": status,
        "primaryClassIds": primary_class_ids or [],
        **extra,
    }


def make_class(
    class_id: str | None = None,
    org_id: str = "org-1",
    name: str = "French 101",
    learning_locale: str = "fr-FR",
    teacher_membership_ids: list[str] | None = None,
    **extra,
) -> dict[str, Any]:
    return {
        "id": class_id or _next_id("class"),
        "org_id": org_id,
        "name": name,
        "learning_locale": learning_locale,
        "term": extra.pop("term", "Fall 2026"),
        "subject": extra.pop("subject", "French"),
        "grade_band": extra.pop("grade_band", "9-12"),
        "teacher_membership_ids": teacher_membership_ids or [],
        "status": extra.pop("status", "active"),
        "created_at": None,
        "updated_at": None,
        **extra,
    }


def make_enrollment(
    class_id: str = "class-1",
    student_uid: str = "stu-1",
    join_source: str = "join_code",
    status: str = "active",
    **extra,
) -> dict[str, Any]:
    return {
        "id": f"{class_id}_{student_uid}",
        "class_id": class_id,
        "student_uid": student_uid,
        "student_membership_id": extra.pop("student_membership_id", ""),
        "join_source": join_source,
        "status": status,
        "created_at": datetime.now(UTC).isoformat(),
        **extra,
    }


def make_user(
    uid: str = "user-1",
    name: str = "Test User",
    email: str = "test@example.com",
    age: int | None = None,
    display_name: str | None = None,
    **extra,
) -> dict[str, Any]:
    profile: dict[str, Any] = {
        "display_name": display_name or name,
    }
    if age is not None:
        profile["age"] = age
    return {
        "uid": uid,
        "name": name,
        "email": email,
        "profile": profile,
        **extra,
    }


def make_assignment(
    assignment_id: str | None = None,
    org_id: str = "org-1",
    class_id: str = "class-1",
    title: str = "Practice 1",
    status: str = "published",
    task_type: str = "information_gap",
    **extra,
) -> dict[str, Any]:
    return {
        "id": assignment_id or _next_id("assign"),
        "org_id": org_id,
        "class_id": class_id,
        "title": title,
        "description": extra.pop("description", ""),
        "status": status,
        "task_type": task_type,
        "release_at": None,
        "due_at": None,
        "modality_override": None,
        "max_attempts": None,
        "success_criteria": [],
        "created_by_uid": extra.pop("created_by_uid", ""),
        # Direct scenario fields (C2 — curriculum_mappings is gone).
        "instructions": extra.pop("instructions", "Default test instructions."),
        "generated_scenario": extra.pop("generated_scenario", "Default test scenario."),
        "target_expressions": extra.pop("target_expressions", []),
        "focus_grammar": extra.pop("focus_grammar", []),
        "teacher_notes": extra.pop("teacher_notes", ""),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        **extra,
    }


def make_compliance_record(
    org_id: str = "org-1",
    student_uid: str = "stu-1",
    is_minor: bool = True,
    voice_consent_status: str = "unknown",
    guardian_consent_status: str = "unknown",
    **extra,
) -> dict[str, Any]:
    return {
        "id": f"{org_id}_{student_uid}",
        "org_id": org_id,
        "student_uid": student_uid,
        "is_minor": is_minor,
        "voice_consent_status": voice_consent_status,
        "guardian_consent_status": guardian_consent_status,
        "text_allowed": extra.pop("text_allowed", True),
        "voice_allowed": extra.pop("voice_allowed", False),
        "retention_policy_id": extra.pop("retention_policy_id", "standard_school"),
        **extra,
    }


def make_practice_session(
    session_id: str | None = None,
    org_id: str = "org-1",
    class_id: str = "class-1",
    assignment_id: str = "assign-1",
    student_uid: str = "stu-1",
    status: str = "active",
    **extra,
) -> dict[str, Any]:
    from backend.services.practice_analytics import default_session_summary, default_cost_summary, default_analysis_state
    return {
        "id": session_id or _next_id("session"),
        "org_id": org_id,
        "class_id": class_id,
        "assignment_id": assignment_id,
        "student_uid": student_uid,
        "status": status,
        "modality": extra.pop("modality", "hybrid"),
        "voice_enabled": extra.pop("voice_enabled", True),
        "text_enabled": extra.pop("text_enabled", True),
        "started_at": datetime.now(UTC),
        "ended_at": None,
        "session_summary": extra.pop("session_summary", default_session_summary()),
        "cost_summary": extra.pop("cost_summary", default_cost_summary()),
        "analysis_state": extra.pop("analysis_state", default_analysis_state()),
        "mapping_snapshot": extra.pop("mapping_snapshot", {}),
        "pedagogy_snapshot": extra.pop("pedagogy_snapshot", {}),
        "curriculum_snapshot": extra.pop("curriculum_snapshot", {}),
        "transcript_ref": extra.pop("transcript_ref", {}),
        "teacher_preview": extra.pop("teacher_preview", False),
        "prompt_version": "assignment_bootstrap.v1",
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        **extra,
    }


# ---------------------------------------------------------------------------
# Sample curriculum package
# ---------------------------------------------------------------------------
SAMPLE_CURRICULUM_PACKAGE: dict[str, Any] = {
    "curriculum": {
        "id": "ap-french-sample",
        "title": {"en": "AP French Sample"},
        "learningLocale": "fr-FR",
        "levelBand": "intermediate",
        "version": "1.0",
        "source": {"type": "native"},
    },
    "objectives": [
        {
            "id": "obj-1",
            "mode": "interpersonal_speaking",
            "canDo": {"en": "Describe family"},
            "contextTags": ["family_structures"],
            "communicativeFunctions": ["describe_people_things"],
            "discourseMoves": ["compare_contrast"],
            "foundationDomains": ["personal"],
            "mastery": {"rubricId": "rubric-1", "threshold": 3},
            "evidenceModel": {"taskModel": "information_gap", "minTurns": 4, "timeLimitSec": 300},
            "templateRefs": [],
        },
    ],
    "rubrics": [
        {
            "id": "rubric-1",
            "title": {"en": "Speaking rubric"},
            "scale": {"min": 0, "max": 4},
            "dimensions": [
                {"id": "interaction_management", "title": {"en": "Interaction"}, "description": {"en": "..."}},
                {"id": "lexical_grammatical_control", "title": {"en": "Grammar"}, "description": {"en": "..."}},
            ],
        }
    ],
    "units": [
        {
            "id": "unit-1",
            "title": {"en": "Unit 1"},
            "ap": {"unitNumber": 1},
            "modules": [
                {
                    "id": "mod-1",
                    "title": {"en": "Module 1"},
                    "moduleGoal": {"en": "Learn family vocabulary"},
                    "capstone": {
                        "mode": "interpersonal_speaking",
                        "taskModel": "information_gap",
                        "situationId": "sit-1",
                    },
                    "situations": [
                        {
                            "id": "sit-1",
                            "kind": "interpersonal_speaking",
                            "objectiveIds": ["obj-1"],
                            "seed": {
                                "setting": {"en": "At a cafe"},
                                "roles": [{"en": "Student"}, {"en": "Friend"}],
                                "register": "informal",
                                "contextTags": ["family_structures"],
                                "constraints": {"minTurns": 4, "maxTurns": 10, "timeLimitSec": 300},
                            },
                        }
                    ],
                }
            ],
        }
    ],
    "templates": {"activityTemplates": []},
}


def get_sample_curriculum_practice_context(module_id: str, situation_id: str):
    """Look up module and situation from the sample package."""
    package = SAMPLE_CURRICULUM_PACKAGE
    for unit in package.get("units", []):
        for mod in unit.get("modules", []):
            if mod.get("id") == module_id:
                for sit in mod.get("situations", []):
                    if sit.get("id") == situation_id:
                        obj_index = {o["id"]: o for o in package.get("objectives", []) if isinstance(o, dict)}
                        objectives = [obj_index[oid] for oid in sit.get("objectiveIds", []) if oid in obj_index]
                        return package, unit, mod, sit, "interpersonal_speaking", objectives
    raise ValueError(f"Module {module_id} / situation {situation_id} not found in sample package.")


# ---------------------------------------------------------------------------
# FakeDbBase — composable in-memory store
# ---------------------------------------------------------------------------
class FakeDbBase:
    """
    Shared in-memory fake database for backend tests.

    Covers the common core methods used by 3+ test files. Subclass and add
    specialized methods when needed (Canvas, deletion, etc.).
    """

    def __init__(self):
        self.organizations: dict[str, dict] = {}
        self.memberships: dict[str, dict] = {}
        self.classes: dict[str, dict] = {}
        self.enrollments: dict[str, dict] = {}
        self.users: dict[str, dict] = {}
        self.student_compliance_records: dict[str, dict] = {}
        self.consent_events: list[dict] = []
        self.guardian_packets: dict[str, dict] = {}
        self.assignments: dict[str, dict] = {}
        self.practice_sessions: dict[str, dict] = {}
        self.learning_events: list[dict] = []
        self.deletion_requests: dict[str, dict] = {}
        self.deletion_execution_runs: dict[str, dict] = {}
        self.user_active_memberships: dict[str, str] = {}
        self._counters: dict[str, int] = {}
        self.canvas_course_content: dict[str, dict] = {}

    def _next_id(self, prefix: str) -> str:
        self._counters[prefix] = self._counters.get(prefix, 0) + 1
        return f"{prefix}-{self._counters[prefix]}"

    # -- Identity / context --

    def set_user_last_active_membership(self, uid: str, membership_id: str):
        self.user_active_memberships[uid] = membership_id

    def resolve_user_school_context(self, uid: str, preferred_active_membership_id: str | None = None):
        memberships = []
        for membership in self.memberships.values():
            if membership.get("uid") != uid or membership.get("status") not in {"active", "invited"}:
                continue
            org = self.organizations.get(membership.get("orgId")) or {}
            memberships.append({
                "id": membership["id"],
                "orgId": membership["orgId"],
                "orgName": org.get("name", ""),
                "orgType": org.get("type"),
                "roles": membership.get("roles", []),
                "status": membership.get("status", "active"),
                "primaryClassIds": membership.get("primaryClassIds", []),
            })
        memberships.sort(key=lambda m: m["id"])
        active_membership_id = preferred_active_membership_id or self.user_active_memberships.get(uid)
        active = next((m for m in memberships if m["id"] == active_membership_id), memberships[0] if memberships else None)
        return {
            "memberships": memberships,
            "active_membership": active,
            "active_membership_id": active.get("id") if active else None,
            "active_organization_id": active.get("orgId") if active else None,
            "active_roles": active.get("roles", []) if active else [],
        }

    # -- Core CRUD --

    def get_user(self, uid: str):
        return self.users.get(uid)

    def get_organization(self, org_id: str):
        return self.organizations.get(org_id)

    def get_class(self, class_id: str):
        return self.classes.get(class_id)

    def get_membership(self, membership_id: str):
        return self.memberships.get(membership_id)

    def create_organization(self, name: str, org_type: str = "school", status: str = "active", **kwargs) -> str:
        org = make_organization(name=name, org_type=org_type, status=status, **kwargs)
        self.organizations[org["id"]] = org
        return org["id"]

    def create_membership(self, org_id: str, uid: str, roles: list, status: str = "active", primary_class_ids=None, membership_id=None, **kwargs) -> str:
        mem = make_membership(membership_id=membership_id, org_id=org_id, uid=uid, roles=list(roles), status=status, primary_class_ids=list(primary_class_ids or []), **kwargs)
        self.memberships[mem["id"]] = mem
        return mem["id"]

    def create_class(self, org_id: str, name: str, learning_locale: str = "fr-FR", teacher_membership_ids=None, class_id=None, **kwargs) -> str:
        cls = make_class(class_id=class_id, org_id=org_id, name=name, learning_locale=learning_locale, teacher_membership_ids=teacher_membership_ids, **kwargs)
        self.classes[cls["id"]] = cls
        return cls["id"]

    def add_primary_class_to_membership(self, membership_id: str, class_id: str):
        mem = self.memberships.get(membership_id)
        if mem and class_id not in mem.get("primaryClassIds", []):
            mem.setdefault("primaryClassIds", []).append(class_id)

    # -- Enrollments --

    def create_enrollment(self, class_id: str, student_uid: str, student_membership_id: str = "", join_source: str = "", **kwargs) -> str:
        enr = make_enrollment(class_id=class_id, student_uid=student_uid, join_source=join_source, student_membership_id=student_membership_id, **kwargs)
        self.enrollments[enr["id"]] = enr
        return enr["id"]

    def get_student_class_enrollment(self, class_id: str, student_uid: str):
        enr = self.enrollments.get(f"{class_id}_{student_uid}")
        return dict(enr) if enr else None

    def list_class_enrollments(self, class_id: str, status: str = "active"):
        return [
            dict(e) for e in self.enrollments.values()
            if e.get("class_id") == class_id and (not status or e.get("status") == status)
        ]

    def deactivate_enrollment(self, class_id: str, student_uid: str):
        key = f"{class_id}_{student_uid}"
        if key in self.enrollments:
            self.enrollments[key]["status"] = "inactive"

    def reactivate_enrollment(self, class_id: str, student_uid: str):
        key = f"{class_id}_{student_uid}"
        if key in self.enrollments:
            self.enrollments[key]["status"] = "active"

    # -- Compliance --

    def get_student_compliance_record(self, org_id: str, student_uid: str):
        record = self.student_compliance_records.get(f"{org_id}_{student_uid}")
        return dict(record) if record else None

    def upsert_student_compliance_record(self, org_id: str, student_uid: str, record: dict):
        key = f"{org_id}_{student_uid}"
        self.student_compliance_records[key] = {"id": key, **record}
        return key

    def create_consent_event(self, **kwargs) -> str:
        self.consent_events.append(dict(kwargs))
        return f"event-{len(self.consent_events)}"

    def list_consent_events(self, org_id: str, limit: int = 500):
        events = [dict(e) for e in self.consent_events if e.get("org_id") == org_id]
        return list(reversed(events))[:limit]

    # -- Guardian packets --

    def create_guardian_consent_packet(self, **kwargs) -> str:
        pid = self._next_id("packet")
        self.guardian_packets[pid] = {"id": pid, **kwargs}
        return pid

    def get_guardian_consent_packet(self, packet_id: str):
        p = self.guardian_packets.get(packet_id)
        return dict(p) if p else None

    def update_guardian_consent_packet(self, packet_id: str, updates: dict):
        if packet_id in self.guardian_packets:
            self.guardian_packets[packet_id].update(updates)

    def list_class_guardian_consent_packets(self, class_id: str, student_uid: str | None = None, limit: int = 500):
        packets = [
            dict(p) for p in self.guardian_packets.values()
            if p.get("class_id") == class_id and (not student_uid or p.get("student_uid") == student_uid)
        ]
        packets.sort(key=lambda p: p.get("id", ""), reverse=True)
        return packets[:limit]

    def find_guardian_consent_packet_by_token_hash(self, token_hash: str):
        for p in self.guardian_packets.values():
            if p.get("token_hash") == token_hash:
                return dict(p)
        return None

    # -- Assignments / mappings --

    def get_assignment(self, assignment_id: str):
        a = self.assignments.get(assignment_id)
        return dict(a) if a else None

    def create_assignment(
        self,
        org_id,
        class_id,
        title='',
        description='',
        status='draft',
        release_at='',
        due_at='',
        modality_override=None,
        max_attempts=None,
        task_type='decision_making',
        success_criteria=None,
        created_by_uid='',
        assignment_id=None,
        canvas_module_item_id='',
        instructions='',
        canvas_module_item_ref=None,
        objectives=None,
        target_expressions=None,
        focus_grammar=None,
        generated_scenario='',
        teacher_notes='',
    ) -> str:
        aid = assignment_id or self._next_id("assign")
        self.assignments[aid] = {
            'id': aid,
            'org_id': org_id,
            'class_id': class_id,
            'title': title,
            'description': description or '',
            'status': status,
            'release_at': release_at or '',
            'due_at': due_at or '',
            'modality_override': modality_override or {},
            'max_attempts': max_attempts,
            'task_type': task_type,
            'success_criteria': list(success_criteria or []),
            'created_by_uid': created_by_uid,
            'canvas_module_item_id': canvas_module_item_id or '',
            'instructions': instructions or '',
            'canvas_module_item_ref': canvas_module_item_ref,
            'objectives': list(objectives or []),
            'target_expressions': list(target_expressions or []),
            'focus_grammar': list(focus_grammar or []),
            'generated_scenario': generated_scenario or '',
            'teacher_notes': teacher_notes or '',
            'created_at': datetime.now(UTC),
            'updated_at': datetime.now(UTC),
        }
        return aid

    def list_class_assignments(self, class_id: str):
        return [dict(a) for a in self.assignments.values() if a.get("class_id") == class_id]

    def list_student_assignments(self, uid: str, statuses: list | None = None):
        results = []
        enrolled_class_ids = {e.get("class_id") for e in self.enrollments.values() if e.get("student_uid") == uid and e.get("status") == "active"}
        for a in self.assignments.values():
            if a.get("class_id") not in enrolled_class_ids:
                continue
            if statuses and a.get("status") not in statuses:
                continue
            results.append(dict(a))
        return results

    # -- Canvas course content --

    def get_canvas_course_content(self, content_id: str):
        doc = self.canvas_course_content.get(content_id)
        return dict(doc) if doc else None

    def link_assignment_to_canvas_item(self, assignment_id: str, content_id: str, canvas_module_item_id: str):
        asg = self.assignments.get(assignment_id)
        if asg is not None:
            asg['canvas_module_item_id'] = canvas_module_item_id

    # -- Practice sessions --

    def create_practice_session(self, payload: dict) -> str:
        sid = self._next_id("session")
        self.practice_sessions[sid] = {"id": sid, **payload}
        return sid

    def get_practice_session(self, session_id: str):
        s = self.practice_sessions.get(session_id)
        return dict(s) if s else None

    def update_practice_session(self, session_id: str, updates: dict):
        if session_id in self.practice_sessions:
            self.practice_sessions[session_id].update(updates)

    def list_assignment_practice_sessions(self, assignment_id: str):
        return [dict(s) for s in self.practice_sessions.values() if s.get("assignment_id") == assignment_id]

    def list_class_practice_sessions(self, class_id: str):
        return [dict(s) for s in self.practice_sessions.values() if s.get("class_id") == class_id]

    # -- Learning events --

    def create_learning_event(self, payload: dict) -> str:
        eid = self._next_id("event")
        self.learning_events.append({"id": eid, **payload})
        return eid

    def list_assignment_learning_events(self, assignment_id: str):
        return [dict(e) for e in self.learning_events if e.get("assignment_id") == assignment_id]

    # -- Org-scoped queries --

    def list_org_classes(self, org_id: str, status: str = "active"):
        return [dict(c) for c in self.classes.values() if c.get("org_id") == org_id and (not status or c.get("status") == status)]

    def list_teacher_classes(self, membership_id: str, status: str = "active"):
        return [
            dict(c) for c in self.classes.values()
            if membership_id in c.get("teacher_membership_ids", []) and (not status or c.get("status") == status)
        ]

    # -- Seed helpers --

    def seed_org_teacher_class(
        self,
        *,
        org_name: str = "Test School",
        teacher_uid: str = "teacher-1",
        class_name: str = "French 101",
    ) -> tuple[str, str, str]:
        """Create an org, teacher membership, and class. Returns (org_id, membership_id, class_id)."""
        org = make_organization(name=org_name)
        self.organizations[org["id"]] = org
        mem = make_membership(org_id=org["id"], uid=teacher_uid, roles=["teacher"])
        self.memberships[mem["id"]] = mem
        cls = make_class(org_id=org["id"], name=class_name, teacher_membership_ids=[mem["id"]])
        self.classes[cls["id"]] = cls
        mem["primaryClassIds"].append(cls["id"])
        self.users[teacher_uid] = make_user(uid=teacher_uid, name="Teacher User", age=35)
        return org["id"], mem["id"], cls["id"]

    def seed_student(
        self,
        *,
        uid: str = "stu-1",
        class_id: str = "class-1",
        org_id: str = "org-1",
        age: int = 16,
        name: str = "Student One",
    ) -> str:
        """Create a student user and enroll them. Returns enrollment_id."""
        self.users[uid] = make_user(uid=uid, name=name, age=age)
        mem = make_membership(org_id=org_id, uid=uid, roles=["student"])
        self.memberships[mem["id"]] = mem
        enr = make_enrollment(class_id=class_id, student_uid=uid, student_membership_id=mem["id"])
        self.enrollments[enr["id"]] = enr
        return enr["id"]


# ---------------------------------------------------------------------------
# make_test_deps — builds a RouteDeps wired to a FakeDb
# ---------------------------------------------------------------------------
def make_test_deps(
    db: FakeDbBase | None = None,
    package: dict | None = None,
) -> RouteDeps:
    """Build a RouteDeps suitable for Flask test blueprints."""
    if db is None:
        db = FakeDbBase()
    if package is None:
        package = SAMPLE_CURRICULUM_PACKAGE

    def get_school_request_context():
        uid = (session.get("user") or {}).get("uid")
        preferred = (session.get("user") or {}).get("active_membership_id")
        ctx = resolve_school_request_context(db, uid, preferred_active_membership_id=preferred)
        if "user" in session:
            session["user"]["active_membership_id"] = ctx.active_membership_id
        db.set_user_last_active_membership(uid, ctx.active_membership_id)
        return ctx

    def set_active_school_membership(membership_id):
        uid = (session.get("user") or {}).get("uid")
        ctx = resolve_school_request_context(db, uid, preferred_active_membership_id=membership_id)
        if ctx.active_membership_id != membership_id:
            raise LookupError("Membership not found for the current user.")
        session["user"]["active_membership_id"] = ctx.active_membership_id
        db.set_user_last_active_membership(uid, membership_id)
        return ctx

    return RouteDeps(
        db=db,
        firebase_auth=None,
        get_current_user_uid=lambda: (session.get("user") or {}).get("uid"),
        get_openai_client=lambda: None,
        get_assessment=lambda: {},
        compute_results=lambda *a, **kw: {},
        get_proficiency_description=lambda *a, **kw: {"level": "Novice Mid", "description": "Test"},
        login_required=passthrough_login_required,
        get_user_proficiency_context=lambda: "",
        build_system_prompt=lambda _ctx: "",
        load_sample_curriculum_package=lambda: package,
        get_curriculum_practice_context=lambda module_id, situation_id: get_sample_curriculum_practice_context(module_id, situation_id),
        build_curriculum_system_prompt=lambda **kw: "SYSTEM PROMPT PLACEHOLDER",
        get_school_request_context=get_school_request_context,
        set_active_school_membership=set_active_school_membership,
        allowed_learning_locales={"ko-KR", "es-ES", "fr-FR"},
        allowed_minigame_types={"listening_quiz", "grammar_challenge"},
        supported_ui_languages={"en", "ko"},
    )


def make_test_app(*blueprints) -> Flask:
    """Create a Flask test app with the given blueprints registered."""
    app = Flask(__name__)
    app.secret_key = "test-secret"
    for bp in blueprints:
        app.register_blueprint(bp)
    return app
