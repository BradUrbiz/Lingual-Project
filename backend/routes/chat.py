import os
from typing import Any

import requests
from flask import Blueprint, jsonify, request
from openai import APIStatusError, RateLimitError

from backend.route_deps import RouteDeps
from backend.services.assignment_resolver import (
    build_assignment_system_prompt,
    resolve_assignment_bootstrap_for_user,
)


AVATAR_EMOTION_KEYS = [
    'neutral',
    'anger',
    'disgust',
    'fear',
    'joy',
    'smirk',
    'sadness',
    'surprise',
]

AVATAR_EXPRESSION_IDS = [
    'neutral_primary',
    'neutral_soft',
    'warm_smile',
    'warm_bright',
    'curious_lift',
    'curious_smile',
    'corrective_focus',
    'corrective_soft',
    'apology_soft',
    'surprised_open',
    'playful_smirk',
    'affirm_soft',
]

AVATAR_MOTION_REFS = [
    'idle_base',
    'listening_attentive',
    'thinking_soft',
    'speaking_base',
    'speaking_question',
    'speaking_affirm',
    'speaking_corrective',
    'speaking_apology',
    'react_head_curious',
    'react_face_curious',
    'react_body_affirm',
    'post_speaking_soft',
]

AVATAR_REACTION_INTENTS = [
    'none',
    'tap_head_notice',
    'tap_face_focus',
    'tap_body_affirm',
    'tap_hand_wave',
    'tap_chest_reassure',
]


def build_avatar_directive_tool() -> dict[str, Any]:
    return {
        'type': 'function',
        'name': 'emit_avatar_directive',
        'description': 'Emit a non-spoken Live2D avatar acting directive for the current tutor turn.',
        'parameters': {
            'type': 'object',
            'properties': {
                'emotionKey': {'type': 'string', 'enum': AVATAR_EMOTION_KEYS},
                'expressionId': {'type': 'string', 'enum': AVATAR_EXPRESSION_IDS},
                'motionRef': {'type': 'string', 'enum': AVATAR_MOTION_REFS},
                'reactionIntent': {'type': 'string', 'enum': AVATAR_REACTION_INTENTS},
                'intensity': {'type': 'number', 'minimum': 0, 'maximum': 1},
                'holdMs': {'type': 'integer', 'minimum': 120, 'maximum': 4000},
                'subtitleText': {'type': 'string'},
            },
            'additionalProperties': False,
        },
    }


def build_avatar_realtime_instructions() -> str:
    return """

Avatar acting contract:
- You may call emit_avatar_directive to control the Live2D tutor's expression and motion.
- For most spoken tutor turns, emit one concise directive near the start of the turn unless the turn is truly neutral and very short.
- Use a directive whenever your speaking intent is meaningfully one of: question, encouragement, correction, apology, surprise, affirmation, or contextual tap reaction.
- Keep the spoken tutoring response natural. Never mention internal tool names, schemas, or tags.
- Prefer exactly one directive per turn instead of spamming repeated directives.
- Use only the provided symbolic expressionId and motionRef values. Do not invent new ones.
- Keep subtitleText short and natural. Use it mainly for tap reactions or strong affect shifts.

Preferred mappings:
- curious questions: emotionKey=surprise or neutral, expressionId=curious_lift or curious_smile, motionRef=speaking_question
- encouragement or praise: emotionKey=joy, expressionId=warm_smile or warm_bright, motionRef=speaking_affirm
- affirmation or agreement: emotionKey=joy or neutral, expressionId=affirm_soft, motionRef=speaking_affirm
- correction or reformulation: emotionKey=anger or disgust, expressionId=corrective_focus or corrective_soft, motionRef=speaking_corrective
- apology or gentle hedge: emotionKey=sadness or fear, expressionId=apology_soft, motionRef=speaking_apology
- playful acknowledgement: emotionKey=smirk, expressionId=playful_smirk, motionRef=speaking_base
- neutral explanation: emotionKey=neutral, expressionId=neutral_soft or neutral_primary, motionRef=speaking_base

Tap reaction mappings:
- head tap: reactionIntent=tap_head_notice with a curious expression and react_head_curious or speaking_question motion
- face tap: reactionIntent=tap_face_focus with attentive curiosity and react_face_curious motion
- body tap: reactionIntent=tap_body_affirm with warm affirmation and react_body_affirm motion
- hand tap: reactionIntent=tap_hand_wave with a brief friendly acknowledgement
- chest tap: reactionIntent=tap_chest_reassure with a soft reassuring tone
""".strip()


def build_avatar_context_payload(area: str, mode: str, practice: Any = None) -> dict[str, str]:
    normalized_area = (area or 'body').strip().lower() or 'body'
    normalized_mode = (mode or 'realtime').strip().lower() or 'realtime'

    reaction_map = {
        'head': {
            'reactionIntent': 'tap_head_notice',
            'subtitleText': 'Oh?',
            'seed': 'The learner tapped your head. Briefly acknowledge it with curious, light surprise before continuing as a calm tutor.',
        },
        'face': {
            'reactionIntent': 'tap_face_focus',
            'subtitleText': 'I see.',
            'seed': 'The learner tapped your face. React with attentive curiosity and then continue the tutoring flow.',
        },
        'body': {
            'reactionIntent': 'tap_body_affirm',
            'subtitleText': 'Ready.',
            'seed': 'The learner tapped your body. Respond warmly and affirm that you are ready to continue.',
        },
        'hand': {
            'reactionIntent': 'tap_hand_wave',
            'subtitleText': 'Hi.',
            'seed': 'The learner tapped your hand. Respond with a short, friendly acknowledgement before returning to tutoring.',
        },
        'chest': {
            'reactionIntent': 'tap_chest_reassure',
            'subtitleText': "It's okay.",
            'seed': 'The learner tapped your chest. React with a brief reassuring tone, then continue tutoring calmly.',
        },
    }
    reaction = reaction_map.get(normalized_area, reaction_map['body'])

    practice_hint = ''
    if isinstance(practice, dict) and practice.get('type') == 'curriculum_module':
        module_id = practice.get('moduleId')
        situation_id = practice.get('situationId')
        if module_id and situation_id:
            practice_hint = f' Keep the acknowledgement aligned with curriculum module {module_id} and situation {situation_id}.'

    system_message = (
        f'{reaction["seed"]} '
        f'The current voice mode is {normalized_mode}. '
        'If you answer immediately, keep it to one short sentence. '
        f'If avatar directives are available, emit one directive that uses reactionIntent={reaction["reactionIntent"]} '
        'with matching expression and motion.'
        f'{practice_hint}'
    )

    return {
        'systemMessage': system_message,
        'reactionIntent': reaction['reactionIntent'],
        'subtitleText': reaction['subtitleText'],
    }


def realtime_avatar_directives_enabled() -> bool:
    return os.environ.get('ENABLE_REALTIME_AVATAR_DIRECTIVES', '').strip().lower() in {
        '1',
        'true',
        'yes',
        'on',
    }


def realtime_avatar_directives_requested(payload: dict[str, Any] | None = None) -> bool:
    if realtime_avatar_directives_enabled():
        return True

    request_payload = payload or {}
    request_opt_in = request_payload.get('avatarDirectives') is True
    is_development = os.environ.get('FLASK_ENV', '').strip().lower() == 'development'
    return is_development and request_opt_in


def build_realtime_session_request(
    system_instructions: str,
    *,
    enable_avatar_directives: bool | None = None,
) -> dict[str, Any]:
    request_payload: dict[str, Any] = {
        'model': 'gpt-realtime-mini',
        'voice': 'coral',
        'instructions': system_instructions,
        'input_audio_transcription': {'model': 'whisper-1'},
        'turn_detection': {
            'type': 'server_vad',
            'threshold': 0.7,
            'prefix_padding_ms': 300,
            'silence_duration_ms': 350,
            'interrupt_response': True,
        },
    }

    if enable_avatar_directives is None:
        enable_avatar_directives = realtime_avatar_directives_enabled()

    if enable_avatar_directives:
        request_payload['instructions'] = (
            f'{system_instructions}\n\n{build_avatar_realtime_instructions()}'
        )
        request_payload['tool_choice'] = 'auto'
        request_payload['tools'] = [build_avatar_directive_tool()]

    return request_payload


def _extract_assignment_id(payload: dict[str, Any]) -> str | None:
    assignment_id = payload.get('assignmentId')
    if isinstance(assignment_id, str) and assignment_id.strip():
        return assignment_id.strip()

    practice = payload.get('practice')
    if isinstance(practice, dict):
        practice_assignment_id = practice.get('assignmentId')
        if isinstance(practice_assignment_id, str) and practice_assignment_id.strip():
            return practice_assignment_id.strip()
    return None


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

            assignment_id = _extract_assignment_id(payload)
            if assignment_id:
                uid = deps.get_current_user_uid()
                context = deps.get_school_request_context()
                bootstrap = resolve_assignment_bootstrap_for_user(
                    deps,
                    uid=uid,
                    context=context,
                    assignment_id=assignment_id,
                    ui_language=ui_language,
                )
                system_instructions = build_assignment_system_prompt(bootstrap)
            else:
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
                json=build_realtime_session_request(
                    system_instructions,
                    enable_avatar_directives=realtime_avatar_directives_requested(payload),
                ),
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

        except PermissionError as e:
            return jsonify({'error': str(e), 'success': False}), 403
        except ValueError as e:
            error = str(e)
            status_code = 404 if 'not found' in error.lower() else 400
            return jsonify({'error': error, 'success': False}), status_code
        except Exception as e:
            return jsonify({'error': str(e), 'success': False}), 500

    @bp.route('/api/realtime/avatar-context', methods=['POST'])
    @deps.login_required
    def create_realtime_avatar_context():
        try:
            payload = request.get_json(silent=True) or {}
            area = payload.get('area', 'body')
            mode = payload.get('mode', 'realtime')
            practice = payload.get('practice')

            if not isinstance(area, str) or not area.strip():
                return jsonify({'success': False, 'error': 'area is required'}), 400

            context = build_avatar_context_payload(area=area, mode=mode, practice=practice)
            return jsonify({'success': True, **context})
        except Exception as e:
            return jsonify({'error': str(e), 'success': False}), 500

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
        timestamp = data.get('timestamp')
        sort_order = data.get('sortOrder', data.get('sort_order'))

        if not role or role not in ['user', 'assistant']:
            return jsonify({'success': False, 'error': 'Invalid role'}), 400

        if not content:
            return jsonify({'success': False, 'error': 'Content is required'}), 400

        if timestamp is not None and (not isinstance(timestamp, str) or not timestamp.strip()):
            return jsonify({'success': False, 'error': 'Invalid timestamp'}), 400

        if sort_order is not None:
            if isinstance(sort_order, bool):
                return jsonify({'success': False, 'error': 'Invalid sort order'}), 400
            if isinstance(sort_order, float):
                sort_order = int(sort_order)
            elif isinstance(sort_order, str):
                stripped = sort_order.strip()
                if not stripped:
                    sort_order = None
                elif stripped.lstrip('-').isdigit():
                    sort_order = int(stripped)
                else:
                    return jsonify({'success': False, 'error': 'Invalid sort order'}), 400
            elif not isinstance(sort_order, int):
                return jsonify({'success': False, 'error': 'Invalid sort order'}), 400

        try:
            chat = deps.db.get_chat_session(uid, chat_id)
            if not chat:
                return jsonify({'success': False, 'error': 'Chat not found'}), 404

            message = deps.db.add_message_to_chat(
                uid,
                chat_id,
                role,
                content,
                timestamp=timestamp.strip() if isinstance(timestamp, str) else None,
                sort_order=sort_order,
            )
            resolved_title = None

            chat_messages = chat.get('messages', [])
            if len(chat_messages) == 0 and role == 'user':
                try:
                    client = deps.get_openai_client()
                    if client:
                        title_response = client.chat.completions.create(
                            model='gpt-5.3-chat-latest',
                            messages=[
                                {
                                    'role': 'system',
                                    'content': 'Generate a very brief chat title (max 30 characters) in the same language as the user\'s message. Just return the title, nothing else. No quotes.',
                                },
                                {'role': 'user', 'content': f'User message: {content}'},
                            ],
                            max_completion_tokens=1024,
                            )
                        resolved_title = title_response.choices[0].message.content.strip()[:40]
                        deps.db.update_chat_title(uid, chat_id, resolved_title)
                except Exception:
                    resolved_title = content[:30] + ('...' if len(content) > 30 else '')
                    deps.db.update_chat_title(uid, chat_id, resolved_title)

            return jsonify({'success': True, 'message': message, 'title': resolved_title})

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

            try:
                response = client.chat.completions.create(
                    model='gpt-5.3-chat-latest',
                    messages=messages,
                    max_completion_tokens=8192,
                )
            except RateLimitError:
                return jsonify({
                    'success': False,
                    'error': 'OpenAI quota exceeded for the configured API key. Update billing/quota or replace OPENAI_API_KEY.',
                }), 429
            except APIStatusError as e:
                return jsonify({
                    'success': False,
                    'error': str(e),
                }), e.status_code or 500

            assistant_message = response.choices[0].message.content
            user_msg = deps.db.add_message_to_chat(uid, chat_id, 'user', user_message)
            assistant_msg = deps.db.add_message_to_chat(uid, chat_id, 'assistant', assistant_message)
            resolved_title = None

            if len(chat_messages) == 0:
                try:
                    title_response = client.chat.completions.create(
                        model='gpt-5.3-chat-latest',
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
                        max_completion_tokens=1024,
                    )
                    resolved_title = title_response.choices[0].message.content.strip()[:40]
                except Exception:
                    resolved_title = user_message[:30] + ('...' if len(user_message) > 30 else '')
                deps.db.update_chat_title(uid, chat_id, resolved_title)

            return jsonify({
                'success': True,
                'response': assistant_message,
                'userMessage': user_msg,
                'assistantMessage': assistant_msg,
                'title': resolved_title,
            })

        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    return bp
