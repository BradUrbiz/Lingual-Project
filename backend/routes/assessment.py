from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps


def create_assessment_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('assessment_routes', __name__)

    @bp.route('/api/assessment/status')
    @deps.login_required
    def api_assessment_status():
        uid = deps.get_current_user_uid()
        assessment_data = deps.get_assessment()
        assessment_state = deps.db.get_assessment_state(uid) or {}
        return jsonify({
            'current_index': assessment_state.get('current_item_index', 0),
            'total_items': len(assessment_data['items']),
            'responses_count': len(assessment_state.get('responses', {})),
        })

    @bp.route('/api/assessment/items', methods=['GET'])
    @deps.login_required
    def api_assessment_items():
        """Get all assessment items and current progress (JSON API)."""
        uid = deps.get_current_user_uid()
        assessment_data = deps.get_assessment()

        assessment_state = deps.db.get_assessment_state(uid) or {}
        current_index = assessment_state.get('current_item_index', 0)
        responses = assessment_state.get('responses', {})

        return jsonify({
            'items': assessment_data['items'],
            'totalItems': len(assessment_data['items']),
            'currentIndex': current_index,
            'responses': responses,
            'title': assessment_data['title'],
        })

    @bp.route('/api/assessment/submit', methods=['POST'])
    @deps.login_required
    def api_assessment_submit_json():
        """Submit an assessment response (JSON API)."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}

        item_id = data.get('itemId')
        response = data.get('response', '')

        if not item_id:
            return jsonify({'success': False, 'error': 'Item ID is required'}), 400

        assessment_data = deps.get_assessment()
        items = assessment_data['items']

        current_index = next((i for i, item in enumerate(items) if item['id'] == item_id), None)
        if current_index is None:
            return jsonify({'success': False, 'error': 'Invalid item ID'}), 400

        deps.db.update_assessment_response(uid, item_id, response, current_index + 1)
        is_complete = (current_index + 1) >= len(items)

        return jsonify({'success': True, 'nextIndex': current_index + 1, 'isComplete': is_complete})

    @bp.route('/api/assessment/skip', methods=['POST'])
    @deps.login_required
    def api_assessment_skip_json():
        """Skip current assessment question (JSON API)."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}

        item_id = data.get('itemId')
        if not item_id:
            return jsonify({'success': False, 'error': 'Item ID is required'}), 400

        assessment_data = deps.get_assessment()
        items = assessment_data['items']

        current_index = next((i for i, item in enumerate(items) if item['id'] == item_id), None)
        if current_index is None:
            return jsonify({'success': False, 'error': 'Invalid item ID'}), 400

        deps.db.update_assessment_response(uid, item_id, '', current_index + 1)
        is_complete = (current_index + 1) >= len(items)

        return jsonify({'success': True, 'nextIndex': current_index + 1, 'isComplete': is_complete})

    @bp.route('/api/assessment/results', methods=['GET'])
    @deps.login_required
    def api_assessment_results_json():
        """Get computed assessment results (JSON API)."""
        uid = deps.get_current_user_uid()

        results = deps.db.get_assessment_results(uid)
        if not results:
            assessment_state = deps.db.get_assessment_state(uid)
            if assessment_state:
                responses = assessment_state.get('responses', {})
                if responses:
                    assessment_data = deps.get_assessment()
                    results = deps.compute_results(assessment_data, responses)
                    deps.db.save_assessment_results(uid, results)

        if results:
            global_stage = results.get('global_stage', 0)
            sklc_info = deps.get_sklc_description(global_stage)

            return jsonify({
                'success': True,
                'results': results,
                'sklcLevel': sklc_info['level'],
                'sklcDescription': sklc_info['description'],
            })

        return jsonify({'success': False, 'error': 'No results available'}), 404

    @bp.route('/api/assessment/reset', methods=['POST'])
    @deps.login_required
    def api_assessment_reset_json():
        """Reset assessment progress (JSON API)."""
        uid = deps.get_current_user_uid()
        deps.db.reset_assessment(uid)
        return jsonify({'success': True})

    @bp.route('/api/categories', methods=['POST'])
    @deps.login_required
    def api_update_categories():
        """Update selected practice categories (JSON API)."""
        uid = deps.get_current_user_uid()
        data = request.get_json() or {}

        categories = data.get('categories', [])

        db_results = deps.db.get_assessment_results(uid)
        if not db_results:
            assessment_state = deps.db.get_assessment_state(uid)
            if assessment_state:
                responses = assessment_state.get('responses', {})
                if responses:
                    assessment_data = deps.get_assessment()
                    results = deps.compute_results(assessment_data, responses)
                    deps.db.save_assessment_results(uid, results)

        deps.db.update_selected_categories(uid, categories)
        return jsonify({'success': True, 'categories': categories})

    return bp
