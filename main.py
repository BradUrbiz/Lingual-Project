from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file
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

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24))

# Initialize Firebase Admin SDK
firebase_app = None
try:
    # For production: use GOOGLE_APPLICATION_CREDENTIALS or default credentials
    if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        cred = credentials.Certificate(os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'))
        firebase_app = firebase_admin.initialize_app(cred)
    else:
        # Use Application Default Credentials (works on Cloud Run)
        firebase_app = firebase_admin.initialize_app()
except Exception as e:
    print(f"Firebase initialization error: {e}")


def login_required(f):
    """Decorator to require authentication for routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
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
    # If user is logged in, redirect to general quiz
    if 'user' in session:
        return redirect(url_for('general'))
    return render_template('index.html')


@app.route('/login')
def login():
    # If user is already logged in, redirect to general
    if 'user' in session:
        return redirect(url_for('general'))
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


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


@app.route('/general', methods=['GET', 'POST'])
@login_required
def general():
    uid = get_current_user_uid()

    if request.method == 'POST':
        goals = request.form.get('goals', '')
        duration = request.form.get('duration', '0')

        goals_list = [g.strip() for g in goals.split(',') if g.strip()]
        duration_int = int(duration)

        # Save to database
        db.update_user_profile(uid, goals=goals_list, learning_duration=duration_int)

        # Reset assessment in database
        db.reset_assessment(uid)

        # Keep session for quick access during assessment
        session['user_goals'] = goals_list
        session['learning_duration'] = duration_int
        session.pop('assessment_responses', None)
        session.pop('current_item_index', None)
        session.pop('assessment_results', None)

        return redirect(url_for('assessment'))

    # Load existing profile from database
    user_data = db.get_user(uid)
    if user_data and user_data.get('profile'):
        profile = user_data['profile']
        session['user_goals'] = profile.get('goals', [])
        session['learning_duration'] = profile.get('learning_duration', 0)

    return render_template('general.html')


@app.route('/assessment')
@login_required
def assessment():
    uid = get_current_user_uid()
    assessment_data = get_assessment()

    # Load assessment state from database
    assessment_state = db.get_assessment_state(uid)
    if assessment_state:
        session['assessment_responses'] = assessment_state.get('responses', {})
        session['current_item_index'] = assessment_state.get('current_item_index', 0)
    elif 'assessment_responses' not in session:
        session['assessment_responses'] = {}
        session['current_item_index'] = 0

    current_index = session.get('current_item_index', 0)
    items = assessment_data['items']

    if current_index >= len(items):
        return redirect(url_for('categories'))

    current_item = items[current_index]

    ui_lang = session.get('ui_language', 'en')

    return render_template(
        'assessment.html',
        item=current_item,
        item_index=current_index,
        total_items=len(items),
        ui_lang=ui_lang,
        test_title=assessment_data['title']
    )


@app.route('/assessment/submit', methods=['POST'])
@login_required
def assessment_submit():
    uid = get_current_user_uid()
    assessment_data = get_assessment()
    items = assessment_data['items']

    current_index = session.get('current_item_index', 0)

    if current_index >= len(items):
        return redirect(url_for('categories'))

    current_item = items[current_index]
    item_id = current_item['id']

    item_type = current_item.get('item_type')

    if item_type == 'mcq_single':
        response = request.form.get('response', '')
    elif item_type == 'text_short':
        response = request.form.get('response', '')
    elif item_type == 'audio_read':
        response = request.form.get('transcript', '')
    else:
        response = request.form.get('response', '')

    responses = session.get('assessment_responses', {})
    responses[item_id] = response
    session['assessment_responses'] = responses

    session['current_item_index'] = current_index + 1

    # Save to database
    db.update_assessment_response(uid, item_id, response, session['current_item_index'])

    if session['current_item_index'] >= len(items):
        return redirect(url_for('categories'))

    return redirect(url_for('assessment'))


@app.route('/assessment/skip', methods=['POST'])
@login_required
def assessment_skip():
    uid = get_current_user_uid()
    assessment_data = get_assessment()
    items = assessment_data['items']

    current_index = session.get('current_item_index', 0)

    if current_index < len(items):
        item_id = items[current_index]['id']
        responses = session.get('assessment_responses', {})
        responses[item_id] = ''
        session['assessment_responses'] = responses
        session['current_item_index'] = current_index + 1

        # Save to database
        db.update_assessment_response(uid, item_id, '', session['current_item_index'])

    if session['current_item_index'] >= len(items):
        return redirect(url_for('categories'))

    return redirect(url_for('assessment'))


@app.route('/assessment/results')
@login_required
def assessment_results():
    assessment_data = get_assessment()
    responses = session.get('assessment_responses', {})

    if not responses:
        return redirect(url_for('assessment'))

    results = compute_results(assessment_data, responses)

    ui_lang = session.get('ui_language', 'en')
    sklc_info = get_sklc_description(results['global_stage'], ui_lang)

    domain_sklc = {}
    for domain, band in results['domain_bands'].items():
        domain_sklc[domain] = get_sklc_description(band, ui_lang)

    return render_template(
        'results.html',
        results=results,
        sklc_info=sklc_info,
        domain_sklc=domain_sklc,
        domains=assessment_data['domains']
    )


@app.route('/assessment/reset')
@login_required
def assessment_reset():
    uid = get_current_user_uid()
    session.pop('assessment_responses', None)
    session.pop('current_item_index', None)
    session.pop('assessment_results', None)

    # Reset in database
    db.reset_assessment(uid)

    return redirect(url_for('assessment'))


@app.route('/categories', methods=['GET', 'POST'])
@login_required
def categories():
    uid = get_current_user_uid()

    # Try to load results from database first
    if 'assessment_results' not in session:
        db_results = db.get_assessment_results(uid)
        if db_results:
            session['assessment_results'] = db_results

    # Compute results if we have responses but no results
    if 'assessment_results' not in session and 'assessment_responses' in session:
        assessment_data = get_assessment()
        responses = session.get('assessment_responses', {})
        if responses:
            results = compute_results(assessment_data, responses)
            session['assessment_results'] = results
            # Save results to database
            db.save_assessment_results(uid, results)

    if request.method == 'POST':
        selected_categories = request.form.get('categories', '')
        categories_list = [c.strip() for c in selected_categories.split(',') if c.strip()]
        session['selected_categories'] = categories_list

        # Save to database
        db.update_selected_categories(uid, categories_list)

        return redirect(url_for('ai'))

    return render_template('categories.html')


@app.route('/ai')
@login_required
def ai():
    uid = get_current_user_uid()

    # Load results from database if not in session
    results = session.get('assessment_results')
    if not results:
        results = db.get_assessment_results(uid) or {}
        session['assessment_results'] = results

    global_stage = results.get('global_stage', 0)
    sklc_info = get_sklc_description(global_stage)

    return render_template('ai.html', sklc_level=sklc_info.get('level', 'Not assessed'))


def get_user_proficiency_context():
    uid = get_current_user_uid()

    # Try to get from database first, fall back to session
    if uid:
        profile_context = db.get_user_profile_context(uid)
        if profile_context:
            results = profile_context.get('results') or {}
            goals = profile_context.get('goals', [])
            duration = profile_context.get('learning_duration', 0)
        else:
            results = session.get('assessment_results', {})
            goals = session.get('user_goals', [])
            duration = session.get('learning_duration', 0)
    else:
        results = session.get('assessment_results', {})
        goals = session.get('user_goals', [])
        duration = session.get('learning_duration', 0)

    if not results:
        return "The user has not completed their assessment yet. Assume beginner level."

    global_stage = results.get('global_stage', 0)
    domain_bands = results.get('domain_bands', {})
    domain_scores = results.get('domain_raw_scores', {})

    sklc_info = SKLC_LEVEL_DESCRIPTIONS.get(global_stage, SKLC_LEVEL_DESCRIPTIONS[0])

    context = f"""
USER PROFICIENCY PROFILE:
- Overall Level: {sklc_info['level']} (Stage {global_stage}/5)
- Description: {sklc_info['description_en']}

DOMAIN BREAKDOWN:
- Grammar: Band {domain_bands.get('grammar', 0)}/5 (Score: {domain_scores.get('grammar', 0):.2f})
- Vocabulary: Band {domain_bands.get('vocabulary', 0)}/5 (Score: {domain_scores.get('vocabulary', 0):.2f})
- Pragmatics: Band {domain_bands.get('pragmatics', 0)}/5 (Score: {domain_scores.get('pragmatics', 0):.2f})
- Pronunciation: Band {domain_bands.get('pronunciation', 0)}/5 (Score: {domain_scores.get('pronunciation', 0):.2f})

USER BACKGROUND:
- Learning Goals: {', '.join(goals) if goals else 'Not specified'}
- Learning Duration: {duration} (on scale 0-10, where 0=just started, 10=10+ years)
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
def api_user_profile():
    results = session.get('assessment_results', {})
    goals = session.get('user_goals', [])

    if not results:
        return jsonify({
            'assessed': False,
            'message': 'Please complete the assessment first'
        })

    global_stage = results.get('global_stage', 0)
    sklc_info = get_sklc_description(global_stage)

    return jsonify({
        'assessed': True,
        'global_stage': global_stage,
        'sklc_level': sklc_info['level'],
        'sklc_description': sklc_info['description'],
        'domain_bands': results.get('domain_bands', {}),
        'goals': goals
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


if __name__ == '__main__':
    # Use PORT environment variable for Cloud Run, default to 5000 for local dev
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV', 'development') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
