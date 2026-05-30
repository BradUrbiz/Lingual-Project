from flask import Blueprint, current_app, jsonify, request, session

from backend.route_deps import RouteDeps
from backend.services import email_verification
from database import ALLOWED_INTENDED_ROLES

ALLOWED_MIGRATE_ROLES = frozenset({'student', 'teacher', 'admin'})


def build_auth_user_payload(uid, email, name, school_context, email_verification_required=False):
    """Build the auth payload returned to the frontend."""
    return {
        'uid': uid,
        'email': email,
        'name': name,
        'memberships': school_context.get('memberships', []),
        'activeMembershipId': school_context.get('active_membership_id'),
        'activeOrganizationId': school_context.get('active_organization_id'),
        'activeRoles': school_context.get('active_roles', []),
        'intendedRole': school_context.get('intended_role'),
        'onboardingState': school_context.get('onboarding_state'),
        'requiresLegacyRolePick': bool(school_context.get('requires_legacy_role_pick')),
        'lingualAdmin': bool(school_context.get('lingual_admin')),
        'emailVerificationRequired': bool(email_verification_required),
    }


def _resolve_email_verification(deps, decoded_token, existing_user, uid, email, name):
    """Return True if this account must verify its email before using the app.

    Starts verification (and emails a code) only for brand-new accounts whose
    provider has not already verified the email — so Google (email_verified
    claim True) is auto-verified and existing accounts are never re-gated.
    """
    is_new_account = existing_user is None
    provider_verified = bool(decoded_token.get('email_verified'))

    if is_new_account and not provider_verified:
        try:
            code = email_verification.start_verification(deps.db, uid)
            email_verification.send_verification_code_email(email, name, code)
        except Exception as exc:  # delivery/start failure must not block signup
            print(f'[email-verification] start failed for {uid}: {exc}')
        return True

    return email_verification.is_pending(existing_user)


def create_auth_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('auth_routes', __name__)

    @bp.route('/api/auth/logout', methods=['POST'])
    def api_logout():
        """API endpoint to clear session."""
        session.clear()
        return jsonify({'success': True})

    @bp.route('/api/auth/verify', methods=['POST'])
    def verify_auth():
        """Verify Firebase ID token and create session."""
        try:
            # silent=True so a missing/invalid body returns None instead of
            # raising a Werkzeug HTTPException (415/400), which would get
            # caught by the broad `except Exception` below and remapped to 500.
            data = request.get_json(silent=True) or {}
            id_token = data.get('idToken')

            if not id_token:
                return jsonify({'success': False, 'error': 'No token provided'}), 400

            intended_role = data.get('intended_role')
            if intended_role and intended_role not in ALLOWED_INTENDED_ROLES:
                return jsonify({'success': False, 'error': 'Invalid intended_role'}), 400

            decoded_token = deps.firebase_auth.verify_id_token(id_token)
            uid = decoded_token['uid']
            email = decoded_token.get('email', '')
            name = decoded_token.get('name', email.split('@')[0] if email else 'User')

            existing_user = deps.db.get_user(uid)
            deps.db.get_or_create_user(uid, email, name)
            email_verification_required = _resolve_email_verification(
                deps, decoded_token, existing_user, uid, email, name,
            )

            if intended_role:
                # Persist only on first-time users — existing memberships always win.
                existing_context = deps.db.resolve_user_school_context(uid)
                has_active_membership = any(
                    (m or {}).get('status') == 'active'
                    for m in (existing_context.get('memberships') or [])
                )
                if not has_active_membership:
                    deps.db.update_user_profile(
                        uid,
                        intended_role=intended_role,
                        onboarding_state='role_selected',
                    )

            preferred_active_membership_id = (session.get('user') or {}).get('active_membership_id')
            school_context = deps.db.resolve_user_school_context(
                uid,
                preferred_active_membership_id=preferred_active_membership_id,
            )
            deps.db.set_user_last_active_membership(uid, school_context.get('active_membership_id'))

            session['user'] = {
                'uid': uid,
                'email': email,
                'name': name,
                'active_membership_id': school_context.get('active_membership_id'),
                'email_verified': not email_verification_required,
            }

            return jsonify({
                'success': True,
                'user': build_auth_user_payload(
                    uid, email, name, school_context, email_verification_required,
                ),
            })

        except deps.firebase_auth.InvalidIdTokenError:
            return jsonify({'success': False, 'error': 'Invalid token'}), 401
        except deps.firebase_auth.ExpiredIdTokenError:
            return jsonify({'success': False, 'error': 'Token expired'}), 401
        except Exception as e:
            print(f'Auth verification error: {e}')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/user/profile')
    @deps.login_required
    def api_user_profile():
        """Get user profile from database."""
        uid = deps.get_current_user_uid()
        user_data = deps.db.get_user(uid)

        if not user_data:
            return jsonify({'assessed': False, 'message': 'User not found'}), 404

        profile = user_data.get('profile', {})
        results = user_data.get('results')
        assessment = user_data.get('assessment', {})

        display_name = profile.get('display_name', '')
        age = profile.get('age')
        gender = profile.get('gender')
        rigor = profile.get('rigor')
        frequency = profile.get('frequency')
        frequency_unit = profile.get('frequency_unit')
        level_objective = profile.get('level_objective', '')
        avatar_url = profile.get('avatar_url', '')
        contact_email = profile.get('contact_email', '')
        grade_level = profile.get('grade_level', '')
        native_language = profile.get('native_language', '')
        learning_locale = profile.get('learning_locale', 'ko-KR')
        assessment_preference = profile.get('assessment_preference')
        location = profile.get('location', '')
        school_name = profile.get('school_name', '')
        selected_categories = user_data.get('selected_categories', [])

        is_assessed = assessment.get('completed', False) and results is not None
        profile_completed = bool(display_name and age and gender and rigor)

        base_response = {
            'profile_completed': profile_completed,
            'display_name': display_name,
            'age': age,
            'gender': gender,
            'rigor': rigor,
            'frequency': frequency,
            'frequency_unit': frequency_unit,
            'level_objective': level_objective,
            'selected_categories': selected_categories,
            'avatar_url': avatar_url,
            'contact_email': contact_email,
            'grade_level': grade_level,
            'native_language': native_language,
            'learning_locale': learning_locale,
            'assessment_preference': assessment_preference,
            'location': location,
            'school_name': school_name,
        }

        if not is_assessed:
            return jsonify({
                **base_response,
                'assessed': False,
                'message': 'Please complete the assessment first',
            })

        global_stage = results.get('global_stage', 0)

        proficiency_level = results.get('proficiency_level')
        proficiency_description = results.get('proficiency_description_en')
        if not proficiency_level or not proficiency_description:
            fallback_info = deps.get_proficiency_description(global_stage)
            proficiency_level = fallback_info['level']
            proficiency_description = fallback_info['description']

        return jsonify({
            **base_response,
            'assessed': True,
            'global_stage': global_stage,
            'framework': results.get('framework', 'ACTFL'),
            'proficiency_level': proficiency_level,
            'proficiency_description': proficiency_description,
            'actfl_level': results.get('actfl_level', proficiency_level),
            'actfl_description': results.get('actfl_description_en', proficiency_description),
            # Backward-compatible aliases for existing frontend consumers.
            'sklc_level': proficiency_level,
            'sklc_description': proficiency_description,
            'domain_bands': results.get('domain_bands', {}),
        })

    @bp.route('/api/auth/email-verification/confirm', methods=['POST'])
    def confirm_email_verification():
        user = session.get('user')
        if not user or not user.get('uid'):
            return jsonify({'success': False, 'error': 'Authentication required'}), 401

        data = request.get_json(silent=True) or {}
        code = str(data.get('code', '')).strip()
        result = email_verification.confirm(deps.db, user['uid'], code)

        if not result.ok:
            return jsonify({'success': False, 'error': result.error}), 400

        try:
            deps.firebase_auth.update_user(user['uid'], email_verified=True)
        except Exception as exc:  # best-effort sync; Firestore is authoritative
            print(f"[email-verification] firebase sync failed for {user['uid']}: {exc}")

        session['user']['email_verified'] = True
        session.modified = True
        return jsonify({'success': True})

    @bp.route('/api/auth/email-verification/resend', methods=['POST'])
    def resend_email_verification():
        user = session.get('user')
        if not user or not user.get('uid'):
            return jsonify({'success': False, 'error': 'Authentication required'}), 401

        result = email_verification.resend(deps.db, user['uid'])
        if not result.allowed:
            return jsonify({
                'success': False,
                'error': 'cooldown',
                'cooldownSeconds': result.cooldown_seconds,
            }), 429

        try:
            email_verification.send_verification_code_email(
                user.get('email', ''), user.get('name'), result.code,
            )
        except Exception as exc:
            print(f"[email-verification] resend enqueue failed for {user['uid']}: {exc}")

        return jsonify({'success': True, 'cooldownSeconds': result.cooldown_seconds})

    @bp.route('/api/set-language', methods=['POST'])
    def api_set_language():
        data = request.get_json() or {}
        lang = data.get('language', 'en')
        if lang in ['en', 'ko']:
            session['ui_language'] = lang

            uid = deps.get_current_user_uid()
            if uid:
                deps.db.update_user_profile(uid, ui_language=lang)

            return jsonify({'success': True, 'language': lang})
        return jsonify({'success': False, 'error': 'Invalid language'}), 400

    @bp.route('/api/profile', methods=['POST'])
    @deps.login_required
    def api_update_profile():
        """Update user profile information (JSON API)."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}

        display_name = data.get('displayName')
        age = data.get('age')
        gender = data.get('gender')
        rigor = data.get('rigor')
        frequency = data.get('frequency')
        frequency_unit = data.get('frequencyUnit')
        level_objective = data.get('levelObjective')
        assessment_preference = data.get('assessmentPreference')
        avatar_url = data.get('avatarUrl')
        contact_email = data.get('contactEmail')
        grade_level = data.get('gradeLevel')
        native_language = data.get('nativeLanguage')
        learning_locale = data.get('learningLocale')
        location = data.get('location')
        school_name = data.get('schoolName')
        is_edit = data.get('isEdit', False)

        if learning_locale and learning_locale not in deps.allowed_learning_locales:
            return jsonify({'success': False, 'error': 'Invalid learning locale'}), 400
        if assessment_preference and assessment_preference not in {'take', 'skip'}:
            return jsonify({'success': False, 'error': 'Invalid assessment preference'}), 400

        deps.db.update_user_profile(
            uid,
            display_name=display_name,
            age=age,
            gender=gender,
            rigor=rigor,
            frequency=frequency,
            frequency_unit=frequency_unit,
            level_objective=level_objective,
            assessment_preference=assessment_preference,
            avatar_url=avatar_url,
            contact_email=contact_email,
            grade_level=grade_level,
            native_language=native_language,
            learning_locale=learning_locale,
            location=location,
            school_name=school_name,
        )

        if not is_edit:
            deps.db.reset_assessment(uid)

        return jsonify({
            'success': True,
            'profile': {
                'displayName': display_name,
                'age': age,
                'gender': gender,
                'rigor': rigor,
                'frequency': frequency,
                'frequencyUnit': frequency_unit,
                'levelObjective': level_objective,
                'assessmentPreference': assessment_preference,
                'avatarUrl': avatar_url,
                'contactEmail': contact_email,
                'gradeLevel': grade_level,
                'nativeLanguage': native_language,
                'learningLocale': learning_locale or 'ko-KR',
                'location': location,
                'schoolName': school_name,
            },
        })

    @bp.route('/api/onboarding/initial', methods=['POST'])
    @deps.login_required
    def api_initial_onboarding():
        """Save initial onboarding choices (learning locale + assessment choice)."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}

        learning_locale = data.get('learningLocale')
        assessment_preference = data.get('assessmentPreference')

        if learning_locale and learning_locale not in deps.allowed_learning_locales:
            return jsonify({'success': False, 'error': 'Invalid learning locale'}), 400
        if assessment_preference not in {'take', 'skip'}:
            return jsonify({'success': False, 'error': 'Invalid assessment preference'}), 400

        # Keep onboarding decision explicit and clear stale results/progress.
        deps.db.update_user_profile(
            uid,
            learning_locale=learning_locale,
            assessment_preference=assessment_preference,
        )
        deps.db.reset_assessment(uid)

        return jsonify({
            'success': True,
            'learningLocale': learning_locale,
            'assessmentPreference': assessment_preference,
        })

    @bp.post('/api/auth/migrate-role')
    @deps.login_required
    def migrate_role():
        """Legacy user role pick — idempotent. Non-legacy users are a no-op 200."""
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'error': 'unauthenticated'}), 401

        body = request.get_json(silent=True) or {}
        raw_role = body.get('role')
        if raw_role is None:
            return jsonify({'error': 'role is required'}), 400
        if not isinstance(raw_role, str):
            return jsonify({'error': 'role must be a string'}), 400
        role = raw_role.strip()
        if not role:
            return jsonify({'error': 'role is required'}), 400
        if role not in ALLOWED_MIGRATE_ROLES:
            return jsonify({'error': f'invalid role {role!r}'}), 400

        user_doc = deps.db.get_user(uid)
        memberships = deps.db.get_user_memberships(uid)

        # `is_legacy_user_needing_role_pick` is a pure function (Plan 1) — import
        # directly so the route does not rely on a fake method existing on
        # `deps.db`. State-changing helpers still live behind `deps.db`.
        from database import is_legacy_user_needing_role_pick
        if is_legacy_user_needing_role_pick(user_doc, memberships):
            try:
                deps.db.mark_user_legacy_role_picked(uid=uid, role=role)
            except ValueError as exc:
                return jsonify({'error': str(exc)}), 400
            current_app.logger.info('[legacy_role_pick] uid=%s role=%s', uid, role)
            user_doc = deps.db.get_user(uid) or {}

        profile = (user_doc or {}).get('profile') or {}
        return jsonify({
            'intendedRole': profile.get('intended_role'),
            'onboardingState': profile.get('onboarding_state'),
        }), 200

    return bp
