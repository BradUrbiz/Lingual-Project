from flask import Flask, g, session, jsonify, send_from_directory
from flask_cors import CORS
from functools import wraps, lru_cache
import json
import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth

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

from scoring import load_assessment_data, compute_results, get_actfl_description
import database as db
from backend.avatar_chat import register_avatar_chat_routes
from backend.route_deps import RouteDeps
from backend.routes.auth import create_auth_blueprint
from backend.routes.chat import create_chat_blueprint
from backend.routes.assessment import create_assessment_blueprint
from backend.routes.pronunciation import create_pronunciation_blueprint
from backend.routes.games import create_games_blueprint
from backend.routes.schools import create_schools_blueprint
from backend.routes.teacher import create_teacher_blueprint
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
from backend.services.membership_context import (
    SchoolContextNotFoundError,
    resolve_school_request_context,
)


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


# Old template routes removed - now using React SPA
# All page rendering is handled by React at the root path
# API endpoints below handle data operations


def get_user_proficiency_context():
    uid = get_current_user_uid()

    # Get profile context from database
    if uid:
        profile_context = db.get_user_profile_context(uid) or {}
    else:
        profile_context = {}

    results = profile_context.get('results') or {}
    display_name = profile_context.get('display_name', '')
    age = profile_context.get('age')
    rigor = profile_context.get('rigor', '')
    frequency = profile_context.get('frequency')
    frequency_unit = profile_context.get('frequency_unit', '')
    level_objective = profile_context.get('level_objective', '')

    if not results:
        return "The user has not completed their assessment yet. Assume beginner level."

    global_stage = results.get('global_stage', 0)
    framework = results.get('framework', 'ACTFL')
    domain_bands = results.get('domain_bands', {})
    domain_scores = results.get('domain_raw_scores', {})
    band_scale = results.get('band_scale')
    if band_scale is None:
        max_band = max(domain_bands.values(), default=0)
        band_scale = 5 if max_band <= 5 and global_stage <= 5 else 10

    proficiency_level = results.get('proficiency_level') or results.get('actfl_level')
    proficiency_description = (
        results.get('proficiency_description_en')
        or results.get('actfl_description_en')
    )
    if not proficiency_level or not proficiency_description:
        proficiency_info = get_actfl_description(global_stage, lang='en')
        proficiency_level = proficiency_info['level']
        proficiency_description = proficiency_info['description']

    domain_label_map = {
        'interpretive_comprehension': 'Interpretive Comprehension',
        'interpersonal_communication': 'Interpersonal Communication',
        'presentational_communication': 'Presentational Communication',
        'language_control': 'Language Control',
        'pronunciation': 'Pronunciation',
        # Backward-compatible labels for older stored results.
        'grammar': 'Grammar',
        'vocabulary': 'Vocabulary',
        'pragmatics': 'Pragmatics',
    }

    domain_lines = []
    for domain, band in sorted(domain_bands.items(), key=lambda entry: entry[1], reverse=True):
        label = domain_label_map.get(domain, domain.replace('_', ' ').title())
        score = float(domain_scores.get(domain, 0.0))
        domain_lines.append(f"- {label}: Band {band}/{band_scale} (Score: {score:.2f})")

    if not domain_lines:
        domain_lines = ['- No domain data available.']

    # Format frequency string
    frequency_str = f"{frequency} times per {frequency_unit}" if frequency and frequency_unit else 'Not specified'

    context = f"""
USER PROFICIENCY PROFILE:
- Name: {display_name if display_name else 'Not specified'}
- Age: {age if age else 'Not specified'}
- Overall Level: {proficiency_level} ({framework}, Stage {global_stage}/{band_scale})
- Description: {proficiency_description}

DOMAIN BREAKDOWN:
{chr(10).join(domain_lines)}

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
1. ADAPT to the user's ACTFL level and use only as much complexity as they can handle
2. For ACTFL Novice learners, keep output short, high-frequency, and include romanization when helpful
3. For ACTFL Intermediate learners, use mostly Korean with brief English scaffolding as needed
4. For ACTFL Advanced+ learners, prioritize sustained Korean interaction with nuanced vocabulary
5. CORRECT mistakes gently and explain why
6. ENCOURAGE the user and celebrate their progress
7. Mix Korean and English by proficiency - more English at Novice, less at higher levels
8. Focus on their WEAK areas based on the domain scores above
9. Keep responses conversational and not too long

RESPONSE FORMAT:
- Use natural conversation style
- When teaching new words/phrases, format as: Korean (romanization) - English meaning
- For corrections, be specific but kind
- End responses with a follow-up question or prompt to keep the conversation going

Remember: You're a supportive tutor, not a strict teacher. Make learning fun!"""


def register_domain_blueprints():
    def get_school_request_context():
        cached_context = getattr(g, 'school_request_context', None)
        if cached_context is not None:
            return cached_context

        uid = get_current_user_uid()
        if not uid:
            raise PermissionError('Authentication required.')

        preferred_active_membership_id = (session.get('user') or {}).get('active_membership_id')
        context = resolve_school_request_context(
            db,
            uid,
            preferred_active_membership_id=preferred_active_membership_id,
        )

        if 'user' in session:
            session['user']['active_membership_id'] = context.active_membership_id
        db.set_user_last_active_membership(uid, context.active_membership_id)
        g.school_request_context = context
        return context

    def set_active_school_membership(membership_id):
        uid = get_current_user_uid()
        if not uid:
            raise PermissionError('Authentication required.')

        context = resolve_school_request_context(
            db,
            uid,
            preferred_active_membership_id=membership_id,
        )
        if context.active_membership_id != membership_id:
            raise SchoolContextNotFoundError('Membership not found for the current user.')

        if 'user' in session:
            session['user']['active_membership_id'] = context.active_membership_id
        db.set_user_last_active_membership(uid, context.active_membership_id)
        g.school_request_context = context
        return context

    deps = RouteDeps(
        db=db,
        firebase_auth=firebase_auth,
        get_current_user_uid=get_current_user_uid,
        get_openai_client=get_openai_client,
        get_assessment=get_assessment,
        compute_results=compute_results,
        get_proficiency_description=get_actfl_description,
        login_required=login_required,
        get_user_proficiency_context=get_user_proficiency_context,
        build_system_prompt=build_system_prompt,
        load_sample_curriculum_package=load_sample_curriculum_package,
        get_curriculum_practice_context=get_curriculum_practice_context,
        build_curriculum_system_prompt=build_curriculum_system_prompt,
        get_school_request_context=get_school_request_context,
        set_active_school_membership=set_active_school_membership,
        allowed_learning_locales=ALLOWED_LEARNING_LOCALES,
        allowed_minigame_types=ALLOWED_MINIGAME_TYPES,
        supported_ui_languages=SUPPORTED_UI_LANGUAGES,
    )

    app.register_blueprint(create_auth_blueprint(deps))
    app.register_blueprint(create_chat_blueprint(deps))
    app.register_blueprint(create_assessment_blueprint(deps))
    app.register_blueprint(create_pronunciation_blueprint(deps))
    app.register_blueprint(create_games_blueprint(deps))
    app.register_blueprint(create_schools_blueprint(deps))
    app.register_blueprint(create_teacher_blueprint(deps))
    app.register_blueprint(create_curriculum_admin_blueprint(deps))
    register_avatar_chat_routes(app, deps)


register_domain_blueprints()


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
