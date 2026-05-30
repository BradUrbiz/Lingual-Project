from flask import Flask, g, session, jsonify, send_from_directory
from flask_cors import CORS
from functools import wraps
import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from werkzeug.middleware.proxy_fix import ProxyFix

load_dotenv()


def _validate_required_env() -> None:
    """Fail fast in production (warn in dev) when required env vars are missing.

    Why: otherwise missing keys surface as 500/503s at feature-use time, which
    is far later and noisier than refusing to boot. The Canvas PAT encryption
    key drifting out of prod caused exactly this (silent 503 on connect).
    """
    is_production = os.environ.get('FLASK_ENV') == 'production'
    secret = os.environ.get('SECRET_KEY', '')
    hard = {
        'OPENAI_API_KEY': 'AI chat, realtime voice, and scoring will fail',
        'SECRET_KEY': 'Flask session security (dev fallback is insecure)',
    }
    feature = {
        'CANVAS_PAT_ENCRYPTION_KEY': 'Canvas connect returns 503 when a teacher clicks Connect',
        'PUBLIC_BASE_URL': 'Email CTAs ship with relative URLs which break in email clients',
        'SUPPORT_EMAIL': 'Plan 5 — falls back to help@l1ngual.com if unset; surfaces in org_suspended email footer',
        'INSTANCE_CONNECTION_NAME': 'Cloud SQL disabled; Postgres-backed features (none yet) fall back to Firestore',
    }
    missing_hard = [
        f'  - {k}: {reason}'
        for k, reason in hard.items()
        if not os.environ.get(k)
        or (k == 'SECRET_KEY' and secret == 'dev-secret-key-change-in-production')
    ]
    missing_feature = [
        f'  - {k}: {reason}' for k, reason in feature.items() if not os.environ.get(k)
    ]
    if missing_hard:
        msg = 'Required environment variables missing:\n' + '\n'.join(missing_hard)
        if is_production:
            raise RuntimeError(msg)
        print(f'[startup warning] {msg}')
    if missing_feature:
        print(
            '[startup warning] Feature-gated env vars missing:\n'
            + '\n'.join(missing_feature)
        )


_validate_required_env()

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=0, x_host=0, x_port=0, x_prefix=0)
_secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
if os.environ.get('FLASK_ENV') == 'production' and _secret_key == 'dev-secret-key-change-in-production':
    raise RuntimeError('SECRET_KEY must be set in production — do not use the dev fallback')
app.secret_key = _secret_key

# Session cookie configuration for production (Cloud Run uses HTTPS)
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Enable CORS for React development server
CORS(app, origins=['http://localhost:5173', 'http://localhost:3000'], supports_credentials=True)

# Initialize Firebase Admin SDK
firebase_app = None
FIREBASE_PROJECT_ID = os.environ.get('GOOGLE_CLOUD_PROJECT', 'lingu-480600')
ALLOWED_LEARNING_LOCALES = {'ko-KR', 'es-ES', 'fr-FR', 'ru-RU', 'he-IL', 'tl-PH'}
ALLOWED_MINIGAME_TYPES = {'listening_quiz', 'grammar_challenge'}
SUPPORTED_UI_LANGUAGES = {'en', 'ko'}
LEARNING_LOCALE_PROMPT_CONFIG = {
    'ko-KR': {
        'language_name': 'Korean',
        'conversation_note': 'Use natural Korean and include romanization only when it genuinely helps beginner learners.',
        'register_note': 'Keep explanations learner-friendly and use Hangul naturally.',
    },
    'es-ES': {
        'language_name': 'Spanish',
        'conversation_note': 'Use natural spoken Spanish and include pronunciation hints only when genuinely useful.',
        'register_note': 'Keep register natural and learner-friendly.',
    },
    'fr-FR': {
        'language_name': 'French',
        'conversation_note': 'Use natural spoken French and include pronunciation hints only when genuinely useful.',
        'register_note': 'Respect tu/vous register choices whenever the conversation implies one.',
    },
    'ru-RU': {
        'language_name': 'Russian',
        'conversation_note': 'Use natural spoken Russian and include pronunciation or stress hints only when genuinely useful.',
        'register_note': 'Prefer modern everyday Russian and keep explanations learner-friendly.',
    },
    'he-IL': {
        'language_name': 'Hebrew',
        'conversation_note': 'Use natural modern Hebrew and include transliteration only when it genuinely helps beginner learners.',
        'register_note': 'Respect right-to-left Hebrew script and keep explanations learner-friendly.',
    },
    'tl-PH': {
        'language_name': 'Tagalog',
        'conversation_note': 'Use natural conversational Tagalog. Include romanization hints only when genuinely helpful for beginners. Filipino often code-switches with English — follow the learner\'s lead on mixing.',
        'register_note': 'Be mindful of formal (po/opo) vs informal register and let the conversation context guide which to use.',
    },
}
FREE_PRACTICE_LANGUAGE_MIX_LEVELS = {
    'english_first',
    'english_led',
    'balanced',
    'target_led',
    'target_only',
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
        user = session.get('user')
        if not user:
            return jsonify({'error': 'Authentication required', 'success': False}), 401
        # `is False` only — legacy sessions (and Google) lack the key (None) and
        # must pass. Only sessions explicitly marked pending are blocked.
        if user.get('email_verified') is False:
            return jsonify({'error': 'email_verification_required', 'success': False}), 403
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
from backend.route_deps import RouteDeps, _no_sql_engine
from backend.services.audit import AuditLogger
from backend.db.sql import get_engine, sql_enabled  # inert Postgres engine provider (ADR-0001)
from backend.routes.auth import create_auth_blueprint
from backend.routes.chat import create_chat_blueprint
from backend.routes.assessment import create_assessment_blueprint
from backend.routes.pronunciation import create_pronunciation_blueprint
from backend.routes.games import create_games_blueprint
from backend.routes.schools import create_schools_blueprint
from backend.routes.guardian import create_guardian_blueprint
from backend.routes.teacher import create_teacher_blueprint
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
from backend.routes.admin import create_admin_blueprint
from backend.routes.integrations import create_integrations_blueprint
from backend.routes.canvas_practice import create_canvas_practice_blueprint
from backend.routes.school_requests import create_school_requests_blueprint
from backend.routes.teacher_requests import create_teacher_requests_blueprint
from backend.routes.lti import create_lti_blueprint
from backend.routes.lingual_admin import create_lingual_admin_blueprint
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
        return (
            "The user has not completed their assessment yet. "
            "Assume ACTFL Intermediate Mid/High: comfortable with everyday "
            "topics, can sustain a conversation in the target language, and "
            "benefits from concise corrective feedback rather than heavy "
            "English scaffolding."
        )

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


def normalize_free_practice_language_mix_level(value):
    if isinstance(value, str) and value in FREE_PRACTICE_LANGUAGE_MIX_LEVELS:
        return value
    return 'balanced'


def build_free_practice_language_mix_policy(language_name, language_mix_level):
    if language_mix_level == 'english_first':
        return (
            f'The selected language mix level is english_first. Lead each turn in English and keep the conversation '
            f'accessible for a novice. Introduce any {language_name} word or short phrase with an immediate English '
            f'meaning. Accept English replies as valid progress. Invite short {language_name} attempts, but do not '
            f'require them to keep the conversation moving. Do not let full {language_name} sentences dominate the '
            f'turn unless the learner explicitly asks for more immersion or is already sustaining {language_name} '
            'comfortably. Never exceed the bounds of the selected language mix level.'
        )
    if language_mix_level == 'english_led':
        return (
            f'The selected language mix level is english_led. English leads the conversation. Open most turns in '
            f'English, then model key {language_name} phrases or short sentences with quick English support. Use '
            f'{language_name} for recasts, repeatable phrases, and scenario moves, but keep the learner safe to reply '
            f'mostly in English. If the learner increasingly sustains {language_name}, adapt somewhat toward the '
            f'learner without leaving the English-led range. Never exceed the bounds of the selected language mix '
            'level.'
        )
    if language_mix_level == 'target_led':
        return (
            f'The selected language mix level is target_led. Start mostly in {language_name} and use brief English '
            f'only when the learner stalls, asks for help, or repeatedly falls back to English. Adapt somewhat toward '
            f'the learner, but keep the conversation target-language-led. Never exceed the bounds of the selected '
            'language mix level.'
        )
    if language_mix_level == 'target_only':
        return (
            f'The selected language mix level is target_only. Stay in {language_name} for almost every turn. Use '
            'English only if the learner explicitly asks for translation or help, then return to the target language '
            'immediately. Do not adapt away from target_only unless the learner explicitly asks for translation/help.'
        )
    return (
        f'The selected language mix level is balanced. Use both English and {language_name} regularly. Observe '
        f'whether the learner is using mostly English, mostly {language_name}, or both, and adapt somewhat toward the '
        'learner while keeping the conversation balanced. never exceed the bounds of the selected language mix level.'
    )


def build_system_prompt(proficiency_context, learning_locale='ko-KR', language_mix_level='balanced'):
    locale_config = LEARNING_LOCALE_PROMPT_CONFIG.get(
        learning_locale,
        LEARNING_LOCALE_PROMPT_CONFIG['ko-KR'],
    )
    language_name = locale_config['language_name']
    conversation_note = locale_config['conversation_note']
    register_note = locale_config['register_note']
    normalized_language_mix_level = normalize_free_practice_language_mix_level(language_mix_level)
    language_mix_policy = build_free_practice_language_mix_policy(
        language_name,
        normalized_language_mix_level,
    )

    return f"""You are Lingu, a friendly {language_name} conversation partner for free practice. Hold a natural conversation that feels real, not scripted.

SESSION DEFAULTS:
- Target language: {language_name} ({learning_locale})
- Treat this as the learner's default free-practice language unless an assignment explicitly overrides it.

{proficiency_context}

LANGUAGE MIX POLICY:
- {language_mix_policy}
- When proficiency guidance and the selected language mix level pull in different directions, follow the selected language mix level for language choice.
- Let proficiency change difficulty, pacing, and correction depth, not the English-vs-target-language ratio.

CONVERSATION STYLE:
- Follow the learner's lead. If they shift the topic, shift with them and do not steer back to the previous subject.
- Adapt complexity to the learner's ACTFL level. If their meaning is clear, accept it, optionally recast briefly, and continue.
- Ask at most one forward-moving question per turn, and prefer questions that open a new step rather than revisit the same one.
- {conversation_note}
- {register_note}

RESPONSE FORMAT:
- Natural conversation style.
- New words/phrases: {language_name} phrase - English meaning.
- Corrections: brief, kind, woven into the next turn.
- End with a follow-up that opens the next step of the conversation."""


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
        get_school_request_context=get_school_request_context,
        set_active_school_membership=set_active_school_membership,
        allowed_learning_locales=ALLOWED_LEARNING_LOCALES,
        allowed_minigame_types=ALLOWED_MINIGAME_TYPES,
        supported_ui_languages=SUPPORTED_UI_LANGUAGES,
        audit_logger=AuditLogger(),
        # Postgres engine provider (Cloud SQL). When no Cloud SQL target is
        # configured, wire the None-returning sentinel so the provider's "None
        # means unavailable -> fall back to Firestore" contract holds;
        # get_engine() would otherwise raise. No engine is built until first
        # call (post-fork). Consumed by the slice-2b enrollment dual-write
        # (fail-open SHADOW, gated on DUAL_WRITE_ENROLLMENTS); Firestore stays
        # the system of record.
        sql_engine=(get_engine if sql_enabled() else _no_sql_engine),
    )

    # Surface the dual-write toggle at startup: confirm when ON, warn loudly when
    # ON without a Postgres target (every shadow write would be a silent no-op).
    if os.environ.get('DUAL_WRITE_ENROLLMENTS') == '1':
        if sql_enabled():
            print('[startup] DUAL_WRITE_ENROLLMENTS=1 — enrollment writes shadow to Postgres')
        else:
            print(
                '[startup warning] DUAL_WRITE_ENROLLMENTS=1 but no Cloud SQL target '
                '(INSTANCE_CONNECTION_NAME/DATABASE_URL) set — enrollment shadow writes '
                'are a no-op until one is configured'
            )

    app.register_blueprint(create_auth_blueprint(deps))
    app.register_blueprint(create_chat_blueprint(deps))
    app.register_blueprint(create_assessment_blueprint(deps))
    app.register_blueprint(create_pronunciation_blueprint(deps))
    app.register_blueprint(create_games_blueprint(deps))
    app.register_blueprint(create_schools_blueprint(deps))
    app.register_blueprint(create_guardian_blueprint(deps))
    app.register_blueprint(create_teacher_blueprint(deps))
    app.register_blueprint(create_curriculum_admin_blueprint(deps))
    app.register_blueprint(create_admin_blueprint(deps))
    app.register_blueprint(create_integrations_blueprint(deps))
    app.register_blueprint(create_canvas_practice_blueprint(deps))
    app.register_blueprint(create_school_requests_blueprint(deps))
    app.register_blueprint(create_teacher_requests_blueprint(deps))
    app.register_blueprint(create_lti_blueprint(deps))
    app.register_blueprint(create_lingual_admin_blueprint(deps))
    register_avatar_chat_routes(app, deps)

    # E2E test harness — development/testing only
    if os.environ.get('FLASK_ENV') in ('development', 'testing'):
        try:
            from backend.routes.test_harness import create_test_harness_blueprint
            app.register_blueprint(create_test_harness_blueprint(deps))
            print('[test_harness] E2E test endpoints registered at /api/test/*')
        except ImportError:
            pass


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
