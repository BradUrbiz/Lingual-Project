from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from urllib.parse import urlparse

import database
from flask import Blueprint, jsonify, request, session

from backend.route_deps import RouteDeps
from backend.services.audit_utils import (
    client_ip as _client_ip,
    hash_ip as _hash_ip,
    public_base_url as _public_base_url,
    user_agent as _user_agent,
)
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email
from database import list_lingual_admin_emails


_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
MAX_DRAFT_PAYLOAD_BYTES = 64_000
MAX_PRE_INVITED_TEACHERS = 25


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

    # -- Enriched-payload helpers (used by submit_school_request) -------------

    _ENRICHED_FIELDS = (
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

    def _validate_required_url(value, field):
        parsed = urlparse(value or '')
        if parsed.scheme not in ('http', 'https') or not parsed.netloc:
            raise ValueError(f'{field} must be a valid http(s) URL.')
        return value

    def _validate_required_location(value):
        if not isinstance(value, dict):
            raise ValueError('location must be an object.')
        country = str(value.get('country') or '').strip()
        state = str(value.get('state') or '').strip()
        county = str(value.get('county') or '').strip()
        if not country:
            raise ValueError('location.country is required.')
        if not state:
            raise ValueError('location.state is required.')
        out = {'country': country, 'state': state}
        if county:
            out['county'] = county
        return out

    def _authenticated_requester_contact(uid):
        user_session = session.get('user') or {}
        if user_session.get('uid') != uid:
            raise ValueError('Authenticated session does not match requester uid.')
        email = str(user_session.get('email') or '').strip().lower()
        name = str(user_session.get('name') or '').strip()
        if not email:
            raise ValueError('Authenticated user email is required.')
        return email, name

    def _attestation_ip():
        return request.remote_addr or ''

    def _normalize_pre_invited_teachers(values):
        if not isinstance(values, list):
            raise ValueError('preInvitedTeachers must be a list')
        if len(values) > MAX_PRE_INVITED_TEACHERS:
            raise ValueError(
                f'preInvitedTeachers may include at most {MAX_PRE_INVITED_TEACHERS} emails.'
            )
        normalized = []
        seen = set()
        for raw in values:
            email = str(raw or '').strip().lower()
            if not email:
                continue
            if not _EMAIL_RE.match(email):
                raise ValueError(f'preInvitedTeachers contains invalid email: {email!r}')
            if email in seen:
                continue
            seen.add(email)
            normalized.append(email)
            if len(normalized) > MAX_PRE_INVITED_TEACHERS:
                raise ValueError(
                    f'preInvitedTeachers may include at most {MAX_PRE_INVITED_TEACHERS} emails.'
                )
        return normalized

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
            if len(school_name) > 120:
                return jsonify({'success': False, 'error': 'schoolName must be 120 characters or fewer.'}), 400

            existing = deps.db.get_user_school_request(uid)
            if existing and existing.get('status') in ('pending', 'approved'):
                return jsonify({'success': False, 'error': 'You already have a pending or approved request.'}), 409

            org_type = (data.get('orgType') or 'school').strip()
            if org_type not in database.ALLOWED_ORG_TYPES:
                return jsonify({
                    'success': False,
                    'error': f'orgType must be one of: {sorted(database.ALLOWED_ORG_TYPES)}',
                }), 400
            requester_email, requester_name = _authenticated_requester_contact(uid)
            website_url = (data.get('websiteUrl') or '').strip()
            _validate_required_url(website_url, 'websiteUrl')
            canvas_instance_url = (data.get('canvasInstanceUrl') or '').strip()

            # --- Build the enriched payload ---
            enriched = {}

            enriched['location'] = _validate_required_location(data.get('location'))

            for camel_key, snake_key in _ENRICHED_FIELDS:
                if camel_key not in data:
                    if snake_key == 'official_email_domains':
                        continue
                    return jsonify({'success': False, 'error': f'{camel_key} is required.'}), 400
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

            for required_key in ('school_type', 'public_private', 'grade_size'):
                if not enriched.get(required_key):
                    return jsonify({'success': False, 'error': f'{required_key} is required.'}), 400

            admin_identity_in = data.get('adminIdentity')
            if admin_identity_in is None:
                return jsonify({'success': False, 'error': 'adminIdentity is required.'}), 400
            if admin_identity_in is not None:
                ai = _camel_to_snake_admin_identity(admin_identity_in)
                if ai is None:
                    return jsonify({'success': False, 'error': 'adminIdentity must be an object'}), 400
                if not ai['full_name']:
                    return jsonify({'success': False, 'error': 'adminIdentity.fullName is required.'}), 400
                if not ai['school_email']:
                    return jsonify({'success': False, 'error': 'adminIdentity.schoolEmail is required.'}), 400
                if not _EMAIL_RE.match(ai['school_email']):
                    return jsonify({'success': False, 'error': 'adminIdentity.schoolEmail must be a valid email.'}), 400
                if not ai['role_title']:
                    return jsonify({'success': False, 'error': 'adminIdentity.roleTitle is required.'}), 400
                if admin_identity_in.get('authorizationAttested') is not True:
                    return jsonify({
                        'success': False,
                        'error': 'authorization attestation must be confirmed',
                    }), 400
                ai['authorization_attestation'] = {
                    'confirmed_at': datetime.now(UTC).isoformat(),
                    'ip_hash': database.hash_attestation_ip(_attestation_ip()),
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
                enriched['pre_invited_teachers'] = _normalize_pre_invited_teachers(pre_invites)

            try:
                request_id = deps.db.create_school_request_with_onboarding(
                    requester_uid=uid,
                    requester_email=requester_email,
                    requester_name=requester_name,
                    school_name=school_name,
                    org_type=org_type,
                    website_url=website_url,
                    canvas_instance_url=canvas_instance_url,
                    enriched=enriched or None,
                )
            except database.DuplicateSchoolRequestError as exc:
                return jsonify({'success': False, 'error': str(exc)}), 409

            # Fan-out outbox email to every active lingual admin.
            # The entire block is fire-and-forget: failures must never break the
            # business response.  Two-level handling:
            #   outer — catches get_db() / list_lingual_admin_emails() failures
            #   inner — keeps a bad enqueue for one admin from blocking others
            try:
                review_url = f"{_public_base_url()}/lingual-admin/requests"
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
        encoded = json.dumps(
            draft_payload,
            ensure_ascii=False,
            separators=(',', ':'),
        ).encode('utf-8')
        if len(encoded) > MAX_DRAFT_PAYLOAD_BYTES:
            return jsonify({
                'success': False,
                'error': 'draftPayload is too large.',
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

    # -- Legacy admin endpoints (Gone) ----------------------------------------
    #
    # Plan 5 moved the lingual-admin surface to `/api/lingual-admin/*`. The
    # routes below are kept only to return 410 Gone with a pointer to the new
    # path, so clients that have not migrated yet get an actionable error
    # instead of a 404. They take no auth/lookup work and never touch the DB.

    @bp.route('/api/admin/school-requests', methods=['GET'])
    def admin_list_school_requests():
        return jsonify({
            'error': 'gone',
            'message': 'Use GET /api/lingual-admin/requests instead',
        }), 410

    @bp.route('/api/admin/school-requests/<request_id>', methods=['GET'])
    def admin_get_school_request(request_id):
        return jsonify({
            'error': 'gone',
            'message': f'Use GET /api/lingual-admin/requests/{request_id} instead',
        }), 410

    @bp.route('/api/admin/school-requests/<request_id>/approve', methods=['POST'])
    def admin_approve_school_request(request_id):
        return jsonify({
            'error': 'gone',
            'message': f'Use POST /api/lingual-admin/requests/{request_id}/approve instead',
        }), 410

    @bp.route('/api/admin/school-requests/<request_id>/reject', methods=['POST'])
    def admin_reject_school_request(request_id):
        return jsonify({
            'error': 'gone',
            'message': f'Use POST /api/lingual-admin/requests/{request_id}/decline instead',
        }), 410

    return bp
