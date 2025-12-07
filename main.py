
from flask import Flask, render_template, request, redirect, url_for

app = Flask(__name__)

# Main page (quiz)
@app.route('/', methods=['GET', 'POST'])
def quiz():
    if request.method == 'POST':
        goals = request.form.get('goals', '')
        goals_list = [g.strip().capitalize() for g in goals.split(',') if g.strip()]
        duration_idx = int(request.form.get('duration', 0))
        duration_labels = [
            'Just started',
            '1 month',
            '3 months',
            '6 months',
            '1 year',
            '2 years',
            '3 years',
            '5 years',
            '7 years',
            '10 years',
            '10+ years'
        ]
        duration_label = duration_labels[duration_idx] if 0 <= duration_idx < len(duration_labels) else 'Unknown'
        return f"""
            <h2>Thank you for submitting!</h2>
            <p><strong>Goals:</strong> {', '.join(goals_list) if goals_list else 'None selected'}</p>
            <p><strong>Learning Duration:</strong> {duration_label}</p>
            <a href='/'>Back to quiz</a>
        """
    return render_template('index.html')

