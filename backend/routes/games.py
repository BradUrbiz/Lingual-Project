import json

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps


def create_games_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('games_routes', __name__)

    @bp.route('/api/minigames/attempts', methods=['POST'])
    @deps.login_required
    def api_save_minigame_attempt():
        """Save a minigame attempt for progress reporting."""
        uid = deps.get_current_user_uid()
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

        if not game_type or game_type not in deps.allowed_minigame_types:
            return jsonify({'success': False, 'error': 'Invalid gameType'}), 400
        if not locale or locale not in deps.allowed_learning_locales:
            return jsonify({'success': False, 'error': 'Invalid locale'}), 400
        if correct_answers is None or total_questions is None:
            return jsonify({
                'success': False,
                'error': 'correctAnswers and totalQuestions are required',
            }), 400

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

            attempt_id = deps.db.add_minigame_attempt(uid, {
                'game_type': game_type,
                'locale': locale,
                'objective_id': objective_id,
                'scenario_id': scenario_id,
                'score': score_value,
                'correct_answers': correct_value,
                'total_questions': total_value,
                'accuracy': accuracy_value,
                'duration_seconds': duration_value,
                'metadata': metadata if isinstance(metadata, dict) else {},
            })
            return jsonify({'success': True, 'attemptId': attempt_id})
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid numeric field'}), 400
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/minigames/summary', methods=['GET'])
    @deps.login_required
    def api_get_minigame_summary():
        """Get aggregate minigame stats for the current user."""
        uid = deps.get_current_user_uid()
        try:
            limit = int(request.args.get('limit', 200))
            limit = max(1, min(limit, 500))
        except ValueError:
            limit = 200

        try:
            summary = deps.db.get_minigame_summary(uid, limit=limit)
            return jsonify({'success': True, 'summary': summary})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/minigames/flashcards', methods=['POST'])
    @deps.login_required
    def generate_flashcards():
        """Generate flashcards from recent chat messages."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}
        chat_id = data.get('chatId')

        if not chat_id:
            return jsonify({'error': 'chatId is required'}), 400

        messages = deps.db.get_chat_messages_for_context(uid, chat_id, limit=10)
        if not messages:
            return jsonify({'error': 'No messages found in this chat'}), 400

        conversation_text = '\n'.join([
            f"{msg.get('role', 'user')}: {msg.get('content', '')}"
            for msg in messages
        ])

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
            client = deps.get_openai_client()
            response = client.chat.completions.create(
                model='gpt-4o-mini',
                messages=[
                    {'role': 'system', 'content': 'You are a Korean language tutor. Return only valid JSON.'},
                    {'role': 'user', 'content': prompt},
                ],
                temperature=0.7,
            )

            result = response.choices[0].message.content.strip()
            if result.startswith('```'):
                result = result.split('\n', 1)[1]
                result = result.rsplit('```', 1)[0]

            flashcards = json.loads(result)
            return jsonify({'flashcards': flashcards})

        except Exception as e:
            print(f'Error generating flashcards: {e}')
            return jsonify({'error': 'Failed to generate flashcards'}), 500

    return bp
