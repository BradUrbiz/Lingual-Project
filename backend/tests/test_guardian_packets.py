import hashlib
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from backend.services.guardian_packets import (
    DEFAULT_GUARDIAN_NOTICE_VERSION,
    DEFAULT_PACKET_TTL_DAYS,
    GUARDIAN_NOTICE_TEMPLATES,
    GuardianPacketNotFoundError,
    GuardianPacketStateError,
    apply_guardian_packet_decision,
    build_guardian_notice,
    cancel_guardian_packet,
    get_latest_guardian_packet,
    issue_guardian_packet,
    normalize_contact_channel,
    normalize_delivery_method,
    normalize_guardian_packet,
    normalize_packet_status,
    resend_guardian_packet,
    resolve_guardian_packet_for_token,
    serialize_guardian_packet,
    _hash_guardian_token,
)


class FakeGuardianDb:
    """Minimal fake DB for guardian packet tests."""

    def __init__(self):
        self.organizations = {}
        self.users = {}
        self.student_compliance_records = {}
        self.consent_events = []
        self.guardian_packets = {}
        self.packet_counter = 0

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

    def get_user(self, uid):
        return self.users.get(uid)

    def get_student_compliance_record(self, org_id, student_uid):
        return self.student_compliance_records.get(f"{org_id}_{student_uid}")

    def upsert_student_compliance_record(self, org_id, student_uid, record):
        self.student_compliance_records[f"{org_id}_{student_uid}"] = record

    def create_consent_event(self, **kwargs):
        self.consent_events.append(kwargs)

    def create_guardian_consent_packet(self, **kwargs):
        self.packet_counter += 1
        packet_id = f"packet-{self.packet_counter}"
        self.guardian_packets[packet_id] = {"id": packet_id, **kwargs}
        return packet_id

    def get_guardian_consent_packet(self, packet_id):
        return self.guardian_packets.get(packet_id)

    def update_guardian_consent_packet(self, packet_id, updates):
        if packet_id in self.guardian_packets:
            self.guardian_packets[packet_id].update(updates)

    def list_class_guardian_consent_packets(self, class_id, student_uid=None, limit=None):
        packets = []
        for packet in self.guardian_packets.values():
            if packet.get("class_id") != class_id:
                continue
            if student_uid and packet.get("student_uid") != student_uid:
                continue
            packets.append(packet)
        return packets

    def find_guardian_consent_packet_by_token_hash(self, token_hash):
        for packet in self.guardian_packets.values():
            if packet.get("token_hash") == token_hash:
                return packet
        return None

    def get_class(self, class_id):
        return None


def _make_deps(db=None):
    if db is None:
        db = FakeGuardianDb()
    return SimpleNamespace(db=db)


def _seed_minor_student(db, uid="stu-1", age=14):
    db.users[uid] = {"uid": uid, "profile": {"display_name": "Student", "age": age}}
    db.student_compliance_records[f"org-1_{uid}"] = {
        "is_minor": True,
        "voice_consent_status": "granted",
        "guardian_consent_status": "unknown",
    }


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------
class TestNormalizeDeliveryMethod(unittest.TestCase):

    def test_valid_methods(self):
        self.assertEqual(normalize_delivery_method("secure_link"), "secure_link")
        self.assertEqual(normalize_delivery_method("downloadable_notice"), "downloadable_notice")

    def test_invalid_falls_back(self):
        self.assertEqual(normalize_delivery_method("invalid"), "secure_link")
        self.assertEqual(normalize_delivery_method(None), "secure_link")


class TestNormalizeContactChannel(unittest.TestCase):

    def test_valid_channels(self):
        for ch in ("email", "phone", "paper", "other"):
            self.assertEqual(normalize_contact_channel(ch), ch)

    def test_invalid_falls_back(self):
        self.assertEqual(normalize_contact_channel("sms"), "other")


class TestNormalizePacketStatus(unittest.TestCase):

    def test_active_statuses(self):
        for status in ("draft", "issued", "viewed"):
            self.assertEqual(normalize_packet_status(status), status)

    def test_terminal_statuses(self):
        for status in ("granted", "revoked", "expired", "canceled"):
            self.assertEqual(normalize_packet_status(status), status)

    def test_invalid_defaults_to_draft(self):
        self.assertEqual(normalize_packet_status("invalid"), "draft")
        self.assertEqual(normalize_packet_status(None), "draft")


class TestHashGuardianToken(unittest.TestCase):

    def test_produces_sha256_hex(self):
        token = "test-token-value"
        expected = hashlib.sha256(token.encode("utf-8")).hexdigest()
        self.assertEqual(_hash_guardian_token(token), expected)


# ---------------------------------------------------------------------------
# normalize_guardian_packet / serialize
# ---------------------------------------------------------------------------
class TestNormalizeGuardianPacket(unittest.TestCase):

    def test_normalizes_from_none(self):
        result = normalize_guardian_packet(None, org_id="org-1", class_id="c-1", student_uid="s-1")
        self.assertEqual(result["org_id"], "org-1")
        self.assertEqual(result["class_id"], "c-1")
        self.assertEqual(result["student_uid"], "s-1")
        self.assertEqual(result["status"], "draft")
        self.assertEqual(result["delivery_method"], "secure_link")
        self.assertEqual(result["notice_version"], DEFAULT_GUARDIAN_NOTICE_VERSION)
        self.assertEqual(result["reminder_count"], 0)

    def test_preserves_valid_fields(self):
        result = normalize_guardian_packet(
            {
                "id": "pk-1",
                "status": "issued",
                "delivery_method": "downloadable_notice",
                "contact_channel": "phone",
                "reminder_count": 2,
                "token_hash": "abc123",
            },
            org_id="o-1",
            class_id="c-1",
            student_uid="s-1",
        )
        self.assertEqual(result["id"], "pk-1")
        self.assertEqual(result["status"], "issued")
        self.assertEqual(result["delivery_method"], "downloadable_notice")
        self.assertEqual(result["contact_channel"], "phone")
        self.assertEqual(result["reminder_count"], 2)
        self.assertEqual(result["token_hash"], "abc123")


class TestSerializeGuardianPacket(unittest.TestCase):

    def test_outputs_camelcase_and_excludes_token_hash(self):
        packet = normalize_guardian_packet(
            {"id": "pk-1", "status": "issued", "token_hash": "secret", "token_last_four": "abcd"},
            org_id="o-1", class_id="c-1", student_uid="s-1",
        )
        serialized = serialize_guardian_packet(packet)
        self.assertIn("orgId", serialized)
        self.assertIn("status", serialized)
        self.assertIn("tokenLastFour", serialized)
        self.assertNotIn("token_hash", serialized)
        self.assertNotIn("guardianLinkToken", serialized)

    def test_includes_token_when_provided(self):
        packet = normalize_guardian_packet(
            {"id": "pk-1", "status": "issued"},
            org_id="o-1", class_id="c-1", student_uid="s-1",
        )
        serialized = serialize_guardian_packet(packet, raw_token="raw-secret-token")
        self.assertEqual(serialized["guardianLinkToken"], "raw-secret-token")

    def test_includes_action_flags(self):
        packet = normalize_guardian_packet(
            {"id": "pk-1", "status": "issued"},
            org_id="o-1", class_id="c-1", student_uid="s-1",
        )
        serialized = serialize_guardian_packet(packet)
        self.assertTrue(serialized["canResend"])
        self.assertTrue(serialized["canCancel"])
        self.assertFalse(serialized["isTerminal"])

    def test_terminal_state_flags(self):
        packet = normalize_guardian_packet(
            {"id": "pk-1", "status": "granted"},
            org_id="o-1", class_id="c-1", student_uid="s-1",
        )
        serialized = serialize_guardian_packet(packet)
        self.assertFalse(serialized["canCancel"])
        self.assertTrue(serialized["isTerminal"])

    def test_none_packet_returns_none(self):
        self.assertIsNone(serialize_guardian_packet(None))


class TestBuildGuardianNotice(unittest.TestCase):

    def test_returns_default_notice(self):
        notice = build_guardian_notice(DEFAULT_GUARDIAN_NOTICE_VERSION)
        self.assertIn("title", notice)
        self.assertIn("bullets", notice)
        self.assertIsInstance(notice["bullets"], list)

    def test_unknown_version_falls_back(self):
        notice = build_guardian_notice("nonexistent_v99")
        self.assertEqual(notice["version"], DEFAULT_GUARDIAN_NOTICE_VERSION)


# ---------------------------------------------------------------------------
# issue_guardian_packet
# ---------------------------------------------------------------------------
class TestIssueGuardianPacket(unittest.TestCase):

    def test_issues_packet_for_minor(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps,
            org_id="org-1",
            class_id="class-1",
            student_uid="stu-1",
            actor_type="teacher",
            actor_id="teacher-1",
        )
        self.assertEqual(packet["status"], "issued")
        self.assertEqual(packet["org_id"], "org-1")
        self.assertEqual(packet["student_uid"], "stu-1")
        self.assertIsNotNone(raw_token)
        self.assertEqual(len(raw_token), 32)  # token_urlsafe(24) -> 32 chars
        # Token hash is stored, not the raw token
        self.assertEqual(packet["token_hash"], _hash_guardian_token(raw_token))
        # Consent event emitted
        self.assertTrue(any(e["event_type"] == "guardian_packet.issued" for e in db.consent_events))

    def test_rejects_for_adult(self):
        db = FakeGuardianDb()
        db.users["stu-1"] = {"uid": "stu-1", "profile": {"age": 20}}
        db.student_compliance_records["org-1_stu-1"] = {"is_minor": False}
        deps = _make_deps(db)

        with self.assertRaises(GuardianPacketStateError) as cm:
            issue_guardian_packet(
                deps, org_id="org-1", class_id="c-1", student_uid="stu-1",
                actor_type="teacher", actor_id="t-1",
            )
        self.assertIn("minor", str(cm.exception))

    def test_cancels_existing_active_packets(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet1, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        packet2, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        # First packet should be canceled
        stored_first = db.guardian_packets[packet1["id"]]
        self.assertEqual(stored_first["status"], "canceled")
        self.assertEqual(packet2["status"], "issued")

    def test_ttl_clamped_to_max(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
            expires_in_days=999,
        )
        expires_at = packet["expires_at"]
        issued_at = packet["issued_at"]
        days_diff = (expires_at - issued_at).days
        self.assertLessEqual(days_diff, 30)

    def test_downloadable_notice_has_no_token(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
            delivery_method="downloadable_notice",
        )
        self.assertIsNone(raw_token)
        self.assertEqual(packet["token_hash"], "")


# ---------------------------------------------------------------------------
# resend_guardian_packet
# ---------------------------------------------------------------------------
class TestResendGuardianPacket(unittest.TestCase):

    def test_resend_increments_reminder_count(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        resent, new_token = resend_guardian_packet(
            deps, packet_id=packet["id"],
            actor_type="teacher", actor_id="t-1",
        )
        self.assertEqual(resent["reminder_count"], 1)
        self.assertIsNotNone(new_token)
        self.assertEqual(resent["status"], "issued")
        self.assertTrue(any(e["event_type"] == "guardian_packet.resent" for e in db.consent_events))

    def test_resend_fails_for_granted_packet(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        db.guardian_packets[packet["id"]]["status"] = "granted"

        with self.assertRaises(GuardianPacketStateError):
            resend_guardian_packet(deps, packet_id=packet["id"], actor_type="teacher", actor_id="t-1")

    def test_resend_fails_for_canceled_packet(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        db.guardian_packets[packet["id"]]["status"] = "canceled"

        with self.assertRaises(GuardianPacketStateError):
            resend_guardian_packet(deps, packet_id=packet["id"], actor_type="teacher", actor_id="t-1")


# ---------------------------------------------------------------------------
# cancel_guardian_packet
# ---------------------------------------------------------------------------
class TestCancelGuardianPacket(unittest.TestCase):

    def test_cancels_active_packet(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        result = cancel_guardian_packet(deps, packet_id=packet["id"], actor_type="teacher", actor_id="t-1")
        self.assertEqual(result["status"], "canceled")
        self.assertEqual(result["token_hash"], "")
        self.assertTrue(any(e["event_type"] == "guardian_packet.canceled" for e in db.consent_events))

    def test_cannot_cancel_terminal_packet(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        db.guardian_packets[packet["id"]]["status"] = "granted"

        with self.assertRaises(GuardianPacketStateError):
            cancel_guardian_packet(deps, packet_id=packet["id"], actor_type="teacher", actor_id="t-1")


# ---------------------------------------------------------------------------
# resolve_guardian_packet_for_token
# ---------------------------------------------------------------------------
class TestResolveGuardianPacketForToken(unittest.TestCase):

    def test_resolves_and_marks_viewed(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        resolved = resolve_guardian_packet_for_token(deps, raw_token)
        self.assertEqual(resolved["status"], "viewed")
        self.assertTrue(any(e["event_type"] == "guardian_packet.viewed" for e in db.consent_events))

    def test_already_viewed_stays_viewed(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        db.guardian_packets[packet["id"]]["status"] = "viewed"
        resolved = resolve_guardian_packet_for_token(deps, raw_token)
        self.assertEqual(resolved["status"], "viewed")

    def test_invalid_token_raises(self):
        db = FakeGuardianDb()
        deps = _make_deps(db)
        with self.assertRaises(GuardianPacketNotFoundError):
            resolve_guardian_packet_for_token(deps, "invalid-token")

    def test_canceled_packet_raises(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        db.guardian_packets[packet["id"]]["status"] = "canceled"
        with self.assertRaises(GuardianPacketStateError):
            resolve_guardian_packet_for_token(deps, raw_token)

    def test_expired_packet_raises(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
            expires_in_days=1,
        )
        # Manually backdate the expiry
        db.guardian_packets[packet["id"]]["expires_at"] = datetime.now(UTC) - timedelta(days=1)
        with self.assertRaises(GuardianPacketStateError):
            resolve_guardian_packet_for_token(deps, raw_token)


# ---------------------------------------------------------------------------
# apply_guardian_packet_decision
# ---------------------------------------------------------------------------
class TestApplyGuardianPacketDecision(unittest.TestCase):

    def test_grant_consent(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        result_packet, compliance = apply_guardian_packet_decision(
            deps, token=raw_token, decision="granted",
        )
        self.assertEqual(result_packet["status"], "granted")
        self.assertEqual(result_packet["response_method"], "secure_link")
        self.assertEqual(compliance["guardian_consent_status"], "granted")
        self.assertTrue(any(e["event_type"] == "guardian_packet.granted" for e in db.consent_events))

    def test_revoke_consent(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        result_packet, compliance = apply_guardian_packet_decision(
            deps, token=raw_token, decision="revoked",
        )
        self.assertEqual(result_packet["status"], "revoked")
        self.assertEqual(compliance["guardian_consent_status"], "revoked")

    def test_invalid_decision_raises(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        with self.assertRaises(GuardianPacketStateError):
            apply_guardian_packet_decision(deps, token=raw_token, decision="maybe")

    def test_cannot_decide_on_already_decided_packet(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        packet, raw_token = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        apply_guardian_packet_decision(deps, token=raw_token, decision="granted")

        # Re-issue so we have a new token (old was cleared)
        packet2, raw_token2 = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        apply_guardian_packet_decision(deps, token=raw_token2, decision="granted")
        # The first packet should now be in a terminal state — old token no longer works
        with self.assertRaises(GuardianPacketNotFoundError):
            resolve_guardian_packet_for_token(deps, raw_token)


# ---------------------------------------------------------------------------
# get_latest_guardian_packet
# ---------------------------------------------------------------------------
class TestGetLatestGuardianPacket(unittest.TestCase):

    def test_returns_most_recent(self):
        db = FakeGuardianDb()
        _seed_minor_student(db)
        deps = _make_deps(db)

        p1, _ = issue_guardian_packet(
            deps, org_id="org-1", class_id="class-1", student_uid="stu-1",
            actor_type="teacher", actor_id="t-1",
        )
        # p1 is now canceled because p2's issuance supersedes it
        latest = get_latest_guardian_packet(deps, class_id="class-1", student_uid="stu-1")
        self.assertIsNotNone(latest)

    def test_returns_none_when_no_packets(self):
        db = FakeGuardianDb()
        deps = _make_deps(db)
        result = get_latest_guardian_packet(deps, class_id="class-1", student_uid="stu-1")
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
