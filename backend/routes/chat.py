import hashlib
import logging
import math
import os
from typing import Any

import requests
from flask import Blueprint, current_app, jsonify, request
from openai import APIStatusError, RateLimitError

from backend.db.read_router import DbUnavailableError
from backend.route_deps import RouteDeps
from backend.services.assignment_resolver import (
    build_assignment_prompt_bootstrap_from_practice_session,
    load_assignment_bundle,
    resolve_assignment_bootstrap_for_user,
    user_can_access_assignment,
)
from backend.services.pedagogy.integration import (
    resolve_assignment_system_prompt,
    promote_back_enabled,
    coach_chips_enabled,
    director_enabled,
)
from backend.services.compliance import create_consent_event, resolve_assignment_launch
from backend.services.native_language import resolve_native_language
from backend.services.suspended_org_guard import SuspendedOrgError, enforce_org_active


logger = logging.getLogger(__name__)


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

REALTIME_MODEL = 'gpt-realtime-mini-2025-12-15'
REALTIME_CLIENT_SECRET_TTL_SECONDS = 600
# Default input-audio transcription model. gpt-realtime-whisper won the A/B
# against real code-switching learner audio (clearly more accurate; streaming-
# native so the learner's own transcript appears live). It does NOT accept the
# transcription `prompt` param — the builder drops the prompt for it automatically
# (see realtime_transcription_supports_prompt). Override per-deploy with the
# REALTIME_TRANSCRIPTION_MODEL env var (e.g. to fall back to gpt-4o-transcribe,
# which keeps the prompt). Resolved at request time via
# resolve_realtime_transcription_model().
REALTIME_INPUT_AUDIO_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper'
REALTIME_TRANSCRIPTION_MODEL_ENV = 'REALTIME_TRANSCRIPTION_MODEL'
# Realtime transcription models that do NOT accept the `prompt` parameter in GA
# realtime sessions. Sending a prompt to these makes the client_secret mint fail,
# so the builder drops the prompt (but keeps the language hint) for them. The
# gpt-4o(-mini)-transcribe family does accept prompt hints.
REALTIME_TRANSCRIPTION_MODELS_WITHOUT_PROMPT = ('gpt-realtime-whisper', 'whisper-1')


def resolve_realtime_transcription_model() -> str:
    configured = os.environ.get(REALTIME_TRANSCRIPTION_MODEL_ENV, '').strip()
    return configured or REALTIME_INPUT_AUDIO_TRANSCRIPTION_MODEL


def realtime_transcription_supports_prompt(model: str) -> bool:
    normalized = (model or '').strip().lower()
    return not any(
        normalized == name or normalized.startswith(f'{name}-')
        for name in REALTIME_TRANSCRIPTION_MODELS_WITHOUT_PROMPT
    )
REALTIME_SPEAKING_SPEED_DEFAULT = 1.0
REALTIME_SPEAKING_SPEED_MIN = 0.25
REALTIME_SPEAKING_SPEED_MAX = 1.5
REALTIME_TRANSCRIPTION_LANGUAGE_HINTS = {
    'ko-KR': ('ko', 'Korean'),
    'es-ES': ('es', 'Spanish'),
    'fr-FR': ('fr', 'French'),
    'ru-RU': ('ru', 'Russian'),
    'he-IL': ('he', 'Hebrew'),
    'en': ('en', 'English'),
    'en-US': ('en', 'English'),
    'en-GB': ('en', 'English'),
}


def normalize_realtime_speaking_speed(value: Any) -> float:
    if value is None or isinstance(value, bool):
        return REALTIME_SPEAKING_SPEED_DEFAULT
    try:
        speed = float(value)
    except (TypeError, ValueError):
        return REALTIME_SPEAKING_SPEED_DEFAULT
    if not math.isfinite(speed):
        return REALTIME_SPEAKING_SPEED_DEFAULT
    clamped = min(
        max(speed, REALTIME_SPEAKING_SPEED_MIN),
        REALTIME_SPEAKING_SPEED_MAX,
    )
    return round(clamped, 2)


def build_realtime_pacing_instruction(speaking_speed: float) -> str:
    if speaking_speed <= 0.9:
        return (
            'Voice pacing: Speak more slowly than normal, with clear word boundaries '
            'and short pauses between phrases so the learner can follow.'
        )
    if speaking_speed >= 1.2:
        return (
            'Voice pacing: Speak briskly but clearly. Keep responses concise and do '
            'not rush corrections or target-language examples.'
        )
    if speaking_speed > 1.0:
        return (
            'Voice pacing: Speak slightly faster than normal while keeping pronunciation '
            'clear and learner-friendly.'
        )
    return 'Voice pacing: Speak at a natural, clear tutoring pace.'


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


def pilot_avatar_enabled() -> bool:
    return os.environ.get('ENABLE_PILOT_AVATAR', '').strip().lower() in {
        '1',
        'true',
        'yes',
        'on',
    }


def realtime_avatar_directives_enabled() -> bool:
    if not pilot_avatar_enabled():
        return False
    return os.environ.get('ENABLE_REALTIME_AVATAR_DIRECTIVES', '').strip().lower() in {
        '1',
        'true',
        'yes',
        'on',
    }


def realtime_avatar_directives_requested(payload: dict[str, Any] | None = None) -> bool:
    if not pilot_avatar_enabled():
        return False

    if realtime_avatar_directives_enabled():
        return True

    request_payload = payload or {}
    request_opt_in = request_payload.get('avatarDirectives') is True
    is_development = os.environ.get('FLASK_ENV', '').strip().lower() == 'development'
    return is_development and request_opt_in


def resolve_realtime_transcription_language_hint(learning_locale: Any) -> tuple[str, str]:
    if isinstance(learning_locale, str):
        normalized = learning_locale.strip()
        if normalized in REALTIME_TRANSCRIPTION_LANGUAGE_HINTS:
            return REALTIME_TRANSCRIPTION_LANGUAGE_HINTS[normalized]

        primary_language = normalized.split('-', 1)[0].lower()
        for locale_key, hint in REALTIME_TRANSCRIPTION_LANGUAGE_HINTS.items():
            if locale_key.split('-', 1)[0].lower() == primary_language:
                return hint

    return ('en', 'English')


def build_realtime_transcription_prompt(expected_language_name: str) -> str:
    return (
        f'Primary expected language is {expected_language_name}. English may also appear. '
        'Transcribe verbatim exactly as spoken. Never translate. Preserve code-switching exactly as spoken. '
        'Keep English words in English and keep non-English words in the language they were spoken. '
        'Do not rewrite the utterance into a single language, and do not replace it with a translated version.'
    )


def build_realtime_safety_identifier(uid: Any) -> str | None:
    if not isinstance(uid, str) or not uid.strip():
        return None
    return hashlib.sha256(f'lingual-user:{uid.strip()}'.encode('utf-8')).hexdigest()


def build_realtime_session_request(
    system_instructions: str,
    *,
    transcription_language: str = 'en',
    transcription_prompt: str | None = None,
    enable_avatar_directives: bool | None = None,
    speaking_speed: Any = REALTIME_SPEAKING_SPEED_DEFAULT,
) -> dict[str, Any]:
    normalized_speaking_speed = normalize_realtime_speaking_speed(speaking_speed)
    guarded_instructions = (
        f'{system_instructions}\n\n'
        'Voice-input guardrail: Ignore accidental noise, background conversations, and speech not directed at you. '
        'Only respond when the learner is clearly addressing you.\n\n'
        f'{build_realtime_pacing_instruction(normalized_speaking_speed)}'
    )
    transcription_model = resolve_realtime_transcription_model()
    input_audio_transcription: dict[str, Any] = {
        'model': transcription_model,
        'language': transcription_language,
    }
    if (
        isinstance(transcription_prompt, str)
        and transcription_prompt.strip()
        and realtime_transcription_supports_prompt(transcription_model)
    ):
        input_audio_transcription['prompt'] = transcription_prompt.strip()

    session_payload: dict[str, Any] = {
        'type': 'realtime',
        'model': REALTIME_MODEL,
        'instructions': guarded_instructions,
        'output_modalities': ['audio'],
        'audio': {
            'input': {
                'format': {
                    'type': 'audio/pcm',
                    'rate': 24000,
                },
                'transcription': input_audio_transcription,
                'turn_detection': {
                    'type': 'semantic_vad',
                    'eagerness': 'auto',
                    'create_response': False,
                    'interrupt_response': True,
                },
            },
            'output': {
                'format': {
                    'type': 'audio/pcm',
                    'rate': 24000,
                },
                'voice': 'coral',
                'speed': normalized_speaking_speed,
            },
        },
    }
    request_payload: dict[str, Any] = {
        'expires_after': {
            'anchor': 'created_at',
            'seconds': REALTIME_CLIENT_SECRET_TTL_SECONDS,
        },
        'session': session_payload,
    }

    if not pilot_avatar_enabled():
        enable_avatar_directives = False
    elif enable_avatar_directives is None:
        enable_avatar_directives = realtime_avatar_directives_enabled()

    if enable_avatar_directives:
        session_payload['instructions'] = (
            f'{guarded_instructions}\n\n{build_avatar_realtime_instructions()}'
        )
        session_payload['tool_choice'] = 'auto'
        session_payload['tools'] = [build_avatar_directive_tool()]

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


def _extract_practice_session_id(payload: dict[str, Any]) -> str | None:
    practice = payload.get('practice')
    if isinstance(practice, dict):
        practice_session_id = practice.get('practiceSessionId')
        if isinstance(practice_session_id, str) and practice_session_id.strip():
            return practice_session_id.strip()
    return None


def _compute_assignment_coverage_state(
    deps, bootstrap, uid, assignment_id, *, current_session_id=None
):
    """S2 cross-session recycling state for this student+assignment, or ``None``.

    Thin route-side wrapper over the shared, single-source-of-truth helper in
    ``practice_analytics`` so the chat path and the session-create snapshot path
    share one gated + fail-open + current-session-excluded compute (their safety
    behavior cannot diverge). Returns a ``CoverageState`` to thread into the prompt,
    or ``None`` (and does ZERO extra reads) when either flag is off or coverage is
    unavailable. ``current_session_id`` is the in-flight session, excluded from the
    prior evidence so a student's FIRST session is a no-op.
    """
    from backend.services.practice_analytics import compute_assignment_coverage_state

    return compute_assignment_coverage_state(
        deps.db,
        bootstrap,
        uid,
        assignment_id,
        current_session_id=current_session_id,
    )


def _compute_assignment_affect_state(
    deps, bootstrap, uid, assignment_id, *, current_session_id=None
):
    """S4.1 cross-session affect state for this student+assignment, or ``None``.

    Thin route-side wrapper over the shared single-source helper in
    ``practice_analytics`` (gated + fail-open + current-session-excluded), so the
    chat render and the session-create snapshot share one compute. Returns an
    ``AffectState`` to thread into the prompt, or ``None`` (zero extra reads) when
    the flag is off or affect is unavailable.
    """
    from backend.services.practice_analytics import compute_assignment_affect_state

    return compute_assignment_affect_state(
        deps.db,
        bootstrap,
        uid,
        assignment_id,
        current_session_id=current_session_id,
    )


def create_chat_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('chat_routes', __name__)

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
            speaking_speed = normalize_realtime_speaking_speed(payload.get('speakingSpeed'))

            uid = deps.get_current_user_uid()
            assignment_id = _extract_assignment_id(payload)
            learning_locale = 'en'
            if assignment_id:
                context = deps.get_school_request_context()
                practice_session_id = _extract_practice_session_id(payload)
                bootstrap = None
                class_record = None

                if practice_session_id:
                    practice_session = deps.db.get_practice_session(practice_session_id)
                    if not practice_session:
                        return jsonify({'success': False, 'error': 'Practice session not found.'}), 404
                    if practice_session.get('student_uid') != uid or practice_session.get('assignment_id') != assignment_id:
                        return jsonify({'success': False, 'error': 'Practice session is not available for this user.'}), 403
                    if practice_session.get('status') != 'active':
                        return jsonify({'success': False, 'error': 'Practice session is no longer active.'}), 409

                    assignment, _mapping, class_record = load_assignment_bundle(deps, assignment_id)
                    # Suspended-org gate: block new realtime sessions on an
                    # org that's been suspended since the practice session
                    # was created. The in-flight grace is handled when
                    # ``/api/practice-sessions/<id>/events`` is called.
                    try:
                        enforce_org_active(
                            (class_record or {}).get('org_id'),
                            db=deps.db,
                        )
                    except SuspendedOrgError as exc:
                        return jsonify(exc.to_payload()), 403
                    allowed, teacher_preview = user_can_access_assignment(
                        deps,
                        uid=uid,
                        context=context,
                        assignment=assignment,
                        class_record=class_record,
                    )
                    if not allowed:
                        raise PermissionError('Assignment is not available for the current user.')

                    launch_policy, _compliance_record = resolve_assignment_launch(
                        deps,
                        org_id=class_record.get('org_id', ''),
                        student_uid=uid,
                        modality_policy=assignment.get('modality_override'),
                        teacher_preview=teacher_preview,
                    )
                    bootstrap = build_assignment_prompt_bootstrap_from_practice_session(
                        practice_session,
                        class_record=class_record,
                        launch_policy=launch_policy,
                        teacher_preview=teacher_preview,
                    )

                if bootstrap is None:
                    bootstrap = resolve_assignment_bootstrap_for_user(
                        deps,
                        uid=uid,
                        context=context,
                        assignment_id=assignment_id,
                        ui_language=ui_language,
                    )
                    class_record = None

                if not (bootstrap.get('launch') or {}).get('voiceAllowed'):
                    blocked_reasons = (bootstrap.get('launch') or {}).get('blockedReasons') or []
                    create_consent_event(
                        deps,
                        org_id=(class_record or {}).get('org_id') or (bootstrap.get('class') or {}).get('orgId', ''),
                        student_uid=uid or '',
                        event_type='voice.blocked.realtime_session',
                        actor_type='student',
                        actor_id=uid or '',
                        payload={'assignmentId': assignment_id, 'blockedReasons': blocked_reasons},
                    )
                    reason = blocked_reasons[0] if blocked_reasons else 'Voice practice is not allowed for this assignment.'
                    return jsonify({
                        'success': False,
                        'error': reason,
                        'blockedReasons': blocked_reasons,
                    }), 403
                coverage_state = _compute_assignment_coverage_state(
                    deps, bootstrap, uid, assignment_id,
                    current_session_id=practice_session_id,
                )
                affect_state = _compute_assignment_affect_state(
                    deps, bootstrap, uid, assignment_id,
                    current_session_id=practice_session_id,
                )
                system_instructions = resolve_assignment_system_prompt(
                    bootstrap, surface="voice", coverage_state=coverage_state, affect_state=affect_state
                )
                learning_locale = (
                    (class_record or {}).get('learning_locale')
                    or (bootstrap.get('class') or {}).get('learningLocale')
                    or 'en'
                )
            else:
                native_language = resolve_native_language(ui_language)
                proficiency_context = deps.get_user_proficiency_context(native_language=native_language)
                profile_context = deps.db.get_user_profile_context(uid) or {}
                learning_locale = profile_context.get('learning_locale', 'ko-KR')
                chat_id = payload.get('chatId')
                chat = (
                    deps.db.get_chat_session(uid, chat_id.strip())
                    if isinstance(chat_id, str) and chat_id.strip()
                    else None
                )
                language_mix_level = (chat or {}).get('language_mix_level', 'balanced')
                system_instructions = deps.build_system_prompt(
                    proficiency_context,
                    learning_locale,
                    language_mix_level,
                    native_language=native_language,
                )
            transcription_language, transcription_language_name = (
                resolve_realtime_transcription_language_hint(learning_locale)
            )
            transcription_prompt = build_realtime_transcription_prompt(
                transcription_language_name,
            )

            request_headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            }
            safety_identifier = build_realtime_safety_identifier(uid)
            if safety_identifier:
                request_headers['OpenAI-Safety-Identifier'] = safety_identifier

            response = requests.post(
                'https://api.openai.com/v1/realtime/client_secrets',
                headers=request_headers,
                json=build_realtime_session_request(
                    system_instructions,
                    transcription_language=transcription_language,
                    transcription_prompt=transcription_prompt,
                    enable_avatar_directives=realtime_avatar_directives_requested(payload),
                    speaking_speed=speaking_speed,
                ),
            )

            if response.status_code != 200:
                current_app.logger.error(
                    'Realtime client_secret mint failed: status=%s body=%s',
                    response.status_code,
                    response.text[:1000],
                )
                return jsonify({
                    'error': 'Unable to start the voice session right now. Please try again.',
                    'success': False,
                }), 502

            data = response.json()
            return jsonify({
                'success': True,
                'client_secret': data.get('value'),
                'session_id': (data.get('session') or {}).get('id'),
                'expires_at': data.get('expires_at'),
            })

        except SuspendedOrgError as exc:
            return jsonify(exc.to_payload()), 403
        except PermissionError as e:
            return jsonify({'error': str(e), 'success': False}), 403
        except ValueError as e:
            error = str(e)
            status_code = 404 if 'not found' in error.lower() else 400
            current_app.logger.warning(
                'Realtime session ValueError (-> %s): %s', status_code, error
            )
            return jsonify({'error': error, 'success': False}), status_code
        except DbUnavailableError as exc:
            # Transient PG outage on the practice-session read (no Firestore mirror).
            # Surface a retryable 503 so the SPA backs off, NOT a false 404 "not found".
            current_app.logger.warning('Realtime session DB unavailable -> 503')
            return jsonify(exc.to_payload()), 503
        except Exception as e:
            current_app.logger.exception('Realtime session unexpected error')
            return jsonify({'error': str(e), 'success': False}), 500

    @bp.route('/api/realtime/connect', methods=['POST'])
    @deps.login_required
    def connect_realtime_session():
        """Proxy the browser WebRTC SDP offer to OpenAI Realtime to avoid browser-side CORS issues."""
        try:
            payload = request.get_json(silent=True) or {}
            offer_sdp = payload.get('offerSdp')
            client_secret = payload.get('clientSecret')

            if not isinstance(offer_sdp, str) or not offer_sdp.strip():
                return jsonify({'success': False, 'error': 'offerSdp is required'}), 400

            if not isinstance(client_secret, str) or not client_secret.strip():
                return jsonify({'success': False, 'error': 'clientSecret is required'}), 400

            response = requests.post(
                'https://api.openai.com/v1/realtime/calls',
                headers={
                    'Authorization': f'Bearer {client_secret}',
                    'Content-Type': 'application/sdp',
                    'Accept': 'application/sdp',
                },
                data=offer_sdp,
                timeout=30,
            )

            if response.status_code not in {200, 201}:
                return jsonify({
                    'success': False,
                    'error': f'Failed to connect realtime session: {response.text}',
                }), response.status_code

            return jsonify({
                'success': True,
                'answerSdp': response.text,
            })
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

    @bp.route('/api/chats/<chat_id>/settings', methods=['PATCH'])
    @deps.login_required
    def api_update_chat_settings(chat_id):
        """Update chat-level settings."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}

        try:
            chat = deps.db.get_chat_session(uid, chat_id)
            if not chat:
                return jsonify({'success': False, 'error': 'Chat not found'}), 404

            deps.db.update_chat_settings(
                uid,
                chat_id,
                language_mix_level=data.get('languageMixLevel'),
            )
            updated_chat = deps.db.get_chat_session(uid, chat_id)
            return jsonify({'success': True, 'chat': updated_chat})
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
        assignment_id = data.get('assignmentId')
        practice_session_id = data.get('practiceSessionId')
        ui_language = data.get('uiLanguage', 'en')
        coach_note = (data.get('coachNote') or '').strip()
        coach_note_allowed = False

        if not user_message:
            return jsonify({'success': False, 'error': 'Message is required'}), 400
        if ui_language not in deps.supported_ui_languages:
            ui_language = 'en'

        if not os.environ.get('OPENAI_API_KEY'):
            return jsonify({'success': False, 'error': 'OpenAI API key not configured'}), 500

        try:
            chat = deps.db.get_chat_session(uid, chat_id)
            if not chat:
                return jsonify({'success': False, 'error': 'Chat not found'}), 404

            chat_messages = chat.get('messages', [])
            if isinstance(assignment_id, str) and assignment_id.strip():
                assignment_id = assignment_id.strip()
                context = deps.get_school_request_context()
                bootstrap = resolve_assignment_bootstrap_for_user(
                    deps,
                    uid=uid,
                    context=context,
                    assignment_id=assignment_id,
                    ui_language=ui_language,
                )
                launch = bootstrap.get('launch') or {}
                if launch.get('modality', {}).get('mode') != 'text_only' or not launch.get('textAllowed'):
                    blocked_reasons = launch.get('blockedReasons') or []
                    create_consent_event(
                        deps,
                        org_id=(bootstrap.get('class') or {}).get('orgId', ''),
                        student_uid=uid or '',
                        event_type='text.blocked.assignment_chat',
                        actor_type='student',
                        actor_id=uid or '',
                        payload={'assignmentId': assignment_id, 'blockedReasons': blocked_reasons},
                    )
                    reason = blocked_reasons[0] if blocked_reasons else 'Assignment text launch is not enabled.'
                    return jsonify({'success': False, 'error': reason}), 403

                if isinstance(practice_session_id, str) and practice_session_id.strip():
                    practice_session = deps.db.get_practice_session(practice_session_id.strip())
                    if not practice_session:
                        return jsonify({'success': False, 'error': 'Practice session not found'}), 404
                    if practice_session.get('student_uid') != uid or practice_session.get('assignment_id') != assignment_id:
                        return jsonify({'success': False, 'error': 'Practice session is not available for this user.'}), 403
                    transcript_ref = practice_session.get('transcript_ref', {}) if isinstance(practice_session, dict) else {}
                    if transcript_ref.get('chat_id') and transcript_ref.get('chat_id') != chat_id:
                        return jsonify({'success': False, 'error': 'Practice session is linked to a different chat.'}), 409
                    if practice_session.get('status') != 'active':
                        return jsonify({'success': False, 'error': 'Practice session is no longer active.'}), 409

                current_session_id = (
                    practice_session_id.strip()
                    if isinstance(practice_session_id, str) and practice_session_id.strip()
                    else None
                )
                coverage_state = _compute_assignment_coverage_state(
                    deps, bootstrap, uid, assignment_id,
                    current_session_id=current_session_id,
                )
                affect_state = _compute_assignment_affect_state(
                    deps, bootstrap, uid, assignment_id,
                    current_session_id=current_session_id,
                )
                system_prompt = resolve_assignment_system_prompt(
                    bootstrap, surface="text", coverage_state=coverage_state, affect_state=affect_state
                )
                coach_note_allowed = True
            else:
                native_language = resolve_native_language(ui_language)
                proficiency_context = deps.get_user_proficiency_context(native_language=native_language)
                profile_context = deps.db.get_user_profile_context(uid) or {}
                learning_locale = profile_context.get('learning_locale', 'ko-KR')
                language_mix_level = chat.get('language_mix_level', 'balanced')
                system_prompt = deps.build_system_prompt(
                    proficiency_context,
                    learning_locale,
                    language_mix_level,
                    native_language=native_language,
                )

            messages = [{'role': 'system', 'content': system_prompt}]
            for msg in chat_messages:
                messages.append({'role': msg['role'], 'content': msg['content']})
            # S3.3 promote-back (text surface): a coach note rides this one turn as a
            # transient system instruction so the tutor weaves the self-repair into its
            # reply in its own words. Assignment-linked + both flags on only; length-capped.
            if coach_note and coach_note_allowed and (
                (promote_back_enabled() and coach_chips_enabled()) or director_enabled()
            ):
                messages.append({'role': 'system', 'content': coach_note[:500]})
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

        except SuspendedOrgError as exc:
            return jsonify(exc.to_payload()), 403
        except DbUnavailableError as exc:
            # Transient PG outage on the practice-session read -> retryable 503,
            # not a false 404/500 mid text-practice.
            return jsonify(exc.to_payload()), 503
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    return bp
