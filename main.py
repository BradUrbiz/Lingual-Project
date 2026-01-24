from flask import Flask, request, redirect, session, jsonify, send_file, send_from_directory
from flask_cors import CORS
from functools import wraps
import json
import os
import tempfile
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
import io
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


@app.route('/')
def index():
    """Serve React SPA at root"""
    return serve_react_index()


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    """API endpoint to clear session"""
    session.clear()
    return jsonify({'success': True})


@app.route('/api/realtime/session', methods=['POST'])
@login_required
def create_realtime_session():
    """Create ephemeral token for OpenAI Realtime API."""
    try:
        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            return jsonify({'error': 'OpenAI API key not configured'}), 500

        # Get user's proficiency context for system instructions
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
                'model': 'gpt-4o-realtime-preview-2024-12-17',
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


@app.route('/api/chat/voice', methods=['POST'])
@login_required
def api_chat_voice():
    uid = get_current_user_uid()

    try:
        if not os.environ.get('OPENAI_API_KEY'):
            return jsonify({'error': 'OpenAI API key not configured', 'success': False}), 500

        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided', 'success': False}), 400

        audio_file = request.files['audio']

        temp_audio = tempfile.NamedTemporaryFile(delete=False, suffix='.webm')
        audio_file.save(temp_audio.name)
        temp_audio.close()

        client = get_openai_client()
        if not client:
            return jsonify({'error': 'OpenAI client not initialized', 'success': False}), 500

        with open(temp_audio.name, 'rb') as audio:
            transcript_response = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio,
                language="ko"
            )

        transcript = transcript_response.text

        os.unlink(temp_audio.name)

        if not transcript or not transcript.strip():
            return jsonify({'error': 'Could not transcribe audio', 'success': False}), 400

        # Load chat history from database
        chat_history = db.get_chat_history(uid, limit=20)

        proficiency_context = get_user_proficiency_context()
        system_prompt = build_system_prompt(proficiency_context)

        messages = [{"role": "system", "content": system_prompt}]
        for msg in chat_history[-10:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": transcript})

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=500,
            temperature=0.7
        )

        assistant_message = response.choices[0].message.content

        # Save messages to database
        db.append_chat_message(uid, "user", transcript)
        db.append_chat_message(uid, "assistant", assistant_message)

        tts_response = client.audio.speech.create(
            model="tts-1",
            voice="nova",
            input=assistant_message,
            response_format="mp3"
        )

        if 'tts_audio' not in session:
            session['tts_audio'] = []

        audio_filename = f"tts_{len(session['tts_audio'])}.mp3"
        audio_path = os.path.join(tempfile.gettempdir(), audio_filename)

        with open(audio_path, 'wb') as f:
            f.write(tts_response.content)

        session['tts_audio'].append(audio_path)

        return jsonify({
            'success': True,
            'transcript': transcript,
            'response': assistant_message,
            'audio_url': f'/api/audio/{audio_filename}'
        })

    except Exception as e:
        return jsonify({
            'error': str(e),
            'success': False
        }), 500


@app.route('/api/audio/<filename>')
def serve_audio(filename):
    try:
        audio_path = os.path.join(tempfile.gettempdir(), filename)
        if os.path.exists(audio_path):
            return send_file(audio_path, mimetype='audio/mpeg')
        else:
            return jsonify({'error': 'Audio file not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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

    # New profile fields
    display_name = profile.get('display_name', '')
    age = profile.get('age')
    gender = profile.get('gender')
    rigor = profile.get('rigor')
    frequency = profile.get('frequency')
    frequency_unit = profile.get('frequency_unit')
    level_objective = profile.get('level_objective', '')
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
        'selected_categories': selected_categories
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
    display_name = data.get('displayName', '')
    age = data.get('age')
    gender = data.get('gender')
    rigor = data.get('rigor')
    frequency = data.get('frequency')
    frequency_unit = data.get('frequencyUnit')
    level_objective = data.get('levelObjective', '')
    is_edit = data.get('isEdit', False)

    # Save to database
    db.update_user_profile(
        uid,
        display_name=display_name,
        age=age,
        gender=gender,
        rigor=rigor,
        frequency=frequency,
        frequency_unit=frequency_unit,
        level_objective=level_objective
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
        'level_objective': level_objective
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
            'levelObjective': level_objective
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
    """Serve images from static/imgs folder"""
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
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV', 'development') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
