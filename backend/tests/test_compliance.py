import unittest
from types import SimpleNamespace

from backend.services.compliance import (
    RETENTION_POLICIES,
    apply_launch_compliance,
    build_voice_block_reasons,
    create_consent_event,
    get_retention_policy,
    is_school_voice_context,
    normalize_consent_status,
    normalize_modality_policy,
    normalize_student_compliance_record,
    resolve_assignment_launch,
    resolve_student_compliance_record,
    serialize_modality_policy,
    serialize_retention_policy,
    serialize_student_compliance_record,
    upsert_student_compliance_record,
)


class FakeComplianceDb:
    """Minimal fake DB for compliance service tests."""

    def __init__(self):
        self.organizations = {}
        self.users = {}
        self.student_compliance_records = {}
        self.consent_events = []
        self.upserted_records = []

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

    def get_user(self, uid):
        return self.users.get(uid)

    def get_student_compliance_record(self, org_id, student_uid):
        return self.student_compliance_records.get(f"{org_id}_{student_uid}")

    def upsert_student_compliance_record(self, org_id, student_uid, record):
        self.student_compliance_records[f"{org_id}_{student_uid}"] = record
        self.upserted_records.append(record)

    def create_consent_event(self, **kwargs):
        self.consent_events.append(kwargs)


def _make_deps(db=None):
    if db is None:
        db = FakeComplianceDb()
    return SimpleNamespace(db=db)


# ---------------------------------------------------------------------------
# normalize_consent_status
# ---------------------------------------------------------------------------
class TestNormalizeConsentStatus(unittest.TestCase):

    def test_valid_statuses_pass_through(self):
        for status in ("unknown", "granted", "revoked", "not_required"):
            self.assertEqual(normalize_consent_status(status), status)

    def test_invalid_string_returns_unknown(self):
        self.assertEqual(normalize_consent_status("invalid"), "unknown")

    def test_non_string_returns_unknown(self):
        self.assertEqual(normalize_consent_status(None), "unknown")
        self.assertEqual(normalize_consent_status(42), "unknown")

    def test_not_required_blocked_when_disallowed(self):
        self.assertEqual(
            normalize_consent_status("not_required", allow_not_required=False),
            "unknown",
        )

    def test_whitespace_is_stripped(self):
        self.assertEqual(normalize_consent_status("  granted  "), "granted")

    def test_case_insensitive(self):
        self.assertEqual(normalize_consent_status("GRANTED"), "granted")


# ---------------------------------------------------------------------------
# normalize_modality_policy
# ---------------------------------------------------------------------------
class TestNormalizeModalityPolicy(unittest.TestCase):

    def test_defaults_when_none(self):
        result = normalize_modality_policy(None)
        self.assertEqual(result["mode"], "hybrid")
        self.assertIsNone(result["voice_minutes_cap"])
        self.assertTrue(result["text_fallback_enabled"])

    def test_valid_modes_accepted(self):
        for mode in ("text_only", "voice_only", "hybrid"):
            result = normalize_modality_policy({"mode": mode})
            self.assertEqual(result["mode"], mode)

    def test_invalid_mode_falls_back(self):
        result = normalize_modality_policy({"mode": "invalid"})
        self.assertEqual(result["mode"], "hybrid")

    def test_camelcase_keys_accepted(self):
        result = normalize_modality_policy({
            "voiceMinutesCap": 10,
            "textFallbackEnabled": False,
        })
        self.assertEqual(result["voice_minutes_cap"], 10)
        self.assertFalse(result["text_fallback_enabled"])

    def test_negative_cap_clamped_to_zero(self):
        result = normalize_modality_policy({"voice_minutes_cap": -5})
        self.assertEqual(result["voice_minutes_cap"], 0)


class TestSerializeModalityPolicy(unittest.TestCase):

    def test_outputs_camelcase_keys(self):
        result = serialize_modality_policy({"mode": "hybrid", "text_fallback_enabled": True})
        self.assertIn("voiceMinutesCap", result)
        self.assertIn("textFallbackEnabled", result)
        self.assertEqual(result["mode"], "hybrid")


# ---------------------------------------------------------------------------
# get_retention_policy / serialize_retention_policy
# ---------------------------------------------------------------------------
class TestRetentionPolicy(unittest.TestCase):

    def test_standard_school_policy(self):
        policy = get_retention_policy("standard_school")
        self.assertEqual(policy["id"], "standard_school")
        self.assertTrue(policy["raw_audio_storage_allowed"])
        self.assertEqual(policy["raw_audio_retention_days"], 30)

    def test_no_raw_audio_policy(self):
        policy = get_retention_policy("no_raw_audio")
        self.assertEqual(policy["id"], "no_raw_audio")
        self.assertFalse(policy["raw_audio_storage_allowed"])
        self.assertEqual(policy["raw_audio_retention_days"], 0)

    def test_unknown_policy_falls_back_to_standard(self):
        policy = get_retention_policy("nonexistent")
        self.assertEqual(policy["id"], "standard_school")

    def test_none_falls_back_to_standard(self):
        policy = get_retention_policy(None)
        self.assertEqual(policy["id"], "standard_school")

    def test_serialize_produces_camelcase(self):
        policy = get_retention_policy("standard_school")
        serialized = serialize_retention_policy(policy)
        self.assertIn("rawAudioStorageAllowed", serialized)
        self.assertIn("rawAudioRetentionDays", serialized)
        self.assertIn("transcriptRetentionDays", serialized)
        self.assertIn("analyticsRetentionDays", serialized)


# ---------------------------------------------------------------------------
# normalize_student_compliance_record — minor detection
# ---------------------------------------------------------------------------
class TestNormalizeComplianceMinorDetection(unittest.TestCase):

    def test_minor_when_age_under_18(self):
        result = normalize_student_compliance_record(
            None,
            org_id="org-1",
            student_uid="stu-1",
            user={"profile": {"age": 16}},
        )
        self.assertTrue(result["is_minor"])

    def test_adult_when_age_18_or_over(self):
        result = normalize_student_compliance_record(
            None,
            org_id="org-1",
            student_uid="stu-1",
            user={"profile": {"age": 18}},
        )
        self.assertFalse(result["is_minor"])

    def test_defaults_to_minor_when_no_age(self):
        result = normalize_student_compliance_record(
            None,
            org_id="org-1",
            student_uid="stu-1",
            user={"profile": {}},
        )
        self.assertTrue(result["is_minor"])

    def test_defaults_to_minor_when_no_user(self):
        result = normalize_student_compliance_record(
            None,
            org_id="org-1",
            student_uid="stu-1",
            user=None,
        )
        self.assertTrue(result["is_minor"])

    def test_explicit_is_minor_overrides_age(self):
        result = normalize_student_compliance_record(
            {"is_minor": False},
            org_id="org-1",
            student_uid="stu-1",
            user={"profile": {"age": 12}},
        )
        self.assertFalse(result["is_minor"])


# ---------------------------------------------------------------------------
# normalize_student_compliance_record — guardian consent for adults
# ---------------------------------------------------------------------------
class TestNormalizeComplianceAdultGuardian(unittest.TestCase):

    def test_adult_guardian_forced_to_not_required(self):
        result = normalize_student_compliance_record(
            {"is_minor": False, "guardian_consent_status": "granted"},
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertEqual(result["guardian_consent_status"], "not_required")

    def test_minor_guardian_preserves_stored_value(self):
        result = normalize_student_compliance_record(
            {"is_minor": True, "guardian_consent_status": "granted"},
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertEqual(result["guardian_consent_status"], "granted")

    def test_minor_guardian_unknown_by_default(self):
        result = normalize_student_compliance_record(
            {"is_minor": True},
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertEqual(result["guardian_consent_status"], "unknown")


# ---------------------------------------------------------------------------
# normalize_student_compliance_record — voice_allowed computation
# ---------------------------------------------------------------------------
class TestNormalizeComplianceVoiceAllowed(unittest.TestCase):

    def test_voice_granted_adult(self):
        result = normalize_student_compliance_record(
            {"is_minor": False, "voice_consent_status": "granted"},
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertTrue(result["voice_allowed"])

    def test_voice_not_granted_adult(self):
        result = normalize_student_compliance_record(
            {"is_minor": False, "voice_consent_status": "unknown"},
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertFalse(result["voice_allowed"])

    def test_minor_with_guardian_and_voice_granted(self):
        result = normalize_student_compliance_record(
            {
                "is_minor": True,
                "guardian_consent_status": "granted",
                "voice_consent_status": "granted",
            },
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertTrue(result["voice_allowed"])

    def test_minor_without_guardian_consent(self):
        result = normalize_student_compliance_record(
            {
                "is_minor": True,
                "guardian_consent_status": "unknown",
                "voice_consent_status": "granted",
            },
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertFalse(result["voice_allowed"])

    def test_minor_with_guardian_but_no_voice_consent(self):
        result = normalize_student_compliance_record(
            {
                "is_minor": True,
                "guardian_consent_status": "granted",
                "voice_consent_status": "revoked",
            },
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertFalse(result["voice_allowed"])


# ---------------------------------------------------------------------------
# normalize_student_compliance_record — retention policy fallback
# ---------------------------------------------------------------------------
class TestNormalizeComplianceRetentionFallback(unittest.TestCase):

    def test_explicit_policy_used(self):
        result = normalize_student_compliance_record(
            {"retention_policy_id": "no_raw_audio"},
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertEqual(result["retention_policy_id"], "no_raw_audio")

    def test_falls_back_to_org_default(self):
        result = normalize_student_compliance_record(
            {},
            org_id="org-1",
            student_uid="stu-1",
            organization={"default_retention_policy": "no_raw_audio"},
        )
        self.assertEqual(result["retention_policy_id"], "no_raw_audio")

    def test_falls_back_to_global_default(self):
        result = normalize_student_compliance_record(
            {},
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertEqual(result["retention_policy_id"], "standard_school")

    def test_id_generated_when_missing(self):
        result = normalize_student_compliance_record(
            {},
            org_id="org-1",
            student_uid="stu-1",
        )
        self.assertEqual(result["id"], "org-1_stu-1")


# ---------------------------------------------------------------------------
# serialize_student_compliance_record
# ---------------------------------------------------------------------------
class TestSerializeComplianceRecord(unittest.TestCase):

    def test_produces_camelcase_keys(self):
        record = normalize_student_compliance_record(
            {"is_minor": True, "voice_consent_status": "granted", "guardian_consent_status": "granted"},
            org_id="org-1",
            student_uid="stu-1",
        )
        serialized = serialize_student_compliance_record(record)
        self.assertIn("isMinor", serialized)
        self.assertIn("voiceAllowed", serialized)
        self.assertIn("guardianConsentStatus", serialized)
        self.assertIn("retentionPolicy", serialized)
        self.assertIn("retentionPolicyId", serialized)
        self.assertTrue(serialized["voiceAllowed"])

    def test_retention_policy_embedded(self):
        record = normalize_student_compliance_record(
            {"retention_policy_id": "no_raw_audio"},
            org_id="org-1",
            student_uid="stu-1",
        )
        serialized = serialize_student_compliance_record(record)
        self.assertFalse(serialized["retentionPolicy"]["rawAudioStorageAllowed"])


# ---------------------------------------------------------------------------
# build_voice_block_reasons
# ---------------------------------------------------------------------------
class TestBuildVoiceBlockReasons(unittest.TestCase):

    def test_no_reasons_when_all_granted(self):
        record = {
            "is_minor": True,
            "guardian_consent_status": "granted",
            "voice_consent_status": "granted",
        }
        self.assertEqual(build_voice_block_reasons(record), [])

    def test_guardian_reason_for_minor_without_guardian(self):
        record = {
            "is_minor": True,
            "guardian_consent_status": "unknown",
            "voice_consent_status": "granted",
        }
        reasons = build_voice_block_reasons(record)
        self.assertEqual(len(reasons), 1)
        self.assertIn("Guardian", reasons[0])

    def test_voice_reason_when_not_granted(self):
        record = {
            "is_minor": False,
            "guardian_consent_status": "not_required",
            "voice_consent_status": "revoked",
        }
        reasons = build_voice_block_reasons(record)
        self.assertEqual(len(reasons), 1)
        self.assertIn("Voice consent", reasons[0])

    def test_both_reasons_for_minor_without_any_consent(self):
        record = {
            "is_minor": True,
            "guardian_consent_status": "unknown",
            "voice_consent_status": "unknown",
        }
        reasons = build_voice_block_reasons(record)
        self.assertEqual(len(reasons), 2)


# ---------------------------------------------------------------------------
# apply_launch_compliance — teacher preview
# ---------------------------------------------------------------------------
class TestApplyLaunchComplianceTeacherPreview(unittest.TestCase):

    def test_teacher_preview_bypasses_all_gating(self):
        compliance = {"voice_allowed": False, "text_allowed": False}
        result = apply_launch_compliance(
            {"mode": "hybrid"},
            compliance,
            teacher_preview=True,
        )
        self.assertTrue(result["voiceAllowed"])
        self.assertTrue(result["textAllowed"])
        self.assertFalse(result["fallbackApplied"])
        self.assertEqual(result["modality"]["mode"], "hybrid")

    def test_teacher_preview_voice_only(self):
        compliance = {"voice_allowed": False}
        result = apply_launch_compliance(
            {"mode": "voice_only"},
            compliance,
            teacher_preview=True,
        )
        self.assertTrue(result["voiceAllowed"])
        self.assertFalse(result["textAllowed"])

    def test_teacher_preview_text_only(self):
        compliance = {"voice_allowed": False}
        result = apply_launch_compliance(
            {"mode": "text_only"},
            compliance,
            teacher_preview=True,
        )
        self.assertFalse(result["voiceAllowed"])
        self.assertTrue(result["textAllowed"])


# ---------------------------------------------------------------------------
# apply_launch_compliance — text_only mode
# ---------------------------------------------------------------------------
class TestApplyLaunchComplianceTextOnly(unittest.TestCase):

    def test_text_only_with_text_allowed(self):
        result = apply_launch_compliance(
            {"mode": "text_only"},
            {"text_allowed": True, "voice_allowed": False},
        )
        self.assertEqual(result["modality"]["mode"], "text_only")
        self.assertFalse(result["voiceAllowed"])
        self.assertTrue(result["textAllowed"])

    def test_text_only_with_text_blocked(self):
        result = apply_launch_compliance(
            {"mode": "text_only"},
            {"text_allowed": False, "voice_allowed": False},
        )
        self.assertFalse(result["textAllowed"])
        self.assertFalse(result["voiceAllowed"])
        self.assertTrue(len(result["blockedReasons"]) > 0)


# ---------------------------------------------------------------------------
# apply_launch_compliance — hybrid/voice_only with voice allowed
# ---------------------------------------------------------------------------
class TestApplyLaunchComplianceVoiceAllowed(unittest.TestCase):

    def test_hybrid_voice_allowed_text_allowed(self):
        result = apply_launch_compliance(
            {"mode": "hybrid"},
            {"voice_allowed": True, "text_allowed": True},
        )
        self.assertEqual(result["modality"]["mode"], "hybrid")
        self.assertTrue(result["voiceAllowed"])
        self.assertTrue(result["textAllowed"])

    def test_hybrid_voice_allowed_text_blocked(self):
        result = apply_launch_compliance(
            {"mode": "hybrid"},
            {"voice_allowed": True, "text_allowed": False},
        )
        self.assertEqual(result["modality"]["mode"], "voice_only")
        self.assertTrue(result["voiceAllowed"])
        self.assertFalse(result["textAllowed"])

    def test_voice_only_with_voice_allowed(self):
        result = apply_launch_compliance(
            {"mode": "voice_only"},
            {"voice_allowed": True, "text_allowed": True},
        )
        self.assertEqual(result["modality"]["mode"], "voice_only")
        self.assertTrue(result["voiceAllowed"])
        self.assertFalse(result["textAllowed"])


# ---------------------------------------------------------------------------
# apply_launch_compliance — hybrid/voice_only with voice blocked
# ---------------------------------------------------------------------------
class TestApplyLaunchComplianceVoiceBlocked(unittest.TestCase):

    def test_hybrid_voice_blocked_fallback_enabled(self):
        result = apply_launch_compliance(
            {"mode": "hybrid", "text_fallback_enabled": True},
            {
                "voice_allowed": False,
                "text_allowed": True,
                "is_minor": True,
                "guardian_consent_status": "unknown",
                "voice_consent_status": "granted",
            },
        )
        self.assertEqual(result["modality"]["mode"], "text_only")
        self.assertFalse(result["voiceAllowed"])
        self.assertTrue(result["textAllowed"])
        self.assertTrue(result["fallbackApplied"])
        self.assertTrue(len(result["blockedReasons"]) > 0)

    def test_hybrid_voice_blocked_fallback_disabled(self):
        result = apply_launch_compliance(
            {"mode": "hybrid", "text_fallback_enabled": False},
            {
                "voice_allowed": False,
                "text_allowed": True,
                "voice_consent_status": "unknown",
            },
        )
        self.assertFalse(result["voiceAllowed"])
        self.assertFalse(result["textAllowed"])
        self.assertFalse(result["fallbackApplied"])
        self.assertIn("Text fallback is disabled", result["blockedReasons"][-1])

    def test_voice_only_blocked_fallback_enabled(self):
        result = apply_launch_compliance(
            {"mode": "voice_only", "text_fallback_enabled": True},
            {"voice_allowed": False, "text_allowed": True, "voice_consent_status": "unknown"},
        )
        self.assertEqual(result["modality"]["mode"], "text_only")
        self.assertTrue(result["fallbackApplied"])
        self.assertTrue(result["textAllowed"])

    def test_voice_only_blocked_fallback_enabled_but_text_also_blocked(self):
        result = apply_launch_compliance(
            {"mode": "voice_only", "text_fallback_enabled": True},
            {"voice_allowed": False, "text_allowed": False, "voice_consent_status": "unknown"},
        )
        self.assertFalse(result["voiceAllowed"])
        self.assertFalse(result["textAllowed"])
        self.assertFalse(result["fallbackApplied"])

    def test_blocked_reasons_are_deduplicated(self):
        result = apply_launch_compliance(
            {"mode": "hybrid", "text_fallback_enabled": False},
            {
                "voice_allowed": False,
                "text_allowed": True,
                "is_minor": True,
                "guardian_consent_status": "unknown",
                "voice_consent_status": "unknown",
            },
        )
        unique_reasons = set(result["blockedReasons"])
        self.assertEqual(len(unique_reasons), len(result["blockedReasons"]))


# ---------------------------------------------------------------------------
# apply_launch_compliance — return structure
# ---------------------------------------------------------------------------
class TestApplyLaunchComplianceReturnStructure(unittest.TestCase):

    def test_return_includes_all_expected_keys(self):
        result = apply_launch_compliance(
            {"mode": "hybrid"},
            {"voice_allowed": True, "text_allowed": True, "retention_policy_id": "standard_school"},
        )
        expected_keys = {
            "configuredMode", "modality", "voiceAllowed", "textAllowed",
            "fallbackApplied", "blockedReasons", "retentionPolicy",
        }
        self.assertEqual(set(result.keys()), expected_keys)

    def test_configured_mode_reflects_request(self):
        result = apply_launch_compliance(
            {"mode": "voice_only"},
            {"voice_allowed": True, "text_allowed": True},
        )
        self.assertEqual(result["configuredMode"], "voice_only")

    def test_retention_policy_is_serialized(self):
        result = apply_launch_compliance(
            {"mode": "hybrid"},
            {"voice_allowed": True, "text_allowed": True, "retention_policy_id": "no_raw_audio"},
        )
        self.assertIn("rawAudioStorageAllowed", result["retentionPolicy"])


# ---------------------------------------------------------------------------
# resolve_student_compliance_record (with FakeDb)
# ---------------------------------------------------------------------------
class TestResolveStudentComplianceRecord(unittest.TestCase):

    def test_resolves_stored_record(self):
        db = FakeComplianceDb()
        db.users["stu-1"] = {"uid": "stu-1", "profile": {"age": 16}}
        db.student_compliance_records["org-1_stu-1"] = {
            "is_minor": True,
            "voice_consent_status": "granted",
            "guardian_consent_status": "granted",
        }
        deps = _make_deps(db)
        result = resolve_student_compliance_record(deps, org_id="org-1", student_uid="stu-1")
        self.assertTrue(result["voice_allowed"])
        self.assertTrue(result["is_minor"])

    def test_returns_normalized_default_when_no_stored_record(self):
        db = FakeComplianceDb()
        db.users["stu-1"] = {"uid": "stu-1", "profile": {"age": 25}}
        deps = _make_deps(db)
        result = resolve_student_compliance_record(deps, org_id="org-1", student_uid="stu-1")
        self.assertFalse(result["is_minor"])
        self.assertEqual(result["guardian_consent_status"], "not_required")
        # voice_consent_status defaults to unknown, so voice_allowed is false
        self.assertFalse(result["voice_allowed"])

    def test_legacy_path_when_db_lacks_method(self):
        """When db has no get_student_compliance_record, returns a permissive legacy fallback."""
        db = SimpleNamespace(
            get_organization=lambda _: None,
            get_user=lambda _: {"profile": {"age": 30}},
        )
        deps = _make_deps(db)
        result = resolve_student_compliance_record(deps, org_id="org-1", student_uid="stu-1")
        self.assertTrue(result["voice_allowed"])
        self.assertEqual(result["voice_consent_status"], "granted")


# ---------------------------------------------------------------------------
# upsert_student_compliance_record
# ---------------------------------------------------------------------------
class TestUpsertStudentComplianceRecord(unittest.TestCase):

    def test_merges_updates_with_existing(self):
        db = FakeComplianceDb()
        db.users["stu-1"] = {"uid": "stu-1", "profile": {"age": 16}}
        db.student_compliance_records["org-1_stu-1"] = {
            "is_minor": True,
            "voice_consent_status": "unknown",
            "guardian_consent_status": "unknown",
        }
        deps = _make_deps(db)
        result = upsert_student_compliance_record(
            deps,
            org_id="org-1",
            student_uid="stu-1",
            updates={"voice_consent_status": "granted", "guardian_consent_status": "granted"},
        )
        self.assertTrue(result["voice_allowed"])
        self.assertEqual(len(db.upserted_records), 1)

    def test_non_dict_updates_ignored(self):
        db = FakeComplianceDb()
        db.users["stu-1"] = {"uid": "stu-1", "profile": {"age": 20}}
        deps = _make_deps(db)
        result = upsert_student_compliance_record(
            deps,
            org_id="org-1",
            student_uid="stu-1",
            updates=None,
        )
        self.assertFalse(result["is_minor"])


# ---------------------------------------------------------------------------
# create_consent_event
# ---------------------------------------------------------------------------
class TestCreateConsentEvent(unittest.TestCase):

    def test_creates_event_with_student_scope(self):
        db = FakeComplianceDb()
        deps = _make_deps(db)
        create_consent_event(
            deps,
            org_id="org-1",
            student_uid="stu-1",
            event_type="consent.updated",
            actor_type="teacher",
            actor_id="teacher-1",
            payload={"field": "voice_consent_status", "new_value": "granted"},
        )
        self.assertEqual(len(db.consent_events), 1)
        event = db.consent_events[0]
        self.assertEqual(event["scope_type"], "student")
        self.assertEqual(event["scope_id"], "stu-1")

    def test_org_scope_when_no_student_uid(self):
        db = FakeComplianceDb()
        deps = _make_deps(db)
        create_consent_event(
            deps,
            org_id="org-1",
            event_type="audit.exported",
            actor_type="teacher",
            actor_id="teacher-1",
        )
        event = db.consent_events[0]
        self.assertEqual(event["scope_type"], "org")
        self.assertEqual(event["scope_id"], "org-1")

    def test_noop_when_db_lacks_method(self):
        db = SimpleNamespace()
        deps = _make_deps(db)
        # Should not raise
        create_consent_event(
            deps,
            org_id="org-1",
            event_type="consent.updated",
            actor_type="teacher",
            actor_id="teacher-1",
        )


# ---------------------------------------------------------------------------
# resolve_assignment_launch (integration of resolve + apply)
# ---------------------------------------------------------------------------
class TestResolveAssignmentLaunch(unittest.TestCase):

    def test_voice_allowed_for_consented_adult(self):
        db = FakeComplianceDb()
        db.users["stu-1"] = {"uid": "stu-1", "profile": {"age": 25}}
        db.student_compliance_records["org-1_stu-1"] = {
            "voice_consent_status": "granted",
        }
        deps = _make_deps(db)
        launch, compliance = resolve_assignment_launch(
            deps,
            org_id="org-1",
            student_uid="stu-1",
            modality_policy={"mode": "hybrid"},
        )
        self.assertTrue(launch["voiceAllowed"])
        self.assertTrue(launch["textAllowed"])
        self.assertFalse(launch["fallbackApplied"])

    def test_fallback_for_minor_without_guardian(self):
        db = FakeComplianceDb()
        db.users["stu-1"] = {"uid": "stu-1", "profile": {"age": 14}}
        db.student_compliance_records["org-1_stu-1"] = {
            "is_minor": True,
            "voice_consent_status": "granted",
            "guardian_consent_status": "unknown",
        }
        deps = _make_deps(db)
        launch, compliance = resolve_assignment_launch(
            deps,
            org_id="org-1",
            student_uid="stu-1",
            modality_policy={"mode": "hybrid", "text_fallback_enabled": True},
        )
        self.assertFalse(launch["voiceAllowed"])
        self.assertTrue(launch["textAllowed"])
        self.assertTrue(launch["fallbackApplied"])

    def test_teacher_preview_bypasses(self):
        db = FakeComplianceDb()
        db.users["stu-1"] = {"uid": "stu-1", "profile": {"age": 14}}
        deps = _make_deps(db)
        launch, compliance = resolve_assignment_launch(
            deps,
            org_id="org-1",
            student_uid="stu-1",
            modality_policy={"mode": "voice_only"},
            teacher_preview=True,
        )
        self.assertTrue(launch["voiceAllowed"])


# ---------------------------------------------------------------------------
# is_school_voice_context
# ---------------------------------------------------------------------------
class TestIsSchoolVoiceContext(unittest.TestCase):

    def test_true_for_student_with_org(self):
        ctx = SimpleNamespace(active_organization_id="org-1", active_roles=["student"])
        self.assertTrue(is_school_voice_context(ctx))

    def test_false_for_teacher(self):
        ctx = SimpleNamespace(active_organization_id="org-1", active_roles=["teacher"])
        self.assertFalse(is_school_voice_context(ctx))

    def test_false_for_no_org(self):
        ctx = SimpleNamespace(active_organization_id=None, active_roles=["student"])
        self.assertFalse(is_school_voice_context(ctx))

    def test_false_for_none_context(self):
        self.assertFalse(is_school_voice_context(None))


if __name__ == "__main__":
    unittest.main()
