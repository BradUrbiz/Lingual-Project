from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import json
import os

app = Flask(__name__)
app.secret_key = os.urandom(24)  # For session management

# Import scoring module
from scoring import load_assessment_data, score_item, compute_results, get_sklc_description


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
        return redirect(url_for('assessment_results'))

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
        return redirect(url_for('assessment_results'))

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
        return redirect(url_for('assessment_results'))

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
        return redirect(url_for('assessment_results'))

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

@app.route('/categories')
def categories():
    return render_template('categories.html')


@app.route('/ai')
def ai():
    return render_template('ai.html')


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
