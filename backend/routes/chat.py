import os

import requests
from flask import Blueprint, jsonify, request, session

from backend.route_deps import RouteDeps


def create_chat_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('chat_routes', __name__)

    @bp.route('/api/curriculum/sample', methods=['GET'])
    @deps.login_required
    def api_get_sample_curriculum():
        """Serve the sample AP French curriculum package."""
        try:
            package = deps.load_sample_curriculum_package()
            return jsonify({'success': True, 'package': package})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/realtime/session', methods=['POST'])
    @deps.login_required
    def create_realtime_session():
        """Create ephemeral token for OpenAI Realtime API."""
        try:
            api_key = os.environ.get('OPENAI_API_KEY')
            if not api_key:
                return jsonify({'error': 'OpenAI API key not configured'}), 500

            payload = request.get_json(silent=True) or {}
            ui_language = payload.get('uiLanguage', 'en')
            if ui_language not in deps.supported_ui_languages:
                ui_language = 'en'

            practice = payload.get('practice')
            if isinstance(practice, dict) and practice.get('type') == 'curriculum_module':
                curriculum_id = practice.get('curriculumId')
                module_id = practice.get('moduleId')
                situation_id = practice.get('situationId')

                if not module_id or not situation_id:
                    return jsonify({
                        'success': False,
                        'error': 'moduleId and situationId are required for curriculum practice.',
                    }), 400

                package = deps.load_sample_curriculum_package()
                sample_curriculum_id = package.get('curriculum', {}).get('id')
                if curriculum_id and curriculum_id != sample_curriculum_id:
                    return jsonify({'success': False, 'error': 'Unsupported curriculumId.'}), 400

                try:
                    package, unit, module, situation, mode, objectives = deps.get_curriculum_practice_context(
                        module_id=module_id,
                        situation_id=situation_id,
                    )
                except ValueError as e:
                    return jsonify({'success': False, 'error': str(e)}), 400

                system_instructions = deps.build_curriculum_system_prompt(
                    package=package,
                    unit=unit,
                    module=module,
                    situation=situation,
                    mode=mode,
                    objectives=objectives,
                    ui_language=ui_language,
                )
            else:
                proficiency_context = deps.get_user_proficiency_context()
                system_instructions = deps.build_system_prompt(proficiency_context)

            response = requests.post(
                'https://api.openai.com/v1/realtime/sessions',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': 'gpt-realtime-mini',
                    'voice': 'coral',
                    'instructions': system_instructions,
                    'input_audio_transcription': {'model': 'whisper-1'},
                    'turn_detection': {
                        'type': 'server_vad',
                        'threshold': 0.5,
                        'prefix_padding_ms': 300,
                        'silence_duration_ms': 500,
                    },
                },
            )

            if response.status_code != 200:
                return jsonify({
                    'error': f'Failed to create session: {response.text}',
                    'success': False,
                }), response.status_code

            data = response.json()
            return jsonify({
                'success': True,
                'client_secret': data.get('client_secret', {}).get('value'),
                'session_id': data.get('id'),
                'expires_at': data.get('client_secret', {}).get('expires_at'),
            })

        except Exception as e:
            return jsonify({'error': str(e), 'success': False}), 500

    @bp.route('/api/chat', methods=['POST'])
    @deps.login_required
    def api_chat():
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}
        user_message = data.get('message', '').strip()

        if not user_message:
            return jsonify({'error': 'Message is required'}), 400

        if not os.environ.get('OPENAI_API_KEY'):
            return jsonify({'error': 'OpenAI API key not configured'}), 500

        chat_history = deps.db.get_chat_history(uid, limit=20)
        proficiency_context = deps.get_user_proficiency_context()
        system_prompt = deps.build_system_prompt(proficiency_context)

        messages = [{'role': 'system', 'content': system_prompt}]
        for msg in chat_history[-10:]:
            messages.append({'role': msg['role'], 'content': msg['content']})
        messages.append({'role': 'user', 'content': user_message})

        try:
            client = deps.get_openai_client()
            if not client:
                return jsonify({'error': 'OpenAI API key not configured', 'success': False}), 500

            response = client.chat.completions.create(
                model='gpt-4o-mini',
                messages=messages,
                max_tokens=500,
                temperature=0.7,
            )

            assistant_message = response.choices[0].message.content
            deps.db.append_chat_message(uid, 'user', user_message)
            deps.db.append_chat_message(uid, 'assistant', assistant_message)

            return jsonify({'response': assistant_message, 'success': True})

        except Exception as e:
            return jsonify({'error': str(e), 'success': False}), 500

    @bp.route('/api/chat/reset', methods=['POST'])
    @deps.login_required
    def api_chat_reset():
        uid = deps.get_current_user_uid()
        session.pop('chat_history', None)
        deps.db.clear_chat_history(uid)
        return jsonify({'success': True, 'message': 'Chat history cleared'})

    @bp.route('/api/chats', methods=['GET'])
    @deps.login_required
    def api_get_chats():
        """Get all chat sessions for the user."""
        uid = deps.get_current_user_uid()
        try:
            sessions = deps.db.get_chat_sessions(uid)
            return jsonify({'success': True, 'chats': sessions})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/chats', methods=['POST'])
    @deps.login_required
    def api_create_chat():
        """Create a new chat session."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}
        title = data.get('title', 'New Chat')

        try:
            chat_id = deps.db.create_chat_session(uid, title)
            return jsonify({'success': True, 'chatId': chat_id, 'title': title})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/chats/<chat_id>', methods=['GET'])
    @deps.login_required
    def api_get_chat(chat_id):
        """Get a specific chat session with messages."""
        uid = deps.get_current_user_uid()
        try:
            chat = deps.db.get_chat_session(uid, chat_id)
            if not chat:
                return jsonify({'success': False, 'error': 'Chat not found'}), 404
            return jsonify({'success': True, 'chat': chat})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/chats/<chat_id>', methods=['DELETE'])
    @deps.login_required
    def api_delete_chat(chat_id):
        """Delete a chat session."""
        uid = deps.get_current_user_uid()
        try:
            deps.db.delete_chat_session(uid, chat_id)
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/chats/<chat_id>/title', methods=['PUT'])
    @deps.login_required
    def api_update_chat_title(chat_id):
        """Update a chat session's title."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}
        title = data.get('title')

        if not title:
            return jsonify({'success': False, 'error': 'Title is required'}), 400

        try:
            deps.db.update_chat_title(uid, chat_id, title)
            return jsonify({'success': True, 'title': title})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/chats/<chat_id>/messages/save', methods=['POST'])
    @deps.login_required
    def api_save_message(chat_id):
        """Save a single message to a chat (no AI response). Used for realtime chat."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}
        role = data.get('role', '').strip()
        content = data.get('content', '').strip()

        if not role or role not in ['user', 'assistant']:
            return jsonify({'success': False, 'error': 'Invalid role'}), 400

        if not content:
            return jsonify({'success': False, 'error': 'Content is required'}), 400

        try:
            chat = deps.db.get_chat_session(uid, chat_id)
            if not chat:
                return jsonify({'success': False, 'error': 'Chat not found'}), 404

            message = deps.db.add_message_to_chat(uid, chat_id, role, content)

            chat_messages = chat.get('messages', [])
            if len(chat_messages) == 0 and role == 'user':
                try:
                    client = deps.get_openai_client()
                    if client:
                        title_response = client.chat.completions.create(
                            model='gpt-4o-mini',
                            messages=[
                                {
                                    'role': 'system',
                                    'content': 'Generate a very brief chat title (max 30 characters) in the same language as the user\'s message. Just return the title, nothing else. No quotes.',
                                },
                                {'role': 'user', 'content': f'User message: {content}'},
                            ],
                            max_tokens=30,
                            temperature=0.5,
                        )
                        title = title_response.choices[0].message.content.strip()[:40]
                        deps.db.update_chat_title(uid, chat_id, title)
                except Exception:
                    title = content[:30] + ('...' if len(content) > 30 else '')
                    deps.db.update_chat_title(uid, chat_id, title)

            return jsonify({'success': True, 'message': message})

        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/chats/<chat_id>/messages', methods=['POST'])
    @deps.login_required
    def api_send_chat_message(chat_id):
        """Send a message in a specific chat session."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}
        user_message = data.get('message', '').strip()

        if not user_message:
            return jsonify({'success': False, 'error': 'Message is required'}), 400

        if not os.environ.get('OPENAI_API_KEY'):
            return jsonify({'success': False, 'error': 'OpenAI API key not configured'}), 500

        try:
            chat = deps.db.get_chat_session(uid, chat_id)
            if not chat:
                return jsonify({'success': False, 'error': 'Chat not found'}), 404

            chat_messages = chat.get('messages', [])
            proficiency_context = deps.get_user_proficiency_context()
            system_prompt = deps.build_system_prompt(proficiency_context)

            messages = [{'role': 'system', 'content': system_prompt}]
            for msg in chat_messages[-10:]:
                messages.append({'role': msg['role'], 'content': msg['content']})
            messages.append({'role': 'user', 'content': user_message})

            client = deps.get_openai_client()
            if not client:
                return jsonify({'success': False, 'error': 'OpenAI client not initialized'}), 500

            response = client.chat.completions.create(
                model='gpt-4o-mini',
                messages=messages,
                max_tokens=500,
                temperature=0.7,
            )

            assistant_message = response.choices[0].message.content
            user_msg = deps.db.add_message_to_chat(uid, chat_id, 'user', user_message)
            assistant_msg = deps.db.add_message_to_chat(uid, chat_id, 'assistant', assistant_message)

            if len(chat_messages) == 0:
                try:
                    title_response = client.chat.completions.create(
                        model='gpt-4o-mini',
                        messages=[
                            {
                                'role': 'system',
                                'content': 'Generate a very brief chat title (max 30 characters) in the same language as the user\'s message. Just return the title, nothing else. No quotes.',
                            },
                            {
                                'role': 'user',
                                'content': f'User: {user_message}\nAssistant: {assistant_message[:200]}',
                            },
                        ],
                        max_tokens=30,
                        temperature=0.5,
                    )
                    title = title_response.choices[0].message.content.strip()[:40]
                except Exception:
                    title = user_message[:30] + ('...' if len(user_message) > 30 else '')
                deps.db.update_chat_title(uid, chat_id, title)

            return jsonify({
                'success': True,
                'response': assistant_message,
                'userMessage': user_msg,
                'assistantMessage': assistant_msg,
            })

        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    return bp
