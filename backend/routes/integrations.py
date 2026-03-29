from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.canvas.client import CanvasAuthError, CanvasClient
from backend.services.canvas.encryption import decrypt_pat, encrypt_pat
from backend.services.canvas.sync import sync_course_content, sync_roster
from backend.services.membership_context import SchoolContextPermissionError

TEACHER_ALLOWED_ROLES = {'teacher', 'school_admin'}


def create_integrations_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('integrations', __name__)

    def _require_teacher_context():
        ctx = deps.get_school_request_context()
        ctx.require_any_role(TEACHER_ALLOWED_ROLES)
        return ctx

    def _require_class_access(ctx, class_id: str) -> dict:
        class_record = deps.db.get_class(class_id)
        if not class_record:
            return None
        if class_record.get('org_id') != ctx.active_organization_id:
            return None
        if not ctx.has_role('school_admin'):
            if ctx.active_membership_id not in (class_record.get('teacher_membership_ids') or []):
                return None
        return class_record

    # -- Validate PAT + list courses ---------------------------------------

    @bp.route('/api/integrations/canvas/validate', methods=['POST'])
    @deps.login_required
    def canvas_validate():
        try:
            _require_teacher_context()
        except (PermissionError, SchoolContextPermissionError):
            return jsonify({'success': False, 'error': 'Forbidden'}), 403

        data = request.get_json() or {}
        instance_url = (data.get('canvasInstanceUrl') or '').strip()
        pat = (data.get('pat') or '').strip()

        if not instance_url or not pat:
            return jsonify({'success': False, 'error': 'Instance URL and PAT are required'}), 400

        try:
            client = CanvasClient(instance_url, pat)
            teacher = client.get_user()
            courses = client.get_courses()
        except CanvasAuthError:
            return jsonify({'success': False, 'error': 'Invalid PAT or unauthorized'}), 401
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 502

        return jsonify({
            'success': True,
            'teacher': {'id': teacher.get('id'), 'name': teacher.get('name')},
            'courses': [
                {
                    'id': c.get('id'),
                    'name': c.get('name', ''),
                    'courseCode': c.get('course_code', ''),
                }
                for c in courses
            ],
        })

    # -- Connect (create connection + initial sync) -------------------------

    @bp.route('/api/integrations/canvas/connect', methods=['POST'])
    @deps.login_required
    def canvas_connect():
        try:
            ctx = _require_teacher_context()
        except (PermissionError, SchoolContextPermissionError):
            return jsonify({'success': False, 'error': 'Forbidden'}), 403

        data = request.get_json() or {}
        instance_url = (data.get('canvasInstanceUrl') or '').strip()
        pat = (data.get('pat') or '').strip()
        canvas_course_id = str(data.get('canvasCourseId', ''))
        canvas_course_name = (data.get('canvasCourseName') or '').strip()
        existing_class_id = (data.get('existingClassId') or '').strip()

        if not instance_url or not pat or not canvas_course_id:
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        try:
            encrypted = encrypt_pat(pat)
        except ValueError:
            return jsonify({'success': False, 'error': 'Encryption key not configured'}), 503

        # Resolve or create the Lingual class.
        if existing_class_id:
            class_record = _require_class_access(ctx, existing_class_id)
            if not class_record:
                return jsonify({'success': False, 'error': 'Class not found or not accessible'}), 404
            class_id = existing_class_id
        else:
            class_id = deps.db.create_class(
                org_id=ctx.active_organization_id,
                name=canvas_course_name or f'Canvas Course {canvas_course_id}',
                teacher_membership_ids=[ctx.active_membership_id],
                canvas_course_id=canvas_course_id,
            )
            deps.db.add_primary_class_to_membership(ctx.active_membership_id, class_id)

        connection_id = deps.db.create_canvas_connection(
            membership_id=ctx.active_membership_id,
            org_id=ctx.active_organization_id,
            class_id=class_id,
            canvas_instance_url=instance_url,
            canvas_course_id=canvas_course_id,
            canvas_course_name=canvas_course_name,
            encrypted_pat=encrypted,
        )

        # Run initial sync (best-effort; errors don't fail the connect).
        roster_result = None
        content_count = 0
        try:
            client = CanvasClient(instance_url, pat)
            connection = deps.db.get_canvas_connection_by_class(class_id) or {
                'id': connection_id, 'class_id': class_id,
                'org_id': ctx.active_organization_id,
                'canvas_course_id': canvas_course_id,
            }
            roster_result = sync_roster(db=deps.db, connection=connection, canvas_client=client)
            content_count = sync_course_content(db=deps.db, connection=connection, canvas_client=client)
            deps.db.update_canvas_connection(connection_id, {
                'sync_status': 'completed',
            })
        except Exception:
            deps.db.update_canvas_connection(connection_id, {
                'sync_status': 'error',
            })

        return jsonify({
            'success': True,
            'connectionId': connection_id,
            'classId': class_id,
            'roster': roster_result.to_dict() if roster_result else None,
            'contentCount': content_count,
        })

    # -- Canvas status for a class -----------------------------------------

    @bp.route('/api/teacher/classes/<class_id>/canvas/status')
    @deps.login_required
    def canvas_status(class_id):
        try:
            ctx = _require_teacher_context()
        except (PermissionError, SchoolContextPermissionError):
            return jsonify({'success': False, 'error': 'Forbidden'}), 403

        class_record = _require_class_access(ctx, class_id)
        if not class_record:
            return jsonify({'success': False, 'error': 'Class not found'}), 404

        connection = deps.db.get_canvas_connection_by_class(class_id)
        if not connection:
            return jsonify({'connected': False})

        return jsonify({
            'connected': True,
            'connectionId': connection.get('id'),
            'canvasInstanceUrl': connection.get('canvas_instance_url', ''),
            'canvasCourseId': connection.get('canvas_course_id', ''),
            'canvasCourseName': connection.get('canvas_course_name', ''),
            'syncStatus': connection.get('sync_status', 'never'),
            'lastSyncAt': connection.get('last_sync_at'),
        })

    # -- Manual sync -------------------------------------------------------

    @bp.route('/api/teacher/classes/<class_id>/canvas/sync', methods=['POST'])
    @deps.login_required
    def canvas_sync(class_id):
        try:
            ctx = _require_teacher_context()
        except (PermissionError, SchoolContextPermissionError):
            return jsonify({'success': False, 'error': 'Forbidden'}), 403

        class_record = _require_class_access(ctx, class_id)
        if not class_record:
            return jsonify({'success': False, 'error': 'Class not found'}), 404

        connection = deps.db.get_canvas_connection_by_class(class_id)
        if not connection:
            return jsonify({'success': False, 'error': 'No Canvas connection for this class'}), 404

        try:
            pat = decrypt_pat(connection.get('encrypted_pat', ''))
        except Exception:
            return jsonify({'success': False, 'error': 'Could not decrypt PAT'}), 500

        deps.db.update_canvas_connection(connection['id'], {'sync_status': 'syncing'})

        try:
            client = CanvasClient(connection.get('canvas_instance_url', ''), pat)
            roster_result = sync_roster(db=deps.db, connection=connection, canvas_client=client)
            content_count = sync_course_content(db=deps.db, connection=connection, canvas_client=client)
            deps.db.update_canvas_connection(connection['id'], {
                'sync_status': 'completed',
            })
        except Exception as e:
            deps.db.update_canvas_connection(connection['id'], {'sync_status': 'error'})
            return jsonify({'success': False, 'error': str(e)}), 502

        return jsonify({
            'success': True,
            'roster': roster_result.to_dict(),
            'contentCount': content_count,
        })

    # -- List Canvas course content for a class ------------------------------

    @bp.route('/api/teacher/classes/<class_id>/canvas/content')
    @deps.login_required
    def canvas_content_list(class_id):
        try:
            ctx = _require_teacher_context()
        except (PermissionError, SchoolContextPermissionError):
            return jsonify({'success': False, 'error': 'Forbidden'}), 403

        class_record = _require_class_access(ctx, class_id)
        if not class_record:
            return jsonify({'success': False, 'error': 'Class not found'}), 404

        items = deps.db.list_canvas_course_content_for_class(class_id)
        return jsonify({
            'items': [
                {
                    'id': item.get('id', ''),
                    'connectionId': item.get('connection_id', ''),
                    'classId': item.get('class_id', ''),
                    'canvasModuleId': str(item.get('canvas_module_id', '')),
                    'canvasModuleName': item.get('canvas_module_name', ''),
                    'canvasModulePosition': item.get('canvas_module_position', 0),
                    'canvasItemId': str(item.get('item_id') or item.get('canvas_item_id') or ''),
                    'title': item.get('item_title') or item.get('title', ''),
                    'itemType': item.get('item_type', ''),
                    'itemPosition': item.get('item_position', 0),
                    'lingualAssignmentId': item.get('lingual_assignment_id') or None,
                }
                for item in items
            ],
        })

    # -- Student: list Canvas content for enrolled class --------------------

    @bp.route('/api/student/classes/<class_id>/canvas/content')
    @deps.login_required
    def student_canvas_content(class_id):
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Auth required'}), 401

        enrollment = deps.db.get_student_class_enrollment(class_id, uid)
        if not enrollment or enrollment.get('status') != 'active':
            return jsonify({'success': False, 'error': 'Not enrolled in this class'}), 403

        items = deps.db.list_canvas_course_content_for_class(class_id)
        return jsonify({
            'items': [
                {
                    'id': item.get('id', ''),
                    'canvasModuleId': str(item.get('canvas_module_id', '')),
                    'canvasModuleName': item.get('canvas_module_name', ''),
                    'canvasModulePosition': item.get('canvas_module_position', 0),
                    'canvasItemId': str(item.get('item_id') or item.get('canvas_item_id') or ''),
                    'title': item.get('item_title') or item.get('title', ''),
                    'itemType': item.get('item_type', ''),
                    'itemPosition': item.get('item_position', 0),
                    'lingualAssignmentId': item.get('lingual_assignment_id') or None,
                }
                for item in items
            ],
        })

    # -- Disconnect --------------------------------------------------------

    @bp.route('/api/teacher/classes/<class_id>/canvas/disconnect', methods=['DELETE'])
    @deps.login_required
    def canvas_disconnect(class_id):
        try:
            ctx = _require_teacher_context()
        except (PermissionError, SchoolContextPermissionError):
            return jsonify({'success': False, 'error': 'Forbidden'}), 403

        class_record = _require_class_access(ctx, class_id)
        if not class_record:
            return jsonify({'success': False, 'error': 'Class not found'}), 404

        connection = deps.db.get_canvas_connection_by_class(class_id)
        if not connection:
            return jsonify({'success': False, 'error': 'No Canvas connection'}), 404

        deps.db.delete_canvas_connection(connection['id'])
        return jsonify({'success': True})

    # -- Assignment ↔ Canvas item link/unlink ------------------------------

    @bp.route('/api/teacher/assignments/<assignment_id>/canvas-link', methods=['POST'])
    @deps.login_required
    def canvas_link_assignment(assignment_id):
        try:
            ctx = _require_teacher_context()
        except (PermissionError, SchoolContextPermissionError):
            return jsonify({'success': False, 'error': 'Forbidden'}), 403

        data = request.get_json() or {}
        canvas_content_id = (data.get('canvasContentId') or '').strip()
        canvas_module_item_id = (data.get('canvasModuleItemId') or '').strip()

        if not canvas_content_id:
            return jsonify({'success': False, 'error': 'canvasContentId is required'}), 400

        deps.db.link_assignment_to_canvas_item(assignment_id, canvas_content_id, canvas_module_item_id)
        return jsonify({'success': True})

    @bp.route('/api/teacher/assignments/<assignment_id>/canvas-link', methods=['DELETE'])
    @deps.login_required
    def canvas_unlink_assignment(assignment_id):
        try:
            ctx = _require_teacher_context()
        except (PermissionError, SchoolContextPermissionError):
            return jsonify({'success': False, 'error': 'Forbidden'}), 403

        data = request.get_json() or {}
        canvas_content_id = (data.get('canvasContentId') or '').strip()
        if not canvas_content_id:
            return jsonify({'success': False, 'error': 'canvasContentId is required'}), 400

        deps.db.unlink_assignment_from_canvas_item(assignment_id, canvas_content_id)
        return jsonify({'success': True})

    return bp
