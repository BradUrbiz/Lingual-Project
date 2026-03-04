from flask import Blueprint, jsonify, request, session

from backend.route_deps import RouteDeps


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

            session['user'] = {
                'uid': uid,
                'email': email,
                'name': name,
            }

            deps.db.get_or_create_user(uid, email, name)
            return jsonify({'success': True, 'user': session['user']})

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
        sklc_info = deps.get_sklc_description(global_stage)

        return jsonify({
            **base_response,
            'assessed': True,
            'global_stage': global_stage,
            'sklc_level': sklc_info['level'],
            'sklc_description': sklc_info['description'],
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

        deps.db.update_user_profile(
            uid,
            display_name=display_name,
            age=age,
            gender=gender,
            rigor=rigor,
            frequency=frequency,
            frequency_unit=frequency_unit,
            level_objective=level_objective,
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
                'avatarUrl': avatar_url,
                'contactEmail': contact_email,
                'gradeLevel': grade_level,
                'nativeLanguage': native_language,
                'learningLocale': learning_locale or 'ko-KR',
                'location': location,
                'schoolName': school_name,
            },
        })

    return bp
