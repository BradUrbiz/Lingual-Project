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
        'createdOrgId': req.get('created_org_id'),
        'createdAt': req.get('created_at').isoformat() if isinstance(req.get('created_at'), datetime) else req.get('created_at'),
    }


def create_school_requests_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('school_requests', __name__)

    def _require_lingual_admin(uid: str):
        """Raise PermissionError if the user is not a lingual_admin."""
        if not deps.db.get_user_field(uid, 'lingual_admin'):
            raise PermissionError('Lingual admin access required.')

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

            # Reject if user already has a pending or approved request
            existing = deps.db.get_user_school_request(uid)
            if existing and existing.get('status') in ('pending', 'approved'):
                return jsonify({'success': False, 'error': 'You already have a pending or approved request.'}), 409

            org_type = (data.get('orgType') or 'school').strip()
            requester_email = (data.get('email') or '').strip()
            requester_name = (data.get('name') or '').strip()
            website_url = (data.get('websiteUrl') or '').strip()
            canvas_instance_url = (data.get('canvasInstanceUrl') or '').strip()

            request_id = deps.db.create_school_request(
                requester_uid=uid,
                requester_email=requester_email,
                requester_name=requester_name,
                school_name=school_name,
                org_type=org_type,
                website_url=website_url,
                canvas_instance_url=canvas_instance_url,
            )

            # Fan-out outbox email to every active lingual admin.
            # The entire block is fire-and-forget: failures must never break the
            # business response.  Two-level handling:
            #   outer — catches get_db() / list_lingual_admin_emails() failures
            #   inner — keeps a bad enqueue for one admin from blocking others
            try:
                review_url = f"{_public_base_url()}/app/lingual-admin/requests"
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

        except Exception as exc:
            print(f"School request submission error: {exc}")
            return jsonify({'success': False, 'error': str(exc)}), 500

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

            # Create the organization and membership
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
