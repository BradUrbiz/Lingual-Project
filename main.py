from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import json
import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24))

# Initialize OpenAI client (lazy initialization)
openai_client = None

def get_openai_client():
    """Get or initialize OpenAI client."""
    global openai_client
    api_key = os.environ.get('OPENAI_API_KEY')
    if api_key and openai_client is None:
        openai_client = OpenAI(api_key=api_key)
    return openai_client

# Import scoring module
from scoring import load_assessment_data, score_item, compute_results, get_sklc_description, SKLC_LEVEL_DESCRIPTIONS


def get_assessment():
    """Load and cache assessment data."""
    return load_assessment_data("data/assessment_v1.json")


# =============================================================================
# Landing Page
# =============================================================================

@app.route('/')
def index():
    return render_template('index.html')


# =============================================================================
# Initial Quiz Flow (Goals & Duration)
# =============================================================================

@app.route('/general', methods=['GET', 'POST'])
def general():
    if request.method == 'POST':
        goals = request.form.get('goals', '')
        duration = request.form.get('duration', '0')

        # Store in session
        session['user_goals'] = [g.strip() for g in goals.split(',') if g.strip()]
        session['learning_duration'] = int(duration)

        return redirect(url_for('assessment'))

    return render_template('general.html')


# =============================================================================
# Assessment Flow
# =============================================================================

@app.route('/assessment')
def assessment():
    """Start or resume assessment."""
    assessment_data = get_assessment()

    # Initialize or get current progress
    if 'assessment_responses' not in session:
        session['assessment_responses'] = {}
        session['current_item_index'] = 0

    current_index = session.get('current_item_index', 0)
    items = assessment_data['items']

    # Check if assessment is complete
    if current_index >= len(items):
        return redirect(url_for('categories'))

    current_item = items[current_index]

    # Get UI language preference (default to English)
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
def assessment_submit():
    """Handle assessment item submission."""
    assessment_data = get_assessment()
    items = assessment_data['items']

    current_index = session.get('current_item_index', 0)

    if current_index >= len(items):
        return redirect(url_for('categories'))

    current_item = items[current_index]
    item_id = current_item['id']

    # Get response based on item type
    item_type = current_item.get('item_type')

    if item_type == 'mcq_single':
        response = request.form.get('response', '')
    elif item_type == 'text_short':
        response = request.form.get('response', '')
    elif item_type == 'audio_read':
        # For audio, we'll get transcript from client-side ASR or skip
        response = request.form.get('transcript', '')
    else:
        response = request.form.get('response', '')

    # Store response
    responses = session.get('assessment_responses', {})
    responses[item_id] = response
    session['assessment_responses'] = responses

    # Move to next item
    session['current_item_index'] = current_index + 1

    # Check if complete
    if session['current_item_index'] >= len(items):
        return redirect(url_for('categories'))

    return redirect(url_for('assessment'))


@app.route('/assessment/skip', methods=['POST'])
def assessment_skip():
    """Skip current assessment item."""
    assessment_data = get_assessment()
    items = assessment_data['items']

    current_index = session.get('current_item_index', 0)

    if current_index < len(items):
        item_id = items[current_index]['id']
        responses = session.get('assessment_responses', {})
        responses[item_id] = ''  # Empty response for skipped
        session['assessment_responses'] = responses
        session['current_item_index'] = current_index + 1

    if session['current_item_index'] >= len(items):
        return redirect(url_for('categories'))

    return redirect(url_for('assessment'))


@app.route('/assessment/results')
def assessment_results():
    """Display assessment results."""
    assessment_data = get_assessment()
    responses = session.get('assessment_responses', {})

    if not responses:
        return redirect(url_for('assessment'))

    # Compute results
    results = compute_results(assessment_data, responses)

    # Get SKLC descriptions
    ui_lang = session.get('ui_language', 'en')
    sklc_info = get_sklc_description(results['global_stage'], ui_lang)

    # Domain-level SKLC info
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
def assessment_reset():
    """Reset assessment progress."""
    session.pop('assessment_responses', None)
    session.pop('current_item_index', None)
    return redirect(url_for('assessment'))


# =============================================================================
# Categories & AI Pages
# =============================================================================

@app.route('/categories', methods=['GET', 'POST'])
def categories():
    # Compute and store assessment results if not already done
    if 'assessment_results' not in session and 'assessment_responses' in session:
        assessment_data = get_assessment()
        responses = session.get('assessment_responses', {})
        if responses:
            results = compute_results(assessment_data, responses)
            session['assessment_results'] = results

    # Handle POST from categories form
    if request.method == 'POST':
        selected_categories = request.form.get('categories', '')
        session['selected_categories'] = [c.strip() for c in selected_categories.split(',') if c.strip()]
        return redirect(url_for('ai'))

    return render_template('categories.html')


@app.route('/ai')
def ai():
    # Get user's proficiency data for display
    results = session.get('assessment_results', {})
    global_stage = results.get('global_stage', 0)
    sklc_info = get_sklc_description(global_stage)

    return render_template('ai.html', sklc_level=sklc_info.get('level', 'Not assessed'))


# =============================================================================
# AI Chat API
# =============================================================================

def get_user_proficiency_context():
    """Build a context string describing the user's proficiency level."""
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
    """Build the system prompt for the AI tutor."""
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
def api_chat():
    """Handle AI chat messages."""
    data = request.get_json()
    user_message = data.get('message', '').strip()

    if not user_message:
        return jsonify({'error': 'Message is required'}), 400

    # Check for API key
    if not os.environ.get('OPENAI_API_KEY'):
        return jsonify({'error': 'OpenAI API key not configured'}), 500

    # Get or initialize chat history
    if 'chat_history' not in session:
        session['chat_history'] = []

    chat_history = session['chat_history']

    # Build messages for OpenAI
    proficiency_context = get_user_proficiency_context()
    system_prompt = build_system_prompt(proficiency_context)

    messages = [{"role": "system", "content": system_prompt}]

    # Add chat history (last 10 messages to keep context manageable)
    for msg in chat_history[-10:]:
        messages.append(msg)

    # Add current user message
    messages.append({"role": "user", "content": user_message})

    try:
        # Get OpenAI client
        client = get_openai_client()
        if not client:
            return jsonify({'error': 'OpenAI API key not configured', 'success': False}), 500

        # Call OpenAI API (using gpt-4o-mini as gpt-5-mini doesn't exist yet)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=500,
            temperature=0.7
        )

        assistant_message = response.choices[0].message.content

        # Update chat history
        chat_history.append({"role": "user", "content": user_message})
        chat_history.append({"role": "assistant", "content": assistant_message})
        session['chat_history'] = chat_history

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
def api_chat_reset():
    """Reset chat history."""
    session.pop('chat_history', None)
    return jsonify({'success': True, 'message': 'Chat history cleared'})


@app.route('/api/user/profile')
def api_user_profile():
    """Get user's assessment profile for the AI page."""
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


# =============================================================================
# API Endpoints (for AJAX/future use)
# =============================================================================

@app.route('/api/assessment/status')
def api_assessment_status():
    """Get current assessment status."""
    assessment_data = get_assessment()
    return jsonify({
        'current_index': session.get('current_item_index', 0),
        'total_items': len(assessment_data['items']),
        'responses_count': len(session.get('assessment_responses', {}))
    })


@app.route('/api/set-language', methods=['POST'])
def api_set_language():
    """Set UI language preference."""
    data = request.get_json()
    lang = data.get('language', 'en')
    if lang in ['en', 'ko']:
        session['ui_language'] = lang
        return jsonify({'success': True, 'language': lang})
    return jsonify({'success': False, 'error': 'Invalid language'}), 400


# =============================================================================
# Run
# =============================================================================

if __name__ == '__main__':
    app.run(debug=True)
