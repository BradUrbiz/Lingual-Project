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
        - learning_locale: str ('ko-KR', 'es-ES', 'fr-FR')
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
    - status: str
    - join_source: str
    - student_number: str (optional)
    - guardian_contact_required: bool
    - created_at: timestamp
    - updated_at: timestamp

- curriculum_mappings/{mapping_id}
    - org_id: str
    - class_id: str
    - package_id: str
    - module_id: str
    - objective_ids: list[str]
    - situation_ids: list[str]
    - target_expressions: list[str]
    - focus_grammar: list[str]
    - allowed_context_tags: list[str]
    - feedback_policy: dict
    - scaffold_policy: dict
    - modality_policy: dict
    - rubric_focus: list[str]
    - teacher_notes: str
    - created_by_uid: str
    - created_at: timestamp
    - updated_at: timestamp

- assignments/{assignment_id}
    - org_id: str
    - class_id: str
    - mapping_id: str
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


def get_curriculum_mappings_collection():
    """Get curriculum mappings collection."""
    return get_db().collection('curriculum_mappings')


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


def get_curriculum_mapping_ref(mapping_id):
    """Get curriculum mapping document reference."""
    return get_curriculum_mappings_collection().document(mapping_id)


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


def update_user_profile(uid, display_name=None, age=None, gender=None,
                        rigor=None, frequency=None, frequency_unit=None,
                        level_objective=None, assessment_preference=None,
                        ui_language=None, learning_locale=None,
                        avatar_url=None, contact_email=None, grade_level=None,
                        native_language=None, location=None, school_name=None):
    """Update user profile fields."""
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
    membership_data = {
        'org_id': org_id,
        'uid': uid,
        'roles': _normalize_string_list(roles),
        'status': status,
        'primary_class_ids': _normalize_string_list(primary_class_ids or []),
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(membership_data)
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

    return {
        'memberships': memberships,
        'active_membership': active_membership,
        'active_membership_id': active_membership.get('id') if active_membership else None,
        'active_organization_id': active_membership.get('orgId') if active_membership else None,
        'active_roles': active_roles,
    }


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


def create_curriculum_mapping(
    org_id,
    class_id,
    package_id,
    module_id,
    objective_ids=None,
    situation_ids=None,
    target_expressions=None,
    focus_grammar=None,
    allowed_context_tags=None,
    feedback_policy=None,
    scaffold_policy=None,
    output_policy=None,
    modality_policy=None,
    rubric_focus=None,
    teacher_notes='',
    created_by_uid='',
    mapping_id=None,
):
    """Create a curriculum mapping document."""
    doc_ref = get_curriculum_mapping_ref(mapping_id) if mapping_id else get_curriculum_mappings_collection().document()
    mapping_data = {
        'org_id': org_id,
        'class_id': class_id,
        'package_id': package_id,
        'module_id': module_id,
        'objective_ids': _normalize_string_list(objective_ids or []),
        'situation_ids': _normalize_string_list(situation_ids or []),
        'target_expressions': _normalize_string_list(target_expressions or []),
        'focus_grammar': _normalize_string_list(focus_grammar or []),
        'allowed_context_tags': _normalize_string_list(allowed_context_tags or []),
        'feedback_policy': feedback_policy or {},
        'scaffold_policy': scaffold_policy or {},
        'output_policy': output_policy or {},
        'modality_policy': modality_policy or {},
        'rubric_focus': _normalize_string_list(rubric_focus or []),
        'teacher_notes': teacher_notes or '',
        'created_by_uid': created_by_uid,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(mapping_data)
    return doc_ref.id


def get_curriculum_mapping(mapping_id):
    """Get a curriculum mapping by id."""
    doc = get_curriculum_mapping_ref(mapping_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data['id'] = doc.id
    return data


def list_class_curriculum_mappings(class_id):
    """List curriculum mappings for a class."""
    docs = get_curriculum_mappings_collection().where('class_id', '==', class_id).stream()
    mappings = []
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        mappings.append(data)
    return mappings


def create_assignment(
    org_id,
    class_id,
    mapping_id,
    title,
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
):
    """Create an assignment document."""
    doc_ref = get_assignment_ref(assignment_id) if assignment_id else get_assignments_collection().document()
    assignment_data = {
        'org_id': org_id,
        'class_id': class_id,
        'mapping_id': mapping_id,
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
    if not enrollment_doc.exists:
        return None
    data = enrollment_doc.to_dict() or {}
    data['id'] = enrollment_doc.id
    return data


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
        'messages': []
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
            'last_message': last_message.get('content', '')[:50] if last_message else None
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
            'messages': messages
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

    by_game = {}
    for attempt in attempts:
        game_type = attempt.get('gameType') or 'unknown'
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
