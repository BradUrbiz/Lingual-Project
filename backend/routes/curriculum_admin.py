from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, jsonify, request

import database
from backend.route_deps import RouteDeps
from backend.services.assignment_resolver import (
    SUPPORTED_ASSIGNMENT_STATUSES,
    TEACHER_ALLOWED_ROLES,
    load_assignment_bundle,
    resolve_assignment_bootstrap_for_user,
    resolve_assignment_bootstrap,
    normalize_modality_policy,
    serialize_assignment,
)
from backend.services.assignment_workspace import build_student_assignment_workspace
from backend.services.canvas.practice_generator import generate_canvas_practice
from backend.services.compliance import (
    create_consent_event,
    resolve_student_compliance_record,
    serialize_student_compliance_record,
    upsert_student_compliance_record,
)
from backend.services.disclosure_logging import log_disclosure_if_new
from backend.services.membership_context import SchoolContextPermissionError
from backend.services.suspended_org_guard import (
    SuspendedOrgError,
    enforce_org_active,
)
from backend.services.practice_analytics import (
    SUPPORTED_EVENT_TYPES,
    apply_learning_event_to_session,
    build_assignment_analytics_payload,
    build_class_analytics_payload,
    build_derived_learning_events,
    build_learning_event_payload,
    build_practice_session_payload,
    build_student_drill_down_payload,
    serialize_practice_session,
)


def _normalize_string(value):
    if not isinstance(value, str):
        return ''
    return value.strip()


def _normalize_string_list(values):
    if not isinstance(values, list):
        return []
    normalized = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def _coerce_optional_int(value):
    if value is None or value == '':
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().lstrip('-').isdigit():
        return int(value.strip())
    return None


def _require_teacher_context(deps: RouteDeps, class_id: str):
    context = deps.get_school_request_context()
    context.require_any_role(TEACHER_ALLOWED_ROLES)

    class_record = deps.db.get_class(class_id)
    if not class_record:
        raise SchoolContextPermissionError('Class not found.')
    if class_record.get('org_id') != context.active_organization_id:
        raise SchoolContextPermissionError('Class is outside the active organization.')

    teacher_membership_ids = class_record.get('teacher_membership_ids') or []
    if context.has_role('school_admin') or context.active_membership_id in teacher_membership_ids:
        return context, class_record

    raise SchoolContextPermissionError('Teacher membership does not have access to this class.')


def _serialize_assignments_with_class_names(deps: RouteDeps, assignments: list[dict]):
    serialized = []
    for assignment in assignments:
        assignment_dto = serialize_assignment(assignment)
        if not assignment_dto:
            continue
        class_record = deps.db.get_class(assignment.get('class_id'))
        serialized.append({
            **assignment_dto,
            'className': (class_record or {}).get('name', ''),
        })
    return serialized


def _require_assignment_teacher_access(deps: RouteDeps, assignment_id: str):
    assignment = deps.db.get_assignment(assignment_id)
    if not assignment:
        raise ValueError('Assignment not found.')
    _require_teacher_context(deps, assignment.get('class_id'))
    return assignment


def _parse_iso_date(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(UTC)
    except (ValueError, TypeError):
        return None


def _get_session_started_at(session: dict) -> datetime | None:
    ts = session.get('started_at') or session.get('created_at')
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts
    if hasattr(ts, 'seconds'):
        return datetime.fromtimestamp(ts.seconds, UTC)
    if isinstance(ts, str):
        return _parse_iso_date(ts)
    return None


def _filter_sessions_by_date(
    sessions: list[dict],
    date_from: str | None,
    date_to: str | None,
) -> list[dict]:
    parsed_from = _parse_iso_date(date_from)
    parsed_to = _parse_iso_date(date_to)
    if not parsed_from and not parsed_to:
        return sessions
    filtered = []
    for session in sessions:
        ts = _get_session_started_at(session)
        if ts is None:
            continue
        if parsed_from and ts < parsed_from:
            continue
        if parsed_to and ts > parsed_to:
            continue
        filtered.append(session)
    return filtered


def create_curriculum_admin_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('curriculum_admin_routes', __name__)

    @bp.route('/api/teacher/classes/<class_id>/assignments', methods=['GET'])
    @deps.login_required
    def api_list_class_assignments(class_id):
        try:
            _require_teacher_context(deps, class_id)
            assignments = deps.db.list_class_assignments(class_id)
            return jsonify({
                'success': True,
                'assignments': _serialize_assignments_with_class_names(deps, assignments),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'Assignment list error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/teacher/classes/<class_id>/assignment-drafts/generate', methods=['POST'])
    @deps.login_required
    def api_generate_assignment_draft(class_id):
        try:
            _context, class_record = _require_teacher_context(deps, class_id)
            try:
                enforce_org_active(class_record.get('org_id'), db=deps.db)
            except SuspendedOrgError as exc:
                return jsonify(exc.to_payload()), 403
            data = request.get_json() or {}
            source_text = _normalize_string(data.get('sourceText'))

            if not source_text:
                return jsonify({'success': False, 'error': 'sourceText is required.'}), 400

            openai_client = deps.get_openai_client()
            if not openai_client:
                return jsonify({'success': False, 'error': 'OpenAI client not initialized.'}), 500

            suggestions = generate_canvas_practice(
                openai_client,
                item_title='Teacher-provided source packet',
                item_type='TeacherSource',
                item_description=source_text,
                class_learning_locale=class_record.get('learning_locale', 'ko-KR'),
                class_name=class_record.get('name', ''),
                class_subject=class_record.get('subject', ''),
            )

            return jsonify({
                'success': True,
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
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'Assignment draft generation error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/teacher/classes/<class_id>/assignments', methods=['POST'])
    @deps.login_required
    def api_create_assignment(class_id):
        try:
            _context, class_record = _require_teacher_context(deps, class_id)
            try:
                enforce_org_active(class_record.get('org_id'), db=deps.db)
            except SuspendedOrgError as exc:
                return jsonify(exc.to_payload()), 403
            uid = deps.get_current_user_uid()
            data = request.get_json() or {}

            title = _normalize_string(data.get('title'))
            description = _normalize_string(data.get('description'))
            status = _normalize_string(data.get('status')) or 'draft'
            release_at = _normalize_string(data.get('releaseAt'))
            due_at = _normalize_string(data.get('dueAt'))
            success_criteria = _normalize_string_list(data.get('successCriteria'))
            max_attempts = _coerce_optional_int(data.get('maxAttempts'))
            instructions = _normalize_string(data.get('instructions'))
            generated_scenario = _normalize_string(data.get('generatedScenario'))
            objectives = _normalize_string_list(data.get('objectives'))
            target_expressions = _normalize_string_list(data.get('targetExpressions'))
            target_vocabulary = _normalize_string_list(data.get('targetVocabulary'))
            focus_grammar = _normalize_string_list(data.get('focusGrammar'))
            teacher_notes = _normalize_string(data.get('teacherNotes'))
            student_instructions = _normalize_string(data.get('studentInstructions'))
            target_language_intensity = _normalize_string(data.get('targetLanguageIntensity')) or 'balanced'
            task_type = _normalize_string(data.get('taskType')) or 'decision_making'

            if task_type not in {'information_gap', 'opinion_gap', 'decision_making', 'custom_prompt'}:
                return jsonify({'success': False, 'error': 'Invalid taskType.'}), 400

            if not title:
                return jsonify({'success': False, 'error': 'title is required.'}), 400
            if status not in SUPPORTED_ASSIGNMENT_STATUSES:
                return jsonify({'success': False, 'error': 'Invalid assignment status.'}), 400
            if not instructions:
                return jsonify({'success': False, 'error': 'instructions is required.'}), 400
            # Scaffold-free assignments use the teacher's instructions as the
            # full system prompt; scenario/target/grammar scaffolds are skipped
            # by design, so we don't require a generated scenario for them.
            if task_type != 'custom_prompt' and not generated_scenario:
                return jsonify({'success': False, 'error': 'generatedScenario is required.'}), 400

            assignment_id = deps.db.create_assignment(
                org_id=class_record.get('org_id'),
                class_id=class_id,
                title=title,
                description=description,
                status=status,
                release_at=release_at,
                due_at=due_at,
                modality_override=normalize_modality_policy(data.get('modalityOverride')),
                max_attempts=max_attempts,
                task_type=task_type,
                success_criteria=success_criteria,
                created_by_uid=uid or '',
                instructions=instructions,
                objectives=objectives,
                target_expressions=target_expressions,
                target_vocabulary=target_vocabulary,
                focus_grammar=focus_grammar,
                generated_scenario=generated_scenario,
                teacher_notes=teacher_notes,
                student_instructions=student_instructions,
                target_language_intensity=target_language_intensity,
                sql_engine=deps.sql_engine,
            )

            return jsonify({
                'success': True,
                'assignment': serialize_assignment(deps.db.get_assignment(assignment_id)),
            }), 201
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'Assignment creation error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/student/compliance', methods=['GET'])
    @deps.login_required
    def api_student_compliance():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                return jsonify({'success': False, 'error': 'not_authenticated'}), 401
            context = deps.get_school_request_context()
            org_id = getattr(context, 'active_organization_id', None) if context else None
            if not org_id:
                return jsonify({'success': False, 'error': 'no_active_org'}), 400
            record = resolve_student_compliance_record(deps, org_id=org_id, student_uid=uid)
            return jsonify({
                'success': True,
                'compliance': serialize_student_compliance_record(record),
            })
        except Exception as exc:
            print(f'Student compliance fetch error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/student/voice-consent', methods=['POST'])
    @deps.login_required
    def api_student_voice_consent():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                return jsonify({'success': False, 'error': 'not_authenticated'}), 401
            context = deps.get_school_request_context()
            org_id = getattr(context, 'active_organization_id', None) if context else None
            if not org_id:
                return jsonify({'success': False, 'error': 'no_active_org'}), 400
            data = request.get_json(silent=True) or {}
            status = _normalize_string(data.get('status')).lower()
            if status not in ('granted', 'revoked'):
                return jsonify({'success': False, 'error': 'invalid_status'}), 400
            record = upsert_student_compliance_record(
                deps,
                org_id=org_id,
                student_uid=uid,
                updates={'voice_consent_status': status},
            )
            create_consent_event(
                deps,
                org_id=org_id,
                student_uid=uid,
                event_type=f'voice_consent_{status}',
                actor_type='student',
                actor_id=uid,
            )
            return jsonify({
                'success': True,
                'compliance': serialize_student_compliance_record(record),
            })
        except Exception as exc:
            print(f'Student voice consent error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/student/assignments', methods=['GET'])
    @deps.login_required
    def api_list_student_assignments():
        try:
            uid = deps.get_current_user_uid()
            assignments = deps.db.list_student_assignments(uid, statuses=['published'])
            return jsonify({
                'success': True,
                'assignments': _serialize_assignments_with_class_names(deps, assignments),
            })
        except Exception as exc:
            print(f'Student assignment list error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/student/assignments/<assignment_id>/bootstrap', methods=['POST'])
    @deps.login_required
    def api_bootstrap_student_assignment(assignment_id):
        try:
            uid = deps.get_current_user_uid()
            data = request.get_json(silent=True) or {}
            ui_language = _normalize_string(data.get('uiLanguage')) or 'en'
            context = deps.get_school_request_context()
            bootstrap = resolve_assignment_bootstrap_for_user(
                deps,
                uid=uid,
                context=context,
                assignment_id=assignment_id,
                ui_language=ui_language,
            )
            return jsonify({'success': True, 'bootstrap': bootstrap})
        except SuspendedOrgError as exc:
            return jsonify(exc.to_payload()), 403
        except ValueError as exc:
            error = str(exc)
            status_code = 404 if 'not found' in error.lower() else 400
            return jsonify({'success': False, 'error': error}), status_code
        except PermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'Assignment bootstrap error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/student/assignments/<assignment_id>/workspace', methods=['GET'])
    @deps.login_required
    def api_get_student_assignment_workspace(assignment_id):
        try:
            uid = deps.get_current_user_uid()
            context = deps.get_school_request_context()
            bootstrap = resolve_assignment_bootstrap_for_user(
                deps,
                uid=uid,
                context=context,
                assignment_id=assignment_id,
                ui_language='en',
            )
            if hasattr(deps.db, 'list_student_assignment_practice_sessions'):
                session_records = deps.db.list_student_assignment_practice_sessions(assignment_id, uid)
            else:
                session_records = [
                    session
                    for session in deps.db.list_assignment_practice_sessions(assignment_id)
                    if session.get('student_uid') == uid
                ]
            workspace = build_student_assignment_workspace(
                bootstrap,
                session_records,
                db=deps.db,
                uid=uid or '',
            )
            return jsonify({'success': True, 'workspace': workspace})
        except SuspendedOrgError as exc:
            return jsonify(exc.to_payload()), 403
        except ValueError as exc:
            error = str(exc)
            status_code = 404 if 'not found' in error.lower() else 400
            return jsonify({'success': False, 'error': error}), status_code
        except PermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'Assignment workspace error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/student/assignments/<assignment_id>/practice-sessions', methods=['POST'])
    @deps.login_required
    def api_create_assignment_practice_session(assignment_id):
        try:
            uid = deps.get_current_user_uid()
            data = request.get_json(silent=True) or {}
            ui_language = _normalize_string(data.get('uiLanguage')) or 'en'
            chat_id = _normalize_string(data.get('chatId'))
            context = deps.get_school_request_context()
            bootstrap = resolve_assignment_bootstrap_for_user(
                deps,
                uid=uid,
                context=context,
                assignment_id=assignment_id,
                ui_language=ui_language,
            )
            launch = bootstrap.get('launch', {}) if isinstance(bootstrap, dict) else {}
            if not launch.get('voiceAllowed') and not launch.get('textAllowed'):
                blocked_reasons = launch.get('blockedReasons') or []
                reason = blocked_reasons[0] if blocked_reasons else 'This assignment launch is blocked by policy.'
                return jsonify({'success': False, 'error': reason, 'blockedReasons': blocked_reasons}), 403

            session_payload = build_practice_session_payload(
                bootstrap,
                student_uid=uid or '',
                chat_id=chat_id,
                ui_language=ui_language,
            )
            # In-flight grace anchor: capture the org status at session
            # creation. Future event POSTs on this session pass through if
            # *this* snapshot is 'active', even after the org is suspended.
            classroom = bootstrap.get('class', {}) if isinstance(bootstrap, dict) else {}
            session_org_id = classroom.get('orgId') or session_payload.get('org_id')
            session_org = deps.db.get_organization(session_org_id) if session_org_id else None
            session_payload['org_status_when_created'] = (
                (session_org or {}).get('status') or database.ORG_STATUS_ACTIVE
            )
            session_id = deps.db.create_practice_session(session_payload)
            session_record = deps.db.get_practice_session(session_id)

            deps.db.create_learning_event(
                build_learning_event_payload(
                    session_record,
                    event_type='session.started',
                    payload={
                        'chatId': chat_id,
                        'uiLanguage': ui_language,
                        'modality': session_record.get('modality'),
                    },
                )
            )

            return jsonify({
                'success': True,
                'practiceSession': serialize_practice_session(session_record),
            }), 201
        except SuspendedOrgError as exc:
            return jsonify(exc.to_payload()), 403
        except ValueError as exc:
            error = str(exc)
            status_code = 404 if 'not found' in error.lower() else 400
            return jsonify({'success': False, 'error': error}), status_code
        except PermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'Practice session creation error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/practice-sessions/<session_id>/events', methods=['POST'])
    @deps.login_required
    def api_report_practice_session_event(session_id):
        try:
            uid = deps.get_current_user_uid()
            data = request.get_json(silent=True) or {}
            event_type = _normalize_string(data.get('eventType'))
            turn_index = _coerce_optional_int(data.get('turnIndex'))
            payload = data.get('payload') if isinstance(data.get('payload'), dict) else {}

            if event_type not in SUPPORTED_EVENT_TYPES:
                return jsonify({'success': False, 'error': 'Unsupported eventType.'}), 400

            session_record = deps.db.get_practice_session(session_id)
            if not session_record:
                return jsonify({'success': False, 'error': 'Practice session not found.'}), 404
            if session_record.get('student_uid') != uid:
                return jsonify({'success': False, 'error': 'Practice session is not available for this user.'}), 403
            if session_record.get('status') != 'active' and event_type != 'session.ended':
                return jsonify({'success': False, 'error': 'Practice session is no longer active.'}), 409

            # In-flight grace: only block when *both* the org is currently
            # suspended AND the session was created while the org was
            # already suspended. Sessions that started while the org was
            # active continue to drain their events through to closure even
            # if the org is suspended mid-session.
            session_org_id = session_record.get('org_id')
            if session_org_id:
                org = deps.db.get_organization(session_org_id) or {}
                current_status = org.get('status', database.ORG_STATUS_ACTIVE)
                snapshot = session_record.get('org_status_when_created', database.ORG_STATUS_ACTIVE)
                if current_status != database.ORG_STATUS_ACTIVE and snapshot != database.ORG_STATUS_ACTIVE:
                    err = SuspendedOrgError(
                        org_id=session_org_id,
                        reason=org.get('suspend_reason'),
                        until=org.get('suspended_until'),
                    )
                    return jsonify(err.to_payload()), 403

            deps.db.create_learning_event(
                build_learning_event_payload(
                    session_record,
                    event_type=event_type,
                    turn_index=turn_index,
                    payload=payload,
                )
            )
            session_updates = apply_learning_event_to_session(
                session_record,
                event_type=event_type,
                turn_index=turn_index,
                payload=payload,
            )
            for derived_event in build_derived_learning_events(
                session_record,
                event_type=event_type,
                turn_index=turn_index,
                payload=payload,
                updated_session_summary=session_updates.get('session_summary'),
            ):
                deps.db.create_learning_event(derived_event)
            deps.db.update_practice_session(session_id, session_updates)

            return jsonify({
                'success': True,
                'practiceSession': serialize_practice_session(deps.db.get_practice_session(session_id)),
            })
        except Exception as exc:
            print(f'Practice session event error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/teacher/assignments/<assignment_id>/analytics', methods=['GET'])
    @deps.login_required
    def api_get_assignment_analytics(assignment_id):
        try:
            _require_assignment_teacher_access(deps, assignment_id)
            assignment, _mapping, class_record = load_assignment_bundle(deps, assignment_id)
            bootstrap = resolve_assignment_bootstrap(
                deps,
                assignment=assignment,
                class_record=class_record,
                ui_language='en',
            )
            analytics = build_assignment_analytics_payload(
                bootstrap,
                deps.db.list_assignment_practice_sessions(assignment_id),
                deps.db.list_assignment_learning_events(assignment_id),
            )
            return jsonify({
                'success': True,
                'analytics': analytics,
            })
        except SuspendedOrgError as exc:
            return jsonify(exc.to_payload()), 403
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 404
        except Exception as exc:
            print(f'Assignment analytics error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/teacher/classes/<class_id>/analytics', methods=['GET'])
    @deps.login_required
    def api_get_class_analytics(class_id):
        try:
            _context, class_record = _require_teacher_context(deps, class_id)
            assignments = deps.db.list_class_assignments(class_id)
            enrollments = deps.db.list_class_enrollments(class_id)
            all_sessions = deps.db.list_class_practice_sessions(class_id)

            # Optional date range filtering on sessions
            date_from = request.args.get('dateFrom')
            date_to = request.args.get('dateTo')
            if date_from or date_to:
                all_sessions = _filter_sessions_by_date(all_sessions, date_from, date_to)

            student_uids = set()
            for enrollment in enrollments:
                uid = enrollment.get('student_uid')
                if isinstance(uid, str) and uid:
                    student_uids.add(uid)
            for session in all_sessions:
                uid = session.get('student_uid')
                if isinstance(uid, str) and uid:
                    student_uids.add(uid)

            student_profiles = {}
            for uid in student_uids:
                user = deps.db.get_user(uid)
                if user:
                    student_profiles[uid] = user

            analytics = build_class_analytics_payload(
                class_record,
                assignments,
                enrollments,
                all_sessions,
                student_profiles,
            )
            return jsonify({
                'success': True,
                'analytics': analytics,
            })
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'Class analytics error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/teacher/classes/<class_id>/students/<student_uid>/analytics', methods=['GET'])
    @deps.login_required
    def api_get_student_drill_down(class_id, student_uid):
        try:
            _context, class_record = _require_teacher_context(deps, class_id)
            assignments = deps.db.list_class_assignments(class_id)
            student_sessions = deps.db.list_student_class_practice_sessions(class_id, student_uid)
            student_events = deps.db.list_student_class_learning_events(class_id, student_uid)
            student_profile = deps.db.get_user(student_uid) or {}

            analytics = build_student_drill_down_payload(
                student_uid,
                class_record,
                assignments,
                student_sessions,
                student_events,
                student_profile,
            )
            log_disclosure_if_new(
                org_id=_context.active_organization_id,
                actor_uid=_context.uid,
                actor_role='teacher',
                student_uid=student_uid,
                event_type='disclosure.practice_data_viewed',
                payload={'endpoint': f'/api/teacher/classes/{class_id}/students/{student_uid}/analytics', 'class_id': class_id},
            )
            return jsonify({
                'success': True,
                'analytics': analytics,
            })
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'Student drill-down error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    return bp
