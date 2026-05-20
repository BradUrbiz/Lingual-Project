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
import os

import database
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
from backend.services.outbox import OutboxTemplate, enqueue_outbox_email

MAX_INTERNAL_NOTE_LEN = 2000

ALLOWED_DECLINE_CATEGORIES = frozenset({
    'info_missing', 'fraud_risk', 'out_of_scope', 'duplicate', 'other',
})

# Cursor shape lives on the wire as camelCase to match the FE TS types (Plan 5
# Important #2 fix). DB helpers still use snake_case internally because that
# matches Firestore field names, so we transform at the route boundary in both
# directions. Unknown keys pass through unchanged so the mapping survives
# additive cursor schema changes.
_CURSOR_KEY_TO_CAMEL = {
    'name_lower': 'nameLower',
    'leading_value': 'leadingValue',
}
_CURSOR_KEY_TO_SNAKE = {v: k for k, v in _CURSOR_KEY_TO_CAMEL.items()}


def _camelize_cursor(cursor):
    """Transform a cursor dict's known snake_case keys to camelCase for the wire."""
    if not cursor:
        return cursor
    return {_CURSOR_KEY_TO_CAMEL.get(k, k): v for k, v in cursor.items()}


def _snakeize_cursor(cursor):
    """Inverse of `_camelize_cursor` for cursor values arriving from the wire."""
    if not cursor:
        return cursor
    return {_CURSOR_KEY_TO_SNAKE.get(k, k): v for k, v in cursor.items()}


def _parse_iso8601(value):
    """Parse an ISO 8601 datetime string into a tz-aware datetime.

    Returns None for None/empty input. Accepts a trailing 'Z' as +00:00
    (Python's ``fromisoformat`` did not handle 'Z' until 3.11+; we
    normalize defensively for older interpreters). Raises ValueError on
    malformed input so the route can return 400.
    """
    if value is None or value == '':
        return None
    if isinstance(value, datetime.datetime):
        return value
    try:
        s = value.replace('Z', '+00:00') if isinstance(value, str) else value
        return datetime.datetime.fromisoformat(s)
    except (ValueError, TypeError) as exc:
        raise ValueError(f'invalid ISO 8601 datetime: {value}') from exc


def _camel_org_row(row):
    """Reshape a Firestore organization row to the camelCase response DTO.

    Tabular org-list response — keeps the wire contract decoupled from the
    Firestore document shape. `memberCount` is derived from
    `school_admin_uids` (Plan 5 v1 surfaces school-admin headcount only;
    full staff counts arrive with the detail page).
    """
    return {
        'id': row.get('id'),
        'name': row.get('name'),
        'status': row.get('status'),
        'schoolType': row.get('school_type'),
        'country': row.get('country'),
        'publicOrPrivate': row.get('public_or_private'),
        'memberCount': len(row.get('school_admin_uids') or []),
        'createdAt': row.get('created_at'),
        'lastActivityAt': row.get('last_activity_at'),
    }


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
            'nextCursor': _camelize_cursor(result.get('next_cursor')),
        }), 200

    @bp.get('/organizations')
    def list_orgs():
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        cursor_arg = request.args.get('cursor')
        cursor = None
        if cursor_arg:
            # Cursor is a JSON-encoded {nameLower, id} dict produced by a
            # prior page's response. We transform back to {name_lower, id}
            # before handing to the DB helper, which uses Firestore field
            # names. Reject malformed input with 400 rather than letting
            # Firestore silently return a wrong page.
            try:
                import json
                cursor = _snakeize_cursor(json.loads(cursor_arg))
            except Exception:
                return jsonify({'error': 'invalid cursor'}), 400

        try:
            result = deps.db.list_organizations(
                status=request.args.get('status'),
                school_type=request.args.get('schoolType'),
                country=request.args.get('country'),
                public_or_private=request.args.get('publicOrPrivate'),
                cursor=cursor,
            )
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        return jsonify({
            'items': [_camel_org_row(r) for r in result['items']],
            'nextCursor': _camelize_cursor(result.get('next_cursor')),
        }), 200

    @bp.get('/organizations/<org_id>')
    def get_org_detail(org_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        org = deps.db.get_organization(org_id)
        if not org:
            return jsonify({'error': 'not_found'}), 404

        contacts = deps.db.list_org_memberships(
            org_id=org_id, roles=('school_admin',),
        )

        # Fail-soft view audit — never block the page render if the audit
        # write fails. Mirrors the pattern documented at the top of this
        # module: build_audit_doc(...) is for state-transitions that batch
        # with business writes; log(...) is for views like this one.
        try:
            deps.audit_logger.log(
                actor_uid=uid,
                action=AuditAction.ORG_VIEWED_DETAIL,
                target_type='organization',
                target_id=org_id,
                target_org_id=org_id,
                metadata={},
                ip_hash=_hash_ip(_client_ip()),
                user_agent=_user_agent(),
            )
        except Exception:  # noqa: BLE001
            pass

        return jsonify({
            'id': org_id,
            'name': org.get('name'),
            'status': org.get('status'),
            'schoolType': org.get('school_type'),
            'country': org.get('country'),
            'state': org.get('state'),
            'websiteUrl': org.get('website_url'),
            'createdAt': org.get('created_at'),
            'lastActivityAt': org.get('last_activity_at'),
            'suspendedAt': org.get('suspended_at'),
            'suspendedByUid': org.get('suspended_by_uid'),
            'suspendReason': org.get('suspend_reason'),
            'suspendedUntil': org.get('suspended_until'),
            'schoolAdminContacts': [
                {'membershipId': c['membership_id'], 'uid': c['uid'],
                 'email': c['email'], 'name': c.get('name')}
                for c in contacts
            ],
        }), 200

    @bp.get('/organizations/<org_id>/members')
    def get_org_members(org_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        org = deps.db.get_organization(org_id)
        if not org:
            return jsonify({'error': 'not_found'}), 404

        members = deps.db.list_org_memberships(
            org_id=org_id, roles=('school_admin', 'teacher'),
        )
        student_count = deps.db.count_org_students(org_id=org_id)
        return jsonify({
            'members': [
                {'membershipId': m['membership_id'], 'uid': m['uid'],
                 'email': m['email'], 'name': m.get('name'),
                 'roles': m['roles'], 'status': m['status'],
                 'joinedAt': m.get('joined_at')}
                for m in members
            ],
            'studentCount': student_count,
        }), 200

    @bp.get('/organizations/<org_id>/classes')
    def get_org_classes(org_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        org = deps.db.get_organization(org_id)
        if not org:
            return jsonify({'error': 'not_found'}), 404

        # Use list_org_classes_summary (Task 6 metadata helper) not
        # list_org_classes — the latter is a pre-existing function with a
        # different shape used by admin/lti/schools routes. The metadata
        # variant returns the curated summary needed for the admin panel.
        classes = deps.db.list_org_classes_summary(org_id=org_id)
        return jsonify({
            'items': [
                {'id': c['id'], 'name': c.get('name'), 'term': c.get('term'),
                 'subject': c.get('subject'),
                 'teacherMembershipIds': c.get('teacher_membership_ids') or [],
                 'createdAt': c.get('created_at'),
                 'lastActivityAt': c.get('last_activity_at')}
                for c in classes
            ],
        }), 200

    @bp.get('/organizations/<org_id>/audit')
    def get_org_audit(org_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        org = deps.db.get_organization(org_id)
        if not org:
            return jsonify({'error': 'not_found'}), 404

        limit = min(int(request.args.get('limit', 50)), 200)
        items = deps.db.list_org_audit_events(org_id=org_id, limit=limit)
        return jsonify({'items': items}), 200

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

        # Side effects after successful approval — mirror Plan 3 behavior so
        # Task 24 can safely retire the legacy endpoint without losing UX.
        # All are best-effort: exceptions are logged but do not fail the
        # response (the atomic Firestore write already succeeded).
        req_row = deps.db.get_school_request(request_id) or {}
        requester_uid = req_row.get('requester_uid')
        requester_email = req_row.get('requester_email') or ''
        requester_name = req_row.get('requester_name')
        school_name = req_row.get('school_name')
        pre_invited = req_row.get('pre_invited_teachers') or []
        base = _public_base_url()

        # Advance requester onboarding to 'complete'.
        if requester_uid:
            try:
                deps.db.update_user_profile(requester_uid, onboarding_state='complete')
            except Exception as exc:
                print(f'[onboarding] state update failed on approval: {exc}')

        # Approval email to requester.
        if requester_email:
            try:
                enqueue_outbox_email(
                    db=database.get_db(),
                    recipient_email=requester_email,
                    recipient_name=requester_name,
                    template=OutboxTemplate.SCHOOL_REQUEST_APPROVED,
                    template_data={
                        'org_name': school_name,
                        'requester_name': requester_name,
                        'login_url': f'{base}/login',
                    },
                    related_entity_type='school_request',
                    related_entity_id=request_id,
                    created_by_uid=uid,
                )
            except Exception as exc:
                print(f'[outbox] school_request_approved enqueue failed: {exc}')

        # Teacher invitation emails (one per pre-invited teacher).
        inviter_name = (
            (req_row.get('admin_identity') or {}).get('full_name')
            or requester_name
            or 'A school administrator'
        )
        for teacher_email in pre_invited:
            if not teacher_email:
                continue
            try:
                enqueue_outbox_email(
                    db=database.get_db(),
                    recipient_email=teacher_email,
                    recipient_name=None,
                    template=OutboxTemplate.TEACHER_INVITATION,
                    template_data={
                        'org_name': school_name,
                        'inviter_name': inviter_name,
                        'signup_url': f'{base}/signup?role=teacher',
                    },
                    related_entity_type='school_request',
                    related_entity_id=request_id,
                    created_by_uid=uid,
                )
            except Exception as exc:
                print(f'[outbox] teacher_invitation enqueue failed for {teacher_email}: {exc}')

        return jsonify({
            'requestId': result.get('request_id'),
            'createdOrgId': result.get('created_org_id'),
            'membershipId': result.get('membership_id'),
            'preInviteInvitationIds': result.get('pre_invite_invitation_ids') or [],
        }), 200

    @bp.post('/requests/<request_id>/decline')
    def decline_request(request_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        body = request.get_json(silent=True) or {}
        reason = (body.get('reason') or '').strip()
        category = (body.get('category') or '').strip()
        internal_note = (body.get('internalNote') or '').strip() or None
        if not reason:
            return jsonify({'error': 'reason required'}), 400
        if not category:
            return jsonify({'error': 'category required'}), 400
        if category not in ALLOWED_DECLINE_CATEGORIES:
            return jsonify({'error': 'invalid category'}), 400
        if internal_note and len(internal_note) > MAX_INTERNAL_NOTE_LEN:
            return jsonify({'error': 'internalNote too long'}), 400

        # Build the audit doc here (not via AuditLogger.log) so it can be
        # committed in the same Firestore batch as the request update. The
        # helper accepts `audit_entry=` and writes it atomically; on failure
        # both the business write and the audit row are rolled back together.
        audit_entry = deps.audit_logger.build_audit_doc(
            actor_uid=uid,
            action=AuditAction.REQUEST_DECLINED,
            target_type='school_request',
            target_id=request_id,
            target_org_id=None,
            metadata={
                'reason': reason,
                'category': category,
                'internal_note': internal_note,
            },
            ip_hash=_hash_ip(_client_ip()),
            user_agent=_user_agent(),
        )

        try:
            result = deps.db.reject_school_request(
                request_id=request_id,
                reviewer_uid=uid,
                reason=reason,
                category=category,
                internal_note=internal_note,
                audit_entry=audit_entry,
            )
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        if not result:
            return jsonify({'error': 'not_found'}), 404

        # Side effects after a successful decline — mirror Plan 3's
        # `admin_reject_school_request` so Task 24 can retire the legacy
        # endpoint without losing UX. The decline does NOT change
        # onboarding_state (Plan 3 leaves the requester at `awaiting_lingual`
        # so they can re-submit). Best-effort: outbox failures are logged but
        # do not fail the response (the atomic Firestore write already
        # succeeded).
        req_row = deps.db.get_school_request(request_id) or {}
        requester_email = req_row.get('requester_email') or ''
        requester_name = req_row.get('requester_name')
        school_name = req_row.get('school_name')

        if requester_email:
            try:
                enqueue_outbox_email(
                    db=database.get_db(),
                    recipient_email=requester_email,
                    recipient_name=requester_name,
                    template=OutboxTemplate.SCHOOL_REQUEST_DECLINED,
                    template_data={
                        'org_name': school_name,
                        'requester_name': requester_name,
                        'reason': reason,
                        'category': category,
                        'support_url': 'mailto:support@l1ngual.com',
                    },
                    related_entity_type='school_request',
                    related_entity_id=request_id,
                    created_by_uid=uid,
                )
            except Exception as exc:
                print(f'[outbox] school_request_declined enqueue failed: {exc}')

        return jsonify({'requestId': result.get('request_id')}), 200

    @bp.post('/organizations/<org_id>/suspend')
    def suspend_org(org_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        org = deps.db.get_organization(org_id)
        if not org:
            return jsonify({'error': 'not_found'}), 404

        body = request.get_json(silent=True) or {}
        reason = (body.get('reason') or '').strip()
        suspended_until_str = body.get('suspendedUntil')
        if not reason:
            return jsonify({'error': 'reason required'}), 400

        try:
            suspended_until = _parse_iso8601(suspended_until_str)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        # Recipient lookup is best-effort: a missing helper or transient
        # Firestore failure must not block the suspension itself.
        try:
            recipients = deps.db.list_school_admin_emails(org_id)
        except Exception:  # noqa: BLE001
            recipients = []

        # Build the audit doc here (not via AuditLogger.log) so it can be
        # committed in the same Firestore batch as the org status update.
        # The helper accepts `audit_entry=` and writes it atomically; on
        # failure both the business write and the audit row are rolled
        # back together.
        audit_entry = deps.audit_logger.build_audit_doc(
            actor_uid=uid,
            action=AuditAction.ORG_SUSPENDED,
            target_type='organization',
            target_id=org_id,
            target_org_id=org_id,
            metadata={
                'reason': reason,
                'suspended_until': (
                    suspended_until.isoformat() if suspended_until else None
                ),
                'recipient_count': len(recipients),
            },
            ip_hash=_hash_ip(_client_ip()),
            user_agent=_user_agent(),
        )

        try:
            deps.db.suspend_organization(
                org_id=org_id,
                actor_uid=uid,
                reason=reason,
                suspended_until=suspended_until,
                audit_entry=audit_entry,
            )
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        # Fan-out notification email to every active school_admin. Each
        # enqueue is best-effort: outbox failures are swallowed so a single
        # bad recipient doesn't fail the response (the atomic Firestore
        # suspend write already succeeded).
        support_email = os.environ.get('SUPPORT_EMAIL', 'help@l1ngual.com')
        for rec in recipients:
            email = (rec or {}).get('email')
            if not email:
                continue
            try:
                enqueue_outbox_email(
                    db=database.get_db(),
                    recipient_email=email,
                    recipient_name=rec.get('name') or '',
                    template=OutboxTemplate.ORG_SUSPENDED,
                    template_data={
                        'org_name': org.get('name', ''),
                        'reason': reason,
                        'suspended_until': (
                            suspended_until.isoformat() if suspended_until else None
                        ),
                        'support_email': support_email,
                    },
                    related_entity_type='organization',
                    related_entity_id=org_id,
                    created_by_uid=uid,
                )
            except Exception as exc:  # noqa: BLE001
                print(f'[outbox] org_suspended enqueue failed for {email}: {exc}')

        return jsonify({'ok': True, 'orgId': org_id}), 200

    @bp.post('/organizations/<org_id>/restore')
    def restore_org(org_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        org = deps.db.get_organization(org_id)
        if not org:
            return jsonify({'error': 'not_found'}), 404

        # Recipient lookup is best-effort: a missing helper or transient
        # Firestore failure must not block the restore itself.
        try:
            recipients = deps.db.list_school_admin_emails(org_id)
        except Exception:  # noqa: BLE001
            recipients = []

        # Build the audit doc here (not via AuditLogger.log) so it can be
        # committed in the same Firestore batch as the org status update.
        # The helper accepts `audit_entry=` and writes it atomically; on
        # failure both the business write and the audit row are rolled
        # back together.
        audit_entry = deps.audit_logger.build_audit_doc(
            actor_uid=uid,
            action=AuditAction.ORG_RESTORED,
            target_type='organization',
            target_id=org_id,
            target_org_id=org_id,
            metadata={'recipient_count': len(recipients)},
            ip_hash=_hash_ip(_client_ip()),
            user_agent=_user_agent(),
        )

        try:
            deps.db.restore_organization(
                org_id=org_id,
                actor_uid=uid,
                audit_entry=audit_entry,
            )
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        # Fan-out notification email to every active school_admin. Each
        # enqueue is best-effort: outbox failures are swallowed so a single
        # bad recipient doesn't fail the response (the atomic Firestore
        # restore write already succeeded).
        dashboard_url = f'{_public_base_url()}/app/admin'
        for rec in recipients:
            email = (rec or {}).get('email')
            if not email:
                continue
            try:
                enqueue_outbox_email(
                    db=database.get_db(),
                    recipient_email=email,
                    recipient_name=rec.get('name') or '',
                    template=OutboxTemplate.ORG_RESTORED,
                    template_data={
                        'org_name': org.get('name', ''),
                        'dashboard_url': dashboard_url,
                    },
                    related_entity_type='organization',
                    related_entity_id=org_id,
                    created_by_uid=uid,
                )
            except Exception as exc:  # noqa: BLE001
                print(f'[outbox] org_restored enqueue failed for {email}: {exc}')

        return jsonify({'ok': True, 'orgId': org_id}), 200

    @bp.delete('/organizations/<org_id>/members/<membership_id>')
    def remove_member(org_id, membership_id):
        try:
            uid = deps.get_current_user_uid()
            _require_lingual_admin(uid)
        except PermissionError as exc:
            return jsonify({'error': str(exc)}), 403

        org = deps.db.get_organization(org_id)
        if not org:
            return jsonify({'error': 'not_found'}), 404

        membership = deps.db.get_membership(membership_id)
        if not membership or membership.get('org_id') != org_id:
            return jsonify({'error': 'not_found'}), 404

        body = request.get_json(silent=True) or {}
        reason = (body.get('reason') or '').strip()
        if not reason:
            return jsonify({'error': 'reason required'}), 400

        # Build the audit doc here (not via AuditLogger.log) so it can be
        # committed in the same Firestore batch as the membership soft-remove
        # and the org `school_admin_uids` ArrayRemove. The Task 7 helper
        # accepts `audit_entry=` and writes it atomically; on failure all
        # three writes (membership status, org admin uids, audit row) are
        # rolled back together.
        audit_entry = deps.audit_logger.build_audit_doc(
            actor_uid=uid,
            action=AuditAction.MEMBERSHIP_REMOVED,
            target_type='membership',
            target_id=membership_id,
            target_org_id=org_id,
            metadata={
                'reason': reason,
                'removed_uid': membership.get('uid'),
                'removed_roles': membership.get('roles') or [],
            },
            ip_hash=_hash_ip(_client_ip()),
            user_agent=_user_agent(),
        )

        try:
            deps.db.remove_membership(
                membership_id=membership_id,
                actor_uid=uid,
                audit_entry=audit_entry,
            )
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        return jsonify({'ok': True}), 200

    return bp
