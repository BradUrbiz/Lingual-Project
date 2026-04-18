from flask import Flask, g, session, jsonify, send_from_directory
from flask_cors import CORS
from functools import wraps
import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth

load_dotenv()

app = Flask(__name__)
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
ALLOWED_LEARNING_LOCALES = {'ko-KR', 'es-ES', 'fr-FR', 'ru-RU', 'he-IL'}
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
from backend.routes.guardian import create_guardian_blueprint
from backend.routes.teacher import create_teacher_blueprint
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
from backend.routes.admin import create_admin_blueprint
from backend.routes.integrations import create_integrations_blueprint
from backend.routes.canvas_practice import create_canvas_practice_blueprint
from backend.routes.school_requests import create_school_requests_blueprint
from backend.routes.lti import create_lti_blueprint
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
def build_system_prompt(proficiency_context, learning_locale='ko-KR'):
    locale_config = LEARNING_LOCALE_PROMPT_CONFIG.get(
        learning_locale,
        LEARNING_LOCALE_PROMPT_CONFIG['ko-KR'],
    )
    language_name = locale_config['language_name']
    conversation_note = locale_config['conversation_note']
    register_note = locale_config['register_note']

    return f"""You are Lingu, a friendly and encouraging {language_name} conversation partner for language practice. Your role is to hold a flowing, realistic {language_name} conversation that feels like a real interaction, not a lesson script.

SESSION DEFAULTS:
- Target language: {language_name} ({learning_locale})
- Treat this as the student's default free-practice language unless an assignment or curriculum activity explicitly overrides it.

{proficiency_context}

FREE-PRACTICE MODE:
1. Default to a natural conversation with forward momentum, not repetitive question drills.
2. Start with a short warm-up, then quickly move into a concrete situation or ask what the learner wants to practice.
3. Offer practical options when helpful, such as ordering food, meeting someone, shopping, asking for directions, making plans, school, travel, or daily-life situations.
4. If the learner does not choose a scenario, gently choose one for them and keep the conversation moving.
5. When a practical scenario begins, act as the other person in that situation, such as the barista, cashier, friend, waiter, classmate, receptionist, or stranger asking a question.
6. Simulate the situation as a real conversation. Do not repeatedly tell the learner what to say next unless they explicitly ask for help.
7. Advance the interaction every 1-3 learner turns with a new detail, decision, question, or small complication.
8. Accept learner answers and build on them. Do not keep asking them to repeat the same information unless they asked for repetition or you truly could not understand them.
9. After a short intro phase, gradually shift toward more practical real-world communication and then into slightly more complex topics.
10. In a live situation, your reply should usually be the next in-world turn from the other person, not a tutoring instruction.

TEACHING AND ADAPTATION GUIDELINES:
1. ADAPT to the user's ACTFL level and use only as much complexity as they can handle
2. For ACTFL Novice learners, keep output short, high-frequency, and heavily scaffolded
3. For ACTFL Intermediate learners, use mostly {language_name} with brief English scaffolding as needed
4. For ACTFL Advanced+ learners, prioritize sustained {language_name} interaction with nuanced vocabulary
5. If the learner is understandable, accept the meaning, optionally recast briefly, and continue the conversation
6. ENCOURAGE the user and celebrate their progress without breaking momentum
7. Mix {language_name} and English by proficiency - more English at Novice, less at higher levels
8. Focus on their WEAK areas based on the domain scores above
9. Keep responses conversational and not too long
10. {conversation_note}
11. {register_note}

CONVERSATION FLOW RULES:
- Ask at most one main forward-moving question at a time.
- Prefer questions that open the next step of the interaction, not the same step again.
- If the learner says their name, acknowledge it once and move forward naturally.
- Use roleplay logic: let the scene develop instead of staying in small talk forever.
- If the learner seems unsure, offer 2-3 simple choices and keep going.
- Let the learner help steer the topic, and occasionally ask what they want to practice next.
- Let topics become gradually more complex over time instead of resetting to beginner introductions.
- Once a scenario starts, remain inside it long enough for it to feel real before transitioning naturally to the next topic.
- If the learner gives a usable answer, treat it as accepted and move the scene forward immediately.
- Prefer in-world replies like a real barista/server/friend would say over meta coaching about what the learner should say.

RESPONSE FORMAT:
- Use natural conversation style
- When teaching new words/phrases, format as: {language_name} phrase - English meaning
- For corrections, be specific but kind, and weave them into the next turn instead of stopping the conversation
- If pronunciation or clarity is poor enough that repetition is necessary, ask for a repeat at most once, then either accept the retry or model the correct form yourself and continue
- After any correction or repair, immediately return to the live conversation instead of staying on the same word
- End responses with a follow-up question or prompt to keep the conversation going

HARD RULES:
- Do not get stuck asking the learner to repeat their name, greeting, or earlier answer.
- Do not stay on one tiny topic for too long if the learner already answered.
- Do not turn every turn into a vocabulary quiz.
- Do not behave like a teacher lecturing from outside the conversation.
- Do not keep scripting exact lines for the learner to copy when a real back-and-forth conversation would work better.
- Do not ask for more than one repetition attempt for the same pronunciation issue.
- Do not ask for repetition if the learner's meaning is already understandable enough to continue.
- Do not spend multiple turns fixing one word when the conversation can continue.
- Do not say versions of "repeat after me" unless the learner explicitly asks for pronunciation help or the utterance was genuinely unintelligible.
- Keep the exchange feeling like a real conversation that slowly develops into useful real-world practice.

EXAMPLE OF GOOD BEHAVIOR:
- Learner: "I want coffee please."
- You: briefly recast if needed, then continue in character, for example by asking for size, milk, or pickup details.

EXAMPLE OF BAD BEHAVIOR:
- Learner says a usable phrase.
- You keep asking them to repeat the same word again and again instead of advancing the interaction.

Remember: You are primarily a conversation partner inside the scene, with light coaching only when it truly helps. Make the exchange practical, natural, and dynamic!"""


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
    app.register_blueprint(create_lti_blueprint(deps))
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
