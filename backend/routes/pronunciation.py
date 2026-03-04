import os
from datetime import datetime, timedelta

import requests
from flask import Blueprint, current_app, jsonify, request

from backend.route_deps import RouteDeps


def create_pronunciation_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('pronunciation_routes', __name__)

    @bp.route('/api/azure/speech-token', methods=['POST'])
    @deps.login_required
    def api_speech_token():
        """Issue a short-lived Azure Speech token for the browser SDK."""
        speech_key = (os.environ.get('AZURE_SPEECH_KEY') or os.environ.get('SPEECH_KEY') or '').strip()
        speech_region = (os.environ.get('AZURE_SPEECH_REGION') or os.environ.get('SPEECH_REGION') or '').strip()

        if not speech_key or not speech_region:
            missing = []
            if not speech_key:
                missing.append('AZURE_SPEECH_KEY')
            if not speech_region:
                missing.append('AZURE_SPEECH_REGION')
            missing_text = ', '.join(missing)
            return jsonify({
                'success': False,
                'error': f'Azure Speech credentials not configured ({missing_text})',
            }), 500

        try:
            response = requests.post(
                f'https://{speech_region}.api.cognitive.microsoft.com/sts/v1.0/issueToken',
                headers={'Ocp-Apim-Subscription-Key': speech_key},
                timeout=10,
            )
            if response.status_code != 200:
                current_app.logger.warning(
                    'Azure speech token request failed with status %s: %s',
                    response.status_code,
                    response.text[:300],
                )
                return jsonify({
                    'success': False,
                    'error': 'Failed to issue Azure Speech token',
                    'provider_error': response.text[:300],
                }), response.status_code

            expires_at = (datetime.utcnow() + timedelta(minutes=9)).isoformat() + 'Z'
            return jsonify({
                'success': True,
                'token': response.text,
                'region': speech_region,
                'expires_at': expires_at,
            })
        except requests.RequestException as e:
            current_app.logger.exception('Azure speech token request exception: %s', e)
            return jsonify({
                'success': False,
                'error': 'Azure Speech service request failed. Please try again shortly.',
            }), 502
        except Exception as e:
            current_app.logger.exception('Unexpected error issuing Azure speech token: %s', e)
            return jsonify({'success': False, 'error': 'Failed to issue Azure Speech token'}), 500

    @bp.route('/api/pronunciation/sessions', methods=['POST'])
    @deps.login_required
    def api_create_pronunciation_session():
        """Create a pronunciation practice session."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}

        locale = data.get('locale', 'ko-KR')
        kind = data.get('kind', 'practice')
        prompt_set_id = data.get('promptSetId')
        objective_id = data.get('objectiveId')

        if locale not in deps.allowed_learning_locales:
            return jsonify({'success': False, 'error': 'Invalid locale'}), 400

        try:
            session_id = deps.db.create_pronunciation_session(uid, locale, kind, prompt_set_id, objective_id)
            return jsonify({'success': True, 'sessionId': session_id})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/pronunciation/attempts', methods=['POST'])
    @deps.login_required
    def api_save_pronunciation_attempt():
        """Save a pronunciation assessment attempt."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}

        session_id = data.get('sessionId')
        prompt_id = data.get('promptId')
        reference_text = data.get('referenceText')
        recognized_text = data.get('recognizedText', '')
        locale = data.get('locale')
        objective_id = data.get('objectiveId')
        scores = data.get('scores', {})
        words = data.get('words', [])
        raw_result = data.get('rawResult')
        audio_url = data.get('audioUrl')

        if not session_id:
            return jsonify({'success': False, 'error': 'sessionId is required'}), 400
        if not prompt_id:
            return jsonify({'success': False, 'error': 'promptId is required'}), 400
        if not reference_text:
            return jsonify({'success': False, 'error': 'referenceText is required'}), 400
        if not locale or locale not in deps.allowed_learning_locales:
            return jsonify({'success': False, 'error': 'Invalid locale'}), 400

        try:
            session = deps.db.get_pronunciation_session(uid, session_id)
            if not session:
                return jsonify({'success': False, 'error': 'Session not found'}), 404

            attempt_id = deps.db.add_pronunciation_attempt(uid, session_id, {
                'prompt_id': prompt_id,
                'objective_id': objective_id,
                'reference_text': reference_text,
                'recognized_text': recognized_text,
                'locale': locale,
                'scores': scores,
                'words': words,
                'raw_result': raw_result,
                'audio_url': audio_url,
            })
            return jsonify({'success': True, 'attemptId': attempt_id})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/pronunciation/sessions/<session_id>/attempts', methods=['GET'])
    @deps.login_required
    def api_get_pronunciation_attempts(session_id):
        """Get pronunciation attempts for a session."""
        uid = deps.get_current_user_uid()
        objective_id = request.args.get('objectiveId')
        try:
            session = deps.db.get_pronunciation_session(uid, session_id)
            if not session:
                return jsonify({'success': False, 'error': 'Session not found'}), 404

            attempts = deps.db.get_pronunciation_attempts(uid, session_id, limit=50, objective_id=objective_id)
            return jsonify({'success': True, 'attempts': attempts})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    return bp
