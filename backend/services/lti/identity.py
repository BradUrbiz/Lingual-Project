"""
LTI identity matching and auto-enrollment.

Maps an LTI launch (issuer + email + Canvas roles) to an existing Lingual
user and ensures the student is enrolled in the appropriate class.
"""

from firebase_admin import firestore as _firestore

from backend.services.compliance import auto_grant_voice_consent_for_pilot


def build_lti_identity_key(issuer: str, client_id: str, canvas_user_id: str) -> str:
    """Build the deterministic user index key for an LTI platform identity."""
    return f'{issuer}|{client_id or ""}|{canvas_user_id}'


def resolve_lti_platform(db, *, issuer, client_id='', deployment_id=''):
    """Resolve an LTI platform without collapsing shared Canvas issuers."""
    if issuer and client_id and deployment_id and hasattr(db, 'get_lti_platform_by_issuer_client_deployment'):
        platform = db.get_lti_platform_by_issuer_client_deployment(issuer, client_id, deployment_id)
        if platform:
            return platform
    if issuer and client_id and hasattr(db, 'get_lti_platform_by_issuer_and_client_id'):
        platform = db.get_lti_platform_by_issuer_and_client_id(issuer, client_id)
        if platform:
            return platform
    if issuer and not client_id and hasattr(db, 'get_lti_platform_by_issuer'):
        return db.get_lti_platform_by_issuer(issuer)
    return None


def _find_user_by_lti_identity(db, *, issuer, client_id, canvas_user_id):
    if not issuer or not canvas_user_id:
        return None
    if hasattr(db, 'get_user_by_lti_identity'):
        user = db.get_user_by_lti_identity(issuer, canvas_user_id, client_id or '')
        if user:
            return user
    return None


def match_lti_user(db, *, issuer, email, canvas_user_id, roles, client_id='', deployment_id=''):
    """Match an LTI launch to a Lingual user account.

    Steps:
      1. Look up the LTI platform by issuer + client_id/deployment_id to get
         the org_id.
      2. Find the Lingual user by stored LTI identity, then by ``email``.
      3. Verify the user holds an active/invited membership in that org.
      4. Determine role: "teacher" if any role string contains "Instructor",
         otherwise "student".

    Args:
        db: The ``database`` module.
        issuer: The LTI platform issuer URL.
        email: The user's email address from the LTI launch.
        canvas_user_id: The user's ID on Canvas.
        roles: List of LTI role URIs/strings.
        client_id: The Canvas developer-key client ID from the launch.
        deployment_id: The LTI deployment ID from the launch.

    Returns:
        A dict with ``uid``, ``email``, ``membership_id``, ``org_id``,
        ``platform_id``, and ``role`` — or ``None`` if no match.
    """
    # 1. Find platform by issuer + client/deployment where possible.
    platform = resolve_lti_platform(
        db,
        issuer=issuer,
        client_id=client_id,
        deployment_id=deployment_id,
    )
    if not platform:
        return None
    org_id = platform.get('org_id')
    platform_id = platform.get('id')

    # 2. Find linked user first; email is not stable across Canvas accounts.
    user = _find_user_by_lti_identity(
        db,
        issuer=issuer,
        client_id=client_id or platform.get('client_id', ''),
        canvas_user_id=canvas_user_id,
    )
    if not user:
        user = db.get_user_by_email(email)
    if not user:
        return None
    uid = user.get('uid')

    # 3. Check user has membership in the org
    memberships = db.get_user_memberships(uid)
    matching_membership = None
    for m in memberships:
        if m.get('orgId') == org_id:
            matching_membership = m
            break

    if not matching_membership:
        return None

    # 4. Determine role from LTI role URIs
    role = 'student'
    roles_list = roles if isinstance(roles, list) else [roles] if roles else []
    for r in roles_list:
        if 'Instructor' in str(r):
            role = 'teacher'
            break

    return {
        'uid': uid,
        'email': email,
        'membership_id': matching_membership.get('id'),
        'org_id': org_id,
        'platform_id': platform_id,
        'role': role,
    }


def auto_enroll_student(db, *, uid, org_id, class_id, membership_id='', sql_engine=None):
    """Ensure a student is enrolled in a class, creating membership and
    enrollment records as needed.

    Steps:
      1. Ensure a student membership exists (deterministic ID ``{org_id}_{uid}``).
         If one already exists, reuse it. Otherwise create one.
      2. Add ``class_id`` to the membership's ``primaryClassIds`` if missing.
      3. Ensure an enrollment record exists. Reactivate if inactive, create if absent.
      4. Set ``join_source`` to ``'lti'``.

    Args:
        db: The ``database`` module.
        uid: The student's Lingual uid.
        org_id: The organization ID.
        class_id: The class to enroll into.
        membership_id: An existing membership ID to reuse. If empty, a
            deterministic ID ``{org_id}_{uid}`` is used.
        sql_engine: deps.sql_engine — opts the enrollment writes into the
            fail-open Postgres dual-write (slice 2b). None disables shadowing.

    Returns:
        The enrollment ID.
    """
    # 1. Ensure student membership exists
    deterministic_membership_id = membership_id or f'{org_id}_{uid}'

    existing_membership = db.get_membership(deterministic_membership_id)
    if existing_membership:
        actual_membership_id = existing_membership.get('id', deterministic_membership_id)
    else:
        actual_membership_id = db.create_membership(
            org_id=org_id,
            uid=uid,
            roles=['student'],
            status='active',
            primary_class_ids=[class_id],
            membership_id=deterministic_membership_id,
            sql_engine=sql_engine,
        )

    # 2. Add class to membership's primaryClassIds if not already present
    membership_doc = db.get_membership(actual_membership_id)
    if membership_doc:
        existing_class_ids = membership_doc.get('primary_class_ids', [])
        if class_id not in existing_class_ids:
            # This ArrayUnion is a MEMBERSHIP write that bypasses the database.py
            # helpers, so its Postgres shadow (slice 2c-3) is wired explicitly.
            db.get_membership_ref(actual_membership_id).update({
                'primary_class_ids': _firestore.ArrayUnion([class_id]),
                'updated_at': _firestore.SERVER_TIMESTAMP,
            })
            if sql_engine is not None:
                from backend.db import dual_write_school_chain as _sc
                _sc.shadow_add_primary_class(
                    sql_engine, membership_id=actual_membership_id, class_id=class_id
                )

    # 3. Ensure enrollment exists
    existing_enrollment = db.get_student_class_enrollment(class_id, uid)
    if existing_enrollment:
        enrollment_id = existing_enrollment.get('id')
        if existing_enrollment.get('status') == 'inactive':
            # Reactivate and update join_source (a DIRECT ref update that bypasses
            # the database.py helpers, so its shadow is wired explicitly here).
            db.get_enrollment_ref(enrollment_id).update({
                'status': 'active',
                'join_source': 'lti',
                'student_membership_id': actual_membership_id,
                'updated_at': _firestore.SERVER_TIMESTAMP,
            })
            if sql_engine is not None:
                from backend.db import dual_write
                dual_write.shadow_lti_reactivate(
                    sql_engine,
                    class_id=class_id,
                    student_uid=uid,
                    student_membership_id=actual_membership_id,
                )
        return enrollment_id

    # Create new enrollment with join_source = 'lti'
    enrollment_id = db.create_enrollment(
        class_id=class_id,
        student_uid=uid,
        student_membership_id=actual_membership_id,
        status='active',
        join_source='lti',
        sql_engine=sql_engine,
    )
    # Pilot: auto-grant voice + guardian consent on enrollment.
    auto_grant_voice_consent_for_pilot(db, org_id=org_id, student_uid=uid)

    return enrollment_id
