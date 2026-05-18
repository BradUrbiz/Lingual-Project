from __future__ import annotations

import os
from datetime import UTC, datetime

import database
from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email
from database import list_lingual_admin_emails


def _public_base_url() -> str:
    return os.environ.get('PUBLIC_BASE_URL', 'https://lingual.app')


def _serialize_request(req: dict | None) -> dict | None:
    """Convert snake_case Firestore fields to camelCase for the API response."""
    if req is None:
        return None

    admin_identity = req.get('admin_identity')
    admin_identity_out = None
    if admin_identity:
        att = admin_identity.get('authorization_attestation') or {}
        admin_identity_out = {
            'fullName': admin_identity.get('full_name'),
            'schoolEmail': admin_identity.get('school_email'),
            'roleTitle': admin_identity.get('role_title'),
            'authorizationAttestation': {
                'confirmedAt': att.get('confirmed_at'),
                'ipHash': att.get('ip_hash'),
                'userAgent': att.get('user_agent'),
            },
        }

    integration = req.get('integration')
    integration_out = None
    if integration:
        integration_out = {
            'canvasUrl': integration.get('canvas_url'),
            'canvasIntegrationTypes': integration.get('canvas_integration_types') or [],
        }

    curriculum = req.get('curriculum')
    curriculum_out = None
    if curriculum:
        curriculum_out = {
            'gradeRanges': curriculum.get('grade_ranges') or [],
            'languagesTaught': curriculum.get('languages_taught') or [],
            'courseFrameworks': curriculum.get('course_frameworks') or [],
        }

    return {
        'id': req.get('id'),
        'requesterUid': req.get('requester_uid'),
        'requesterEmail': req.get('requester_email'),
        'requesterName': req.get('requester_name'),
        'schoolName': req.get('school_name'),
        'orgType': req.get('org_type'),
        'websiteUrl': req.get('website_url'),
        'canvasInstanceUrl': req.get('canvas_instance_url'),
        'status': req.get('status'),
        'reviewedByUid': req.get('reviewed_by_uid'),
        'reviewedAt': req.get('reviewed_at').isoformat() if isinstance(req.get('reviewed_at'), datetime) else req.get('reviewed_at'),
        'rejectionReason': req.get('rejection_reason'),
        'rejectionCategory': req.get('rejection_category'),
        'createdOrgId': req.get('created_org_id'),
        'createdAt': req.get('created_at').isoformat() if isinstance(req.get('created_at'), datetime) else req.get('created_at'),
        'cancelledAt': req.get('cancelled_at').isoformat() if isinstance(req.get('cancelled_at'), datetime) else req.get('cancelled_at'),
        # --- Enriched (Plan 3) ---
        'location': req.get('location'),
        'schoolType': req.get('school_type'),
        'publicPrivate': req.get('public_private'),
        'gradeSize': req.get('grade_size'),
        'officialEmailDomains': req.get('official_email_domains') or [],
        'adminIdentity': admin_identity_out,
        'integration': integration_out,
        'curriculum': curriculum_out,
        'preInvitedTeachers': req.get('pre_invited_teachers') or [],
    }


def create_school_requests_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('school_requests', __name__)

    def _require_lingual_admin(uid: str):
        """Raise PermissionError if the user is not a lingual_admin."""
        if not deps.db.get_user_field(uid, 'lingual_admin'):
            raise PermissionError('Lingual admin access required.')

    # -- Enriched-payload helpers (used by submit_school_request) -------------

    _ENRICHED_FIELDS = (
        ('location', 'location'),
        ('schoolType', 'school_type'),
        ('publicPrivate', 'public_private'),
        ('gradeSize', 'grade_size'),
        ('officialEmailDomains', 'official_email_domains'),
    )

    def _camel_to_snake_admin_identity(camel):
        if not isinstance(camel, dict):
            return None
        return {
            'full_name': (camel.get('fullName') or '').strip(),
            'school_email': (camel.get('schoolEmail') or '').strip().lower(),
            'role_title': (camel.get('roleTitle') or '').strip(),
        }

    def _camel_to_snake_integration(camel):
        if not isinstance(camel, dict):
            return None
        return {
            'canvas_url': (camel.get('canvasUrl') or '').strip(),
            'canvas_integration_types': list(camel.get('canvasIntegrationTypes') or []),
        }

    def _camel_to_snake_curriculum(camel):
        if not isinstance(camel, dict):
            return None
        return {
            'grade_ranges': list(camel.get('gradeRanges') or []),
            'languages_taught': list(camel.get('languagesTaught') or []),
            'course_frameworks': list(camel.get('courseFrameworks') or []),
        }

    def _validate_enum(value, allowed, field):
        if value is None or value == '':
            return None
        if value not in allowed:
            raise ValueError(f'Invalid {field}: {value!r}')
        return value

    def _validate_enum_list(values, allowed, field):
        if not values:
            return []
        bad = [v for v in values if v not in allowed]
        if bad:
            raise ValueError(f'Invalid {field} entries: {bad!r}')
        return list(values)

    # -- User endpoints -------------------------------------------------------

    @bp.route('/api/school-requests', methods=['POST'])
    @deps.login_required
    def submit_school_request():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                return jsonify({'success': False, 'error': 'Authentication required.'}), 401

            data = request.get_json() or {}
            school_name = (data.get('schoolName') or '').strip()
            if not school_name:
                return jsonify({'success': False, 'error': 'schoolName is required.'}), 400

            existing = deps.db.get_user_school_request(uid)
            if existing and existing.get('status') in ('pending', 'approved'):
                return jsonify({'success': False, 'error': 'You already have a pending or approved request.'}), 409

            org_type = (data.get('orgType') or 'school').strip()
            requester_email = (data.get('email') or '').strip()
            requester_name = (data.get('name') or '').strip()
            website_url = (data.get('websiteUrl') or '').strip()
            canvas_instance_url = (data.get('canvasInstanceUrl') or '').strip()

            # --- Build the enriched payload ---
            enriched = {}

            for camel_key, snake_key in _ENRICHED_FIELDS:
                if camel_key not in data:
                    continue
                value = data[camel_key]
                if snake_key == 'school_type':
                    value = _validate_enum(value, database.ALLOWED_SCHOOL_TYPES, 'schoolType')
                elif snake_key == 'public_private':
                    value = _validate_enum(value, database.ALLOWED_PUBLIC_PRIVATE, 'publicPrivate')
                elif snake_key == 'grade_size':
                    value = _validate_enum(value, database.ALLOWED_GRADE_SIZES, 'gradeSize')
                elif snake_key == 'official_email_domains':
                    value = [str(d).strip().lower() for d in (value or []) if str(d).strip()]
                if value is not None:
                    enriched[snake_key] = value

            admin_identity_in = data.get('adminIdentity')
            if admin_identity_in is not None:
                ai = _camel_to_snake_admin_identity(admin_identity_in)
                if ai is None:
                    return jsonify({'success': False, 'error': 'adminIdentity must be an object'}), 400
                if not admin_identity_in.get('authorizationAttested') is True:
                    return jsonify({
                        'success': False,
                        'error': 'authorization attestation must be confirmed',
                    }), 400
                ai['authorization_attestation'] = {
                    'confirmed_at': datetime.now(UTC).isoformat(),
                    'ip_hash': database.hash_attestation_ip(request.remote_addr or ''),
                    'user_agent': (request.user_agent.string or '')[:512],
                }
                enriched['admin_identity'] = ai

            integration_in = data.get('integration')
            if integration_in is not None:
                integ = _camel_to_snake_integration(integration_in)
                if integ is None:
                    return jsonify({'success': False, 'error': 'integration must be an object'}), 400
                integ['canvas_integration_types'] = _validate_enum_list(
                    integ['canvas_integration_types'],
                    database.ALLOWED_CANVAS_INTEGRATION_TYPES,
                    'canvasIntegrationTypes',
                )
                enriched['integration'] = integ

            curriculum_in = data.get('curriculum')
            if curriculum_in is not None:
                cur = _camel_to_snake_curriculum(curriculum_in)
                if cur is None:
                    return jsonify({'success': False, 'error': 'curriculum must be an object'}), 400
                cur['grade_ranges'] = _validate_enum_list(
                    cur['grade_ranges'], database.ALLOWED_GRADE_RANGES, 'gradeRanges')
                cur['course_frameworks'] = _validate_enum_list(
                    cur['course_frameworks'], database.ALLOWED_COURSE_FRAMEWORKS, 'courseFrameworks')
                cur['languages_taught'] = [
                    str(s).strip().lower() for s in cur['languages_taught'] if str(s).strip()
                ]
                enriched['curriculum'] = cur

            pre_invites = data.get('preInvitedTeachers')
            if pre_invites is not None:
                if not isinstance(pre_invites, list):
                    return jsonify({'success': False, 'error': 'preInvitedTeachers must be a list'}), 400
                enriched['pre_invited_teachers'] = [
                    str(e).strip().lower() for e in pre_invites if str(e).strip()
                ]

            request_id = deps.db.create_school_request(
                requester_uid=uid,
                requester_email=requester_email,
                requester_name=requester_name,
                school_name=school_name,
                org_type=org_type,
                website_url=website_url,
                canvas_instance_url=canvas_instance_url,
                enriched=enriched or None,
            )

            # Drop the draft — submission is the success terminal.
            try:
                deps.db.delete_school_creation_draft(uid)
            except Exception as exc:
                print(f'[draft] cleanup failed after submit: {exc}')

            # Move the user's onboarding state forward.
            try:
                deps.db.update_user_profile(uid, onboarding_state='awaiting_lingual')
            except Exception as exc:
                print(f'[onboarding] state update failed: {exc}')

            # Fan-out outbox email to every active lingual admin.
            # The entire block is fire-and-forget: failures must never break the
            # business response.  Two-level handling:
            #   outer — catches get_db() / list_lingual_admin_emails() failures
            #   inner — keeps a bad enqueue for one admin from blocking others
            try:
                review_url = f"{_public_base_url()}/app/admin/school-requests"
                firestore_client = database.get_db()
                for admin in list_lingual_admin_emails():
                    try:
                        enqueue_outbox_email(
                            db=firestore_client,
                            recipient_email=admin['email'],
                            recipient_name=admin.get('name'),
                            template=OutboxTemplate.SCHOOL_REQUEST_TO_LINGUAL,
                            template_data={
                                'org_name': school_name,
                                'requester_name': requester_name,
                                'requester_email': requester_email,
                                'review_url': review_url,
                            },
                            related_entity_type='school_request',
                            related_entity_id=request_id,
                            created_by_uid=uid,
                        )
                    except Exception as exc:
                        # One bad admin must not block others.
                        print(f"[outbox] failed to enqueue school_request_to_lingual for {admin.get('email')}: {exc}")
            except Exception as exc:
                # Outbox fan-out must never break the business call.
                print(f"[outbox] school_request fan-out aborted: {exc}")

            created = deps.db.get_school_request(request_id)
            return jsonify({'success': True, 'request': _serialize_request(created)}), 201

        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400
        except Exception as exc:
            print(f"School request submission error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500

    def _serialize_draft(draft):
        if draft is None:
            return None
        updated = draft.get('updated_at')
        return {
            'uid': draft.get('uid'),
            'currentStep': draft.get('current_step'),
            'draftPayload': draft.get('draft_payload') or {},
            'updatedAt': (
                updated.isoformat()
                if isinstance(updated, datetime)
                else updated
            ),
        }

    @bp.route('/api/school-requests/draft', methods=['GET'])
    @deps.login_required
    def get_school_request_draft():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        draft = deps.db.get_school_creation_draft(uid)
        return jsonify({'success': True, 'draft': _serialize_draft(draft)}), 200

    @bp.route('/api/school-requests/draft', methods=['PATCH'])
    @deps.login_required
    def patch_school_request_draft():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401

        data = request.get_json(silent=True) or {}
        current_step = data.get('currentStep')
        draft_payload = data.get('draftPayload')

        if not isinstance(current_step, int) or not (1 <= current_step <= 4):
            return jsonify({
                'success': False,
                'error': 'currentStep must be an integer in [1, 4].',
            }), 400
        if not isinstance(draft_payload, dict):
            return jsonify({
                'success': False,
                'error': 'draftPayload must be a JSON object.',
            }), 400

        try:
            deps.db.upsert_school_creation_draft(
                uid,
                current_step=current_step,
                draft_payload=draft_payload,
            )
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400

        return jsonify({'success': True}), 200

    @bp.route('/api/school-requests/mine', methods=['GET'])
    @deps.login_required
    def get_my_school_request():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                return jsonify({'success': False, 'error': 'Authentication required.'}), 401

            req = deps.db.get_user_school_request(uid)
            return jsonify({'success': True, 'request': _serialize_request(req)}), 200

        except Exception as exc:
            print(f"School request lookup error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/school-requests/mine', methods=['DELETE'])
    @deps.login_required
    def cancel_my_school_request():
        try:
            uid = deps.get_current_user_uid()
            if not uid:
                return jsonify({'success': False, 'error': 'Authentication required.'}), 401

            existing = deps.db.get_user_school_request(uid)
            if not existing or existing.get('status') == 'cancelled':
                return jsonify({'success': False, 'error': 'No request to cancel.'}), 404

            try:
                ok = deps.db.cancel_school_request(existing['id'], uid)
            except ValueError as exc:
                return jsonify({'success': False, 'error': str(exc)}), 409
            except PermissionError as exc:
                return jsonify({'success': False, 'error': str(exc)}), 403

            if not ok:
                return jsonify({'success': False, 'error': 'No request to cancel.'}), 404

            return jsonify({'success': True}), 200

        except Exception as exc:
            print(f"School request cancellation error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500

    # -- Admin endpoints ------------------------------------------------------

    @bp.route('/api/admin/school-requests', methods=['GET'])
    @deps.login_required
    def admin_list_school_requests():
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)

            status_filter = request.args.get('status') or None
            requests_list = deps.db.list_school_requests(status_filter=status_filter)
            return jsonify({
                'success': True,
                'requests': [_serialize_request(r) for r in requests_list],
            }), 200

        except PermissionError:
            return jsonify({'success': False, 'error': 'Forbidden'}), 403
        except Exception as exc:
            print(f"Admin list school requests error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/admin/school-requests/<request_id>', methods=['GET'])
    @deps.login_required
    def admin_get_school_request(request_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)

            req = deps.db.get_school_request(request_id)
            if not req:
                return jsonify({'success': False, 'error': 'Request not found.'}), 404

            return jsonify({'success': True, 'request': _serialize_request(req)}), 200

        except PermissionError:
            return jsonify({'success': False, 'error': 'Forbidden'}), 403
        except Exception as exc:
            print(f"Admin get school request error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/admin/school-requests/<request_id>/approve', methods=['POST'])
    @deps.login_required
    def admin_approve_school_request(request_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)

            req = deps.db.get_school_request(request_id)
            if not req:
                return jsonify({'success': False, 'error': 'Request not found.'}), 404
            if req.get('status') != 'pending':
                return jsonify({'success': False, 'error': 'Only pending requests can be approved.'}), 409

            org_id = deps.db.create_organization(
                name=req['school_name'],
                org_type=req.get('org_type', 'school'),
                pilot_stage='beta',
            )
            membership_id = deps.db.create_membership(
                org_id=org_id,
                uid=req['requester_uid'],
                roles=['school_admin'],
            )
            deps.db.set_user_last_active_membership(req['requester_uid'], membership_id)

            deps.db.update_school_request(request_id, {
                'status': 'approved',
                'reviewed_by_uid': uid,
                'reviewed_at': datetime.now(UTC),
                'created_org_id': org_id,
            })

            # Move the requester's onboarding state forward.
            try:
                deps.db.update_user_profile(req['requester_uid'], onboarding_state='complete')
            except Exception as exc:
                print(f'[onboarding] state update failed on approval: {exc}')

            # --- Best-effort side effects ---
            pre_invites = req.get('pre_invited_teachers') or []
            try:
                if pre_invites:
                    deps.db.record_school_request_pre_invites(
                        org_id=org_id,
                        requester_uid=req['requester_uid'],
                        emails=pre_invites,
                    )
            except Exception as exc:
                print(f'[pre-invites] record failed: {exc}')

            firestore_client = database.get_db()
            base = _public_base_url()
            try:
                enqueue_outbox_email(
                    db=firestore_client,
                    recipient_email=req.get('requester_email') or '',
                    recipient_name=req.get('requester_name'),
                    template=OutboxTemplate.SCHOOL_REQUEST_APPROVED,
                    template_data={
                        'org_name': req.get('school_name'),
                        'requester_name': req.get('requester_name'),
                        'login_url': f'{base}/login',
                    },
                    related_entity_type='school_request',
                    related_entity_id=request_id,
                    created_by_uid=uid,
                )
            except Exception as exc:
                print(f'[outbox] school_request_approved enqueue failed: {exc}')

            inviter_name = (req.get('admin_identity') or {}).get('full_name') or req.get('requester_name') or 'A school administrator'
            for email in pre_invites:
                try:
                    enqueue_outbox_email(
                        db=firestore_client,
                        recipient_email=email,
                        recipient_name=None,
                        template=OutboxTemplate.TEACHER_INVITATION,
                        template_data={
                            'org_name': req.get('school_name'),
                            'inviter_name': inviter_name,
                            'signup_url': f'{base}/signup?role=teacher',
                        },
                        related_entity_type='school_request',
                        related_entity_id=request_id,
                        created_by_uid=uid,
                    )
                except Exception as exc:
                    print(f'[outbox] teacher_invitation enqueue failed for {email}: {exc}')

            updated = deps.db.get_school_request(request_id)
            return jsonify({'success': True, 'request': _serialize_request(updated)}), 200

        except PermissionError:
            return jsonify({'success': False, 'error': 'Forbidden'}), 403
        except Exception as exc:
            print(f"Admin approve school request error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/admin/school-requests/<request_id>/reject', methods=['POST'])
    @deps.login_required
    def admin_reject_school_request(request_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)

            req = deps.db.get_school_request(request_id)
            if not req:
                return jsonify({'success': False, 'error': 'Request not found.'}), 404
            if req.get('status') != 'pending':
                return jsonify({'success': False, 'error': 'Only pending requests can be rejected.'}), 409

            data = request.get_json() or {}
            reason = (data.get('reason') or '').strip()

            deps.db.update_school_request(request_id, {
                'status': 'rejected',
                'reviewed_by_uid': uid,
                'reviewed_at': datetime.now(UTC),
                'rejection_reason': reason,
            })

            updated = deps.db.get_school_request(request_id)
            return jsonify({'success': True, 'request': _serialize_request(updated)}), 200

        except PermissionError:
            return jsonify({'success': False, 'error': 'Forbidden'}), 403
        except Exception as exc:
            print(f"Admin reject school request error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500

    return bp
