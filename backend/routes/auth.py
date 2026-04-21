from flask import Blueprint, jsonify, request, session

from backend.route_deps import RouteDeps


def build_auth_user_payload(uid, email, name, school_context):
    """Build the auth payload returned to the frontend."""
    return {
        'uid': uid,
        'email': email,
        'name': name,
        'memberships': school_context.get('memberships', []),
        'activeMembershipId': school_context.get('active_membership_id'),
        'activeOrganizationId': school_context.get('active_organization_id'),
        'activeRoles': school_context.get('active_roles', []),
    }


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
            data = request.get_json() or {}
            id_token = data.get('idToken')

            if not id_token:
                return jsonify({'success': False, 'error': 'No token provided'}), 400

            decoded_token = deps.firebase_auth.verify_id_token(id_token)
            uid = decoded_token['uid']
            email = decoded_token.get('email', '')
            name = decoded_token.get('name', email.split('@')[0] if email else 'User')

            deps.db.get_or_create_user(uid, email, name)

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
            }

            return jsonify({
                'success': True,
                'user': build_auth_user_payload(uid, email, name, school_context),
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

    return bp
