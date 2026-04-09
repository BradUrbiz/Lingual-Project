from __future__ import annotations

import base64
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from io import BytesIO
from threading import Lock
from typing import Any

from flask import Flask, jsonify, request, session
from flask_sock import Sock

from backend.route_deps import RouteDeps

ALLOWED_AFFECTS = {
    'neutral',
    'encouraging',
    'curious',
    'corrective',
    'affirming',
    'apologetic',
}
ALLOWED_MOTION_GROUPS = {
    'idle',
    'listen',
    'think',
    'talk',
    'question',
    'affirm',
    'corrective',
    'apology',
    'react_head',
    'react_body',
    'react_face',
}
ALLOWED_BLINK_MODES = {'auto', 'focused', 'soft'}
MAX_HISTORY_MESSAGES = 16
DEFAULT_GAZE = {'x': 0.0, 'y': -0.08}
DEFAULT_BODY_SWAY = 0.22
DEFAULT_AUDIO_CHUNK_SIZE = 16_384
DEFAULT_TTS_SEGMENT_MAX_CHARS = 120


@dataclass
class AvatarChatSessionState:
    session_id: str
    uid: str
    ui_language: str
    system_instructions: str
    chat_id: str | None = None
    practice: dict[str, Any] | None = None
    conversation_history: list[dict[str, str]] = field(default_factory=list)
    last_hit_area: str | None = None
    created_at: float = field(default_factory=time.time)


class AvatarChatSessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, AvatarChatSessionState] = {}
        self._lock = Lock()

    def create(
        self,
        *,
        uid: str,
        ui_language: str,
        system_instructions: str,
        chat_id: str | None,
        practice: dict[str, Any] | None,
        conversation_history: list[dict[str, str]],
    ) -> AvatarChatSessionState:
        state = AvatarChatSessionState(
            session_id=f'avatar-{uuid.uuid4().hex}',
            uid=uid,
            ui_language=ui_language,
            system_instructions=system_instructions,
            chat_id=chat_id,
            practice=practice,
            conversation_history=conversation_history[-MAX_HISTORY_MESSAGES:],
        )
        with self._lock:
            self._sessions[state.session_id] = state
        return state

    def get(self, session_id: str) -> AvatarChatSessionState | None:
        with self._lock:
            return self._sessions.get(session_id)

    def remove(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)


SESSION_STORE = AvatarChatSessionStore()


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def extract_first_json_object(raw_text: str) -> str:
    start = raw_text.find('{')
    if start == -1:
        raise ValueError('No JSON object found in model output.')

    depth = 0
    in_string = False
    escape_next = False
    for index in range(start, len(raw_text)):
        char = raw_text[index]
        if escape_next:
            escape_next = False
            continue
        if char == '\\':
            escape_next = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                return raw_text[start:index + 1]

    raise ValueError('Incomplete JSON object in model output.')


def normalize_affect(value: Any) -> str:
    if isinstance(value, str):
        normalized = value.strip().lower().replace(' ', '_').replace('-', '_')
        if normalized in ALLOWED_AFFECTS:
            return normalized
    return 'neutral'


def normalize_motion_group(value: Any, affect: str = 'neutral') -> str:
    if isinstance(value, str):
        normalized = value.strip().lower().replace(' ', '_').replace('-', '_')
        if normalized in ALLOWED_MOTION_GROUPS:
            return normalized

    defaults = {
        'curious': 'question',
        'affirming': 'affirm',
        'corrective': 'corrective',
        'apologetic': 'apology',
        'encouraging': 'talk',
    }
    return defaults.get(affect, 'talk')


def normalize_blink_mode(value: Any) -> str:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ALLOWED_BLINK_MODES:
            return normalized
    return 'auto'


def normalize_gaze(value: Any) -> dict[str, float]:
    if isinstance(value, dict):
        x = clamp(float(value.get('x', DEFAULT_GAZE['x'])), -1.0, 1.0)
        y = clamp(float(value.get('y', DEFAULT_GAZE['y'])), -1.0, 1.0)
        return {'x': x, 'y': y}
    return dict(DEFAULT_GAZE)


def normalize_body_sway(value: Any) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return clamp(float(value), 0.0, 1.0)
    return DEFAULT_BODY_SWAY


def normalize_hit_area(value: Any) -> str:
    if not isinstance(value, str):
        return 'body'
    normalized = value.strip().lower().replace(' ', '_').replace('-', '_')
    if normalized in {'head', 'face', 'body', 'hand', 'chest'}:
        return normalized
    return 'body'


def build_avatar_generation_prompt(
    *,
    system_instructions: str,
    ui_language: str,
    last_hit_area: str | None,
) -> str:
    ui_language_name = 'English' if ui_language == 'en' else 'Korean'
    hit_area_note = (
        f'- Recent avatar interaction: the learner tapped the avatar around the "{last_hit_area}" area.\n'
        if last_hit_area
        else ''
    )
    return f"""{system_instructions}

You must produce one JSON object only. Do not wrap it in Markdown. Do not include commentary before or after the JSON.

JSON contract:
{{
  "speech": "what the tutor will actually say out loud",
  "affect": "neutral|encouraging|curious|corrective|affirming|apologetic",
  "motionIntent": "idle|listen|think|talk|question|affirm|corrective|apology|react_head|react_body|react_face",
  "reactionIntent": "brief internal label for the frontend/backend reaction system",
  "gaze": {{"x": -1.0 to 1.0, "y": -1.0 to 1.0}},
  "bodySway": 0.0 to 1.0,
  "blinkMode": "auto|focused|soft",
  "subtitleText": "short subtitle, usually same as speech",
  "visemeHint": null or "optional short hint"
}}

Rules:
- "speech" must stay natural and learner-facing. No JSON, no stage directions.
- Keep "speech" concise enough for realtime tutoring.
- Pick the affect that best matches the tutor intent.
- Use "question" motionIntent when the tutor ends with a question.
- Use "corrective" when giving guidance or reformulation.
- Use "affirm" or "encouraging" when reassuring or praising.
- Use "apology" for apologies or hedging.
- "subtitleText" should be readable, short, and match the spoken line.
- If uncertain, use affect "neutral", motionIntent "talk", blinkMode "auto", bodySway 0.22, gaze {{"x": 0, "y": -0.08}}.
- If clarification is needed, the brief explanation language may be {ui_language_name}.
{hit_area_note}"""


def parse_avatar_turn(raw_output: str) -> dict[str, Any]:
    try:
        parsed = json.loads(extract_first_json_object(raw_output))
    except (json.JSONDecodeError, ValueError):
        speech = raw_output.strip()
        affect = 'neutral'
        return {
            'speech': speech,
            'affect': affect,
            'motionGroup': normalize_motion_group(None, affect),
            'reactionIntent': 'default',
            'gaze': dict(DEFAULT_GAZE),
            'bodySway': DEFAULT_BODY_SWAY,
            'blinkMode': 'auto',
            'subtitleText': speech,
            'visemeHint': None,
        }

    speech = str(parsed.get('speech', '')).strip()
    affect = normalize_affect(parsed.get('affect'))
    motion_group = normalize_motion_group(parsed.get('motionIntent'), affect)
    reaction_intent = str(parsed.get('reactionIntent', 'default')).strip() or 'default'
    subtitle_text = str(parsed.get('subtitleText', speech)).strip() or speech
    viseme_hint = parsed.get('visemeHint')
    if viseme_hint is not None and not isinstance(viseme_hint, str):
        viseme_hint = None

    return {
        'speech': speech,
        'affect': affect,
        'motionGroup': motion_group,
        'reactionIntent': reaction_intent,
        'gaze': normalize_gaze(parsed.get('gaze')),
        'bodySway': normalize_body_sway(parsed.get('bodySway')),
        'blinkMode': normalize_blink_mode(parsed.get('blinkMode')),
        'subtitleText': subtitle_text,
        'visemeHint': viseme_hint,
    }


def build_avatar_state_payload(
    *,
    dialogue_state: str,
    affect: str = 'neutral',
    motion_group: str = 'idle',
    subtitle_text: str = '',
    gaze: dict[str, float] | None = None,
    body_sway: float = DEFAULT_BODY_SWAY,
    blink_mode: str = 'auto',
    viseme_hint: str | None = None,
) -> dict[str, Any]:
    return {
        'dialogueState': dialogue_state,
        'affect': normalize_affect(affect),
        'motionGroup': normalize_motion_group(motion_group, affect),
        'gaze': normalize_gaze(gaze),
        'bodySway': normalize_body_sway(body_sway),
        'blinkMode': normalize_blink_mode(blink_mode),
        'subtitleText': subtitle_text,
        'visemeHint': viseme_hint if isinstance(viseme_hint, str) and viseme_hint.strip() else None,
    }


def build_hit_reaction(area: str) -> dict[str, Any]:
    normalized_area = normalize_hit_area(area)
    if normalized_area in {'head', 'face'}:
        affect = 'curious'
        motion_group = 'react_head' if normalized_area == 'head' else 'react_face'
        subtitle_text = 'Oh?'
    else:
        affect = 'affirming'
        motion_group = 'react_body'
        subtitle_text = 'Ready.'

    return {
        'area': normalized_area,
        'affect': affect,
        'motionGroup': motion_group,
        'subtitleText': subtitle_text,
        'durationMs': 900,
    }


def split_audio_bytes(audio_bytes: bytes, chunk_size: int = DEFAULT_AUDIO_CHUNK_SIZE) -> list[bytes]:
    if chunk_size <= 0:
        raise ValueError('chunk_size must be greater than 0')
    return [audio_bytes[index:index + chunk_size] for index in range(0, len(audio_bytes), chunk_size)]


def chunk_reply_text(text: str, words_per_chunk: int = 3) -> list[str]:
    words = text.split()
    if not words:
        return []

    chunks: list[str] = []
    for index in range(0, len(words), words_per_chunk):
        chunk = ' '.join(words[index:index + words_per_chunk]).strip()
        if not chunk:
            continue
        if chunks:
            chunks.append(f' {chunk}')
        else:
            chunks.append(chunk)
    return chunks


def split_speech_for_tts(text: str, max_chars: int = DEFAULT_TTS_SEGMENT_MAX_CHARS) -> list[str]:
    normalized = re.sub(r'\s+', ' ', text).strip()
    if not normalized:
        return []

    sentence_parts = [
        part.strip()
        for part in re.split(r'(?<=[.!?。！？])\s+', normalized)
        if part.strip()
    ]
    if not sentence_parts:
        sentence_parts = [normalized]

    segments: list[str] = []
    for sentence in sentence_parts:
        if len(sentence) <= max_chars:
            segments.append(sentence)
            continue

        clause_parts = [
            part.strip()
            for part in re.split(r'(?<=[,;:])\s+|(?<=[،，、])\s*', sentence)
            if part.strip()
        ]
        if not clause_parts:
            clause_parts = [sentence]

        current = ''
        for clause in clause_parts:
            candidate = clause if not current else f'{current} {clause}'
            if len(candidate) <= max_chars:
                current = candidate
                continue

            if current:
                segments.append(current)
                current = ''

            words = clause.split()
            if not words:
                continue

            word_buffer = ''
            for word in words:
                next_buffer = word if not word_buffer else f'{word_buffer} {word}'
                if len(next_buffer) <= max_chars:
                    word_buffer = next_buffer
                    continue
                if word_buffer:
                    segments.append(word_buffer)
                word_buffer = word
            if word_buffer:
                current = word_buffer

        if current:
            segments.append(current)

    return segments


def infer_audio_extension(mime_type: str) -> str:
    lowered = mime_type.lower()
    if 'ogg' in lowered:
        return '.ogg'
    if 'wav' in lowered:
        return '.wav'
    if 'mpeg' in lowered or 'mp3' in lowered:
        return '.mp3'
    return '.webm'


def read_binary_response_content(response: Any) -> bytes:
    content = getattr(response, 'content', None)
    if isinstance(content, bytes):
        return content

    iter_bytes = getattr(response, 'iter_bytes', None)
    if callable(iter_bytes):
        return b''.join(iter_bytes())

    read = getattr(response, 'read', None)
    if callable(read):
        return read()

    raise ValueError('Unsupported binary response payload from OpenAI SDK.')


def serialize_chat_history(chat: dict[str, Any] | None) -> list[dict[str, str]]:
    if not isinstance(chat, dict):
        return []

    messages = chat.get('messages', [])
    if not isinstance(messages, list):
        return []

    serialized: list[dict[str, str]] = []
    for message in messages[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(message, dict):
            continue
        role = message.get('role')
        content = message.get('content')
        if role not in {'user', 'assistant'} or not isinstance(content, str) or not content.strip():
            continue
        serialized.append({'role': role, 'content': content.strip()})
    return serialized


def resolve_system_instructions(deps: RouteDeps, payload: dict[str, Any]) -> str:
    ui_language = payload.get('uiLanguage', 'en')
    if ui_language not in deps.supported_ui_languages:
        ui_language = 'en'

    practice = payload.get('practice')
    if isinstance(practice, dict) and practice.get('type') == 'curriculum_module':
        curriculum_id = practice.get('curriculumId')
        module_id = practice.get('moduleId')
        situation_id = practice.get('situationId')
        if not module_id or not situation_id:
            raise ValueError('moduleId and situationId are required for curriculum practice.')

        package = deps.load_sample_curriculum_package()
        sample_curriculum_id = package.get('curriculum', {}).get('id')
        if curriculum_id and curriculum_id != sample_curriculum_id:
            raise ValueError('Unsupported curriculumId.')

        package, unit, module, situation, mode, objectives = deps.get_curriculum_practice_context(
            module_id=module_id,
            situation_id=situation_id,
        )
        return deps.build_curriculum_system_prompt(
            package=package,
            unit=unit,
            module=module,
            situation=situation,
            mode=mode,
            objectives=objectives,
            ui_language=ui_language,
        )

    proficiency_context = deps.get_user_proficiency_context()
    uid = deps.get_current_user_uid()
    profile_context = deps.db.get_user_profile_context(uid) or {}
    learning_locale = profile_context.get('learning_locale', 'ko-KR')
    return deps.build_system_prompt(proficiency_context, learning_locale)


def send_ws_event(ws: Any, event_type: str, payload: dict[str, Any] | None = None) -> None:
    message = {'type': event_type}
    if payload:
        message.update(payload)
    ws.send(json.dumps(message))


def transcribe_user_audio(client: Any, audio_bytes: bytes, mime_type: str) -> str:
    audio_file = BytesIO(audio_bytes)
    audio_file.name = f'utterance{infer_audio_extension(mime_type)}'

    transcript = client.audio.transcriptions.create(
        model=os.environ.get('OPENAI_STT_MODEL', 'whisper-1'),
        file=audio_file,
    )
    text = getattr(transcript, 'text', '')
    return text.strip()


def generate_assistant_turn(
    *,
    client: Any,
    session_state: AvatarChatSessionState,
    user_text: str,
) -> dict[str, Any]:
    messages = [
        {
            'role': 'system',
            'content': build_avatar_generation_prompt(
                system_instructions=session_state.system_instructions,
                ui_language=session_state.ui_language,
                last_hit_area=session_state.last_hit_area,
            ),
        },
        *session_state.conversation_history,
        {'role': 'user', 'content': user_text},
    ]

    response = client.chat.completions.create(
        model=os.environ.get('OPENAI_CHAT_MODEL', 'gpt-5.3-chat-latest'),
        messages=messages,
        max_completion_tokens=1024,
    )

    raw_output = response.choices[0].message.content or ''
    turn = parse_avatar_turn(raw_output)
    speech = turn.get('speech', '').strip()
    if not speech:
        raise ValueError('Assistant response did not include speech content.')

    session_state.conversation_history.extend([
        {'role': 'user', 'content': user_text},
        {'role': 'assistant', 'content': speech},
    ])
    session_state.conversation_history = session_state.conversation_history[-MAX_HISTORY_MESSAGES:]
    session_state.last_hit_area = None

    return turn


def synthesize_assistant_audio(client: Any, speech_text: str) -> tuple[bytes, str]:
    response = client.audio.speech.create(
        model=os.environ.get('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
        voice=os.environ.get('OPENAI_TTS_VOICE', 'coral'),
        input=speech_text,
        response_format='mp3',
    )
    return read_binary_response_content(response), 'audio/mpeg'


def stream_synthesized_audio_segments(
    *,
    ws: Any,
    client: Any,
    assistant_item_id: str,
    speech_text: str,
) -> str:
    segments = split_speech_for_tts(speech_text)
    if not segments:
        raise ValueError('No speech text available for TTS synthesis.')

    mime_type = 'audio/mpeg'
    for segment_index, segment_text in enumerate(segments):
        audio_bytes, mime_type = synthesize_assistant_audio(client, segment_text)
        for chunk_index, chunk in enumerate(split_audio_bytes(audio_bytes)):
            send_ws_event(ws, 'assistant.audio.chunk', {
                'itemId': assistant_item_id,
                'audioBase64': base64.b64encode(chunk).decode('ascii'),
                'mimeType': mime_type,
                'chunkIndex': chunk_index,
                'segmentIndex': segment_index,
            })

        send_ws_event(ws, 'assistant.audio.done', {
            'itemId': assistant_item_id,
            'mimeType': mime_type,
            'segmentIndex': segment_index,
            'isFinal': segment_index == len(segments) - 1,
        })

    return mime_type


def register_avatar_chat_routes(app: Flask, deps: RouteDeps) -> None:
    sock = Sock(app)

    @app.route('/api/avatar-chat/sessions', methods=['POST'])
    @deps.login_required
    def create_avatar_chat_session():
        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            return jsonify({'success': False, 'error': 'OpenAI API key not configured'}), 500

        payload = request.get_json(silent=True) or {}
        ui_language = payload.get('uiLanguage', 'en')
        if ui_language not in deps.supported_ui_languages:
            ui_language = 'en'

        chat_id = payload.get('chatId')
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required'}), 401

        try:
            system_instructions = resolve_system_instructions(deps, payload)
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400

        conversation_history: list[dict[str, str]] = []
        if isinstance(chat_id, str) and chat_id.strip():
            chat = deps.db.get_chat_session(uid, chat_id)
            if not chat:
                return jsonify({'success': False, 'error': 'Chat not found'}), 404
            conversation_history = serialize_chat_history(chat)
        else:
            chat_id = None

        state = SESSION_STORE.create(
            uid=uid,
            ui_language=ui_language,
            system_instructions=system_instructions,
            chat_id=chat_id,
            practice=payload.get('practice') if isinstance(payload.get('practice'), dict) else None,
            conversation_history=conversation_history,
        )

        return jsonify({
            'success': True,
            'sessionId': state.session_id,
            'wsUrl': f'/api/avatar-chat/ws/{state.session_id}',
            'chatId': chat_id,
        })

    @sock.route('/api/avatar-chat/ws/<session_id>')
    def avatar_chat_socket(ws: Any, session_id: str) -> None:
        user = session.get('user')
        if not user:
            send_ws_event(ws, 'error', {'message': 'Authentication required'})
            return

        state = SESSION_STORE.get(session_id)
        if state is None or state.uid != user.get('uid'):
            send_ws_event(ws, 'error', {'message': 'Avatar chat session not found'})
            return

        client = deps.get_openai_client()
        if client is None:
            send_ws_event(ws, 'error', {'message': 'OpenAI client is not available'})
            return

        audio_chunks: list[bytes] = []
        audio_mime_type = 'audio/webm'
        is_listening = False

        send_ws_event(ws, 'session.ready', {
            'sessionId': state.session_id,
            'chatId': state.chat_id,
        })
        send_ws_event(ws, 'turn.state', {'state': 'idle'})
        send_ws_event(ws, 'avatar.state', build_avatar_state_payload(dialogue_state='idle'))

        try:
            while True:
                raw_message = ws.receive()
                if raw_message is None:
                    break

                try:
                    event = json.loads(raw_message)
                except json.JSONDecodeError:
                    send_ws_event(ws, 'error', {'message': 'Invalid websocket payload'})
                    continue

                event_type = event.get('type')

                if event_type == 'mic.audio.chunk':
                    encoded_audio = event.get('audioBase64')
                    if not isinstance(encoded_audio, str) or not encoded_audio.strip():
                        continue

                    if not is_listening:
                        is_listening = True
                        send_ws_event(ws, 'turn.state', {'state': 'listening'})
                        send_ws_event(ws, 'avatar.state', build_avatar_state_payload(
                            dialogue_state='listening',
                            motion_group='listen',
                            subtitle_text='',
                            gaze={'x': 0.0, 'y': -0.05},
                            body_sway=0.14,
                            blink_mode='focused',
                        ))

                    audio_mime_type = str(event.get('mimeType') or audio_mime_type)
                    audio_chunks.append(base64.b64decode(encoded_audio))
                    continue

                if event_type == 'mic.audio.end':
                    if not audio_chunks:
                        send_ws_event(ws, 'turn.state', {'state': 'idle'})
                        send_ws_event(ws, 'avatar.state', build_avatar_state_payload(dialogue_state='idle'))
                        is_listening = False
                        continue

                    user_audio = b''.join(audio_chunks)
                    audio_chunks = []
                    is_listening = False

                    try:
                        user_text = transcribe_user_audio(client, user_audio, audio_mime_type)
                    except Exception as exc:
                        send_ws_event(ws, 'error', {'message': f'Failed to transcribe user audio: {exc}'})
                        send_ws_event(ws, 'turn.state', {'state': 'idle'})
                        send_ws_event(ws, 'avatar.state', build_avatar_state_payload(dialogue_state='idle'))
                        continue

                    if not user_text:
                        send_ws_event(ws, 'error', {'message': 'No speech detected from user audio'})
                        send_ws_event(ws, 'turn.state', {'state': 'idle'})
                        send_ws_event(ws, 'avatar.state', build_avatar_state_payload(dialogue_state='idle'))
                        continue

                    user_item_id = f'user-{uuid.uuid4().hex[:10]}'
                    send_ws_event(ws, 'transcript.user.final', {
                        'itemId': user_item_id,
                        'text': user_text,
                        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    })
                    send_ws_event(ws, 'turn.state', {'state': 'thinking'})
                    send_ws_event(ws, 'avatar.state', build_avatar_state_payload(
                        dialogue_state='thinking',
                        motion_group='think',
                        subtitle_text='',
                        gaze={'x': 0.06, 'y': -0.12},
                        body_sway=0.1,
                        blink_mode='soft',
                    ))

                    try:
                        turn = generate_assistant_turn(
                            client=client,
                            session_state=state,
                            user_text=user_text,
                        )
                    except Exception as exc:
                        send_ws_event(ws, 'error', {'message': f'Failed to generate assistant reply: {exc}'})
                        send_ws_event(ws, 'turn.state', {'state': 'idle'})
                        send_ws_event(ws, 'avatar.state', build_avatar_state_payload(dialogue_state='idle'))
                        continue

                    speech = str(turn['speech']).strip()
                    assistant_item_id = f'assistant-{uuid.uuid4().hex[:10]}'

                    for delta in chunk_reply_text(speech):
                        send_ws_event(ws, 'assistant.reply.delta', {
                            'itemId': assistant_item_id,
                            'delta': delta,
                        })

                    send_ws_event(ws, 'assistant.reply.final', {
                        'itemId': assistant_item_id,
                        'text': speech,
                        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    })
                    send_ws_event(ws, 'turn.state', {'state': 'speaking'})
                    send_ws_event(ws, 'avatar.state', build_avatar_state_payload(
                        dialogue_state='speaking',
                        affect=turn['affect'],
                        motion_group=turn['motionGroup'],
                        subtitle_text=turn['subtitleText'],
                        gaze=turn['gaze'],
                        body_sway=turn['bodySway'],
                        blink_mode=turn['blinkMode'],
                        viseme_hint=turn['visemeHint'],
                    ))

                    try:
                        stream_synthesized_audio_segments(
                            ws=ws,
                            client=client,
                            assistant_item_id=assistant_item_id,
                            speech_text=speech,
                        )
                    except Exception as exc:
                        send_ws_event(ws, 'error', {'message': f'Failed to synthesize assistant speech: {exc}'})
                        send_ws_event(ws, 'turn.state', {'state': 'post_speaking'})
                        send_ws_event(ws, 'avatar.state', build_avatar_state_payload(
                            dialogue_state='post_speaking',
                            affect=turn['affect'],
                            motion_group='idle',
                            subtitle_text='',
                        ))
                        send_ws_event(ws, 'turn.state', {'state': 'idle'})
                        send_ws_event(ws, 'avatar.state', build_avatar_state_payload(dialogue_state='idle'))
                        continue

                    continue

                if event_type == 'chat.interrupt':
                    audio_chunks = []
                    is_listening = False
                    send_ws_event(ws, 'turn.state', {'state': 'idle'})
                    send_ws_event(ws, 'avatar.state', build_avatar_state_payload(dialogue_state='idle'))
                    continue

                if event_type == 'avatar.hit':
                    reaction = build_hit_reaction(str(event.get('area', 'body')))
                    state.last_hit_area = reaction['area']
                    send_ws_event(ws, 'avatar.reaction', reaction)
                    continue

                if event_type == 'session.close':
                    break

                send_ws_event(ws, 'error', {'message': f'Unsupported event type: {event_type}'})
        finally:
            SESSION_STORE.remove(session_id)
