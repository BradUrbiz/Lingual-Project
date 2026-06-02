"""
Canvas-to-Practice endpoints.

Provides AI-powered generation of speaking practice from Canvas course
content, plus one-click creation of mapping + assignment + Canvas link.
"""

from __future__ import annotations

import re
import traceback

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.canvas.client import CanvasClient
from backend.services.canvas.encryption import decrypt_pat
from backend.services.canvas.practice_generator import generate_canvas_practice
from backend.services.membership_context import SchoolContextPermissionError
from backend.services.suspended_org_guard import (
    SuspendedOrgError,
    enforce_org_active,
)

TEACHER_ALLOWED_ROLES = {'teacher', 'school_admin'}


def create_canvas_practice_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('canvas_practice', __name__)

    def _require_teacher_for_class(class_id: str):
        """Returns (context, class_record) or raises."""
        ctx = deps.get_school_request_context()
        ctx.require_any_role(TEACHER_ALLOWED_ROLES)
        class_record = deps.db.get_class(class_id)
        if not class_record:
            raise LookupError('Class not found')
        if class_record.get('org_id') != ctx.active_organization_id:
            raise PermissionError('Class does not belong to your organization')
        if not ctx.has_role('school_admin'):
            if ctx.active_membership_id not in (class_record.get('teacher_membership_ids') or []):
                raise PermissionError('You are not a teacher of this class')
        return ctx, class_record

    # -- Generate AI suggestions from Canvas item ----------------------------

    @bp.route('/api/teacher/classes/<class_id>/canvas-practice/generate', methods=['POST'])
    @deps.login_required
    def canvas_practice_generate(class_id):
        try:
            ctx, class_record = _require_teacher_for_class(class_id)
        except (PermissionError, SchoolContextPermissionError, LookupError) as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403

        try:
            enforce_org_active(class_record.get('org_id'), db=deps.db)
        except SuspendedOrgError as exc:
            return jsonify(exc.to_payload()), 403

        data = request.get_json() or {}
        canvas_content_id = data.get('canvasContentId', '').strip()
        if not canvas_content_id:
            return jsonify({'success': False, 'error': 'canvasContentId is required'}), 400

        # Look up the Canvas content item
        content_item = deps.db.get_canvas_course_content(canvas_content_id)
        if not content_item:
            return jsonify({'success': False, 'error': 'Canvas content item not found'}), 404

        item_title = content_item.get('item_title', '')
        item_type = content_item.get('item_type', '')
        item_description = ''

        # Try to enrich with Canvas API content (best-effort)
        try:
            connection = deps.db.get_canvas_connection_by_class(class_id)
            if connection:
                raw_pat = decrypt_pat(connection['encrypted_pat'])
                client = CanvasClient(connection['canvas_instance_url'], raw_pat)
                course_id = connection.get('canvas_course_id', '')

                if item_type == 'Page' and content_item.get('item_id'):
                    page = client.get_page(course_id, content_item['item_id'])
                    body = page.get('body', '')
                    # Strip HTML tags for a cleaner description
                    item_description = re.sub(r'<[^>]+>', '', body).strip()[:2000]
                elif item_type == 'Assignment' and content_item.get('item_id'):
                    assignment = client.get_canvas_assignment(course_id, content_item['item_id'])
                    desc = assignment.get('description', '')
                    item_description = re.sub(r'<[^>]+>', '', desc).strip()[:2000]
        except Exception:
            # Graceful degradation — generate from title alone
            pass

        try:
            openai_client = deps.get_openai_client()
            suggestions = generate_canvas_practice(
                openai_client,
                item_title=item_title,
                item_type=item_type,
                item_description=item_description,
                class_learning_locale=class_record.get('learning_locale', 'ko-KR'),
                class_name=class_record.get('name', ''),
                class_subject=class_record.get('subject', ''),
            )

            return jsonify({
                'success': True,
                'canvasItem': {
                    'id': canvas_content_id,
                    'title': item_title,
                    'type': item_type,
                    'moduleName': content_item.get('canvas_module_name', ''),
                    'canvasItemId': content_item.get('item_id', ''),
                },
                'suggestions': {
                    'scenario': suggestions.get('scenario', ''),
                    'targetExpressions': suggestions.get('target_expressions', []),
                    'targetVocabulary': suggestions.get('target_vocabulary', []),
                    'focusGrammar': suggestions.get('focus_grammar', []),
                    'successCriteria': suggestions.get('success_criteria', []),
                    'suggestedTitle': suggestions.get('suggested_title', ''),
                    'suggestedDescription': suggestions.get('suggested_description', ''),
                    'teacherNotes': suggestions.get('teacher_notes', ''),
                },
            })

        except Exception as exc:
            traceback.print_exc()
            return jsonify({'success': False, 'error': f'AI generation failed: {exc}'}), 500

    # -- One-click create assignment + link (scenario lives on assignment) ----

    @bp.route('/api/teacher/classes/<class_id>/canvas-practice/create', methods=['POST'])
    @deps.login_required
    def canvas_practice_create(class_id):
        try:
            ctx, class_record = _require_teacher_for_class(class_id)
        except (PermissionError, SchoolContextPermissionError, LookupError) as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403

        try:
            enforce_org_active(class_record.get('org_id'), db=deps.db)
        except SuspendedOrgError as exc:
            return jsonify(exc.to_payload()), 403

        data = request.get_json() or {}

        canvas_content_id = data.get('canvasContentId', '').strip()
        canvas_module_item_id = data.get('canvasModuleItemId', '').strip()
        title = data.get('title', '').strip()
        scenario = data.get('scenario', '').strip()
        instructions = (data.get('instructions') or data.get('description') or '').strip()

        if not canvas_content_id or not title or not scenario:
            return jsonify({'success': False, 'error': 'canvasContentId, title, and scenario are required'}), 400

        content_item = deps.db.get_canvas_course_content(canvas_content_id)
        if not content_item:
            return jsonify({'success': False, 'error': 'Canvas content item not found'}), 404

        org_id = class_record.get('org_id', '')
        teacher_uid = deps.get_current_user_uid()

        canvas_ref = {
            'connection_id': content_item.get('connection_id', ''),
            'canvas_module_id': content_item.get('canvas_module_id', ''),
            'item_id': canvas_module_item_id or content_item.get('item_id', ''),
            'item_title': content_item.get('item_title', ''),
            'canvas_module_name': content_item.get('canvas_module_name', ''),
        }

        try:
            status = data.get('status', 'draft')
            if status not in ('draft', 'published'):
                status = 'draft'

            assignment_id = deps.db.create_assignment(
                org_id=org_id,
                class_id=class_id,
                title=title,
                description=data.get('description', ''),
                status=status,
                success_criteria=data.get('successCriteria', []),
                created_by_uid=teacher_uid,
                canvas_module_item_id=canvas_module_item_id or '',
                instructions=instructions,
                canvas_module_item_ref=canvas_ref,
                objectives=data.get('objectives', []),
                target_expressions=data.get('targetExpressions', []),
                target_vocabulary=data.get('targetVocabulary', []),
                focus_grammar=data.get('focusGrammar', []),
                generated_scenario=scenario,
                teacher_notes=data.get('teacherNotes', ''),
                target_language_intensity=data.get('targetLanguageIntensity', 'mostly_target') or 'mostly_target',
                sql_engine=deps.sql_engine,
            )

            if canvas_module_item_id:
                deps.db.link_assignment_to_canvas_item(
                    assignment_id, canvas_content_id, canvas_module_item_id,
                    sql_engine=deps.sql_engine,
                )

            return jsonify({
                'success': True,
                'assignmentId': assignment_id,
                'status': status,
            }), 201

        except Exception as exc:
            traceback.print_exc()
            return jsonify({'success': False, 'error': str(exc)}), 500

    return bp
