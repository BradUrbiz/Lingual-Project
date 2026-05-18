"""
Database module for Lingual app using Firestore.

Schema:
- users/{uid}
    - email: str
    - name: str
    - last_active_membership_id: str | null
    - created_at: timestamp
    - updated_at: timestamp
    - profile:
        - display_name: str (user's preferred name)
        - age: int
        - gender: str ('male', 'female', 'other', 'prefer_not_to_say')
        - rigor: str ('light', 'casual', 'moderate', 'serious', 'intense')
        - frequency: int (how many times)
        - frequency_unit: str ('day', 'week', 'month')
        - level_objective: str (user's goal description)
        - assessment_preference: str ('take' | 'skip' | None)
        - ui_language: str ('en' or 'ko')
        - learning_locale: str ('ko-KR', 'es-ES', 'fr-FR', 'ru-RU', 'he-IL')
        - avatar_url: str (profile image URL or data URI)
        - contact_email: str (editable email address for profile)
        - grade_level: str (e.g. "10th Grade")
        - native_language: str (e.g. "English (US)")
        - location: str (city/state or region)
        - school_name: str
    - assessment:
        - responses: dict (item_id -> response)
        - current_item_index: int
        - completed: bool
        - completed_at: timestamp (optional)
    - results:
        - framework: str (e.g., "ACTFL")
        - global_stage: int (normalized proficiency index, typically 0-10)
        - domain_bands: dict (domain -> band)
        - domain_raw_scores: dict (domain -> score)
        - proficiency_level: str (e.g., "Intermediate Mid")
        - proficiency_description_en: str
        - item_scores: dict (item_id -> score)
    - selected_categories: list[str]
    - chat_history: list[dict] (role, content) [DEPRECATED - kept for migration]

- users/{uid}/chats/{chat_id}
    - title: str (auto-generated from first message or default)
    - created_at: timestamp
    - updated_at: timestamp
    - messages: list[dict]
        - role: str ('user' or 'assistant')
        - content: str
        - timestamp: str (ISO format)
        - sort_order: int (optional, stable client-side ordering)

- users/{uid}/minigame_attempts/{attempt_id}
    - game_type: str ('listening_quiz' | 'grammar_challenge')
    - locale: str
    - objective_id: str (optional)
    - scenario_id: str (optional)
    - score: int
    - correct_answers: int
    - total_questions: int
    - accuracy: float
    - duration_seconds: int (optional)
    - metadata: dict (optional)
    - created_at: timestamp

- organizations/{org_id}
    - name: str
    - type: str ('school' | 'district' | 'program')
    - status: str ('active' | 'inactive')
    - pilot_stage: str
    - default_modality_policy: str
    - default_retention_policy: str
    - lms_capabilities: list[str]
    - created_at: timestamp
    - updated_at: timestamp

- memberships/{membership_id}
    - org_id: str
    - uid: str
    - roles: list[str] ('school_admin' | 'teacher' | 'student')
    - status: str ('active' | 'invited' | 'inactive')
    - primary_class_ids: list[str]
    - created_at: timestamp
    - updated_at: timestamp

- classes/{class_id}
    - org_id: str
    - name: str
    - term: str
    - subject: str
    - learning_locale: str
    - teacher_membership_ids: list[str]
    - grade_band: str
    - status: str
    - created_at: timestamp
    - updated_at: timestamp

- enrollments/{enrollment_id}
    - class_id: str
    - student_uid: str
    - student_membership_id: str (optional)
    - status: str ('active' | 'inactive' | 'pending_sync')
    - join_source: str ('manual' | 'join_code' | 'canvas_legacy' | 'lti')
      (note: 'canvas' was historically used by Canvas PAT sync and may still
      appear in older rows. Current Canvas PAT sync no longer writes
      enrollments — see canvas_roster_entries/. 'canvas_legacy' marks
      rows grandfathered by the 2026-04-21 migration.)
    - student_number: str (optional)
    - guardian_contact_required: bool
    - canvas_user_id: str (optional, Canvas integration)
    - canvas_email: str (optional, Canvas integration)
    - created_at: timestamp
    - updated_at: timestamp

- assignments/{assignment_id}
    - org_id: str
    - class_id: str
    - title: str
    - description: str
    - status: str ('draft' | 'published' | 'archived')
    - release_at: str (ISO datetime, optional)
    - due_at: str (ISO datetime, optional)
    - modality_override: dict
    - max_attempts: int | None
    - task_type: str
    - success_criteria: list[str]
    - created_by_uid: str
    - created_at: timestamp
    - updated_at: timestamp

- student_compliance_records/{org_id}_{student_uid}
    - org_id: str
    - student_uid: str
    - is_minor: bool
    - guardian_consent_status: str
    - voice_consent_status: str
    - text_allowed: bool
    - voice_allowed: bool
    - retention_policy_id: str
    - school_agreement_version: str
    - last_verified_at: timestamp | None
    - created_at: timestamp
    - updated_at: timestamp

- consent_events/{event_id}
    - org_id: str
    - student_uid: str
    - event_type: str
    - actor_type: str
    - actor_id: str
    - evidence_ref: str
    - payload: dict
    - created_at: timestamp

- guardian_consent_packets/{packet_id}
    - org_id: str
    - class_id: str
    - student_uid: str
    - notice_version: str
    - consent_scope: str
    - contact_channel: str
    - contact_destination_hint: str
    - delivery_method: str
    - status: str
    - token_hash: str
    - token_last_four: str
    - response_method: str
    - evidence_ref: str
    - reminder_count: int
    - expires_at: timestamp | None
    - issued_at: timestamp | None
    - last_sent_at: timestamp | None
    - acted_at: timestamp | None
    - created_by_uid: str
    - created_at: timestamp
    - updated_at: timestamp

- practice_sessions/{session_id}
    - org_id: str
    - class_id: str
    - assignment_id: str
    - student_uid: str
    - mapping_snapshot: dict
    - assignment_snapshot: dict
    - curriculum_snapshot: dict
    - pedagogy_snapshot: dict
    - modality: str
    - voice_enabled: bool
    - text_enabled: bool
    - status: str ('active' | 'completed' | 'abandoned')
    - started_at: timestamp
    - ended_at: timestamp | None
    - prompt_version: str
    - system_prompt_preview: str
    - class_snapshot: dict
    - transcript_ref: dict
    - cost_summary: dict
    - session_summary: dict
    - analysis_state: dict
    - teacher_preview: bool
    - ui_language: str
    - created_at: timestamp
    - updated_at: timestamp

- learning_events/{event_id}
    - org_id: str
    - class_id: str
    - assignment_id: str
    - session_id: str
    - student_uid: str
    - event_type: str
    - turn_index: int | None
    - payload: dict (includes curriculum/pedagogy metadata for analytics alignment)
    - created_at: timestamp

- deletion_requests/{request_id}
    - org_id: str
    - scope_type: str ('student' | 'class' | 'org')
    - scope_id: str
    - requested_by_uid: str
    - request_reason: str
    - status: str ('requested' | 'approved' | 'rejected' | 'in_progress' | 'completed' | 'failed' | 'partially_completed')
    - approved_by_uid: str
    - review_notes: str
    - target_collections: list[str]
    - target_storage_prefixes: list[str]
    - execution_summary: dict
    - created_at: timestamp
    - updated_at: timestamp
    - completed_at: timestamp | None

- deletion_execution_runs/{run_id}
    - request_id: str
    - org_id: str
    - scope_type: str
    - scope_id: str
    - status: str ('running' | 'completed' | 'failed' | 'partially_completed')
    - attempt_number: int
    - firestore_counts: dict (targeted, deleted, failed, by_collection)
    - storage_counts: dict (targeted, deleted, failed)
    - error_summary: list[str]
    - started_at: timestamp
    - finished_at: timestamp | None
"""

import secrets
from datetime import UTC, datetime

from firebase_admin import firestore

SCHOOL_ROLE_PRIORITY = {
    'school_admin': 0,
    'teacher': 1,
    'student': 2,
}
ACTIVE_MEMBERSHIP_STATUSES = {'active', 'invited'}

INTENDED_ROLE_STUDENT = 'student'
INTENDED_ROLE_TEACHER = 'teacher'
INTENDED_ROLE_ADMIN = 'admin'
ALLOWED_INTENDED_ROLES = frozenset({
    INTENDED_ROLE_STUDENT,
    INTENDED_ROLE_TEACHER,
    INTENDED_ROLE_ADMIN,
})

ONBOARDING_STATE_ROLE_SELECTED = 'role_selected'
ONBOARDING_STATE_STUDENT_SETUP = 'student_setup'
ONBOARDING_STATE_TEACHER_PENDING = 'teacher_pending'
ONBOARDING_STATE_ORG_CREATION_PENDING = 'org_creation_pending'
ONBOARDING_STATE_AWAITING_LINGUAL = 'awaiting_lingual'
ONBOARDING_STATE_COMPLETE = 'complete'
ALLOWED_ONBOARDING_STATES = frozenset({
    ONBOARDING_STATE_ROLE_SELECTED,
    ONBOARDING_STATE_STUDENT_SETUP,
    ONBOARDING_STATE_TEACHER_PENDING,
    ONBOARDING_STATE_ORG_CREATION_PENDING,
    ONBOARDING_STATE_AWAITING_LINGUAL,
    ONBOARDING_STATE_COMPLETE,
})


def _utc_now():
    return datetime.now(UTC)


def get_db():
    """Get Firestore client."""
    return firestore.client()


def get_user_ref(uid):
    """Get reference to user document."""
    db = get_db()
    return db.collection('users').document(uid)


def get_organizations_collection():
    """Get organizations collection."""
    return get_db().collection('organizations')


def get_memberships_collection():
    """Get memberships collection."""
    return get_db().collection('memberships')


def get_classes_collection():
    """Get classes collection."""
    return get_db().collection('classes')


def get_enrollments_collection():
    """Get enrollments collection."""
    return get_db().collection('enrollments')


def get_assignments_collection():
    """Get assignments collection."""
    return get_db().collection('assignments')


def get_student_compliance_records_collection():
    """Get student compliance records collection."""
    return get_db().collection('student_compliance_records')


def get_consent_events_collection():
    """Get consent events collection."""
    return get_db().collection('consent_events')


def get_guardian_consent_packets_collection():
    """Get guardian consent packets collection."""
    return get_db().collection('guardian_consent_packets')


def get_deletion_requests_collection():
    """Get deletion requests collection."""
    return get_db().collection('deletion_requests')


def get_deletion_execution_runs_collection():
    """Get deletion execution runs collection."""
    return get_db().collection('deletion_execution_runs')


def get_canvas_connections_collection():
    """Get canvas connections collection."""
    return get_db().collection('canvas_connections')


def get_canvas_course_content_collection():
    """Get canvas course content collection."""
    return get_db().collection('canvas_course_content')


def get_school_requests_collection():
    """Get school requests collection."""
    return get_db().collection('school_requests')


def get_school_request_ref(request_id):
    """Get school request document reference."""
    return get_school_requests_collection().document(request_id)


def get_practice_sessions_collection():
    """Get practice sessions collection."""
    return get_db().collection('practice_sessions')


def get_learning_events_collection():
    """Get learning events collection."""
    return get_db().collection('learning_events')


def get_organization_ref(org_id):
    """Get organization document reference."""
    return get_organizations_collection().document(org_id)


def get_membership_ref(membership_id):
    """Get membership document reference."""
    return get_memberships_collection().document(membership_id)


def get_class_ref(class_id):
    """Get class document reference."""
    return get_classes_collection().document(class_id)


def get_enrollment_ref(enrollment_id):
    """Get enrollment document reference."""
    return get_enrollments_collection().document(enrollment_id)


def get_assignment_ref(assignment_id):
    """Get assignment document reference."""
    return get_assignments_collection().document(assignment_id)


def get_student_compliance_record_ref(org_id, student_uid):
    """Get student compliance record reference."""
    return get_student_compliance_records_collection().document(f'{org_id}_{student_uid}')


def get_consent_event_ref(event_id):
    """Get consent event reference."""
    return get_consent_events_collection().document(event_id)


def get_guardian_consent_packet_ref(packet_id):
    """Get guardian consent packet reference."""
    return get_guardian_consent_packets_collection().document(packet_id)


def get_deletion_request_ref(request_id):
    """Get deletion request document reference."""
    return get_deletion_requests_collection().document(request_id)


def get_deletion_execution_run_ref(run_id):
    """Get deletion execution run document reference."""
    return get_deletion_execution_runs_collection().document(run_id)


def get_canvas_connection_ref(connection_id):
    """Get canvas connection document reference."""
    return get_canvas_connections_collection().document(connection_id)


def get_canvas_course_content_ref(content_id):
    """Get canvas course content document reference."""
    return get_canvas_course_content_collection().document(content_id)


def get_practice_session_ref(session_id):
    """Get practice session document reference."""
    return get_practice_sessions_collection().document(session_id)


def get_learning_event_ref(event_id):
    """Get learning event document reference."""
    return get_learning_events_collection().document(event_id)


def create_user(uid, email, name):
    """Create a new user document."""
    user_ref = get_user_ref(uid)
    user_data = {
        'email': email,
        'name': name,
        'last_active_membership_id': None,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
        'profile': {
            'display_name': '',
            'age': None,
            'gender': None,
            'rigor': None,
            'frequency': None,
            'frequency_unit': None,
            'level_objective': '',
            'assessment_preference': None,
            'ui_language': 'en',
            'learning_locale': 'ko-KR',
            'avatar_url': '',
            'contact_email': '',
            'grade_level': '',
            'native_language': '',
            'location': '',
            'school_name': ''
        },
        'assessment': {
            'responses': {},
            'current_item_index': 0,
            'completed': False
        },
        'results': None,
        'selected_categories': [],
        'chat_history': []
    }
    user_ref.set(user_data)
    return user_data


def get_user(uid):
    """Get user document, create if doesn't exist."""
    user_ref = get_user_ref(uid)
    doc = user_ref.get()

    if doc.exists:
        return doc.to_dict()
    return None


def get_or_create_user(uid, email, name):
    """Get existing user or create new one."""
    user = get_user(uid)
    if user is None:
        user = create_user(uid, email, name)
    return user


def get_user_field(uid, field):
    """Get a single field from a user document."""
    user = get_user(uid)
    if user:
        return user.get(field)
    return None


def get_user_by_email(email):
    """Look up a user by email address. Returns the first match or None."""
    docs = get_db().collection('users').where('email', '==', email).limit(1).stream()
    for doc in docs:
        data = doc.to_dict() or {}
        data['uid'] = doc.id
        return data
    return None


def get_user_by_lti_identity(issuer, canvas_user_id, client_id=''):
    """Look up a user by a deterministic LTI identity key."""
    key = f'{issuer}|{client_id or ""}|{canvas_user_id}'
    docs = (
        get_db()
        .collection('users')
        .where('lti_identity_keys', 'array_contains', key)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['uid'] = doc.id
        return data
    return None


def is_legacy_user_needing_role_pick(user_doc, memberships):
    """Return True iff this user predates role-aware signup and has no usable role.

    Decision rule: profile lacks both `intended_role` and `onboarding_state`,
    AND the user has no `status='active'` memberships.
    """
    profile = (user_doc or {}).get('profile') or {}
    if profile.get('intended_role'):
        return False
    if profile.get('onboarding_state'):
        return False
    for membership in memberships or []:
        if (membership or {}).get('status') == 'active':
            return False
    return True


def update_user(uid, updates):
    """Update top-level user fields."""
    payload = dict(updates or {})
    payload['updated_at'] = firestore.SERVER_TIMESTAMP
    get_user_ref(uid).set(payload, merge=True)
    return uid


def update_user_profile(uid, display_name=None, age=None, gender=None,
                        rigor=None, frequency=None, frequency_unit=None,
                        level_objective=None, assessment_preference=None,
                        ui_language=None, learning_locale=None,
                        avatar_url=None, contact_email=None, grade_level=None,
                        native_language=None, location=None, school_name=None,
                        intended_role=None, onboarding_state=None):
    """Update user profile fields."""
    # Validate enum fields before touching Firestore.
    if intended_role is not None and intended_role not in ALLOWED_INTENDED_ROLES:
        raise ValueError(f"Invalid intended_role: {intended_role!r}")
    if onboarding_state is not None and onboarding_state not in ALLOWED_ONBOARDING_STATES:
        raise ValueError(f"Invalid onboarding_state: {onboarding_state!r}")

    user_ref = get_user_ref(uid)
    updates = {'updated_at': firestore.SERVER_TIMESTAMP}

    if display_name is not None:
        updates['profile.display_name'] = display_name
    if age is not None:
        updates['profile.age'] = age
    if gender is not None:
        updates['profile.gender'] = gender
    if rigor is not None:
        updates['profile.rigor'] = rigor
    if frequency is not None:
        updates['profile.frequency'] = frequency
    if frequency_unit is not None:
        updates['profile.frequency_unit'] = frequency_unit
    if level_objective is not None:
        updates['profile.level_objective'] = level_objective
    if assessment_preference is not None:
        updates['profile.assessment_preference'] = assessment_preference
    if ui_language is not None:
        updates['profile.ui_language'] = ui_language
    if learning_locale is not None:
        updates['profile.learning_locale'] = learning_locale
    if avatar_url is not None:
        updates['profile.avatar_url'] = avatar_url
    if contact_email is not None:
        updates['profile.contact_email'] = contact_email
    if grade_level is not None:
        updates['profile.grade_level'] = grade_level
    if native_language is not None:
        updates['profile.native_language'] = native_language
    if location is not None:
        updates['profile.location'] = location
    if school_name is not None:
        updates['profile.school_name'] = school_name
    if intended_role is not None:
        updates['profile.intended_role'] = intended_role
    if onboarding_state is not None:
        updates['profile.onboarding_state'] = onboarding_state

    user_ref.update(updates)


def update_assessment_response(uid, item_id, response, current_index):
    """Update a single assessment response."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        f'assessment.responses.{item_id}': response,
        'assessment.current_item_index': current_index,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def get_assessment_state(uid):
    """Get current assessment state for user."""
    user = get_user(uid)
    if user:
        return user.get('assessment', {
            'responses': {},
            'current_item_index': 0,
            'completed': False
        })
    return None


def reset_assessment(uid):
    """Reset user's assessment progress."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        'assessment': {
            'responses': {},
            'current_item_index': 0,
            'completed': False
        },
        'results': None,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def save_assessment_results(uid, results):
    """Save assessment results after completion."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        'assessment.completed': True,
        'assessment.completed_at': firestore.SERVER_TIMESTAMP,
        'results': results,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def get_assessment_results(uid):
    """Get user's assessment results."""
    user = get_user(uid)
    if user:
        return user.get('results')
    return None


def update_selected_categories(uid, categories):
    """Update user's selected practice categories."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        'selected_categories': categories,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def set_user_last_active_membership(uid, membership_id):
    """Persist the user's active membership for direct client access rules."""
    user_ref = get_user_ref(uid)
    user_ref.set({
        'last_active_membership_id': membership_id,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }, merge=True)


def get_user_profile_context(uid):
    """Get user profile data for AI context."""
    user = get_user(uid)
    if user:
        profile = user.get('profile', {})
        return {
            'display_name': profile.get('display_name', ''),
            'age': profile.get('age'),
            'gender': profile.get('gender'),
            'rigor': profile.get('rigor'),
            'frequency': profile.get('frequency'),
            'frequency_unit': profile.get('frequency_unit'),
            'level_objective': profile.get('level_objective', ''),
            'assessment_preference': profile.get('assessment_preference'),
            'learning_locale': profile.get('learning_locale', 'ko-KR'),
            'results': user.get('results'),
            'selected_categories': user.get('selected_categories', [])
        }
    return None


def _normalize_string_list(values):
    if not isinstance(values, list):
        return []
    normalized = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def _membership_sort_key(membership):
    roles = membership.get('roles', [])
    role_priority = min((SCHOOL_ROLE_PRIORITY.get(role, 99) for role in roles), default=99)
    org_name = (membership.get('orgName') or '').lower()
    membership_id = membership.get('id') or ''
    return role_priority, org_name, membership_id


# ============================================
# SCHOOL INTEGRATION FUNCTIONS
# ============================================


def create_organization(
    name,
    org_type='school',
    status='active',
    pilot_stage='internal',
    default_modality_policy='hybrid',
    default_retention_policy='standard_school',
    lms_capabilities=None,
    org_id=None,
):
    """Create an organization document."""
    doc_ref = get_organization_ref(org_id) if org_id else get_organizations_collection().document()
    org_data = {
        'name': name,
        'name_lower': (name or '').strip().lower(),  # search prefix index
        'type': org_type,
        'status': status,
        'pilot_stage': pilot_stage,
        'default_modality_policy': default_modality_policy,
        'default_retention_policy': default_retention_policy,
        'lms_capabilities': _normalize_string_list(lms_capabilities or []),
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(org_data)
    return doc_ref.id


def get_organization(org_id):
    """Get an organization by id."""
    doc = get_organization_ref(org_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    data['id'] = doc.id
    return data


def search_organizations(query: str, *, limit: int = 10):
    """Public-ish org search. Returns metadata only — no PII, no counts.

    Matches against `name_lower` prefix; orgs must be `status='active'`.
    """
    q = (query or '').strip().lower()
    if not q:
        return []
    # Firestore prefix-range idiom: U+F8FF ('') is one of the highest
    # Unicode private-use code points; [q, q + ''] covers every doc whose
    # name_lower starts with q.
    end = q + ''
    docs = (
        get_db()
        .collection('organizations')
        .where('name_lower', '>=', q)
        .where('name_lower', '<=', end)
        .limit(limit)
    ).stream()
    results = []
    for doc in docs:
        data = doc.to_dict() or {}
        if data.get('status') != 'active':
            continue
        results.append({
            'id': doc.id,
            'name': data.get('name', ''),
            'city': data.get('city'),
            'state': data.get('state'),
            'school_type': data.get('school_type'),
        })
    return results


def list_school_admin_emails(org_id: str):
    """Return [{uid, email, name}] for every active school_admin of the org."""
    membership_docs = (
        get_db()
        .collection('memberships')
        .where('org_id', '==', org_id)
        .where('status', '==', 'active')
        .where('roles', 'array_contains', 'school_admin')
    ).stream()
    recipients = []
    seen = set()
    for m in membership_docs:
        data = m.to_dict() or {}
        uid = data.get('uid')
        if not uid or uid in seen:
            continue
        seen.add(uid)
        user_doc = get_db().collection('users').document(uid).get()
        if not user_doc.exists:
            continue
        user = user_doc.to_dict() or {}
        email = user.get('email')
        if not email:
            continue
        display_name = (user.get('profile') or {}).get('display_name') or user.get('name')
        recipients.append({'uid': uid, 'email': email, 'name': display_name})
    return recipients


def _sync_org_admin_uids(org_id: str, uid: str, *, add: bool) -> None:
    """Maintain organizations/{id}.school_admin_uids in sync with membership grants.

    Called whenever a membership touching the school_admin role is created or
    removed. Idempotent; ArrayUnion / ArrayRemove are commutative.

    TODO: any future path that revokes a school_admin role (membership
    deletion, role-change endpoint, org suspension cascading to memberships)
    MUST call _sync_org_admin_uids(org_id, uid, add=False). Audit when
    implementing Plan 5 (Lingual admin org panel — suspend/restore).
    """
    if not org_id or not uid:
        return
    op = firestore.ArrayUnion([uid]) if add else firestore.ArrayRemove([uid])
    get_organizations_collection().document(org_id).update({'school_admin_uids': op})


def create_membership(
    org_id,
    uid,
    roles,
    status='active',
    primary_class_ids=None,
    membership_id=None,
):
    """Create a membership document."""
    doc_ref = get_membership_ref(membership_id) if membership_id else get_memberships_collection().document()
    normalized_roles = _normalize_string_list(roles)
    membership_data = {
        'org_id': org_id,
        'uid': uid,
        'roles': normalized_roles,
        'status': status,
        'primary_class_ids': _normalize_string_list(primary_class_ids or []),
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(membership_data)
    if 'school_admin' in normalized_roles and status == 'active':
        _sync_org_admin_uids(org_id, uid, add=True)
    return doc_ref.id


def get_membership(membership_id):
    """Get a membership by id."""
    doc = get_membership_ref(membership_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    data['id'] = doc.id
    return data


def get_user_memberships(uid):
    """Get active or invited memberships for a user, enriched with organization info."""
    docs = (
        get_memberships_collection()
        .where('uid', '==', uid)
        .where('status', 'in', sorted(ACTIVE_MEMBERSHIP_STATUSES))
        .stream()
    )
    memberships = []

    for doc in docs:
        data = doc.to_dict() or {}
        status = data.get('status', 'active')
        org_id = data.get('org_id')
        org = get_organization(org_id) if isinstance(org_id, str) and org_id else None
        memberships.append({
            'id': doc.id,
            'orgId': org_id,
            'orgName': (org or {}).get('name', ''),
            'orgType': (org or {}).get('type'),
            'roles': _normalize_string_list(data.get('roles', [])),
            'status': status,
            'primaryClassIds': _normalize_string_list(data.get('primary_class_ids', [])),
        })

    memberships.sort(key=_membership_sort_key)
    return memberships


def resolve_user_school_context(uid, preferred_active_membership_id=None):
    """Resolve membership context for auth and route protection."""
    memberships = get_user_memberships(uid)
    active_membership = None

    if preferred_active_membership_id:
        active_membership = next(
            (membership for membership in memberships if membership.get('id') == preferred_active_membership_id),
            None,
        )

    if active_membership is None and memberships:
        active_membership = memberships[0]

    active_roles = active_membership.get('roles', []) if active_membership else []

    result = {
        'memberships': memberships,
        'active_membership': active_membership,
        'active_membership_id': active_membership.get('id') if active_membership else None,
        'active_organization_id': active_membership.get('orgId') if active_membership else None,
        'active_roles': active_roles,
    }

    # Surface onboarding/role fields for role-aware routing on the frontend.
    user_doc = get_user(uid) or {}
    profile = user_doc.get('profile') or {}
    result['intended_role'] = profile.get('intended_role')
    result['onboarding_state'] = profile.get('onboarding_state')
    result['requires_legacy_role_pick'] = is_legacy_user_needing_role_pick(
        user_doc, result.get('memberships') or []
    )

    # Surface Lingual-admin authority for the auth payload + frontend routing.
    # Mirrors the union used in `list_lingual_admin_emails`: legacy flag OR
    # any active membership whose roles include 'lingual_admin'.
    legacy_flag = bool(user_doc.get('lingual_admin'))
    has_active_lingual_admin_role = any(
        (m or {}).get('status') == 'active'
        and 'lingual_admin' in ((m or {}).get('roles') or [])
        for m in (result.get('memberships') or [])
    )
    result['lingual_admin'] = legacy_flag or has_active_lingual_admin_role

    return result


def list_lingual_admin_emails():
    """Return [{uid, email, name}] for every user with Lingual-admin authority.

    Two sources are unioned:
    1. Active memberships with role 'lingual_admin' (preferred, new model).
    2. Legacy individual flag ``users/{uid}.lingual_admin == True`` (predates memberships).

    Until the legacy flag is fully migrated, either source can grant authority;
    this helper returns recipients for both paths so notification emails reach
    everyone who could actually approve a school request.

    Order is deterministic by uid (alphabetical) so tests are stable.
    """
    recipients_by_uid = {}

    # Source 1: active lingual_admin memberships
    membership_docs = (
        get_memberships_collection()
        .where('roles', 'array_contains', 'lingual_admin')
        .stream()
    )
    for doc in membership_docs:
        data = doc.to_dict() or {}
        if data.get('status') != 'active':
            continue
        uid = data.get('uid')
        if not uid or uid in recipients_by_uid:
            continue
        user = get_user(uid) or {}
        email = user.get('email')
        if not email:
            continue
        display_name = (user.get('profile') or {}).get('display_name') or user.get('name')
        recipients_by_uid[uid] = {'uid': uid, 'email': email, 'name': display_name}

    # Source 2: legacy users.{uid}.lingual_admin == True
    # This flag predates the memberships model; unioning ensures admins granted
    # authority via either path receive notification emails.
    for user_doc in get_db().collection('users').where('lingual_admin', '==', True).stream():
        uid = user_doc.id
        if uid in recipients_by_uid:
            continue
        data = user_doc.to_dict() or {}
        email = data.get('email')
        if not email:
            continue
        display_name = (data.get('profile') or {}).get('display_name') or data.get('name')
        recipients_by_uid[uid] = {'uid': uid, 'email': email, 'name': display_name}

    return sorted(recipients_by_uid.values(), key=lambda r: r['uid'])


def create_class(
    org_id,
    name,
    learning_locale='ko-KR',
    term='',
    subject='',
    teacher_membership_ids=None,
    grade_band='',
    status='active',
    class_id=None,
    canvas_course_id='',
):
    """Create a class document."""
    doc_ref = get_class_ref(class_id) if class_id else get_classes_collection().document()
    class_data = {
        'org_id': org_id,
        'name': name,
        'term': term,
        'subject': subject,
        'learning_locale': learning_locale,
        'teacher_membership_ids': _normalize_string_list(teacher_membership_ids or []),
        'grade_band': grade_band,
        'status': status,
        'canvas_course_id': canvas_course_id or '',
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(class_data)
    return doc_ref.id


def add_primary_class_to_membership(membership_id, class_id):
    """Attach a class to a membership's primary class list."""
    membership_ref = get_membership_ref(membership_id)
    membership_ref.update({
        'primary_class_ids': firestore.ArrayUnion([class_id]),
        'updated_at': firestore.SERVER_TIMESTAMP,
    })


def remove_primary_class_from_membership(membership_id, class_id):
    """Detach a class from a membership's primary class list."""
    membership_ref = get_membership_ref(membership_id)
    membership_ref.update({
        'primary_class_ids': firestore.ArrayRemove([class_id]),
        'updated_at': firestore.SERVER_TIMESTAMP,
    })


def get_class(class_id):
    """Get a class by id."""
    doc = get_class_ref(class_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    data['id'] = doc.id
    return data


def list_teacher_classes(membership_id, status='active'):
    """List classes attached to a teacher membership."""
    query = get_classes_collection().where('teacher_membership_ids', 'array_contains', membership_id)
    if status:
        query = query.where('status', '==', status)
    docs = query.order_by('updated_at', direction=firestore.Query.DESCENDING).stream()
    classes = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        classes.append(data)
    return classes


def list_org_classes(org_id, status='active'):
    """List classes for an organization."""
    query = get_classes_collection().where('org_id', '==', org_id)
    if status:
        query = query.where('status', '==', status)
    docs = query.order_by('updated_at', direction=firestore.Query.DESCENDING).stream()

    classes = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        classes.append(data)
    return classes


def create_enrollment(
    class_id,
    student_uid,
    student_membership_id=None,
    status='active',
    join_source='manual',
    student_number='',
    guardian_contact_required=False,
    enrollment_id=None,
    canvas_user_id='',
    canvas_email='',
    canvas_name='',
):
    """Create an enrollment document."""
    deterministic_enrollment_id = enrollment_id or f'{class_id}_{student_uid}'
    doc_ref = get_enrollment_ref(deterministic_enrollment_id)
    enrollment_data = {
        'class_id': class_id,
        'student_uid': student_uid,
        'student_membership_id': student_membership_id,
        'status': status,
        'join_source': join_source,
        'student_number': student_number,
        'guardian_contact_required': bool(guardian_contact_required),
        'canvas_user_id': canvas_user_id or '',
        'canvas_email': canvas_email or '',
        'canvas_name': canvas_name or '',
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(enrollment_data)
    return doc_ref.id


def list_student_enrollments(student_uid, status='active'):
    """List enrollments for a student."""
    query = get_enrollments_collection().where('student_uid', '==', student_uid)
    if status:
        query = query.where('status', '==', status)
    docs = query.order_by('updated_at', direction=firestore.Query.DESCENDING).stream()
    enrollments = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        enrollments.append(data)
    return enrollments


def list_class_enrollments(class_id, status='active'):
    """List enrollments for a class."""
    query = get_enrollments_collection().where('class_id', '==', class_id)
    if status:
        query = query.where('status', '==', status)
    docs = query.order_by('updated_at', direction=firestore.Query.DESCENDING).stream()

    enrollments = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        enrollments.append(data)
    return enrollments


JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
JOIN_CODE_LENGTH = 6


def generate_class_join_code(class_id):
    """Generate or regenerate a 6-char join code for a class."""
    code = ''.join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))
    # Check for collision (extremely unlikely but safe)
    existing = get_class_by_join_code(code)
    if existing and existing['id'] != class_id:
        code = ''.join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))
    get_class_ref(class_id).update({
        'join_code': code,
        'join_code_active': True,
        'join_code_generated_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    return code


def deactivate_class_join_code(class_id):
    """Deactivate the join code for a class."""
    get_class_ref(class_id).update({
        'join_code_active': False,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })


def get_class_by_join_code(code):
    """Find an active class by its join code."""
    docs = (
        get_classes_collection()
        .where('join_code', '==', code)
        .where('join_code_active', '==', True)
        .where('status', '==', 'active')
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def deactivate_enrollment(class_id, student_uid):
    """Set an enrollment to inactive (soft-delete)."""
    enrollment_id = f'{class_id}_{student_uid}'
    get_enrollment_ref(enrollment_id).update({
        'status': 'inactive',
        'updated_at': firestore.SERVER_TIMESTAMP,
    })


def reactivate_enrollment(class_id, student_uid):
    """Reactivate a previously deactivated enrollment."""
    enrollment_id = f'{class_id}_{student_uid}'
    get_enrollment_ref(enrollment_id).update({
        'status': 'active',
        'updated_at': firestore.SERVER_TIMESTAMP,
    })


def get_student_compliance_record(org_id, student_uid):
    """Get a student's compliance record for an organization."""
    doc = get_student_compliance_record_ref(org_id, student_uid).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def upsert_student_compliance_record(org_id, student_uid, record):
    """Create or update a student compliance record."""
    doc_ref = get_student_compliance_record_ref(org_id, student_uid)
    existing = doc_ref.get()
    payload = dict(record or {})
    payload['org_id'] = org_id
    payload['student_uid'] = student_uid
    payload['updated_at'] = firestore.SERVER_TIMESTAMP
    if not existing.exists:
        payload.setdefault('created_at', firestore.SERVER_TIMESTAMP)
    doc_ref.set(payload, merge=True)
    return doc_ref.id


def create_consent_event(
    *,
    org_id,
    student_uid='',
    scope_type='student',
    scope_id='',
    event_type,
    actor_type,
    actor_id,
    payload=None,
    evidence_ref='',
    event_id=None,
):
    """Create an auditable consent event."""
    doc_ref = get_consent_event_ref(event_id) if event_id else get_consent_events_collection().document()
    event_data = {
        'org_id': org_id,
        'student_uid': student_uid,
        'scope_type': scope_type or ('student' if student_uid else 'org'),
        'scope_id': scope_id or student_uid or org_id,
        'event_type': event_type,
        'actor_type': actor_type,
        'actor_id': actor_id,
        'evidence_ref': evidence_ref,
        'payload': payload or {},
        'created_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(event_data)
    return doc_ref.id


def list_consent_events(org_id, limit=500):
    """List consent and sensitive-access audit events for an organization."""
    query = get_consent_events_collection().where('org_id', '==', org_id)
    docs = query.stream()

    events = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        events.append(data)
    events.sort(
        key=lambda item: getattr(item.get('created_at'), 'isoformat', lambda: '')(),
        reverse=True,
    )
    return events[:limit]


def create_guardian_consent_packet(
    *,
    org_id,
    class_id,
    student_uid,
    notice_version,
    consent_scope,
    contact_channel='',
    contact_destination_hint='',
    delivery_method='secure_link',
    status='draft',
    token_hash='',
    token_last_four='',
    response_method='',
    evidence_ref='',
    reminder_count=0,
    expires_at=None,
    issued_at=None,
    last_sent_at=None,
    acted_at=None,
    created_by_uid='',
    packet_id=None,
):
    """Create a guardian consent packet."""
    doc_ref = get_guardian_consent_packet_ref(packet_id) if packet_id else get_guardian_consent_packets_collection().document()
    packet_data = {
        'org_id': org_id,
        'class_id': class_id,
        'student_uid': student_uid,
        'notice_version': notice_version,
        'consent_scope': consent_scope,
        'contact_channel': contact_channel,
        'contact_destination_hint': contact_destination_hint,
        'delivery_method': delivery_method,
        'status': status,
        'token_hash': token_hash,
        'token_last_four': token_last_four,
        'response_method': response_method,
        'evidence_ref': evidence_ref,
        'reminder_count': int(reminder_count or 0),
        'expires_at': expires_at,
        'issued_at': issued_at,
        'last_sent_at': last_sent_at,
        'acted_at': acted_at,
        'created_by_uid': created_by_uid,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(packet_data)
    return doc_ref.id


def get_guardian_consent_packet(packet_id):
    """Get a guardian consent packet by id."""
    doc = get_guardian_consent_packet_ref(packet_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def update_guardian_consent_packet(packet_id, updates):
    """Update guardian consent packet fields."""
    doc_ref = get_guardian_consent_packet_ref(packet_id)
    payload = dict(updates or {})
    payload['updated_at'] = firestore.SERVER_TIMESTAMP
    doc_ref.set(payload, merge=True)
    return packet_id


def list_class_guardian_consent_packets(class_id, student_uid=None, limit=500):
    """List guardian consent packets for a class, optionally scoped to one student."""
    query = get_guardian_consent_packets_collection().where('class_id', '==', class_id)
    docs = query.stream()

    packets = []
    for doc in docs:
        data = doc.to_dict() or {}
        if student_uid and data.get('student_uid') != student_uid:
            continue
        data['id'] = doc.id
        packets.append(data)
    packets.sort(
        key=lambda item: (
            getattr(item.get('updated_at'), 'isoformat', lambda: '')(),
            getattr(item.get('created_at'), 'isoformat', lambda: '')(),
        ),
        reverse=True,
    )
    return packets[:limit]


def list_org_student_compliance_records(org_id, limit=1000):
    """List all student compliance records for an organization."""
    query = get_student_compliance_records_collection().where('org_id', '==', org_id)
    docs = query.stream()

    records = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        records.append(data)
    return records[:limit]


def list_org_guardian_consent_packets(org_id, limit=1000):
    """List all guardian consent packets for an organization."""
    query = get_guardian_consent_packets_collection().where('org_id', '==', org_id)
    docs = query.stream()

    packets = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        packets.append(data)
    packets.sort(
        key=lambda item: (
            getattr(item.get('updated_at'), 'isoformat', lambda: '')(),
            getattr(item.get('created_at'), 'isoformat', lambda: '')(),
        ),
        reverse=True,
    )
    return packets[:limit]


def find_guardian_consent_packet_by_token_hash(token_hash):
    """Find a guardian consent packet by hashed public token."""
    query = get_guardian_consent_packets_collection().where('token_hash', '==', token_hash).limit(1)
    docs = list(query.stream())
    if not docs:
        return None
    doc = docs[0]
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def create_assignment(
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
    target_vocabulary=None,
    focus_grammar=None,
    generated_scenario='',
    teacher_notes='',
    target_language_intensity='mostly_target',
    student_instructions='',
):
    """Create an assignment document.

    After C2, scenario fields live directly on the assignment document — the
    ``curriculum_mappings`` collection has been deleted. Canvas content
    metadata still hangs off the assignment via ``canvas_module_item_id`` and
    ``canvas_module_item_ref``.
    """
    doc_ref = get_assignment_ref(assignment_id) if assignment_id else get_assignments_collection().document()
    assignment_data = {
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
        'success_criteria': _normalize_string_list(success_criteria or []),
        'created_by_uid': created_by_uid,
        'canvas_module_item_id': canvas_module_item_id or '',
        # Direct scenario fields (C2 — curriculum_mappings is gone).
        'instructions': instructions or '',
        'canvas_module_item_ref': canvas_module_item_ref,
        'objectives': list(objectives or []),
        'target_expressions': list(target_expressions or []),
        'target_vocabulary': list(target_vocabulary or []),
        'focus_grammar': list(focus_grammar or []),
        'generated_scenario': generated_scenario or '',
        'teacher_notes': teacher_notes or '',
        'student_instructions': student_instructions or '',
        'target_language_intensity': (
            target_language_intensity
            if target_language_intensity in (
                'english_first',
                'english_led',
                'balanced',
                'target_led',
                'target_only',
                # Legacy values are still accepted on write so older seed
                # fixtures and restored snapshots keep working; read-path
                # normalization maps them to their nearest new-enum value.
                'mostly_target',
                'bilingual_scaffold',
            )
            else 'balanced'
        ),
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(assignment_data)
    return doc_ref.id


def get_assignment(assignment_id):
    """Get an assignment by id."""
    doc = get_assignment_ref(assignment_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def list_class_assignments(class_id, statuses=None):
    """List assignments for a class."""
    docs = get_assignments_collection().where('class_id', '==', class_id).stream()
    allowed_statuses = set(_normalize_string_list(statuses or []))
    assignments = []
    for doc in docs:
        data = doc.to_dict() or {}
        if allowed_statuses and data.get('status') not in allowed_statuses:
            continue
        data['id'] = doc.id
        assignments.append(data)
    return assignments


def get_student_class_enrollment(class_id, student_uid):
    """Get a student's enrollment for a class if it exists."""
    enrollment_doc = get_enrollment_ref(f'{class_id}_{student_uid}').get()
    deterministic = None
    if not enrollment_doc.exists:
        deterministic = None
    else:
        deterministic = enrollment_doc.to_dict() or {}
        deterministic['id'] = enrollment_doc.id
        if deterministic.get('status') == 'active':
            return deterministic

    legacy_match = None
    for enrollment in list_student_enrollments(student_uid, status=None):
        if enrollment.get('class_id') != class_id:
            continue
        if enrollment.get('status') == 'active':
            return enrollment
        if legacy_match is None:
            legacy_match = enrollment

    return deterministic or legacy_match


def list_student_assignments(student_uid, statuses=None):
    """List assignments available to a student through active enrollments."""
    enrollments = list_student_enrollments(student_uid)
    assignments = []
    seen_assignment_ids = set()
    for enrollment in enrollments:
        class_id = enrollment.get('class_id')
        if not isinstance(class_id, str) or not class_id:
            continue
        for assignment in list_class_assignments(class_id, statuses=statuses):
            assignment_id = assignment.get('id')
            if assignment_id in seen_assignment_ids:
                continue
            assignments.append(assignment)
            seen_assignment_ids.add(assignment_id)
    return assignments


def list_student_classes(student_uid):
    """List active classes a student is enrolled in."""
    enrollments = list_student_enrollments(student_uid)
    classes = []
    seen_class_ids = set()
    for enrollment in enrollments:
        class_id = enrollment.get('class_id')
        if not isinstance(class_id, str) or not class_id or class_id in seen_class_ids:
            continue
        class_record = get_class(class_id)
        if not class_record or class_record.get('status') != 'active':
            continue
        classes.append(class_record)
        seen_class_ids.add(class_id)
    return classes


def create_practice_session(session_data, session_id=None):
    """Create a practice session document."""
    doc_ref = get_practice_session_ref(session_id) if session_id else get_practice_sessions_collection().document()
    payload = dict(session_data or {})
    payload.setdefault('created_at', _utc_now())
    payload['updated_at'] = _utc_now()
    doc_ref.set(payload)
    return doc_ref.id


def get_practice_session(session_id):
    """Get a practice session by id."""
    doc = get_practice_session_ref(session_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def update_practice_session(session_id, updates):
    """Update a practice session."""
    payload = dict(updates or {})
    payload['updated_at'] = _utc_now()
    get_practice_session_ref(session_id).update(payload)


def list_assignment_practice_sessions(assignment_id):
    """List practice sessions for an assignment."""
    docs = get_practice_sessions_collection().where('assignment_id', '==', assignment_id).stream()
    sessions = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        sessions.append(data)
    return sessions


def list_student_assignment_practice_sessions(assignment_id, student_uid):
    """List practice sessions for one student on one assignment."""
    docs = (
        get_practice_sessions_collection()
        .where('assignment_id', '==', assignment_id)
        .where('student_uid', '==', student_uid)
        .stream()
    )
    sessions = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        sessions.append(data)
    return sessions


def list_class_practice_sessions(class_id):
    """List all practice sessions for a class."""
    docs = get_practice_sessions_collection().where('class_id', '==', class_id).stream()
    sessions = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        sessions.append(data)
    return sessions


def list_student_class_practice_sessions(class_id, student_uid):
    """List practice sessions for a student in a class."""
    docs = (
        get_practice_sessions_collection()
        .where('class_id', '==', class_id)
        .where('student_uid', '==', student_uid)
        .stream()
    )
    sessions = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        sessions.append(data)
    return sessions


def list_class_learning_events(class_id):
    """List all learning events for a class."""
    docs = get_learning_events_collection().where('class_id', '==', class_id).stream()
    events = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        events.append(data)
    return events


def list_student_class_learning_events(class_id, student_uid):
    """List learning events for a student in a class."""
    docs = (
        get_learning_events_collection()
        .where('class_id', '==', class_id)
        .where('student_uid', '==', student_uid)
        .stream()
    )
    events = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        events.append(data)
    return events


def create_learning_event(event_data, event_id=None):
    """Create a learning event."""
    doc_ref = get_learning_event_ref(event_id) if event_id else get_learning_events_collection().document()
    payload = dict(event_data or {})
    payload.setdefault('created_at', _utc_now())
    doc_ref.set(payload)
    return doc_ref.id


def list_session_learning_events(session_id):
    """List learning events for a session."""
    docs = get_learning_events_collection().where('session_id', '==', session_id).stream()
    events = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        events.append(data)
    return events


def list_assignment_learning_events(assignment_id, event_types=None):
    """List learning events for an assignment."""
    docs = get_learning_events_collection().where('assignment_id', '==', assignment_id).stream()
    allowed_event_types = set(_normalize_string_list(event_types or []))
    events = []
    for doc in docs:
        data = doc.to_dict() or {}
        if allowed_event_types and data.get('event_type') not in allowed_event_types:
            continue
        data['id'] = doc.id
        events.append(data)
    return events


# ============================================
# CHAT SESSION FUNCTIONS
# ============================================

CHAT_LANGUAGE_MIX_LEVELS = {
    'english_first',
    'english_led',
    'balanced',
    'target_led',
    'target_only',
}


def normalize_chat_language_mix_level(value):
    if isinstance(value, str) and value in CHAT_LANGUAGE_MIX_LEVELS:
        return value
    return 'balanced'

def get_chats_collection(uid):
    """Get reference to user's chats subcollection."""
    return get_user_ref(uid).collection('chats')


def create_chat_session(uid, title=None):
    """Create a new chat session for user."""
    chats_ref = get_chats_collection(uid)
    chat_data = {
        'title': title or 'New Chat',
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
        'messages': [],
        'language_mix_level': 'balanced',
    }
    doc_ref = chats_ref.add(chat_data)
    return doc_ref[1].id  # Returns the document ID


def _timestamp_to_iso(ts):
    """Convert Firestore timestamp to ISO string."""
    if ts is None:
        return None
    if hasattr(ts, 'isoformat'):
        return ts.isoformat()
    if hasattr(ts, 'seconds'):
        # Firestore Timestamp object
        return datetime.utcfromtimestamp(ts.seconds).isoformat()
    return str(ts)


def _coerce_sort_order(value):
    """Normalize optional sort order values to ints."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith('-'):
            stripped = stripped[1:]
        if stripped.isdigit():
            return int(value)
    return None


def sort_chat_messages(messages):
    """Return chat messages in stable display/context order."""
    if not isinstance(messages, list):
        return []

    decorated = []
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            continue
        sort_order = _coerce_sort_order(message.get('sort_order'))
        effective_order = sort_order if sort_order is not None else index
        decorated.append((effective_order, index, message))

    decorated.sort(key=lambda item: (item[0], item[1]))
    return [message for _, _, message in decorated]


def get_chat_sessions(uid, limit=50):
    """Get all chat sessions for user, ordered by most recent."""
    chats_ref = get_chats_collection(uid)
    docs = chats_ref.order_by('updated_at', direction=firestore.Query.DESCENDING).limit(limit).stream()

    sessions = []
    for doc in docs:
        data = doc.to_dict()
        # Get preview from last message
        messages = sort_chat_messages(data.get('messages', []))
        last_message = messages[-1] if messages else None

        sessions.append({
            'id': doc.id,
            'title': data.get('title', 'New Chat'),
            'created_at': _timestamp_to_iso(data.get('created_at')),
            'updated_at': _timestamp_to_iso(data.get('updated_at')),
            'message_count': len(messages),
            'last_message': last_message.get('content', '')[:50] if last_message else None,
            'language_mix_level': normalize_chat_language_mix_level(data.get('language_mix_level')),
        })
    return sessions


def get_chat_session(uid, chat_id):
    """Get a specific chat session with all messages."""
    chat_ref = get_chats_collection(uid).document(chat_id)
    doc = chat_ref.get()

    if doc.exists:
        data = doc.to_dict()
        messages = sort_chat_messages(data.get('messages', []))
        return {
            'id': doc.id,
            'title': data.get('title', 'New Chat'),
            'created_at': _timestamp_to_iso(data.get('created_at')),
            'updated_at': _timestamp_to_iso(data.get('updated_at')),
            'messages': messages,
            'language_mix_level': normalize_chat_language_mix_level(data.get('language_mix_level')),
        }
    return None


def add_message_to_chat(uid, chat_id, role, content, timestamp=None, sort_order=None):
    """Add a message to a chat session."""
    chat_ref = get_chats_collection(uid).document(chat_id)
    message = {
        'role': role,
        'content': content,
        'timestamp': timestamp or _utc_now().isoformat()
    }
    normalized_sort_order = _coerce_sort_order(sort_order)
    if normalized_sort_order is not None:
        message['sort_order'] = normalized_sort_order

    chat_ref.update({
        'messages': firestore.ArrayUnion([message]),
        'updated_at': firestore.SERVER_TIMESTAMP
    })
    return message


def update_chat_title(uid, chat_id, title):
    """Update the title of a chat session."""
    chat_ref = get_chats_collection(uid).document(chat_id)
    chat_ref.update({
        'title': title,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def update_chat_settings(uid, chat_id, *, language_mix_level=None):
    """Update chat-level settings."""
    chat_ref = get_chats_collection(uid).document(chat_id)
    updates = {'updated_at': firestore.SERVER_TIMESTAMP}
    if language_mix_level is not None:
        updates['language_mix_level'] = normalize_chat_language_mix_level(language_mix_level)
    chat_ref.update(updates)


def delete_chat_session(uid, chat_id):
    """Delete a chat session."""
    chat_ref = get_chats_collection(uid).document(chat_id)
    chat_ref.delete()


def get_chat_messages_for_context(uid, chat_id, limit=20):
    """Get recent messages from a chat for AI context."""
    session = get_chat_session(uid, chat_id)
    if session:
        messages = sort_chat_messages(session.get('messages', []))
        return messages[-limit:] if len(messages) > limit else messages
    return []


# ============================================
# PRONUNCIATION PRACTICE FUNCTIONS
# ============================================

def get_pronunciation_sessions_collection(uid):
    """Get reference to user's pronunciation sessions subcollection."""
    return get_user_ref(uid).collection('pronunciation_sessions')


def create_pronunciation_session(uid, locale, kind='practice', prompt_set_id=None, objective_id=None):
    """Create a pronunciation practice session."""
    session_ref = get_pronunciation_sessions_collection(uid).document()
    session_data = {
        'kind': kind,
        'locale': locale,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP
    }
    if prompt_set_id:
        session_data['prompt_set_id'] = prompt_set_id
    if objective_id:
        session_data['objective_id'] = objective_id

    session_ref.set(session_data)
    return session_ref.id


def get_pronunciation_session(uid, session_id):
    """Get a pronunciation session by id."""
    session_ref = get_pronunciation_sessions_collection(uid).document(session_id)
    doc = session_ref.get()
    if doc.exists:
        data = doc.to_dict()
        return {
            'id': doc.id,
            'kind': data.get('kind'),
            'locale': data.get('locale'),
            'created_at': _timestamp_to_iso(data.get('created_at')),
            'updated_at': _timestamp_to_iso(data.get('updated_at')),
            'prompt_set_id': data.get('prompt_set_id'),
            'objective_id': data.get('objective_id')
        }
    return None


def add_pronunciation_attempt(uid, session_id, attempt):
    """Add a pronunciation attempt to a session."""
    session_ref = get_pronunciation_sessions_collection(uid).document(session_id)
    attempt_ref = session_ref.collection('attempts').document()

    attempt_data = {
        'prompt_id': attempt.get('prompt_id'),
        'objective_id': attempt.get('objective_id'),
        'reference_text': attempt.get('reference_text'),
        'recognized_text': attempt.get('recognized_text'),
        'locale': attempt.get('locale'),
        'scores': attempt.get('scores', {}),
        'words': attempt.get('words', []),
        'raw_result': attempt.get('raw_result'),
        'audio_url': attempt.get('audio_url'),
        'created_at': firestore.SERVER_TIMESTAMP
    }

    session_ref.update({'updated_at': firestore.SERVER_TIMESTAMP})
    attempt_ref.set(attempt_data)
    return attempt_ref.id


def get_pronunciation_attempts(uid, session_id, limit=50, objective_id=None):
    """Get pronunciation attempts for a session."""
    session_ref = get_pronunciation_sessions_collection(uid).document(session_id)
    attempts_ref = session_ref.collection('attempts')
    query = attempts_ref.order_by('created_at', direction=firestore.Query.DESCENDING)
    if objective_id:
        query = query.where('objective_id', '==', objective_id)
    docs = query.limit(limit).stream()

    attempts = []
    for doc in docs:
        data = doc.to_dict()
        attempts.append({
            'id': doc.id,
            'promptId': data.get('prompt_id'),
            'objectiveId': data.get('objective_id'),
            'referenceText': data.get('reference_text'),
            'recognizedText': data.get('recognized_text'),
            'locale': data.get('locale'),
            'scores': data.get('scores', {}),
            'words': data.get('words', []),
            'audioUrl': data.get('audio_url'),
            'createdAt': _timestamp_to_iso(data.get('created_at'))
        })
    return attempts


# ============================================
# MINIGAME FUNCTIONS
# ============================================

def get_minigame_attempts_collection(uid):
    """Get reference to user's minigame attempts subcollection."""
    return get_user_ref(uid).collection('minigame_attempts')


def add_minigame_attempt(uid, attempt):
    """Add a minigame attempt for progress tracking."""
    attempts_ref = get_minigame_attempts_collection(uid).document()
    attempt_data = {
        'game_type': attempt.get('game_type'),
        'locale': attempt.get('locale'),
        'objective_id': attempt.get('objective_id'),
        'scenario_id': attempt.get('scenario_id'),
        'score': attempt.get('score', 0),
        'correct_answers': attempt.get('correct_answers', 0),
        'total_questions': attempt.get('total_questions', 0),
        'accuracy': attempt.get('accuracy', 0),
        'duration_seconds': attempt.get('duration_seconds'),
        'metadata': attempt.get('metadata', {}),
        'created_at': firestore.SERVER_TIMESTAMP
    }
    attempts_ref.set(attempt_data)
    return attempts_ref.id


def get_minigame_attempts(uid, limit=50):
    """Get minigame attempts ordered by most recent."""
    attempts_ref = get_minigame_attempts_collection(uid)
    docs = attempts_ref.order_by('created_at', direction=firestore.Query.DESCENDING).limit(limit).stream()

    attempts = []
    for doc in docs:
        data = doc.to_dict()
        attempts.append({
            'id': doc.id,
            'gameType': data.get('game_type'),
            'locale': data.get('locale'),
            'objectiveId': data.get('objective_id'),
            'scenarioId': data.get('scenario_id'),
            'score': data.get('score', 0),
            'correctAnswers': data.get('correct_answers', 0),
            'totalQuestions': data.get('total_questions', 0),
            'accuracy': data.get('accuracy', 0),
            'durationSeconds': data.get('duration_seconds'),
            'metadata': data.get('metadata', {}),
            'createdAt': _timestamp_to_iso(data.get('created_at'))
        })
    return attempts


def get_minigame_summary(uid, limit=200):
    """Get aggregate summary of minigame performance."""
    attempts = get_minigame_attempts(uid, limit=limit)
    if not attempts:
        return {
            'totalAttempts': 0,
            'averageAccuracy': 0,
            'bestScore': 0,
            'totalQuestions': 0,
            'totalCorrectAnswers': 0,
            'totalDurationSeconds': 0,
            'durationSecondsByLocale': {},
            'byGame': {},
            'recentAttempts': []
        }

    total_attempts = len(attempts)
    total_questions = sum(item.get('totalQuestions', 0) for item in attempts)
    total_correct = sum(item.get('correctAnswers', 0) for item in attempts)
    average_accuracy = (
        sum(item.get('accuracy', 0) for item in attempts) / total_attempts
        if total_attempts
        else 0
    )
    best_score = max(item.get('score', 0) for item in attempts)
    total_duration_seconds = 0

    by_game = {}
    duration_by_locale = {}
    for attempt in attempts:
        game_type = attempt.get('gameType') or 'unknown'
        locale = attempt.get('locale')
        duration_seconds = max(0, attempt.get('durationSeconds') or 0)
        total_duration_seconds += duration_seconds
        if game_type not in by_game:
            by_game[game_type] = {
                'attempts': 0,
                'totalAccuracy': 0,
                'bestScore': 0
            }
        by_game[game_type]['attempts'] += 1
        by_game[game_type]['totalAccuracy'] += attempt.get('accuracy', 0)
        by_game[game_type]['bestScore'] = max(
            by_game[game_type]['bestScore'],
            attempt.get('score', 0)
        )
        if locale:
            duration_by_locale[locale] = duration_by_locale.get(locale, 0) + duration_seconds

    for game_type, stats in by_game.items():
        attempts_count = stats['attempts']
        stats['averageAccuracy'] = (
            stats['totalAccuracy'] / attempts_count if attempts_count else 0
        )
        del stats['totalAccuracy']
        by_game[game_type] = stats

    return {
        'totalAttempts': total_attempts,
        'averageAccuracy': average_accuracy,
        'bestScore': best_score,
        'totalQuestions': total_questions,
        'totalCorrectAnswers': total_correct,
        'totalDurationSeconds': total_duration_seconds,
        'durationSecondsByLocale': duration_by_locale,
        'byGame': by_game,
        'recentAttempts': attempts[:10]
    }


# --- Deletion requests ---

def create_deletion_request(
    *,
    org_id,
    scope_type,
    scope_id,
    requested_by_uid,
    request_reason='',
    request_id=None,
):
    """Create a deletion request."""
    doc_ref = get_deletion_request_ref(request_id) if request_id else get_deletion_requests_collection().document()
    request_data = {
        'org_id': org_id,
        'scope_type': scope_type,
        'scope_id': scope_id,
        'requested_by_uid': requested_by_uid,
        'request_reason': request_reason,
        'status': 'requested',
        'approved_by_uid': '',
        'review_notes': '',
        'target_collections': [],
        'target_storage_prefixes': [],
        'execution_summary': {},
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
        'completed_at': None,
    }
    doc_ref.set(request_data)
    return doc_ref.id


def get_deletion_request(request_id):
    """Get a deletion request by ID."""
    doc = get_deletion_request_ref(request_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def update_deletion_request(request_id, updates):
    """Update a deletion request."""
    doc_ref = get_deletion_request_ref(request_id)
    payload = dict(updates or {})
    payload['updated_at'] = firestore.SERVER_TIMESTAMP
    doc_ref.update(payload)
    return doc_ref.id


def list_deletion_requests(org_id, status_filter=None, limit=100):
    """List deletion requests for an org, optionally filtered by status."""
    query = get_deletion_requests_collection().where('org_id', '==', org_id)
    if status_filter:
        query = query.where('status', 'in', status_filter)
    docs = query.stream()
    requests = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        requests.append(data)
    requests.sort(
        key=lambda r: getattr(r.get('created_at'), 'isoformat', lambda: '')(),
        reverse=True,
    )
    return requests[:limit]


# --- Deletion execution runs ---

def create_deletion_execution_run(
    *,
    request_id,
    org_id,
    scope_type,
    scope_id,
    attempt_number=1,
    run_id=None,
):
    """Create a deletion execution run."""
    doc_ref = get_deletion_execution_run_ref(run_id) if run_id else get_deletion_execution_runs_collection().document()
    run_data = {
        'request_id': request_id,
        'org_id': org_id,
        'scope_type': scope_type,
        'scope_id': scope_id,
        'status': 'running',
        'attempt_number': attempt_number,
        'firestore_counts': {'targeted': 0, 'deleted': 0, 'failed': 0, 'by_collection': {}},
        'storage_counts': {'targeted': 0, 'deleted': 0, 'failed': 0},
        'error_summary': [],
        'started_at': firestore.SERVER_TIMESTAMP,
        'finished_at': None,
    }
    doc_ref.set(run_data)
    return doc_ref.id


def get_deletion_execution_run(run_id):
    """Get a deletion execution run by ID."""
    doc = get_deletion_execution_run_ref(run_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def update_deletion_execution_run(run_id, updates):
    """Update a deletion execution run."""
    doc_ref = get_deletion_execution_run_ref(run_id)
    payload = dict(updates or {})
    doc_ref.update(payload)
    return doc_ref.id


def list_deletion_execution_runs(request_id, limit=20):
    """List execution runs for a deletion request."""
    query = get_deletion_execution_runs_collection().where('request_id', '==', request_id)
    docs = query.stream()
    runs = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        runs.append(data)
    runs.sort(key=lambda r: r.get('attempt_number', 0))
    return runs[:limit]


# ── Canvas LMS integration helpers ──────────────────────────────────────


def create_canvas_connection(
    membership_id,
    org_id,
    class_id,
    canvas_instance_url,
    canvas_course_id,
    canvas_course_name='',
    encrypted_pat='',
    connection_id=None,
    auth_method='pat',
    lti_deployment_id='',
    lti_context_id='',
    lti_lineitem_url='',
    grade_metric=None,
    grade_points=None,
):
    """Create a canvas connection record (server-only, never client-readable)."""
    doc_ref = get_canvas_connection_ref(connection_id) if connection_id else get_canvas_connections_collection().document()
    connection_data = {
        'membership_id': membership_id,
        'org_id': org_id,
        'class_id': class_id,
        'canvas_instance_url': canvas_instance_url,
        'canvas_course_id': str(canvas_course_id),
        'canvas_course_name': canvas_course_name or '',
        'encrypted_pat': encrypted_pat,
        'auth_method': auth_method,
        'lti_deployment_id': lti_deployment_id or '',
        'lti_context_id': lti_context_id or '',
        'lti_lineitem_url': lti_lineitem_url or '',
        'grade_metric': grade_metric,
        'grade_points': grade_points,
        'last_synced_at': None,
        'sync_status': 'idle',
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(connection_data)
    return doc_ref.id


def get_canvas_connection(connection_id):
    """Get a canvas connection by ID."""
    doc = get_canvas_connection_ref(connection_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def get_canvas_connection_by_class(class_id):
    """Get the canvas connection for a class (at most one per class)."""
    docs = (
        get_canvas_connections_collection()
        .where('class_id', '==', class_id)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def update_canvas_connection(connection_id, updates):
    """Update a canvas connection record."""
    payload = dict(updates or {})
    payload['updated_at'] = firestore.SERVER_TIMESTAMP
    get_canvas_connection_ref(connection_id).update(payload)


def delete_canvas_connection(connection_id):
    """Delete a canvas connection and its associated course content."""
    connection = get_canvas_connection(connection_id)
    if not connection:
        return
    # Delete all course content for this connection
    docs = (
        get_canvas_course_content_collection()
        .where('connection_id', '==', connection_id)
        .stream()
    )
    batch = get_db().batch()
    count = 0
    for doc in docs:
        batch.delete(doc.reference)
        count += 1
        if count >= 400:
            batch.commit()
            batch = get_db().batch()
            count = 0
    if count > 0:
        batch.commit()
    # Delete the connection itself
    get_canvas_connection_ref(connection_id).delete()


def replace_canvas_course_content_for_connection(connection_id, class_id, items):
    """Atomically replace all canvas course content for a connection.

    Deletes existing content, then writes new items in batches.
    Each item is a dict with Canvas module/item fields.
    """
    # Delete existing content
    existing = (
        get_canvas_course_content_collection()
        .where('connection_id', '==', connection_id)
        .stream()
    )
    batch = get_db().batch()
    count = 0
    for doc in existing:
        batch.delete(doc.reference)
        count += 1
        if count >= 400:
            batch.commit()
            batch = get_db().batch()
            count = 0
    if count > 0:
        batch.commit()

    # Write new items
    batch = get_db().batch()
    count = 0
    now = firestore.SERVER_TIMESTAMP
    for item in items:
        doc_ref = get_canvas_course_content_collection().document()
        doc_data = {
            'connection_id': connection_id,
            'class_id': class_id,
            'canvas_module_id': str(item.get('canvas_module_id', '')),
            'canvas_module_name': item.get('canvas_module_name', ''),
            'canvas_module_position': item.get('canvas_module_position', 0),
            'item_id': str(item.get('item_id', '')) if item.get('item_id') else None,
            'item_title': item.get('item_title', ''),
            'item_type': item.get('item_type', ''),
            'item_position': item.get('item_position', 0),
            'item_html_url': item.get('item_html_url', ''),
            'due_at': item.get('due_at'),
            'points_possible': item.get('points_possible'),
            'lingual_assignment_id': item.get('lingual_assignment_id'),
            'updated_at': now,
        }
        batch.set(doc_ref, doc_data)
        count += 1
        if count >= 400:
            batch.commit()
            batch = get_db().batch()
            count = 0
    if count > 0:
        batch.commit()


def get_canvas_course_content(content_id):
    """Get a canvas course content document by ID."""
    doc = get_canvas_course_content_ref(content_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def list_canvas_course_content_for_class(class_id):
    """List canvas course content for a class, ordered by module then item position."""
    docs = (
        get_canvas_course_content_collection()
        .where('class_id', '==', class_id)
        .order_by('canvas_module_position')
        .order_by('item_position')
        .stream()
    )
    items = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        items.append(data)
    return items


# ── canvas_roster_entries collection ──────────────────────────────────
#
# canvas_roster_entries is the Canvas-truth view of who's on the class
# roster, kept separate from enrollments/. Sync writes here; enrollment
# creation never writes here. A roster entry is informational only —
# enrollment only happens via join code or LTI launch.

def get_canvas_roster_entries_collection():
    return get_db().collection('canvas_roster_entries')


def get_canvas_roster_entry_ref(class_id, canvas_user_id):
    return get_canvas_roster_entries_collection().document(
        f'{class_id}__{canvas_user_id}'
    )


def upsert_canvas_roster_entry(*, class_id, connection_id, canvas_user_id,
                               canvas_email, canvas_name):
    """Idempotent upsert of a single Canvas roster entry.

    Key: {class_id}__{canvas_user_id}. Preserves created_at on re-upsert,
    refreshes synced_at / canvas_email / canvas_name / connection_id.
    """
    ref = get_canvas_roster_entry_ref(class_id, canvas_user_id)
    existing = ref.get()
    payload = {
        'class_id': class_id,
        'connection_id': connection_id,
        'canvas_user_id': str(canvas_user_id),
        'canvas_email': (canvas_email or '').lower().strip(),
        'canvas_name': canvas_name or '',
        'synced_at': firestore.SERVER_TIMESTAMP,
    }
    if existing.exists:
        ref.update(payload)
    else:
        payload['created_at'] = firestore.SERVER_TIMESTAMP
        ref.set(payload)


def delete_canvas_roster_entry(class_id, canvas_user_id):
    get_canvas_roster_entry_ref(class_id, canvas_user_id).delete()


def list_canvas_roster_entries(class_id):
    docs = (
        get_canvas_roster_entries_collection()
        .where('class_id', '==', class_id)
        .stream()
    )
    results = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        results.append(data)
    return results


def get_canvas_roster_entry_by_email(class_id, email):
    """Single-entry lookup used by the 'on Canvas roster' badge."""
    if not email:
        return None
    docs = (
        get_canvas_roster_entries_collection()
        .where('class_id', '==', class_id)
        .where('canvas_email', '==', email.lower().strip())
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def count_canvas_roster_entries(class_id):
    """Count of roster entries for a class. Falls back to len(list) if
    the aggregation API is unavailable in the current firestore client
    (e.g. older library versions or test fakes that don't implement it).
    """
    try:
        agg = (
            get_canvas_roster_entries_collection()
            .where('class_id', '==', class_id)
            .count()
            .get()
        )
        return int(agg[0][0].value)
    except (AttributeError, NotImplementedError):
        return len(list_canvas_roster_entries(class_id))


def link_assignment_to_canvas_item(assignment_id, canvas_content_id, canvas_module_item_id):
    """Atomically link a Lingual assignment to a Canvas module item using a batch write."""
    batch = get_db().batch()
    batch.update(get_assignment_ref(assignment_id), {
        'canvas_module_item_id': canvas_module_item_id,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    batch.update(get_canvas_course_content_ref(canvas_content_id), {
        'lingual_assignment_id': assignment_id,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    batch.commit()


def unlink_assignment_from_canvas_item(assignment_id, canvas_content_id):
    """Atomically unlink a Lingual assignment from a Canvas module item."""
    batch = get_db().batch()
    batch.update(get_assignment_ref(assignment_id), {
        'canvas_module_item_id': '',
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    batch.update(get_canvas_course_content_ref(canvas_content_id), {
        'lingual_assignment_id': None,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    batch.commit()


def create_school_request(requester_uid, requester_email, requester_name,
                          school_name, org_type, website_url='', canvas_instance_url=''):
    """Create a school join request."""
    doc_ref = get_school_requests_collection().document()
    doc_ref.set({
        'requester_uid': requester_uid,
        'requester_email': requester_email,
        'requester_name': requester_name,
        'school_name': school_name,
        'org_type': org_type,
        'website_url': website_url or '',
        'canvas_instance_url': canvas_instance_url or '',
        'status': 'pending',
        'reviewed_by_uid': None,
        'reviewed_at': None,
        'rejection_reason': None,
        'created_org_id': None,
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return doc_ref.id


def get_school_request(request_id):
    """Get a school request by ID."""
    doc = get_school_request_ref(request_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def get_user_school_request(uid):
    """Get the most recent school request for a user."""
    docs = (
        get_school_requests_collection()
        .where('requester_uid', '==', uid)
        .order_by('created_at', direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def list_school_requests(status_filter=None):
    """List school requests, optionally filtered by status."""
    query = get_school_requests_collection()
    if status_filter:
        query = query.where('status', '==', status_filter)
    docs = query.order_by('created_at', direction=firestore.Query.DESCENDING).stream()
    results = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        results.append(data)
    return results


def update_school_request(request_id, updates):
    """Update fields on a school request."""
    updates['updated_at'] = firestore.SERVER_TIMESTAMP
    get_school_request_ref(request_id).update(updates)


# ---------------------------------------------------------------------------
# Teacher invite codes
# ---------------------------------------------------------------------------

def generate_teacher_invite_code(org_id):
    """Generate or regenerate a 6-char teacher invite code for an org."""
    code = ''.join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))
    get_organization_ref(org_id).update({
        'teacher_invite_code': code,
        'teacher_invite_code_active': True,
        'teacher_invite_code_generated_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    return code


def get_org_by_teacher_invite_code(code):
    """Look up an org by its active teacher invite code."""
    docs = (
        get_organizations_collection()
        .where('teacher_invite_code', '==', code)
        .where('teacher_invite_code_active', '==', True)
        .where('status', '==', 'active')
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def deactivate_teacher_invite_code(org_id):
    """Deactivate the teacher invite code."""
    get_organization_ref(org_id).update({
        'teacher_invite_code_active': False,
        'updated_at': firestore.SERVER_TIMESTAMP,
    })


# ---------------------------------------------------------------------------
# Teacher invitations CRUD
# ---------------------------------------------------------------------------

def get_teacher_invitations_collection():
    return get_db().collection('teacher_invitations')


def create_teacher_invitation(org_id, uid, email, name):
    """Create a teacher invitation (pending status)."""
    doc_ref = get_teacher_invitations_collection().document()
    doc_ref.set({
        'org_id': org_id,
        'uid': uid,
        'email': email,
        'name': name,
        'status': 'pending',
        'reviewed_by_uid': None,
        'reviewed_at': None,
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return doc_ref.id


def get_teacher_invitation(invitation_id):
    doc = get_teacher_invitations_collection().document(invitation_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def list_teacher_invitations(org_id, status_filter=None):
    query = get_teacher_invitations_collection().where('org_id', '==', org_id)
    if status_filter:
        query = query.where('status', '==', status_filter)
    docs = query.order_by('created_at', direction=firestore.Query.DESCENDING).stream()
    results = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        results.append(data)
    return results


def get_teacher_invitation_by_user(org_id, uid):
    """Check if a user already has a pending invitation for this org."""
    docs = (
        get_teacher_invitations_collection()
        .where('org_id', '==', org_id)
        .where('uid', '==', uid)
        .where('status', '==', 'pending')
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def update_teacher_invitation(invitation_id, updates):
    updates['updated_at'] = firestore.SERVER_TIMESTAMP
    get_teacher_invitations_collection().document(invitation_id).update(updates)


# ============================================================================
# Teacher Join Requests (Plan 4)
# ============================================================================

TEACHER_JOIN_REQUESTS_COLLECTION = 'teacher_join_requests'

TEACHER_JOIN_REQUEST_SOURCE_INVITE_CODE = 'invite_code'
TEACHER_JOIN_REQUEST_SOURCE_SEARCH = 'search'
ALLOWED_TEACHER_JOIN_REQUEST_SOURCES = frozenset({
    TEACHER_JOIN_REQUEST_SOURCE_INVITE_CODE,
    TEACHER_JOIN_REQUEST_SOURCE_SEARCH,
})

TEACHER_JOIN_REQUEST_STATUS_PENDING = 'pending'
TEACHER_JOIN_REQUEST_STATUS_APPROVED = 'approved'
TEACHER_JOIN_REQUEST_STATUS_DECLINED = 'declined'
TEACHER_JOIN_REQUEST_STATUS_CANCELLED = 'cancelled'
ALLOWED_TEACHER_JOIN_REQUEST_STATUSES = frozenset({
    TEACHER_JOIN_REQUEST_STATUS_PENDING,
    TEACHER_JOIN_REQUEST_STATUS_APPROVED,
    TEACHER_JOIN_REQUEST_STATUS_DECLINED,
    TEACHER_JOIN_REQUEST_STATUS_CANCELLED,
})


def get_teacher_join_requests_collection():
    return get_db().collection(TEACHER_JOIN_REQUESTS_COLLECTION)


def create_teacher_join_request(
    *,
    uid: str,
    org_id: str,
    source: str,
    invite_code: str | None = None,
):
    """Create a teacher_join_requests doc in 'pending' status. Returns doc id."""
    if source not in ALLOWED_TEACHER_JOIN_REQUEST_SOURCES:
        raise ValueError(f"Invalid source: {source!r}")
    doc_ref = get_teacher_join_requests_collection().document()
    payload = {
        'uid': uid,
        'org_id': org_id,
        'source': source,
        'status': TEACHER_JOIN_REQUEST_STATUS_PENDING,
        'requested_at': firestore.SERVER_TIMESTAMP,
        'reviewed_at': None,
        'reviewed_by_uid': None,
        'decline_reason': None,
    }
    if invite_code:
        payload['invite_code'] = invite_code
    doc_ref.set(payload)
    return doc_ref.id


def get_pending_teacher_join_request_by_uid(uid: str):
    """Return the user's single open (pending) request, or None."""
    query = (
        get_teacher_join_requests_collection()
        .where('uid', '==', uid)
        .where('status', '==', TEACHER_JOIN_REQUEST_STATUS_PENDING)
        .limit(1)
    )
    for doc in query.stream():
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def get_latest_active_teacher_join_request_by_uid(uid: str):
    """Return the user's latest request that hasn't been cancelled, or None.

    Used by GET /api/teacher-join-requests/me so the teacher can see the
    outcome (pending/approved/declined) of their last submission. Cancelled
    requests are excluded — the user chose to abandon them and should not
    be shown as a pending state on their next login.
    """
    query = (
        get_teacher_join_requests_collection()
        .where('uid', '==', uid)
        .where('status', 'in', [
            TEACHER_JOIN_REQUEST_STATUS_PENDING,
            TEACHER_JOIN_REQUEST_STATUS_APPROVED,
            TEACHER_JOIN_REQUEST_STATUS_DECLINED,
        ])
        .order_by('requested_at', direction=firestore.Query.DESCENDING)
        .limit(1)
    )
    for doc in query.stream():
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def get_teacher_join_request(request_id: str):
    doc = get_teacher_join_requests_collection().document(request_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def list_pending_teacher_join_requests_by_org(org_id: str):
    """List all pending requests targeting the given org, newest first."""
    query = (
        get_teacher_join_requests_collection()
        .where('org_id', '==', org_id)
        .where('status', '==', TEACHER_JOIN_REQUEST_STATUS_PENDING)
        .order_by('requested_at', direction=firestore.Query.DESCENDING)
    )
    results = []
    for doc in query.stream():
        data = doc.to_dict() or {}
        data['id'] = doc.id
        results.append(data)
    return results


_REVIEW_STATUSES = frozenset({
    TEACHER_JOIN_REQUEST_STATUS_APPROVED,
    TEACHER_JOIN_REQUEST_STATUS_DECLINED,
})


def update_teacher_join_request_status(
    *,
    request_id: str,
    status: str,
    reviewed_by_uid: str | None = None,
    decline_reason: str | None = None,
):
    """Transition status with audit metadata.

    `reviewed_at` / `reviewed_by_uid` are stamped only for admin-review
    transitions (approved, declined). Self-cancellation just updates `status`
    — it's not a review.
    """
    if status not in ALLOWED_TEACHER_JOIN_REQUEST_STATUSES:
        raise ValueError(f"Invalid status: {status!r}")
    updates: dict = {'status': status}
    if status in _REVIEW_STATUSES:
        if reviewed_by_uid is None:
            raise ValueError(
                "reviewed_by_uid is required for review transitions "
                f"(status={status!r})"
            )
        updates['reviewed_at'] = firestore.SERVER_TIMESTAMP
        updates['reviewed_by_uid'] = reviewed_by_uid
    if decline_reason is not None:
        updates['decline_reason'] = decline_reason
    get_teacher_join_requests_collection().document(request_id).update(updates)


# ── LTI platform CRUD ────────────────────────────────────────────────────


def get_lti_platforms_collection():
    """Get LTI platforms collection."""
    return get_db().collection('lti_platforms')


def create_lti_platform(
    org_id,
    issuer,
    client_id,
    deployment_id,
    auth_login_url,
    auth_token_url,
    key_set_url,
    platform_id=None,
):
    """Create an LTI 1.3 platform registration."""
    doc_ref = (
        get_lti_platforms_collection().document(platform_id)
        if platform_id
        else get_lti_platforms_collection().document()
    )
    platform_data = {
        'org_id': org_id,
        'issuer': issuer,
        'client_id': client_id,
        'deployment_id': deployment_id,
        'auth_login_url': auth_login_url,
        'auth_token_url': auth_token_url,
        'key_set_url': key_set_url,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(platform_data)
    return doc_ref.id


def get_lti_platform(platform_id):
    """Get an LTI platform by ID."""
    doc = get_lti_platforms_collection().document(platform_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def get_lti_platform_by_org(org_id):
    """Get the LTI platform for an organization (at most one per org)."""
    docs = (
        get_lti_platforms_collection()
        .where('org_id', '==', org_id)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def get_lti_platform_by_issuer(issuer):
    """Get the LTI platform for a given issuer URL."""
    docs = (
        get_lti_platforms_collection()
        .where('issuer', '==', issuer)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def get_lti_platform_by_issuer_and_client_id(issuer, client_id):
    """Get an LTI platform by issuer and client ID."""
    docs = (
        get_lti_platforms_collection()
        .where('issuer', '==', issuer)
        .where('client_id', '==', client_id)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def get_lti_platform_by_issuer_client_deployment(issuer, client_id, deployment_id):
    """Get an LTI platform by issuer, client ID, and deployment ID."""
    docs = (
        get_lti_platforms_collection()
        .where('issuer', '==', issuer)
        .where('client_id', '==', client_id)
        .where('deployment_id', '==', deployment_id)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def delete_lti_platform(platform_id):
    """Delete an LTI platform registration."""
    get_lti_platforms_collection().document(platform_id).delete()


# ── LTI session CRUD ─────────────────────────────────────────────────────


def get_lti_sessions_collection():
    """Get LTI sessions collection."""
    return get_db().collection('lti_sessions')


def create_lti_session(
    user_uid,
    platform_id,
    canvas_user_id,
    canvas_course_id,
    roles,
    access_token='',
    token_expires_at=None,
):
    """Create an LTI session record linking a Lingual user to an LTI launch."""
    doc_ref = get_lti_sessions_collection().document()
    session_data = {
        'user_uid': user_uid,
        'platform_id': platform_id,
        'canvas_user_id': str(canvas_user_id),
        'canvas_course_id': str(canvas_course_id),
        'roles': _normalize_string_list(roles) if isinstance(roles, list) else [roles] if roles else [],
        'access_token': access_token or '',
        'token_expires_at': token_expires_at,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(session_data)
    return doc_ref.id


def get_lti_session_for_user(user_uid, canvas_course_id):
    """Get the most recent LTI session for a user in a given Canvas course."""
    docs = (
        get_lti_sessions_collection()
        .where('user_uid', '==', user_uid)
        .where('canvas_course_id', '==', str(canvas_course_id))
        .order_by('created_at', direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None
