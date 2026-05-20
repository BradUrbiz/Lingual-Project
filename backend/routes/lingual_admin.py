"""Lingual admin panel routes -- mounted at `/api/lingual-admin/*`.

Every state-changing route in this blueprint builds an `audit_entry`
dict via `deps.audit_logger.build_audit_doc(...)` and passes it to the
DB helper, which commits the audit row in the same Firestore batch as
the business write. Every org detail page load writes a fail-soft
`org_viewed_detail` row via `deps.audit_logger.log(...)`.

Identity helpers (`_hash_ip`, `_client_ip`, `_user_agent`) and the
external URL source (`_public_base_url`) are imported from
`backend.services.audit_utils` so Plan 3 (`school_requests.py`) and
Plan 5 cannot drift on the audit trust boundary.

`_serialize_request` is imported from Plan 3's `school_requests.py` so
the request-row shape stays identical across the legacy admin endpoint
and the new lingual-admin list — including datetime ISO serialization
and camelCased nested dicts (admin_identity, integration, curriculum,
location, pre_invited_teachers).
"""
from __future__ import annotations

import datetime

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.routes.school_requests import _serialize_request
from backend.services.audit import AuditAction
from backend.services.audit_utils import (  # noqa: F401  -- re-export
    client_ip as _client_ip,
    hash_ip as _hash_ip,
    public_base_url as _public_base_url,
    user_agent as _user_agent,
)

MAX_INTERNAL_NOTE_LEN = 2000


def create_lingual_admin_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('lingual_admin', __name__, url_prefix='/api/lingual-admin')

    def _require_lingual_admin(uid: str):
        context = deps.db.resolve_user_school_context(uid)
        if not context.get('lingual_admin'):
            raise PermissionError('lingual_admin role required')

    @bp.get('/_smoke')
    def _smoke():
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403
        return jsonify({'ok': True}), 200

    @bp.get('/overview')
    def get_overview():
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        now = datetime.datetime.now(datetime.timezone.utc)
        seven_days_ago = now - datetime.timedelta(days=7)
        tiles = {
            'pendingRequests': deps.db.count_school_requests_pending(),
            'activeOrgs': deps.db.count_organizations_by_status('active'),
            'suspendedOrgs': deps.db.count_organizations_by_status('suspended'),
            'newRequestsLast7d': deps.db.count_school_requests_since(since=seven_days_ago),
        }
        feed = deps.db.list_recent_audit_events(limit=20)
        return jsonify({'tiles': tiles, 'recentActivity': feed}), 200

    @bp.get('/requests')
    def list_requests():
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        status = request.args.get('status') or None
        school_type = request.args.get('schoolType') or None
        country = request.args.get('country') or None
        sort = request.args.get('sort', 'requested_at_desc')

        try:
            result = deps.db.list_school_requests(
                status_filter=status,
                school_type=school_type,
                country=country,
                sort=sort,
            )
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        return jsonify({
            'items': [_serialize_request(r) for r in result['items']],
            'nextCursor': result.get('next_cursor'),
        }), 200

    @bp.get('/requests/<request_id>')
    def get_request_detail(request_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        row = deps.db.get_school_request(request_id)
        if not row:
            return jsonify({'error': 'not_found'}), 404
        return jsonify(_serialize_request(row)), 200

    @bp.post('/requests/<request_id>/approve')
    def approve_request(request_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        body = request.get_json(silent=True) or {}
        internal_note = (body.get('internalNote') or '').strip() or None
        if internal_note and len(internal_note) > MAX_INTERNAL_NOTE_LEN:
            return jsonify({'error': 'internalNote too long'}), 400

        # Build the audit doc here (not via AuditLogger.log) so it can be
        # committed in the same Firestore batch as the org/membership/request
        # writes. The helper accepts `audit_entry=` and writes it
        # atomically; on failure both the business write and the audit
        # row are rolled back together.
        audit_entry = deps.audit_logger.build_audit_doc(
            actor_uid=uid,
            action=AuditAction.REQUEST_APPROVED,
            target_type='school_request',
            target_id=request_id,
            target_org_id=None,
            metadata={'internal_note': internal_note},
            ip_hash=_hash_ip(_client_ip()),
            user_agent=_user_agent(),
        )

        try:
            result = deps.db.approve_school_request(
                request_id=request_id,
                reviewer_uid=uid,
                internal_note=internal_note,
                audit_entry=audit_entry,
            )
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        if not result:
            return jsonify({'error': 'not_found'}), 404

        return jsonify({
            'requestId': result.get('request_id'),
            'createdOrgId': result.get('created_org_id'),
            'membershipId': result.get('membership_id'),
            'preInviteInvitationIds': result.get('pre_invite_invitation_ids') or [],
        }), 200

    return bp
