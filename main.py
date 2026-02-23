from flask import Flask, request, redirect, session, jsonify, send_from_directory
from flask_cors import CORS
from functools import wraps, lru_cache
import json
import os
from pathlib import Path
from datetime import datetime, timedelta
from dotenv import load_dotenv
from openai import OpenAI
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
import requests

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

# Session cookie configuration for production (Cloud Run uses HTTPS)
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Enable CORS for React development server
CORS(app, origins=['http://localhost:5173', 'http://localhost:3000'], supports_credentials=True)

# Initialize Firebase Admin SDK
firebase_app = None
FIREBASE_PROJECT_ID = os.environ.get('GOOGLE_CLOUD_PROJECT', 'lingu-480600')
ALLOWED_LEARNING_LOCALES = {'ko-KR', 'es-ES', 'fr-FR'}
ALLOWED_MINIGAME_TYPES = {'listening_quiz', 'grammar_challenge'}
SUPPORTED_UI_LANGUAGES = {'en', 'ko'}
SAMPLE_CURRICULUM_PATH = Path('data/curriculum/ap_french_fall2024_unit1_3.v1.json')
PRACTICEABLE_CURRICULUM_MODES = {'interpersonal_speaking', 'presentational_speaking'}
FOUNDATION_DOMAIN_LABELS = {
    'comprehension': 'Comprehension',
    'comprehensibility': 'Comprehensibility',
    'vocabulary_usage': 'Vocabulary Usage',
    'language_control': 'Language Control',
    'communication_strategies': 'Communication Strategies',
    'cultural_awareness': 'Cultural Awareness',
}

try:
    # For production: use GOOGLE_APPLICATION_CREDENTIALS or default credentials
    if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        cred = credentials.Certificate(os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'))
        firebase_app = firebase_admin.initialize_app(cred)
    else:
        # Use Application Default Credentials with explicit project ID
        firebase_app = firebase_admin.initialize_app(options={
            'projectId': FIREBASE_PROJECT_ID
        })
except Exception as e:
    print(f"Firebase initialization error: {e}")


def login_required(f):
    """Decorator to require authentication for API routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return jsonify({'error': 'Authentication required', 'success': False}), 401
        return f(*args, **kwargs)
    return decorated_function

openai_client = None

def get_openai_client():
    global openai_client
    api_key = os.environ.get('OPENAI_API_KEY')
    if api_key and openai_client is None:
        openai_client = OpenAI(api_key=api_key)
    return openai_client

from scoring import load_assessment_data, score_item, compute_results, get_sklc_description, SKLC_LEVEL_DESCRIPTIONS
import database as db


def get_current_user_uid():
    """Get the current user's UID from session."""
    user = session.get('user')
    return user.get('uid') if user else None


def get_assessment():
    return load_assessment_data("data/assessment_v1.json")


def get_i18n_text(value, ui_language='en'):
    """Select localized text with English fallback."""
    if isinstance(value, dict):
        if ui_language in value and isinstance(value[ui_language], str):
            return value[ui_language]
        if 'en' in value and isinstance(value['en'], str):
            return value['en']
        for item in value.values():
            if isinstance(item, str):
                return item
    if isinstance(value, str):
        return value
    return ''


@lru_cache(maxsize=1)
def load_sample_curriculum_package():
    with SAMPLE_CURRICULUM_PATH.open('r', encoding='utf-8') as file:
        return json.load(file)


@lru_cache(maxsize=1)
def get_sample_curriculum_indexes():
    package = load_sample_curriculum_package()
    units = package.get('units', [])
    modules = package.get('modules', [])
    objectives = package.get('objectives', [])

    units_by_id = {unit.get('id'): unit for unit in units if isinstance(unit, dict) and unit.get('id')}
    modules_by_id = {module.get('id'): module for module in modules if isinstance(module, dict) and module.get('id')}
    objectives_by_id = {
        objective.get('id'): objective
        for objective in objectives
        if isinstance(objective, dict) and objective.get('id')
    }

    module_situations = {}
    for module in modules_by_id.values():
        situations_by_id = {}
        situations = module.get('situations', {}) if isinstance(module, dict) else {}
        if isinstance(situations, dict):
            for mode, items in situations.items():
                if not isinstance(items, list):
                    continue
                for situation in items:
                    if not isinstance(situation, dict):
                        continue
                    situation_id = situation.get('id')
                    if situation_id:
                        situations_by_id[situation_id] = {
                            'mode': mode,
                            'situation': situation,
                        }
        module_situations[module.get('id')] = situations_by_id

    return {
        'package': package,
        'units_by_id': units_by_id,
        'modules_by_id': modules_by_id,
        'objectives_by_id': objectives_by_id,
        'module_situations': module_situations,
    }


def get_curriculum_practice_context(module_id, situation_id):
    indexes = get_sample_curriculum_indexes()
    package = indexes['package']
    modules_by_id = indexes['modules_by_id']
    module_situations = indexes['module_situations']
    objectives_by_id = indexes['objectives_by_id']
    units_by_id = indexes['units_by_id']

    module = modules_by_id.get(module_id)
    if not module:
        raise ValueError('Invalid moduleId for sample curriculum.')

    situation_entry = (module_situations.get(module_id) or {}).get(situation_id)
    if not situation_entry:
        raise ValueError('Invalid situationId for selected module.')

    mode = situation_entry.get('mode')
    situation = situation_entry.get('situation')
    if mode not in PRACTICEABLE_CURRICULUM_MODES:
        raise ValueError('Only speaking situations are currently practiceable.')

    declared_kind = situation.get('kind') if isinstance(situation, dict) else None
    if declared_kind and declared_kind != mode:
        raise ValueError('Situation kind does not match its mode bucket.')

    objective_ids = situation.get('objectiveIds', []) if isinstance(situation, dict) else []
    missing_objective_ids = [objective_id for objective_id in objective_ids if objective_id not in objectives_by_id]
    if missing_objective_ids:
        raise ValueError('Situation objective references are invalid.')

    objectives = [objectives_by_id[objective_id] for objective_id in objective_ids if objective_id in objectives_by_id]
    if not objectives:
        raise ValueError('No objectives found for selected situation.')

    unit = units_by_id.get(module.get('unitId'))
    return package, unit, module, situation, mode, objectives


@app.route('/')
def index():
    """Serve React SPA at root"""
    return serve_react_index()


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    """API endpoint to clear session"""
    session.clear()
    return jsonify({'success': True})


@app.route('/api/curriculum/sample', methods=['GET'])
@login_required
def api_get_sample_curriculum():
    """Serve the sample AP French curriculum package."""
    try:
        package = load_sample_curriculum_package()
        return jsonify({
            'success': True,
            'package': package
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/realtime/session', methods=['POST'])
@login_required
def create_realtime_session():
    """Create ephemeral token for OpenAI Realtime API."""
    try:
        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            return jsonify({'error': 'OpenAI API key not configured'}), 500

        payload = request.get_json(silent=True) or {}
        ui_language = payload.get('uiLanguage', 'en')
        if ui_language not in SUPPORTED_UI_LANGUAGES:
            ui_language = 'en'

        practice = payload.get('practice')
        if isinstance(practice, dict) and practice.get('type') == 'curriculum_module':
            curriculum_id = practice.get('curriculumId')
            module_id = practice.get('moduleId')
            situation_id = practice.get('situationId')

            if not module_id or not situation_id:
                return jsonify({
                    'success': False,
                    'error': 'moduleId and situationId are required for curriculum practice.'
                }), 400

            package = load_sample_curriculum_package()
            sample_curriculum_id = package.get('curriculum', {}).get('id')
            if curriculum_id and curriculum_id != sample_curriculum_id:
                return jsonify({
                    'success': False,
                    'error': 'Unsupported curriculumId.'
                }), 400

            try:
                package, unit, module, situation, mode, objectives = get_curriculum_practice_context(
                    module_id=module_id,
                    situation_id=situation_id,
                )
            except ValueError as e:
                return jsonify({'success': False, 'error': str(e)}), 400

            system_instructions = build_curriculum_system_prompt(
                package=package,
                unit=unit,
                module=module,
                situation=situation,
                mode=mode,
                objectives=objectives,
                ui_language=ui_language,
            )
        else:
            # Default Korean tutor behavior remains unchanged
            proficiency_context = get_user_proficiency_context()
            system_instructions = build_system_prompt(proficiency_context)

        # Request ephemeral token from OpenAI
        response = requests.post(
            'https://api.openai.com/v1/realtime/sessions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'gpt-realtime-mini',
                'voice': 'coral',
                'instructions': system_instructions,
                'input_audio_transcription': {
                    'model': 'whisper-1'
                },
                'turn_detection': {
                    'type': 'server_vad',
                    'threshold': 0.5,
                    'prefix_padding_ms': 300,
                    'silence_duration_ms': 500
                }
            }
        )

        if response.status_code != 200:
            return jsonify({
                'error': f'Failed to create session: {response.text}',
                'success': False
            }), response.status_code

        data = response.json()
        return jsonify({
            'success': True,
            'client_secret': data.get('client_secret', {}).get('value'),
            'session_id': data.get('id'),
            'expires_at': data.get('client_secret', {}).get('expires_at')
        })

    except Exception as e:
        return jsonify({'error': str(e), 'success': False}), 500


@app.route('/api/auth/verify', methods=['POST'])
def verify_auth():
    """Verify Firebase ID token and create session."""
    try:
        data = request.get_json()
        id_token = data.get('idToken')

        if not id_token:
            return jsonify({'success': False, 'error': 'No token provided'}), 400

        # Verify the ID token with Firebase
        decoded_token = firebase_auth.verify_id_token(id_token)
        uid = decoded_token['uid']
        email = decoded_token.get('email', '')
        name = decoded_token.get('name', email.split('@')[0] if email else 'User')

        # Store user info in session
        session['user'] = {
            'uid': uid,
            'email': email,
            'name': name
        }

        # Create or get user in database
        db.get_or_create_user(uid, email, name)

        return jsonify({'success': True, 'user': session['user']})

    except firebase_auth.InvalidIdTokenError:
        return jsonify({'success': False, 'error': 'Invalid token'}), 401
    except firebase_auth.ExpiredIdTokenError:
        return jsonify({'success': False, 'error': 'Token expired'}), 401
    except Exception as e:
        print(f"Auth verification error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# Old template routes removed - now using React SPA
# All page rendering is handled by React at the root path
# API endpoints below handle data operations


def get_user_proficiency_context():
    uid = get_current_user_uid()

    # Try to get from database first, fall back to session
    if uid:
        profile_context = db.get_user_profile_context(uid)
        if profile_context:
            results = profile_context.get('results') or {}
            display_name = profile_context.get('display_name', '')
            age = profile_context.get('age')
            rigor = profile_context.get('rigor', '')
            frequency = profile_context.get('frequency')
            frequency_unit = profile_context.get('frequency_unit', '')
            level_objective = profile_context.get('level_objective', '')
        else:
            results = session.get('assessment_results', {})
            user_profile = session.get('user_profile', {})
            display_name = user_profile.get('display_name', '')
            age = user_profile.get('age')
            rigor = user_profile.get('rigor', '')
            frequency = user_profile.get('frequency')
            frequency_unit = user_profile.get('frequency_unit', '')
            level_objective = user_profile.get('level_objective', '')
    else:
        results = session.get('assessment_results', {})
        user_profile = session.get('user_profile', {})
        display_name = user_profile.get('display_name', '')
        age = user_profile.get('age')
        rigor = user_profile.get('rigor', '')
        frequency = user_profile.get('frequency')
        frequency_unit = user_profile.get('frequency_unit', '')
        level_objective = user_profile.get('level_objective', '')

    if not results:
        return "The user has not completed their assessment yet. Assume beginner level."

    global_stage = results.get('global_stage', 0)
    domain_bands = results.get('domain_bands', {})
    domain_scores = results.get('domain_raw_scores', {})

    sklc_info = SKLC_LEVEL_DESCRIPTIONS.get(global_stage, SKLC_LEVEL_DESCRIPTIONS[0])

    # Format frequency string
    frequency_str = f"{frequency} times per {frequency_unit}" if frequency and frequency_unit else 'Not specified'

    context = f"""
USER PROFICIENCY PROFILE:
- Name: {display_name if display_name else 'Not specified'}
- Age: {age if age else 'Not specified'}
- Overall Level: {sklc_info['level']} (Stage {global_stage}/5)
- Description: {sklc_info['description_en']}

DOMAIN BREAKDOWN:
- Grammar: Band {domain_bands.get('grammar', 0)}/5 (Score: {domain_scores.get('grammar', 0):.2f})
- Vocabulary: Band {domain_bands.get('vocabulary', 0)}/5 (Score: {domain_scores.get('vocabulary', 0):.2f})
- Pragmatics: Band {domain_bands.get('pragmatics', 0)}/5 (Score: {domain_scores.get('pragmatics', 0):.2f})
- Pronunciation: Band {domain_bands.get('pronunciation', 0)}/5 (Score: {domain_scores.get('pronunciation', 0):.2f})

USER LEARNING PREFERENCES:
- Learning Intensity: {rigor.capitalize() if rigor else 'Not specified'}
- Study Frequency: {frequency_str}
- Level Objective: {level_objective if level_objective else 'Not specified'}
"""
    return context


def get_curriculum_tutor_role(roles):
    if not isinstance(roles, list):
        return 'conversation partner'

    for role in roles:
        if not isinstance(role, str):
            continue
        normalized = role.strip().lower()
        if normalized and normalized not in {'learner', 'presenter', 'student', 'user'}:
            return role

    if len(roles) > 1 and isinstance(roles[1], str):
        return roles[1]
    return 'conversation partner'


def format_support_target_lines(module, ui_language):
    support_targets = module.get('supportTargets', {}) if isinstance(module, dict) else {}
    lines = []
    for domain in FOUNDATION_DOMAIN_LABELS:
        targets = support_targets.get(domain, []) if isinstance(support_targets, dict) else []
        labels = []
        if isinstance(targets, list):
            for target in targets[:3]:
                if not isinstance(target, dict):
                    continue
                label = get_i18n_text(target.get('label', {}), ui_language)
                if label:
                    labels.append(label)
        if labels:
            lines.append(f"- {FOUNDATION_DOMAIN_LABELS[domain]}: {', '.join(labels)}")
    return lines


def build_curriculum_system_prompt(package, unit, module, situation, mode, objectives, ui_language='en'):
    curriculum = package.get('curriculum', {}) if isinstance(package, dict) else {}
    curriculum_title = get_i18n_text(curriculum.get('title', {}), ui_language)
    level_band = curriculum.get('levelBand', 'B1-B2')

    unit_ap = unit.get('ap', {}) if isinstance(unit, dict) else {}
    unit_number = unit_ap.get('unitNumber')
    unit_title = get_i18n_text(unit.get('title', {}), ui_language) if isinstance(unit, dict) else ''
    module_title = get_i18n_text(module.get('title', {}), ui_language)
    module_goal = get_i18n_text(module.get('moduleGoal', {}), ui_language)

    seed = situation.get('seed', {}) if isinstance(situation, dict) else {}
    roles = seed.get('roles', []) if isinstance(seed, dict) else []
    setting = seed.get('setting', 'roleplay')
    register = seed.get('register', 'mixed')
    notes = seed.get('notes', '')
    constraints = seed.get('constraints', {}) if isinstance(seed, dict) else {}
    min_turns = constraints.get('minTurns') if isinstance(constraints, dict) else None
    max_turns = constraints.get('maxTurns') if isinstance(constraints, dict) else None
    time_limit_sec = constraints.get('timeLimitSec') if isinstance(constraints, dict) else None

    constraint_parts = []
    if isinstance(min_turns, int):
        constraint_parts.append(f"min turns: {min_turns}")
    if isinstance(max_turns, int):
        constraint_parts.append(f"max turns: {max_turns}")
    if isinstance(time_limit_sec, int):
        constraint_parts.append(f"time limit: {time_limit_sec} seconds")
    constraints_text = ', '.join(constraint_parts) if constraint_parts else 'No strict turn/time constraint.'

    objective_lines = []
    for objective in objectives[:5]:
        can_do = get_i18n_text(objective.get('canDo', {}), ui_language)
        if can_do:
            objective_lines.append(f"- {can_do}")
    if not objective_lines:
        objective_lines.append('- Keep practice aligned with the module goal and selected speaking mode.')

    support_target_lines = format_support_target_lines(module, ui_language)
    if not support_target_lines:
        support_target_lines = ['- Focus on fluency, clarity, vocabulary control, and culturally appropriate register.']

    mode_label = {
        'interpersonal_speaking': 'Interpersonal speaking roleplay',
        'presentational_speaking': 'Presentational speaking practice',
    }.get(mode, mode)
    tutor_role = get_curriculum_tutor_role(roles)
    ui_language_name = 'English' if ui_language == 'en' else 'Korean'
    presentational_rule = (
        'Ask the learner to deliver a short structured talk first, then ask targeted follow-up questions.'
        if mode == 'presentational_speaking'
        else 'Keep the exchange interactive with natural back-and-forth turns.'
    )

    return f"""You are Lingu, an encouraging French speaking tutor for Lingual curriculum practice.

SESSION CONTEXT:
- Target language: French (fr-FR)
- Curriculum: {curriculum_title}
- Level band: {level_band}
- Unit: {unit_number if unit_number else '?'} - {unit_title}
- Module: {module_title}
- Module goal: {module_goal}
- Practice mode: {mode_label}
- Scenario setting: {setting}
- Roles: user is learner/presenter; you are {tutor_role}
- Register: {register} (respect tu/vous choices)
- Constraints: {constraints_text}
- Scenario notes: {notes if notes else 'n/a'}

SITUATION OBJECTIVES (CAN-DO):
{chr(10).join(objective_lines)}

SUPPORT TARGET HIGHLIGHTS:
{chr(10).join(support_target_lines)}

TUTOR BEHAVIOR RULES:
1. Run a roleplay where you stay in character as the non-learner role.
2. Keep conversation primarily in French and keep turns concise.
3. {presentational_rule}
4. Keep momentum with follow-up questions and clear prompts.
5. Give gentle corrective feedback with recasts; at most 1-2 corrections per learner turn.
6. If clarification is necessary, give a brief explanation in {ui_language_name}, then return to French.
7. Respect the selected register and avoid abrupt topic changes.
"""


def build_system_prompt(proficiency_context):
    return f"""You are Lingu, a friendly and encouraging Korean language tutor AI. Your role is to help users practice and improve their Korean speaking skills through conversation.

{proficiency_context}

TEACHING GUIDELINES:
1. ADAPT to the user's level - use simpler Korean for beginners, more complex for advanced
2. ALWAYS provide Korean text with romanization for beginners (levels 0-2)
3. For intermediate+ users (levels 3-5), you can use more Korean with less romanization
4. CORRECT mistakes gently and explain why
5. ENCOURAGE the user and celebrate their progress
6. Mix Korean and English based on their level - more English for beginners
7. Focus on their WEAK areas based on the domain scores above
8. Keep responses conversational and not too long

RESPONSE FORMAT:
- Use natural conversation style
- When teaching new words/phrases, format as: Korean (romanization) - English meaning
- For corrections, be specific but kind
- End responses with a follow-up question or prompt to keep the conversation going

Remember: You're a supportive tutor, not a strict teacher. Make learning fun!"""


@app.route('/api/chat', methods=['POST'])
@login_required
def api_chat():
    uid = get_current_user_uid()
    data = request.get_json()
    user_message = data.get('message', '').strip()

    if not user_message:
        return jsonify({'error': 'Message is required'}), 400

    if not os.environ.get('OPENAI_API_KEY'):
        return jsonify({'error': 'OpenAI API key not configured'}), 500

    # Load chat history from database
    chat_history = db.get_chat_history(uid, limit=20)

    proficiency_context = get_user_proficiency_context()
    system_prompt = build_system_prompt(proficiency_context)

    messages = [{"role": "system", "content": system_prompt}]

    # Only include role and content for OpenAI API
    for msg in chat_history[-10:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": user_message})

    try:
        client = get_openai_client()
        if not client:
            return jsonify({'error': 'OpenAI API key not configured', 'success': False}), 500

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=500,
            temperature=0.7
        )

        assistant_message = response.choices[0].message.content

        # Save messages to database
        db.append_chat_message(uid, "user", user_message)
        db.append_chat_message(uid, "assistant", assistant_message)

        return jsonify({
            'response': assistant_message,
            'success': True
        })

    except Exception as e:
        return jsonify({
            'error': str(e),
            'success': False
        }), 500


@app.route('/api/chat/reset', methods=['POST'])
@login_required
def api_chat_reset():
    uid = get_current_user_uid()
    session.pop('chat_history', None)

    # Clear in database
    db.clear_chat_history(uid)

    return jsonify({'success': True, 'message': 'Chat history cleared'})


# ============================================
# PRONUNCIATION PRACTICE API ENDPOINTS
# ============================================

@app.route('/api/azure/speech-token', methods=['POST'])
@login_required
def api_speech_token():
    """Issue a short-lived Azure Speech token for the browser SDK."""
    speech_key = os.environ.get('AZURE_SPEECH_KEY')
    speech_region = os.environ.get('AZURE_SPEECH_REGION')

    if not speech_key or not speech_region:
        return jsonify({'success': False, 'error': 'Azure Speech credentials not configured'}), 500

    try:
        response = requests.post(
            f'https://{speech_region}.api.cognitive.microsoft.com/sts/v1.0/issueToken',
            headers={'Ocp-Apim-Subscription-Key': speech_key}
        )
        if response.status_code != 200:
            return jsonify({'success': False, 'error': response.text}), response.status_code

        expires_at = (datetime.utcnow() + timedelta(minutes=9)).isoformat() + 'Z'

        return jsonify({
            'success': True,
            'token': response.text,
            'region': speech_region,
            'expires_at': expires_at
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/pronunciation/sessions', methods=['POST'])
@login_required
def api_create_pronunciation_session():
    """Create a pronunciation practice session."""
    uid = get_current_user_uid()
    data = request.get_json() or {}

    locale = data.get('locale', 'ko-KR')
    kind = data.get('kind', 'practice')
    prompt_set_id = data.get('promptSetId')
    objective_id = data.get('objectiveId')

    if locale not in ALLOWED_LEARNING_LOCALES:
        return jsonify({'success': False, 'error': 'Invalid locale'}), 400

    try:
        session_id = db.create_pronunciation_session(uid, locale, kind, prompt_set_id, objective_id)
        return jsonify({'success': True, 'sessionId': session_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/pronunciation/attempts', methods=['POST'])
@login_required
def api_save_pronunciation_attempt():
    """Save a pronunciation assessment attempt."""
    uid = get_current_user_uid()
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
    if not locale or locale not in ALLOWED_LEARNING_LOCALES:
        return jsonify({'success': False, 'error': 'Invalid locale'}), 400

    try:
        session = db.get_pronunciation_session(uid, session_id)
        if not session:
            return jsonify({'success': False, 'error': 'Session not found'}), 404

        attempt_id = db.add_pronunciation_attempt(uid, session_id, {
            'prompt_id': prompt_id,
            'objective_id': objective_id,
            'reference_text': reference_text,
            'recognized_text': recognized_text,
            'locale': locale,
            'scores': scores,
            'words': words,
            'raw_result': raw_result,
            'audio_url': audio_url
        })
        return jsonify({'success': True, 'attemptId': attempt_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/pronunciation/sessions/<session_id>/attempts', methods=['GET'])
@login_required
def api_get_pronunciation_attempts(session_id):
    """Get pronunciation attempts for a session."""
    uid = get_current_user_uid()
    objective_id = request.args.get('objectiveId')
    try:
        session = db.get_pronunciation_session(uid, session_id)
        if not session:
            return jsonify({'success': False, 'error': 'Session not found'}), 404

        attempts = db.get_pronunciation_attempts(uid, session_id, limit=50, objective_id=objective_id)
        return jsonify({'success': True, 'attempts': attempts})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================
# CHAT SESSION API ENDPOINTS
# ============================================

@app.route('/api/chats', methods=['GET'])
@login_required
def api_get_chats():
    """Get all chat sessions for the user."""
    uid = get_current_user_uid()
    try:
        sessions = db.get_chat_sessions(uid)
        return jsonify({
            'success': True,
            'chats': sessions
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/chats', methods=['POST'])
@login_required
def api_create_chat():
    """Create a new chat session."""
    uid = get_current_user_uid()
    data = request.get_json() or {}
    title = data.get('title', 'New Chat')

    try:
        chat_id = db.create_chat_session(uid, title)
        return jsonify({
            'success': True,
            'chatId': chat_id,
            'title': title
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/chats/<chat_id>', methods=['GET'])
@login_required
def api_get_chat(chat_id):
    """Get a specific chat session with messages."""
    uid = get_current_user_uid()
    try:
        chat = db.get_chat_session(uid, chat_id)
        if not chat:
            return jsonify({'success': False, 'error': 'Chat not found'}), 404
        return jsonify({
            'success': True,
            'chat': chat
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/chats/<chat_id>', methods=['DELETE'])
@login_required
def api_delete_chat(chat_id):
    """Delete a chat session."""
    uid = get_current_user_uid()
    try:
        db.delete_chat_session(uid, chat_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/chats/<chat_id>/title', methods=['PUT'])
@login_required
def api_update_chat_title(chat_id):
    """Update a chat session's title."""
    uid = get_current_user_uid()
    data = request.get_json()
    title = data.get('title')

    if not title:
        return jsonify({'success': False, 'error': 'Title is required'}), 400

    try:
        db.update_chat_title(uid, chat_id, title)
        return jsonify({'success': True, 'title': title})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/chats/<chat_id>/messages/save', methods=['POST'])
@login_required
def api_save_message(chat_id):
    """Save a single message to a chat (no AI response). Used for realtime chat."""
    uid = get_current_user_uid()
    data = request.get_json()
    role = data.get('role', '').strip()
    content = data.get('content', '').strip()

    if not role or role not in ['user', 'assistant']:
        return jsonify({'success': False, 'error': 'Invalid role'}), 400

    if not content:
        return jsonify({'success': False, 'error': 'Content is required'}), 400

    try:
        # Verify chat exists
        chat = db.get_chat_session(uid, chat_id)
        if not chat:
            return jsonify({'success': False, 'error': 'Chat not found'}), 404

        # Save message
        message = db.add_message_to_chat(uid, chat_id, role, content)

        # Generate title if this is the first user message
        chat_messages = chat.get('messages', [])
        if len(chat_messages) == 0 and role == 'user':
            try:
                client = get_openai_client()
                if client:
                    title_response = client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[
                            {
                                "role": "system",
                                "content": "Generate a very brief chat title (max 30 characters) in the same language as the user's message. Just return the title, nothing else. No quotes."
                            },
                            {
                                "role": "user",
                                "content": f"User message: {content}"
                            }
                        ],
                        max_tokens=30,
                        temperature=0.5
                    )
                    title = title_response.choices[0].message.content.strip()[:40]
                    db.update_chat_title(uid, chat_id, title)
            except Exception:
                # Fallback to truncated message
                title = content[:30] + ('...' if len(content) > 30 else '')
                db.update_chat_title(uid, chat_id, title)

        return jsonify({
            'success': True,
            'message': message
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/chats/<chat_id>/messages', methods=['POST'])
@login_required
def api_send_chat_message(chat_id):
    """Send a message in a specific chat session."""
    uid = get_current_user_uid()
    data = request.get_json()
    user_message = data.get('message', '').strip()

    if not user_message:
        return jsonify({'success': False, 'error': 'Message is required'}), 400

    if not os.environ.get('OPENAI_API_KEY'):
        return jsonify({'success': False, 'error': 'OpenAI API key not configured'}), 500

    try:
        # Load chat history for this specific chat
        chat = db.get_chat_session(uid, chat_id)
        if not chat:
            return jsonify({'success': False, 'error': 'Chat not found'}), 404

        chat_messages = chat.get('messages', [])

        proficiency_context = get_user_proficiency_context()
        system_prompt = build_system_prompt(proficiency_context)

        messages = [{"role": "system", "content": system_prompt}]

        # Include recent messages for context
        for msg in chat_messages[-10:]:
            messages.append({"role": msg["role"], "content": msg["content"]})

        messages.append({"role": "user", "content": user_message})

        client = get_openai_client()
        if not client:
            return jsonify({'success': False, 'error': 'OpenAI client not initialized'}), 500

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=500,
            temperature=0.7
        )

        assistant_message = response.choices[0].message.content

        # Save messages to this specific chat
        user_msg = db.add_message_to_chat(uid, chat_id, "user", user_message)
        assistant_msg = db.add_message_to_chat(uid, chat_id, "assistant", assistant_message)

        # Auto-generate title from first message using AI
        if len(chat_messages) == 0:
            try:
                title_response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {
                            "role": "system",
                            "content": "Generate a very brief chat title (max 30 characters) in the same language as the user's message. Just return the title, nothing else. No quotes."
                        },
                        {
                            "role": "user",
                            "content": f"User: {user_message}\nAssistant: {assistant_message[:200]}"
                        }
                    ],
                    max_tokens=30,
                    temperature=0.5
                )
                title = title_response.choices[0].message.content.strip()[:40]
            except Exception:
                # Fallback to truncated message if AI fails
                title = user_message[:30] + ('...' if len(user_message) > 30 else '')
            db.update_chat_title(uid, chat_id, title)

        return jsonify({
            'success': True,
            'response': assistant_message,
            'userMessage': user_msg,
            'assistantMessage': assistant_msg
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/user/profile')
@login_required
def api_user_profile():
    """Get user profile from database."""
    uid = get_current_user_uid()

    # Get user data from database
    user_data = db.get_user(uid)

    if not user_data:
        return jsonify({
            'assessed': False,
            'message': 'User not found'
        }), 404

    # Extract profile data
    profile = user_data.get('profile', {})
    results = user_data.get('results')
    assessment = user_data.get('assessment', {})

    # Profile fields
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

    # Check if assessment is completed
    is_assessed = assessment.get('completed', False) and results is not None

    # Check if profile is completed
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
        'school_name': school_name
    }

    if not is_assessed:
        return jsonify({
            **base_response,
            'assessed': False,
            'message': 'Please complete the assessment first'
        })

    global_stage = results.get('global_stage', 0)
    sklc_info = get_sklc_description(global_stage)

    return jsonify({
        **base_response,
        'assessed': True,
        'global_stage': global_stage,
        'sklc_level': sklc_info['level'],
        'sklc_description': sklc_info['description'],
        'domain_bands': results.get('domain_bands', {})
    })


@app.route('/api/assessment/status')
def api_assessment_status():
    assessment_data = get_assessment()
    return jsonify({
        'current_index': session.get('current_item_index', 0),
        'total_items': len(assessment_data['items']),
        'responses_count': len(session.get('assessment_responses', {}))
    })


@app.route('/api/set-language', methods=['POST'])
def api_set_language():
    data = request.get_json()
    lang = data.get('language', 'en')
    if lang in ['en', 'ko']:
        session['ui_language'] = lang

        # Save to database if user is logged in
        uid = get_current_user_uid()
        if uid:
            db.update_user_profile(uid, ui_language=lang)

        return jsonify({'success': True, 'language': lang})
    return jsonify({'success': False, 'error': 'Invalid language'}), 400


# ============================================
# NEW JSON API ENDPOINTS FOR REACT FRONTEND
# ============================================

@app.route('/api/profile', methods=['POST'])
@login_required
def api_update_profile():
    """Update user profile information (JSON API)."""
    uid = get_current_user_uid()
    data = request.get_json()

    # Extract new profile fields
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

    if learning_locale and learning_locale not in ALLOWED_LEARNING_LOCALES:
        return jsonify({'success': False, 'error': 'Invalid learning locale'}), 400

    # Save to database
    db.update_user_profile(
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
        school_name=school_name
    )

    # Only reset assessment if this is NOT an edit (first time setup)
    if not is_edit:
        db.reset_assessment(uid)
        session.pop('assessment_responses', None)
        session.pop('current_item_index', None)
        session.pop('assessment_results', None)

    # Keep session for quick access
    session['user_profile'] = {
        'display_name': display_name,
        'age': age,
        'gender': gender,
        'rigor': rigor,
        'frequency': frequency,
        'frequency_unit': frequency_unit,
        'level_objective': level_objective,
        'avatar_url': avatar_url,
        'contact_email': contact_email,
        'grade_level': grade_level,
        'native_language': native_language,
        'learning_locale': learning_locale or 'ko-KR',
        'location': location,
        'school_name': school_name
    }

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
            'schoolName': school_name
        }
    })


@app.route('/api/assessment/items', methods=['GET'])
@login_required
def api_assessment_items():
    """Get all assessment items and current progress (JSON API)."""
    uid = get_current_user_uid()
    assessment_data = get_assessment()

    # Load assessment state from database
    assessment_state = db.get_assessment_state(uid)
    if assessment_state:
        current_index = assessment_state.get('current_item_index', 0)
        responses = assessment_state.get('responses', {})
    else:
        current_index = session.get('current_item_index', 0)
        responses = session.get('assessment_responses', {})

    return jsonify({
        'items': assessment_data['items'],
        'totalItems': len(assessment_data['items']),
        'currentIndex': current_index,
        'responses': responses,
        'title': assessment_data['title']
    })


@app.route('/api/assessment/submit', methods=['POST'])
@login_required
def api_assessment_submit_json():
    """Submit an assessment response (JSON API)."""
    uid = get_current_user_uid()
    data = request.get_json()

    item_id = data.get('itemId')
    response = data.get('response', '')

    if not item_id:
        return jsonify({'success': False, 'error': 'Item ID is required'}), 400

    assessment_data = get_assessment()
    items = assessment_data['items']

    # Find current index based on item_id
    current_index = next(
        (i for i, item in enumerate(items) if item['id'] == item_id),
        None
    )

    if current_index is None:
        return jsonify({'success': False, 'error': 'Invalid item ID'}), 400

    # Save response
    responses = session.get('assessment_responses', {})
    responses[item_id] = response
    session['assessment_responses'] = responses
    session['current_item_index'] = current_index + 1

    # Save to database
    db.update_assessment_response(uid, item_id, response, current_index + 1)

    is_complete = (current_index + 1) >= len(items)

    return jsonify({
        'success': True,
        'nextIndex': current_index + 1,
        'isComplete': is_complete
    })


@app.route('/api/assessment/skip', methods=['POST'])
@login_required
def api_assessment_skip_json():
    """Skip current assessment question (JSON API)."""
    uid = get_current_user_uid()
    data = request.get_json()

    item_id = data.get('itemId')

    if not item_id:
        return jsonify({'success': False, 'error': 'Item ID is required'}), 400

    assessment_data = get_assessment()
    items = assessment_data['items']

    # Find current index based on item_id
    current_index = next(
        (i for i, item in enumerate(items) if item['id'] == item_id),
        None
    )

    if current_index is None:
        return jsonify({'success': False, 'error': 'Invalid item ID'}), 400

    # Save empty response
    responses = session.get('assessment_responses', {})
    responses[item_id] = ''
    session['assessment_responses'] = responses
    session['current_item_index'] = current_index + 1

    # Save to database
    db.update_assessment_response(uid, item_id, '', current_index + 1)

    is_complete = (current_index + 1) >= len(items)

    return jsonify({
        'success': True,
        'nextIndex': current_index + 1,
        'isComplete': is_complete
    })


@app.route('/api/assessment/results', methods=['GET'])
@login_required
def api_assessment_results_json():
    """Get computed assessment results (JSON API)."""
    uid = get_current_user_uid()

    # Try to get results from session or database
    results = session.get('assessment_results')
    if not results:
        results = db.get_assessment_results(uid)

    # Compute results if we have responses but no results
    if not results:
        responses = session.get('assessment_responses', {})
        if not responses:
            assessment_state = db.get_assessment_state(uid)
            if assessment_state:
                responses = assessment_state.get('responses', {})

        if responses:
            assessment_data = get_assessment()
            results = compute_results(assessment_data, responses)
            session['assessment_results'] = results
            db.save_assessment_results(uid, results)

    if results:
        global_stage = results.get('global_stage', 0)
        sklc_info = get_sklc_description(global_stage)

        return jsonify({
            'success': True,
            'results': results,
            'sklcLevel': sklc_info['level'],
            'sklcDescription': sklc_info['description']
        })

    return jsonify({
        'success': False,
        'error': 'No results available'
    }), 404


@app.route('/api/assessment/reset', methods=['POST'])
@login_required
def api_assessment_reset_json():
    """Reset assessment progress (JSON API)."""
    uid = get_current_user_uid()

    session.pop('assessment_responses', None)
    session.pop('current_item_index', None)
    session.pop('assessment_results', None)

    # Reset in database
    db.reset_assessment(uid)

    return jsonify({'success': True})


@app.route('/api/categories', methods=['POST'])
@login_required
def api_update_categories():
    """Update selected practice categories (JSON API)."""
    uid = get_current_user_uid()
    data = request.get_json()

    categories = data.get('categories', [])
    session['selected_categories'] = categories

    # Compute and save results if not already done
    if 'assessment_results' not in session:
        db_results = db.get_assessment_results(uid)
        if db_results:
            session['assessment_results'] = db_results
        elif 'assessment_responses' in session:
            assessment_data = get_assessment()
            responses = session.get('assessment_responses', {})
            if responses:
                results = compute_results(assessment_data, responses)
                session['assessment_results'] = results
                db.save_assessment_results(uid, results)

    # Save to database
    db.update_selected_categories(uid, categories)

    return jsonify({
        'success': True,
        'categories': categories
    })


# ============================================
# FLASHCARDFLIP
# ============================================

@app.route('/api/minigames/attempts', methods=['POST'])
@login_required
def api_save_minigame_attempt():
    """Save a minigame attempt for progress reporting."""
    uid = get_current_user_uid()
    data = request.get_json() or {}

    game_type = data.get('gameType')
    locale = data.get('locale')
    objective_id = data.get('objectiveId')
    scenario_id = data.get('scenarioId')
    score = data.get('score', 0)
    correct_answers = data.get('correctAnswers')
    total_questions = data.get('totalQuestions')
    accuracy = data.get('accuracy')
    duration_seconds = data.get('durationSeconds')
    metadata = data.get('metadata', {})

    if not game_type or game_type not in ALLOWED_MINIGAME_TYPES:
        return jsonify({'success': False, 'error': 'Invalid gameType'}), 400
    if not locale or locale not in ALLOWED_LEARNING_LOCALES:
        return jsonify({'success': False, 'error': 'Invalid locale'}), 400
    if correct_answers is None or total_questions is None:
        return jsonify({'success': False, 'error': 'correctAnswers and totalQuestions are required'}), 400

    try:
        score_value = int(score)
        correct_value = int(correct_answers)
        total_value = int(total_questions)
        if total_value <= 0:
            return jsonify({'success': False, 'error': 'totalQuestions must be greater than 0'}), 400
        if correct_value < 0 or correct_value > total_value:
            return jsonify({'success': False, 'error': 'correctAnswers is out of range'}), 400

        if accuracy is None:
            accuracy_value = round((correct_value / total_value) * 100, 2)
        else:
            accuracy_value = float(accuracy)

        duration_value = None if duration_seconds is None else int(duration_seconds)

        attempt_id = db.add_minigame_attempt(uid, {
            'game_type': game_type,
            'locale': locale,
            'objective_id': objective_id,
            'scenario_id': scenario_id,
            'score': score_value,
            'correct_answers': correct_value,
            'total_questions': total_value,
            'accuracy': accuracy_value,
            'duration_seconds': duration_value,
            'metadata': metadata if isinstance(metadata, dict) else {}
        })
        return jsonify({'success': True, 'attemptId': attempt_id})
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid numeric field'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/minigames/summary', methods=['GET'])
@login_required
def api_get_minigame_summary():
    """Get aggregate minigame stats for the current user."""
    uid = get_current_user_uid()
    try:
        limit = int(request.args.get('limit', 200))
        limit = max(1, min(limit, 500))
    except ValueError:
        limit = 200

    try:
        summary = db.get_minigame_summary(uid, limit=limit)
        return jsonify({'success': True, 'summary': summary})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/minigames/flashcards', methods=['POST'])
@login_required
def generate_flashcards():
    """Generate flashcards from recent chat messages"""
    uid = get_current_user_uid()
    data = request.get_json() or {}
    chat_id = data.get('chatId')
    
    if not chat_id:
        return jsonify({'error': 'chatId is required'}), 400
    
    # Get last 10 messages from the chat
    messages = db.get_chat_messages_for_context(uid, chat_id, limit=10)
    
    if not messages:
        return jsonify({'error': 'No messages found in this chat'}), 400
    
    # Format messages for the AI prompt
    conversation_text = "\n".join([
        f"{msg.get('role', 'user')}: {msg.get('content', '')}" 
        for msg in messages
    ])
    
    # Generate flashcards using OpenAI
    prompt = f"""Based on this Korean language learning conversation, create exactly 10 flashcards for vocabulary practice.

Conversation:
{conversation_text}

Create flashcards with Korean words/phrases from the conversation that would be useful to learn.
Return ONLY a JSON array with exactly 10 flashcard objects in this format:
[
  {{"korean": "안녕하세요", "english": "Hello"}},
  {{"korean": "감사합니다", "english": "Thank you"}}
]

If there aren't enough words in the conversation, add common related Korean vocabulary.
Return ONLY the JSON array, no other text."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a Korean language tutor. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7
        )
        
        result = response.choices[0].message.content.strip()
        # Clean up response if needed
        if result.startswith("```"):
            result = result.split("\n", 1)[1]
            result = result.rsplit("```", 1)[0]
        
        flashcards = json.loads(result)
        return jsonify({'flashcards': flashcards})
        
    except Exception as e:
        print(f"Error generating flashcards: {e}")
        return jsonify({'error': 'Failed to generate flashcards'}), 500

# FLASHCARDFLIP
# ============================================


# ============================================
# REACT SPA SERVING (Main Frontend)
# ============================================

REACT_BUILD_DIR = Path(__file__).parent / 'static' / 'react'
STATIC_DIR = Path(__file__).parent / 'static'

def serve_react_index():
    """Serve React app index.html"""
    if REACT_BUILD_DIR.exists():
        return send_from_directory(REACT_BUILD_DIR, 'index.html')
    return "React app not built. Run 'npm run build' in frontend/", 404

@app.route('/imgs/<path:filename>')
def serve_images(filename):
    """Serve images - check React build first, then backend static"""
    # First check React build directory (where Vite copies public/ assets)
    react_img_path = REACT_BUILD_DIR / 'imgs' / filename
    if react_img_path.exists():
        return send_from_directory(REACT_BUILD_DIR / 'imgs', filename)
    # Fallback to backend static folder
    return send_from_directory(STATIC_DIR / 'imgs', filename)

@app.route('/<path:path>')
def serve_react_or_static(path):
    """Serve React static files or fallback to index.html for SPA routing"""
    # Skip API routes - they're handled by other route handlers
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404

    if REACT_BUILD_DIR.exists():
        file_path = REACT_BUILD_DIR / path
        if file_path.exists() and file_path.is_file():
            return send_from_directory(REACT_BUILD_DIR, path)
        # SPA fallback - return index.html for client-side routing
        return send_from_directory(REACT_BUILD_DIR, 'index.html')
    return "React app not built", 404


if __name__ == '__main__':
    # Use PORT environment variable for Cloud Run, default to 5000 for local dev
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_ENV', 'development') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
