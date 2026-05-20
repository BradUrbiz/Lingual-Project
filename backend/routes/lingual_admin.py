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
"""
from __future__ import annotations

import datetime

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.audit_utils import (  # noqa: F401  -- re-export
    client_ip as _client_ip,
    hash_ip as _hash_ip,
    public_base_url as _public_base_url,
    user_agent as _user_agent,
)


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
            'items': [_camel_request_row(r) for r in result['items']],
            'nextCursor': result.get('next_cursor'),
        }), 200

    return bp


def _camel_request_row(row: dict) -> dict:
    """snake_case Firestore row -> camelCase response row.

    Kept module-level so other lingual-admin routes (request detail,
    approve/reject responses) can reuse the same mapping.
    """
    out = dict(row)
    rename = {
        'school_name': 'schoolName',
        'org_type': 'orgType',
        'school_type': 'schoolType',
        'created_at': 'createdAt',
        'requester_uid': 'requesterUid',
        'requester_email': 'requesterEmail',
        'requester_name': 'requesterName',
        'rejection_reason': 'rejectionReason',
        'rejection_category': 'rejectionCategory',
    }
    for src, dst in rename.items():
        if src in out:
            out[dst] = out.pop(src)
    return out
