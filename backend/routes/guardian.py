from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.route_deps import RouteDeps
from backend.services.compliance import serialize_student_compliance_record
from backend.services.guardian_packets import (
    GuardianPacketNotFoundError,
    GuardianPacketStateError,
    apply_guardian_packet_decision,
    resolve_guardian_packet_for_token,
    serialize_guardian_packet_notice,
)


def create_guardian_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint("guardian_routes", __name__)

    @bp.route("/api/guardian/consent/<token>")
    def api_get_guardian_consent_packet(token):
        try:
            packet = resolve_guardian_packet_for_token(deps, token)
            class_record = deps.db.get_class(packet.get("class_id")) if hasattr(deps.db, "get_class") else None
            student_user = deps.db.get_user(packet.get("student_uid")) if hasattr(deps.db, "get_user") else None
            return jsonify({
                "success": True,
                "guardianConsent": serialize_guardian_packet_notice(
                    packet,
                    class_record=class_record,
                    student_user=student_user,
                ),
            })
        except GuardianPacketNotFoundError as exc:
            return jsonify({"success": False, "error": str(exc)}), 404
        except GuardianPacketStateError as exc:
            return jsonify({"success": False, "error": str(exc)}), 410
        except Exception as exc:
            print(f"Guardian consent packet lookup error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @bp.route("/api/guardian/consent/<token>/decision", methods=["POST"])
    def api_submit_guardian_consent_decision(token):
        try:
            data = request.get_json(silent=True) or {}
            packet, compliance_record = apply_guardian_packet_decision(
                deps,
                token=token,
                decision=data.get("decision", ""),
            )
            class_record = deps.db.get_class(packet.get("class_id")) if hasattr(deps.db, "get_class") else None
            student_user = deps.db.get_user(packet.get("student_uid")) if hasattr(deps.db, "get_user") else None
            return jsonify({
                "success": True,
                "guardianConsent": serialize_guardian_packet_notice(
                    packet,
                    class_record=class_record,
                    student_user=student_user,
                ),
                "guardianPacket": serialize_guardian_packet_notice(
                    packet,
                    class_record=class_record,
                    student_user=student_user,
                )["packet"],
                "compliance": serialize_student_compliance_record(compliance_record),
            })
        except GuardianPacketNotFoundError as exc:
            return jsonify({"success": False, "error": str(exc)}), 404
        except GuardianPacketStateError as exc:
            return jsonify({"success": False, "error": str(exc)}), 409
        except Exception as exc:
            print(f"Guardian consent packet decision error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    return bp
