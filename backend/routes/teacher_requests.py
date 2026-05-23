"""Teacher-join-request blueprint (Plan 4).

Endpoints:
- POST   /api/teacher-join-requests             submit by inviteCode or orgId
- GET    /api/teacher-join-requests/me          poll own request (Task 5)
- DELETE /api/teacher-join-requests/me          cancel own request (Task 5)
- GET    /api/teacher-join-requests             list pending for admin's org (Task 6)
- POST   /api/teacher-join-requests/<id>/approve  (Task 7)
- POST   /api/teacher-join-requests/<id>/decline  (Task 8)

Org search lives at GET /api/organizations/search (Task 9), registered on the
same blueprint for locality.
"""
from __future__ import annotations

import logging
import os
import time
from collections import deque

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email
from backend.services.membership_context import SchoolContextPermissionError

log = logging.getLogger(__name__)

_TEACHER_DASHBOARD_PATH = '/app/teacher#pending-requests'

# Per-uid rate limit: at most 10 search calls per 1-second window.
_RATE_LIMIT_PER_UID: dict[str, deque] = {}
_RATE_LIMIT_MAX = 10
_RATE_LIMIT_WINDOW_SECONDS = 1.0


def _check_rate_limit(uid: str) -> bool:
    now = time.monotonic()
    bucket = _RATE_LIMIT_PER_UID.setdefault(uid, deque())
    cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT_MAX:
        return False
    bucket.append(now)
    return True


def _base_url():
    """Used for email CTAs. Falls back to relative path in dev."""
    return os.environ.get('PUBLIC_BASE_URL', '').rstrip('/')


def _absolute_url(path: str) -> str:
    base = _base_url()
    return f"{base}{path}" if base else path


def _get_outbox_db(deps: RouteDeps):
    get_db = getattr(deps.db, 'get_db', None)
    if callable(get_db):
        return get_db()
    return deps.db


def _isoformat(ts):
    """Serialize a Firestore/datetime timestamp to ISO 8601, or None."""
    if ts is None:
        return None
    if hasattr(ts, 'isoformat'):
        return ts.isoformat()
    return str(ts)


def create_teacher_requests_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('teacher_requests', __name__)

    @bp.route('/api/teacher-join-requests', methods=['POST'])
    @deps.login_required
    def submit_join_request():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401

        data = request.get_json(silent=True) or {}
        invite_code = (data.get('inviteCode') or '').strip().upper() or None
        org_id_param = (data.get('orgId') or '').strip() or None
        if not invite_code and not org_id_param:
            return jsonify({
                'success': False,
                'error': 'Either inviteCode or orgId is required.',
            }), 400
        if invite_code and org_id_param:
            return jsonify({
                'success': False,
                'error': 'Provide exactly one of inviteCode or orgId.',
            }), 400

        # Resolve target org
        if invite_code:
            org = deps.db.get_org_by_teacher_invite_code(invite_code)
            if not org:
                # Note: get_org_by_teacher_invite_code() filters status='active'
                # at the Firestore query level, so suspended orgs return None
                # and hit this 404. v1.5 may split into two queries to return
                # a friendlier 409 with "school not accepting new teachers";
                # see LIMITATIONS.md.
                return jsonify({'success': False, 'error': 'Invalid or expired invite code.'}), 404
            source = 'invite_code'
        else:
            org = deps.db.get_organization(org_id_param)
            if not org or org.get('status') != 'active':
                return jsonify({'success': False, 'error': 'School not found.'}), 404
            source = 'search'

        org_id = org['id']

        # Multi-org membership is out of scope for v1 — any active membership
        # in any org blocks a new join request (spec §3 edge case).
        for m in deps.db.get_user_memberships(uid):
            if m.get('status') == 'active':
                already_org_name = ''
                already = deps.db.get_organization(m.get('orgId'))
                if already:
                    already_org_name = already.get('name', '')
                return jsonify({
                    'success': False,
                    'error': (
                        f"You're already a member of {already_org_name or 'a school'}. "
                        "Contact support to change."
                    ),
                }), 422

        # Existing pending request?
        existing = deps.db.get_pending_teacher_join_request_by_uid(uid)
        if existing:
            return jsonify({
                'success': False,
                'error': 'You already have a pending request. Cancel it before submitting a new one.',
            }), 409

        request_id = deps.db.create_teacher_join_request(
            uid=uid,
            org_id=org_id,
            source=source,
            invite_code=invite_code if source == 'invite_code' else None,
        )

        # Notify admins via outbox. Each enqueue is wrapped individually so
        # a failure for one admin doesn't suppress the others. Failure of the
        # admin lookup itself is wrapped in the outer except. (Plan 1 invariant:
        # outbox issues must NEVER fail the business call.)
        try:
            user = deps.db.get_user(uid) or {}
            admins = deps.db.list_school_admin_emails(org_id)
        except Exception:
            log.exception('list_school_admin_emails failed for org=%s', org_id)
            admins = []

        source_label = 'invite code' if source == 'invite_code' else 'school search'
        for admin in admins:
            try:
                enqueue_outbox_email(
                    db=_get_outbox_db(deps),
                    recipient_email=admin['email'],
                    recipient_name=admin.get('name'),
                    template=OutboxTemplate.TEACHER_JOIN_REQUEST_TO_ADMIN,
                    template_data={
                        'org_name': org.get('name', ''),
                        'requester_name': user.get('name') or '(unnamed teacher)',
                        'requester_email': user.get('email', ''),
                        'source_label': source_label,
                        'review_url': _absolute_url(_TEACHER_DASHBOARD_PATH),
                    },
                    related_entity_type='teacher_join_request',
                    related_entity_id=request_id,
                    created_by_uid=uid,
                )
            except Exception:
                log.exception(
                    'Outbox enqueue failed for teacher_join_request=%s admin=%s',
                    request_id, admin.get('uid'),
                )

        # Mark user as awaiting admin review.
        try:
            deps.db.update_user_profile(uid, intended_role='teacher', onboarding_state='teacher_pending')
        except Exception:
            log.exception('onboarding_state update failed for uid=%s', uid)

        return jsonify({
            'success': True,
            'requestId': request_id,
            'orgId': org_id,
            'orgName': org.get('name', ''),
            'status': 'pending',
            'source': source,
        }), 201

    @bp.route('/api/teacher-join-requests', methods=['GET'])
    @deps.login_required
    def admin_list_pending():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        org_id = ctx.active_organization_id
        records = deps.db.list_pending_teacher_join_requests_by_org(org_id)
        out = []
        for rec in records:
            user = deps.db.get_user(rec['uid']) or {}
            out.append({
                'requestId': rec['id'],
                'uid': rec['uid'],
                'name': user.get('name') or '',
                'email': user.get('email') or '',
                'source': rec.get('source'),
                'status': rec.get('status'),
                'requestedAt': _isoformat(rec.get('requested_at')),
            })
        return jsonify({'success': True, 'requests': out}), 200

    @bp.route('/api/teacher-join-requests/me', methods=['GET'])
    @deps.login_required
    def get_my_request():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        rec = deps.db.get_latest_active_teacher_join_request_by_uid(uid)
        if not rec:
            return ('', 204)
        org = deps.db.get_organization(rec['org_id']) or {}
        return jsonify({
            'requestId': rec['id'],
            'orgId': rec['org_id'],
            'orgName': org.get('name', ''),
            'status': rec['status'],
            'source': rec.get('source'),
            'declineReason': rec.get('decline_reason'),
        }), 200

    @bp.route('/api/teacher-join-requests/me', methods=['DELETE'])
    @deps.login_required
    def cancel_my_request():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        rec = deps.db.get_pending_teacher_join_request_by_uid(uid)
        if not rec:
            return jsonify({'success': False, 'error': 'No pending request.'}), 404
        deps.db.update_teacher_join_request_status(
            request_id=rec['id'],
            status='cancelled',
            # No reviewed_by_uid — cancellation is not a review action.
        )
        # Clear pending state on the user profile.
        try:
            deps.db.update_user_profile(uid, onboarding_state='role_selected')
        except Exception:
            log.exception('onboarding_state revert failed for uid=%s', uid)
        return jsonify({'success': True}), 200

    @bp.route('/api/teacher-join-requests/<request_id>/approve', methods=['POST'])
    @deps.login_required
    def admin_approve(request_id: str):
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403

        rec = deps.db.get_teacher_join_request(request_id)
        if not rec:
            return jsonify({'success': False, 'error': 'Request not found.'}), 404
        if rec['org_id'] != ctx.active_organization_id:
            return jsonify({'success': False, 'error': 'Not your org.'}), 403
        if rec.get('status') != 'pending':
            return jsonify({
                'success': False,
                'error': f"Request is already {rec.get('status')}.",
            }), 409

        target_uid = rec['uid']
        org_id = rec['org_id']
        admin_uid = deps.get_current_user_uid()

        # TODO(v1.5): wrap these three writes in a Firestore batch/transaction.
        # Current risks at pilot scale (low probability, noted here for v1.5):
        #   1. Partial write: membership created but request stays 'pending'
        #      if update_teacher_join_request_status fails. Teacher has
        #      access; UI still shows the request as pending.
        #   2. Duplicate-approval race: two admins approving simultaneously
        #      both pass the status=='pending' guard and each call
        #      create_membership, producing two memberships for one teacher.
        # See LIMITATIONS.md.
        membership_id = deps.db.create_membership(
            org_id=org_id,
            uid=target_uid,
            roles=['teacher'],
        )
        deps.db.set_user_last_active_membership(target_uid, membership_id)
        deps.db.update_teacher_join_request_status(
            request_id=request_id,
            status='approved',
            reviewed_by_uid=admin_uid,
        )
        try:
            deps.db.update_user_profile(target_uid, onboarding_state='complete')
        except Exception:
            log.exception('onboarding_state update on approval failed uid=%s', target_uid)

        # Notify teacher.
        try:
            teacher_user = deps.db.get_user(target_uid) or {}
            org = deps.db.get_organization(org_id) or {}
            teacher_email = teacher_user.get('email') or ''
            if not teacher_email:
                log.warning(
                    'approve: teacher uid=%s has no email on profile; skipping approval email',
                    target_uid,
                )
            else:
                enqueue_outbox_email(
                    db=_get_outbox_db(deps),
                    recipient_email=teacher_email,
                    recipient_name=teacher_user.get('name'),
                    template=OutboxTemplate.TEACHER_JOIN_APPROVED,
                    template_data={
                        'org_name': org.get('name', ''),
                        'dashboard_url': _absolute_url('/app/teacher'),
                    },
                    related_entity_type='teacher_join_request',
                    related_entity_id=request_id,
                    created_by_uid=admin_uid,
                )
        except Exception:
            log.exception('approval email enqueue failed request=%s', request_id)

        return jsonify({
            'success': True,
            'requestId': request_id,
            'membershipId': membership_id,
            'status': 'approved',
        }), 200

    @bp.route('/api/teacher-join-requests/<request_id>/decline', methods=['POST'])
    @deps.login_required
    def admin_decline(request_id: str):
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403

        body = request.get_json(silent=True) or {}
        reason = (body.get('reason') or '').strip()
        if not reason:
            return jsonify({'success': False, 'error': 'A reason is required.'}), 400
        if len(reason) > 2000:
            return jsonify({
                'success': False,
                'error': 'Reason must be 2000 characters or fewer.',
            }), 400

        rec = deps.db.get_teacher_join_request(request_id)
        if not rec:
            return jsonify({'success': False, 'error': 'Request not found.'}), 404
        if rec['org_id'] != ctx.active_organization_id:
            return jsonify({'success': False, 'error': 'Not your org.'}), 403
        if rec.get('status') != 'pending':
            return jsonify({
                'success': False,
                'error': f"Request is already {rec.get('status')}.",
            }), 409

        admin_uid = deps.get_current_user_uid()
        deps.db.update_teacher_join_request_status(
            request_id=request_id,
            status='declined',
            reviewed_by_uid=admin_uid,
            decline_reason=reason,
        )
        try:
            deps.db.update_user_profile(rec['uid'], onboarding_state='role_selected')
        except Exception:
            log.exception('onboarding_state revert on decline failed uid=%s', rec['uid'])

        try:
            teacher_user = deps.db.get_user(rec['uid']) or {}
            org = deps.db.get_organization(rec['org_id']) or {}
            teacher_email = teacher_user.get('email') or ''
            if not teacher_email:
                log.warning(
                    'decline: teacher uid=%s has no email on profile; skipping decline email',
                    rec['uid'],
                )
            else:
                enqueue_outbox_email(
                    db=_get_outbox_db(deps),
                    recipient_email=teacher_email,
                    recipient_name=teacher_user.get('name'),
                    template=OutboxTemplate.TEACHER_JOIN_DECLINED,
                    template_data={
                        'org_name': org.get('name', ''),
                        'decline_reason': reason,
                        'retry_url': _absolute_url('/signup/teacher/join-org'),
                    },
                    related_entity_type='teacher_join_request',
                    related_entity_id=request_id,
                    created_by_uid=admin_uid,
                )
        except Exception:
            log.exception('decline email enqueue failed request=%s', request_id)

        return jsonify({
            'success': True,
            'requestId': request_id,
            'status': 'declined',
        }), 200

    @bp.route('/api/organizations/search', methods=['GET'])
    @deps.login_required
    def org_search():
        uid = deps.get_current_user_uid()
        if not uid:
            return jsonify({'success': False, 'error': 'Authentication required.'}), 401
        if not _check_rate_limit(uid):
            return jsonify({'success': False, 'error': 'Too many requests.'}), 429
        query = (request.args.get('q') or '').strip()
        if not query:
            return jsonify({'success': True, 'results': []}), 200
        results = deps.db.search_organizations(query, limit=10)
        return jsonify({'success': True, 'results': results}), 200

    return bp
