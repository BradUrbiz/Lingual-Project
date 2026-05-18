"""
LTI 1.3 blueprint — OIDC login, JWT callback, JWKS, platform management.

Public endpoints (Canvas calls these):
    GET  /lti/jwks       – Serve Lingual's JWKS (RSA public key).
    POST /lti/login      – OIDC login initiation.
    POST /lti/callback   – Main LTI launch handler (JWT validation + routing).

Authenticated API endpoints (school_admin):
    POST   /api/schools/lti-platform – Register Canvas instance as LTI platform.
    GET    /api/schools/lti-platform – Return current LTI platform config.
    DELETE /api/schools/lti-platform – Remove the LTI platform registration.
"""

from __future__ import annotations

import os

from flask import Blueprint, jsonify, redirect, request, session

from backend.route_deps import RouteDeps
from backend.routes.curriculum_admin import _require_assignment_teacher_access
from backend.services.lti.config import FirestoreToolConf
from backend.services.lti.identity import (
    auto_enroll_student,
    build_lti_identity_key,
    match_lti_user,
    resolve_lti_platform,
)
from backend.services.lti.keys import get_jwks
from backend.services.membership_context import SchoolContextPermissionError

SCHOOL_ADMIN_ROLES = {'school_admin'}
TEACHER_ALLOWED_ROLES = {'teacher', 'school_admin'}


def _lti_callback_url() -> str:
    """Build the canonical LTI callback URL.

    Built from `PUBLIC_BASE_URL` rather than Flask's `request.host_url` /
    `url_for(_external=True)` because ProxyFix is configured with
    `x_proto=0, x_host=0` to avoid header spoofing. Without trusting
    forwarded scheme/host, Flask sees the request as `http://<proxy-host>/`
    behind Cloud Run, which would emit broken HTTP LTI callback URLs that
    Canvas rejects.
    """
    base = os.environ.get('PUBLIC_BASE_URL', 'https://lingual.app').rstrip('/')
    return f'{base}/lti/callback'


def create_lti_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('lti', __name__)

    def _require_school_admin():
        """Return the school request context after verifying school_admin role."""
        ctx = deps.get_school_request_context()
        ctx.require_any_role(SCHOOL_ADMIN_ROLES)
        return ctx

    # ── helpers ───────────────────────────────────────────────────────

    def _is_instructor(roles):
        """Return True if any LTI role string indicates an instructor."""
        roles_list = roles if isinstance(roles, list) else [roles] if roles else []
        return any('Instructor' in str(r) for r in roles_list)

    def _extract_issuer(launch_data):
        """Extract the issuer from launch_data, trying common locations."""
        return launch_data.get('iss', '')

    def _extract_email(launch_data):
        return launch_data.get('email', '')

    def _extract_canvas_user_id(launch_data):
        return launch_data.get('sub', '')

    def _extract_roles(launch_data):
        return launch_data.get(
            'https://purl.imsglobal.org/spec/lti/claim/roles', []
        )

    def _extract_client_id(launch_data):
        aud = launch_data.get('aud', '')
        if isinstance(aud, list):
            azp = launch_data.get('azp', '')
            if isinstance(azp, str) and azp in aud:
                return azp
            return str(aud[0]) if aud else ''
        return str(aud or '')

    def _extract_deployment_id(launch_data):
        return str(launch_data.get(
            'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
            '',
        ) or '')

    def _extract_context(launch_data):
        return launch_data.get(
            'https://purl.imsglobal.org/spec/lti/claim/context', {}
        )

    def _extract_custom(launch_data):
        return launch_data.get(
            'https://purl.imsglobal.org/spec/lti/claim/custom', {}
        )

    def _extract_message_type(launch_data):
        return launch_data.get(
            'https://purl.imsglobal.org/spec/lti/claim/message_type', ''
        )

    def _platform_for_launch(issuer, client_id='', deployment_id=''):
        return resolve_lti_platform(
            deps.db,
            issuer=issuer,
            client_id=client_id,
            deployment_id=deployment_id,
        )

    def _active_context_for_platform(platform):
        context = deps.get_school_request_context()
        context.require_any_role(TEACHER_ALLOWED_ROLES)
        if platform and platform.get('org_id') != context.active_organization_id:
            raise SchoolContextPermissionError('LTI platform is outside the active organization.')
        return context

    # ══════════════════════════════════════════════════════════════════
    # 1. GET /lti/jwks — Public JWKS endpoint
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/lti/jwks')
    def lti_jwks():
        try:
            return jsonify(get_jwks())
        except Exception as exc:
            print(f'LTI JWKS error: {exc}')
            return jsonify({'error': str(exc)}), 500

    # ══════════════════════════════════════════════════════════════════
    # 2. POST /lti/login — OIDC login initiation (Canvas calls this)
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/lti/login', methods=['GET', 'POST'])
    def lti_login():
        try:
            from pylti1p3.contrib.flask import FlaskOIDCLogin, FlaskRequest

            tool_conf = FirestoreToolConf(deps.db)
            flask_request = FlaskRequest()
            oidc_login = FlaskOIDCLogin(flask_request, tool_conf)
            target_link_uri = request.form.get(
                'target_link_uri',
                request.args.get(
                    'target_link_uri',
                    _lti_callback_url(),
                ),
            )
            return oidc_login.enable_check_cookies().redirect(target_link_uri)
        except Exception as exc:
            print(f'LTI login error: {exc}')
            return jsonify({'error': f'LTI login failed: {exc}'}), 500

    # ══════════════════════════════════════════════════════════════════
    # 3. POST /lti/callback — Main LTI launch handler
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/lti/callback', methods=['POST'])
    def lti_callback():
        try:
            from pylti1p3.contrib.flask import FlaskMessageLaunch, FlaskRequest

            tool_conf = FirestoreToolConf(deps.db)
            flask_request = FlaskRequest()
            message_launch = FlaskMessageLaunch(flask_request, tool_conf)
            message_launch.validate()

            launch_data = message_launch.get_launch_data()

            # Extract claims
            issuer = _extract_issuer(launch_data)
            client_id = _extract_client_id(launch_data)
            deployment_id = _extract_deployment_id(launch_data)
            email = _extract_email(launch_data)
            canvas_user_id = _extract_canvas_user_id(launch_data)
            roles = _extract_roles(launch_data)
            context = _extract_context(launch_data)
            custom = _extract_custom(launch_data)
            message_type = _extract_message_type(launch_data)

            canvas_course_id = context.get('id', '')
            canvas_course_title = context.get('title', '')
            is_instructor = _is_instructor(roles)

            # ── Deep Linking request ─────────────────────────────────
            if message_type == 'LtiDeepLinkingRequest':
                session['lti_deep_link'] = {
                    'launch_id': message_launch.get_launch_id(),
                    'issuer': issuer,
                    'client_id': client_id,
                    'deployment_id': deployment_id,
                    'email': email,
                    'canvas_user_id': canvas_user_id,
                    'roles': roles,
                    'canvas_course_id': canvas_course_id,
                    'canvas_course_title': canvas_course_title,
                }
                return redirect('/lti/assignment-picker')

            # ── Identity matching ────────────────────────────────────
            matched_user = match_lti_user(
                deps.db,
                issuer=issuer,
                client_id=client_id,
                deployment_id=deployment_id,
                email=email,
                canvas_user_id=canvas_user_id,
                roles=roles,
            )

            if not matched_user:
                # Store pending link info so the link-account page can use it
                session['lti_pending_link'] = {
                    'issuer': issuer,
                    'client_id': client_id,
                    'deployment_id': deployment_id,
                    'email': email,
                    'canvas_user_id': canvas_user_id,
                    'roles': roles,
                    'canvas_course_id': canvas_course_id,
                    'canvas_course_title': canvas_course_title,
                }
                return redirect('/lti/link-account')

            uid = matched_user['uid']
            org_id = matched_user['org_id']
            membership_id = matched_user['membership_id']
            platform_id = matched_user['platform_id']

            # ── Create LTI session record ────────────────────────────
            deps.db.create_lti_session(
                user_uid=uid,
                platform_id=platform_id,
                canvas_user_id=canvas_user_id,
                canvas_course_id=canvas_course_id,
                roles=roles,
            )

            # ── Set Flask session (same pattern as test_harness) ─────
            user = deps.db.get_user(uid)
            session['user'] = {
                'uid': uid,
                'email': user.get('email', '') if user else email,
                'name': user.get('name', '') if user else '',
                'active_membership_id': membership_id,
            }
            deps.db.set_user_last_active_membership(uid, membership_id)

            # ── Auto-create class + canvas_connection for instructors ─
            if is_instructor and canvas_course_id:
                # Check if a class already exists for this course in the org
                existing_classes = deps.db.list_org_classes(org_id)
                course_class = None
                for cls in existing_classes:
                    if cls.get('canvas_course_id') == str(canvas_course_id):
                        course_class = cls
                        break

                if not course_class:
                    # Create a new class linked to this Canvas course
                    class_id = deps.db.create_class(
                        org_id=org_id,
                        name=canvas_course_title or f'Canvas Course {canvas_course_id}',
                        teacher_membership_ids=[membership_id],
                        canvas_course_id=str(canvas_course_id),
                    )
                    deps.db.add_primary_class_to_membership(membership_id, class_id)

                    # Create canvas_connection with LTI auth
                    platform = _platform_for_launch(issuer, client_id, deployment_id)
                    canvas_instance_url = ''
                    deployment_id_val = ''
                    if platform:
                        # Derive instance URL from issuer (e.g. https://canvas.school.edu)
                        canvas_instance_url = platform.get('issuer', '')
                        deployment_id_val = platform.get('deployment_id', '')

                    deps.db.create_canvas_connection(
                        membership_id=membership_id,
                        org_id=org_id,
                        class_id=class_id,
                        canvas_instance_url=canvas_instance_url,
                        canvas_course_id=str(canvas_course_id),
                        canvas_course_name=canvas_course_title,
                        auth_method='lti',
                        lti_deployment_id=deployment_id_val,
                        lti_context_id=str(canvas_course_id),
                    )

            # ── Auto-enroll students ─────────────────────────────────
            if not is_instructor and canvas_course_id:
                # Find the class for this canvas course
                existing_classes = deps.db.list_org_classes(org_id)
                for cls in existing_classes:
                    if cls.get('canvas_course_id') == str(canvas_course_id):
                        auto_enroll_student(
                            deps.db,
                            uid=uid,
                            org_id=org_id,
                            class_id=cls['id'],
                            membership_id=membership_id,
                        )
                        break

            # ── Check for deep-linked assignment in custom claims ────
            assignment_id = (
                custom.get('lingual_assignment_id', '')
                or custom.get('assignment_id', '')
                or custom.get('assignmentId', '')
            )
            if assignment_id:
                return redirect(f'/app/assignments/{assignment_id}')

            # ── Default redirect ─────────────────────────────────────
            if is_instructor:
                return redirect('/app/teacher')
            return redirect('/app/learn')

        except Exception as exc:
            print(f'LTI callback error: {exc}')
            return jsonify({'error': f'LTI launch failed: {exc}'}), 500

    # ══════════════════════════════════════════════════════════════════
    # 4. POST /api/schools/lti-platform — Register Canvas as LTI platform
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/api/schools/lti-platform', methods=['POST'])
    @deps.login_required
    def api_register_lti_platform():
        try:
            ctx = _require_school_admin()
            org_id = ctx.active_organization_id
            if not org_id:
                return jsonify({'success': False, 'error': 'No active organization.'}), 400

            data = request.get_json() or {}
            issuer = (data.get('issuer') or '').strip()
            client_id = (data.get('clientId') or '').strip()
            deployment_id = (data.get('deploymentId') or '').strip()
            auth_login_url = (data.get('authLoginUrl') or '').strip()
            auth_token_url = (data.get('authTokenUrl') or '').strip()
            key_set_url = (data.get('keySetUrl') or '').strip()

            if not all([issuer, client_id, deployment_id, auth_login_url, auth_token_url, key_set_url]):
                return jsonify({
                    'success': False,
                    'error': 'All fields are required: issuer, clientId, deploymentId, authLoginUrl, authTokenUrl, keySetUrl.',
                }), 400

            duplicate = _platform_for_launch(issuer, client_id, deployment_id)
            if duplicate and duplicate.get('org_id') != org_id:
                return jsonify({
                    'success': False,
                    'error': 'This Canvas issuer, client ID, and deployment ID are already registered to another organization.',
                }), 409

            # Delete existing platform for this org (only one per org)
            existing = deps.db.get_lti_platform_by_org(org_id)
            if existing:
                deps.db.delete_lti_platform(existing['id'])

            platform_id = deps.db.create_lti_platform(
                org_id=org_id,
                issuer=issuer,
                client_id=client_id,
                deployment_id=deployment_id,
                auth_login_url=auth_login_url,
                auth_token_url=auth_token_url,
                key_set_url=key_set_url,
            )

            return jsonify({
                'success': True,
                'platformId': platform_id,
            }), 201

        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'LTI platform registration error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    # ══════════════════════════════════════════════════════════════════
    # 5. GET /api/schools/lti-platform — Current LTI platform config
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/api/schools/lti-platform')
    @deps.login_required
    def api_get_lti_platform():
        try:
            ctx = _require_school_admin()
            org_id = ctx.active_organization_id
            if not org_id:
                return jsonify({'success': False, 'error': 'No active organization.'}), 400

            platform = deps.db.get_lti_platform_by_org(org_id)
            if not platform:
                return jsonify({'success': True, 'platform': None})

            return jsonify({
                'success': True,
                'platform': {
                    'id': platform.get('id'),
                    'orgId': platform.get('org_id'),
                    'issuer': platform.get('issuer', ''),
                    'clientId': platform.get('client_id', ''),
                    'deploymentId': platform.get('deployment_id', ''),
                    'authLoginUrl': platform.get('auth_login_url', ''),
                    'authTokenUrl': platform.get('auth_token_url', ''),
                    'keySetUrl': platform.get('key_set_url', ''),
                },
            })

        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'LTI platform lookup error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    # ══════════════════════════════════════════════════════════════════
    # 6. DELETE /api/schools/lti-platform — Remove LTI platform
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/api/schools/lti-platform', methods=['DELETE'])
    @deps.login_required
    def api_delete_lti_platform():
        try:
            ctx = _require_school_admin()
            org_id = ctx.active_organization_id
            if not org_id:
                return jsonify({'success': False, 'error': 'No active organization.'}), 400

            platform = deps.db.get_lti_platform_by_org(org_id)
            if not platform:
                return jsonify({'success': False, 'error': 'No LTI platform registered for this organization.'}), 404

            deps.db.delete_lti_platform(platform['id'])
            return jsonify({'success': True})

        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            print(f'LTI platform deletion error: {exc}')
            return jsonify({'success': False, 'error': str(exc)}), 500

    # ══════════════════════════════════════════════════════════════════
    # 7. POST /api/lti/link-account — Manual account linking
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/api/lti/link-account', methods=['POST'])
    @deps.login_required
    def api_link_lti_account():
        uid = deps.get_current_user_uid()
        pending = session.get('lti_pending_link')
        if not pending:
            return jsonify({'success': False, 'error': 'No pending LTI link.'}), 400

        issuer = pending.get('issuer', '')
        client_id = pending.get('client_id', '')
        deployment_id = pending.get('deployment_id', '')
        canvas_user_id = pending.get('canvas_user_id', '')
        email = pending.get('email', '')
        roles = pending.get('roles', [])
        canvas_course_id = pending.get('canvas_course_id', '')
        canvas_course_title = pending.get('canvas_course_title', '')

        # Find the platform for this issuer/client/deployment.
        platform = _platform_for_launch(issuer, client_id, deployment_id)
        if not platform:
            return jsonify({'success': False, 'error': 'LTI platform not found for issuer.'}), 400

        org_id = platform.get('org_id', '')
        resolved_client_id = client_id or platform.get('client_id', '')
        resolved_deployment_id = deployment_id or platform.get('deployment_id', '')
        is_instructor = _is_instructor(roles)
        role = 'teacher' if is_instructor else 'student'

        # Store the LTI identity link on the user record
        user = deps.db.get_user(uid) or {}
        lti_identities = [
            identity
            for identity in (user.get('lti_identities', []) or [])
            if isinstance(identity, dict)
        ]
        identity_key = build_lti_identity_key(issuer, resolved_client_id, canvas_user_id)
        if not any(
            identity.get('issuer') == issuer
            and identity.get('client_id', '') == resolved_client_id
            and identity.get('canvas_user_id') == canvas_user_id
            for identity in lti_identities
        ):
            lti_identities.append({
                'issuer': issuer,
                'client_id': resolved_client_id,
                'deployment_id': resolved_deployment_id,
                'canvas_user_id': canvas_user_id,
                'email': email,
                'platform_id': platform['id'],
            })
        lti_identity_keys = list(user.get('lti_identity_keys', []) or [])
        if identity_key not in lti_identity_keys:
            lti_identity_keys.append(identity_key)
        deps.db.update_user(uid, {
            'lti_identities': lti_identities,
            'lti_identity_keys': lti_identity_keys,
        })

        membership_id = ''
        memberships = deps.db.get_user_memberships(uid) if hasattr(deps.db, 'get_user_memberships') else []
        for membership in memberships:
            if membership.get('orgId') == org_id:
                membership_id = membership.get('id', '')
                break
        if not membership_id:
            membership_id = deps.db.create_membership(
                org_id=org_id,
                uid=uid,
                roles=[role],
                status='active',
                primary_class_ids=[],
                membership_id=f'{org_id}_{uid}',
            )

        user = deps.db.get_user(uid) or user
        session['user'] = {
            'uid': uid,
            'email': user.get('email', ''),
            'name': user.get('name', ''),
            'active_membership_id': membership_id,
        }
        deps.db.set_user_last_active_membership(uid, membership_id)

        if not is_instructor and canvas_course_id:
            for cls in deps.db.list_org_classes(org_id):
                if cls.get('canvas_course_id') == str(canvas_course_id):
                    auto_enroll_student(
                        deps.db,
                        uid=uid,
                        org_id=org_id,
                        class_id=cls['id'],
                        membership_id=membership_id,
                    )
                    break

        session.pop('lti_pending_link', None)

        redirect_to = '/app/teacher' if is_instructor else '/app/learn'

        return jsonify({'success': True, 'redirectTo': redirect_to})

    # ══════════════════════════════════════════════════════════════════
    # 8. GET /api/lti/deep-link/assignments — List assignments for picker
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/api/lti/deep-link/assignments')
    @deps.login_required
    def api_deep_link_assignments():
        try:
            deep_link_info = session.get('lti_deep_link')
            if not deep_link_info:
                return jsonify({'success': False, 'error': 'No deep link session. Launch from Canvas first.'}), 400

            canvas_course_id = deep_link_info.get('canvas_course_id', '')

            # Find the class linked to this Canvas course
            issuer = deep_link_info.get('issuer', '')
            client_id = deep_link_info.get('client_id', '')
            deployment_id = deep_link_info.get('deployment_id', '')
            platform = _platform_for_launch(issuer, client_id, deployment_id)
            if not platform:
                return jsonify({'success': False, 'error': 'LTI platform not found.'}), 400
            _active_context_for_platform(platform)

            org_id = platform.get('org_id', '')
            org_classes = deps.db.list_org_classes(org_id)
            class_id = None
            for cls in org_classes:
                if cls.get('canvas_course_id') == str(canvas_course_id):
                    class_id = cls['id']
                    break

            if not class_id:
                return jsonify({'success': True, 'assignments': []})

            assignments = deps.db.list_class_assignments(class_id)
            serialized = []
            for a in assignments:
                if a.get('status') == 'published':
                    serialized.append({
                        'id': a.get('id', ''),
                        'title': a.get('title', 'Untitled'),
                        'status': a.get('status', ''),
                        'taskType': a.get('task_type', ''),
                    })

            return jsonify({'success': True, 'assignments': serialized})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            import traceback
            traceback.print_exc()
            return jsonify({'success': False, 'error': str(exc)}), 500

    # ══════════════════════════════════════════════════════════════════
    # 9. POST /api/lti/deep-link/respond — Submit deep link response
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/api/lti/deep-link/respond', methods=['POST'])
    @deps.login_required
    def api_deep_link_respond():
        try:
            from pylti1p3.contrib.flask import FlaskMessageLaunch, FlaskRequest

            data = request.get_json() or {}
            assignment_id = data.get('assignmentId', '')
            points = data.get('points')
            launch_info = session.get('lti_deep_link')

            if not launch_info or not assignment_id:
                return jsonify({'success': False, 'error': 'Missing context.'}), 400

            issuer = launch_info.get('issuer', '')
            client_id = launch_info.get('client_id', '')
            deployment_id = launch_info.get('deployment_id', '')
            platform = _platform_for_launch(issuer, client_id, deployment_id)
            if not platform:
                return jsonify({'success': False, 'error': 'LTI platform not found.'}), 400
            _active_context_for_platform(platform)

            try:
                assignment = _require_assignment_teacher_access(deps, assignment_id)
            except ValueError:
                return jsonify({'success': False, 'error': 'Assignment not found.'}), 404
            assignment_class = deps.db.get_class(assignment.get('class_id'))
            if (
                not assignment_class
                or assignment_class.get('org_id') != platform.get('org_id')
                or (
                    launch_info.get('canvas_course_id')
                    and assignment_class.get('canvas_course_id') != str(launch_info.get('canvas_course_id'))
                )
            ):
                return jsonify({'success': False, 'error': 'Assignment is outside this Canvas course.'}), 403

            from pylti1p3.deep_link_resource import DeepLinkResource
            resource = DeepLinkResource()
            resource.set_url(_lti_callback_url())
            resource.set_custom_params({'lingual_assignment_id': assignment_id})
            resource.set_title(assignment.get('title', 'Lingual Practice'))

            if points:
                from pylti1p3.lineitem import LineItem
                lineitem = LineItem()
                lineitem.set_tag('lingual-grade')
                lineitem.set_score_maximum(float(points))
                lineitem.set_label(assignment.get('title', 'Lingual Practice'))
                resource.set_lineitem(lineitem)

            tool_conf = FirestoreToolConf(deps.db)
            flask_req = FlaskRequest()
            launch = FlaskMessageLaunch.from_cache(launch_info['launch_id'], flask_req, tool_conf)
            deep_link = launch.get_deep_link()
            html = deep_link.output_response_form_html([resource])

            session.pop('lti_deep_link', None)
            return jsonify({'success': True, 'responseHtml': html})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            import traceback
            traceback.print_exc()
            return jsonify({'success': False, 'error': str(exc)}), 500

    # ══════════════════════════════════════════════════════════════════
    # 10. POST /api/teacher/assignments/<id>/grade-config — Set grade config
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/api/teacher/assignments/<assignment_id>/grade-config', methods=['POST'])
    @deps.login_required
    def api_set_grade_config(assignment_id):
        try:
            _require_assignment_teacher_access(deps, assignment_id)
            data = request.get_json() or {}
            metric = data.get('metric')
            points = data.get('points')
            if metric and metric != 'completion':
                return jsonify({'success': False, 'error': 'Only "completion" metric is supported.'}), 400
            # Update the assignment's grade fields
            assignment = deps.db.get_assignment(assignment_id)
            if not assignment:
                return jsonify({'success': False, 'error': 'Assignment not found.'}), 404
            # Use a direct Firestore update
            from google.cloud import firestore as gc_firestore
            deps.db.get_assignment_ref(assignment_id).update({
                'grade_metric': metric,
                'grade_points': float(points) if points else None,
                'updated_at': gc_firestore.SERVER_TIMESTAMP,
            })
            return jsonify({'success': True})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 404
        except Exception as exc:
            return jsonify({'success': False, 'error': str(exc)}), 500

    # ══════════════════════════════════════════════════════════════════
    # 11. GET /api/teacher/assignments/<id>/grade-config — Get grade config
    # ══════════════════════════════════════════════════════════════════

    @bp.route('/api/teacher/assignments/<assignment_id>/grade-config')
    @deps.login_required
    def api_get_grade_config(assignment_id):
        try:
            try:
                assignment = _require_assignment_teacher_access(deps, assignment_id)
            except ValueError:
                return jsonify({'success': False, 'error': 'Assignment not found.'}), 404
            return jsonify({
                'success': True,
                'metric': assignment.get('grade_metric'),
                'points': assignment.get('grade_points'),
            })
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            return jsonify({'success': False, 'error': str(exc)}), 500

    return bp
