import unittest

from backend.services.practice_analytics import (
    apply_learning_event_to_session,
    build_derived_learning_events,
    build_practice_session_payload,
    default_analysis_state,
    default_session_summary,
    normalize_analysis_state,
    normalize_session_summary,
    serialize_session_summary,
    _count_words,
    _estimate_speaking_time_seconds,
    _count_target_expression_hits,
    _detect_communicative_function_signals,
    _detect_discourse_move_signals,
    _detect_feedback_event_types,
    _detect_student_errors,
    _detect_locale_key,
    _normalize_search_text,
    _infer_feedback_errors,
)


def _make_session(
    *,
    summary=None,
    mapping_snapshot=None,
    pedagogy_snapshot=None,
    curriculum_snapshot=None,
    voice_enabled=True,
    analysis_state=None,
):
    """Build a minimal session record for testing."""
    return {
        'id': 'session-1',
        'org_id': 'org-1',
        'class_id': 'class-1',
        'assignment_id': 'assign-1',
        'student_uid': 'stu-1',
        'voice_enabled': voice_enabled,
        'status': 'active',
        'session_summary': summary or default_session_summary(),
        'cost_summary': {'estimated_usd': 0.0, 'estimated_voice_seconds': 0, 'estimated_text_turns': 0},
        'analysis_state': analysis_state or {'recent_turns': [], 'last_student_turn': {'content': '', 'turn_index': None}},
        'mapping_snapshot': mapping_snapshot or {},
        'pedagogy_snapshot': pedagogy_snapshot or {},
        'curriculum_snapshot': curriculum_snapshot or {},
    }


# ---------------------------------------------------------------------------
# Helper function tests
# ---------------------------------------------------------------------------
class TestCountWords(unittest.TestCase):

    def test_counts_english_words(self):
        self.assertEqual(_count_words("I think this is great"), 5)

    def test_counts_french_words(self):
        self.assertEqual(_count_words("Je pense que c'est bien"), 5)

    def test_empty_string(self):
        self.assertEqual(_count_words(""), 0)

    def test_whitespace_only(self):
        self.assertEqual(_count_words("   "), 0)


class TestEstimateSpeakingTime(unittest.TestCase):

    def test_zero_words(self):
        self.assertEqual(_estimate_speaking_time_seconds(0), 0)

    def test_positive_words(self):
        result = _estimate_speaking_time_seconds(23)
        self.assertEqual(result, 10)  # 23 / 2.3 = 10

    def test_minimum_one_second(self):
        self.assertEqual(_estimate_speaking_time_seconds(1), 1)


class TestNormalizeSearchText(unittest.TestCase):

    def test_strips_accents(self):
        result = _normalize_search_text("J'ai mangé du café")
        self.assertIn("mange", result)
        self.assertIn("cafe", result)

    def test_lowercases(self):
        result = _normalize_search_text("HELLO WORLD")
        self.assertEqual(result, "hello world")


class TestDetectLocaleKey(unittest.TestCase):

    def test_french_locale(self):
        self.assertEqual(_detect_locale_key("fr-FR"), "fr")

    def test_english_default(self):
        self.assertEqual(_detect_locale_key("en-US"), "en")

    def test_empty_defaults_english(self):
        self.assertEqual(_detect_locale_key(""), "en")

    def test_spanish_locale(self):
        self.assertEqual(_detect_locale_key("es-ES"), "es")

    def test_spanish_locale_mx(self):
        self.assertEqual(_detect_locale_key("es-MX"), "es")

    def test_korean_defaults_english(self):
        self.assertEqual(_detect_locale_key("ko-KR"), "en")


class TestCountTargetExpressionHits(unittest.TestCase):

    def test_finds_expression_in_content(self):
        hits = _count_target_expression_hits("I think this is great because I like it", ["I think"])
        self.assertEqual(hits.get("I think"), 1)

    def test_no_match(self):
        hits = _count_target_expression_hits("Hello world", ["bonjour"])
        self.assertEqual(hits, {})

    def test_multiple_hits(self):
        hits = _count_target_expression_hits("I think that I think it works", ["I think"])
        self.assertEqual(hits.get("I think"), 2)

    def test_accent_normalized(self):
        hits = _count_target_expression_hits("J'ai mangé du café", ["cafe"])
        self.assertEqual(hits.get("cafe"), 1)


# ---------------------------------------------------------------------------
# Detection function tests
# ---------------------------------------------------------------------------
class TestDetectCommunicativeFunctionSignals(unittest.TestCase):

    def test_detects_opinion_english(self):
        signals = _detect_communicative_function_signals(
            "I think this is a good idea",
            ["express_opinion"],
            locale="en-US",
        )
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["functionId"], "express_opinion")

    def test_detects_opinion_french(self):
        signals = _detect_communicative_function_signals(
            "Je pense que c'est bien",
            ["express_opinion"],
            locale="fr-FR",
        )
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["functionId"], "express_opinion")

    def test_no_match_when_function_not_in_allowed(self):
        signals = _detect_communicative_function_signals(
            "I think this is good",
            ["invite"],
            locale="en-US",
        )
        self.assertEqual(len(signals), 0)

    def test_empty_content(self):
        signals = _detect_communicative_function_signals("", ["express_opinion"], locale="en-US")
        self.assertEqual(len(signals), 0)


class TestDetectDiscourseMoveSignals(unittest.TestCase):

    def test_detects_hedging_english(self):
        signals = _detect_discourse_move_signals(
            "Maybe we should probably try something else",
            ["hedging"],
            locale="en-US",
        )
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["moveId"], "hedging")

    def test_detects_self_correction(self):
        signals = _detect_discourse_move_signals(
            "I went to... I mean, I visited the museum",
            ["self_correction"],
            locale="en-US",
        )
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["moveId"], "self_correction")


class TestDetectFeedbackEventTypes(unittest.TestCase):

    def test_detects_recast(self):
        detected = _detect_feedback_event_types(
            "Did you mean you went to the store?",
            locale="en-US",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertIn("feedback.recast", event_types)

    def test_detects_elicitation(self):
        detected = _detect_feedback_event_types(
            "Can you say that again in a different way?",
            locale="en-US",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertIn("feedback.elicitation", event_types)

    def test_detects_review(self):
        detected = _detect_feedback_event_types(
            "Let's review what we practiced today",
            locale="en-US",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertIn("feedback.review_item", event_types)

    def test_no_match(self):
        detected = _detect_feedback_event_types("Hello, how are you?", locale="en-US")
        self.assertEqual(len(detected), 0)

    # --- Spanish catalog tests ---

    def test_spanish_recast_pequeno_ajuste(self):
        # Live tutor line: "Pequeño ajuste: mejor 'una galleta'."
        detected = _detect_feedback_event_types(
            "Pequeño ajuste: mejor 'una galleta'.",
            locale="es-ES",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertIn("feedback.recast", event_types)

    def test_spanish_elicitation_intenta_otra_vez(self):
        detected = _detect_feedback_event_types(
            "Intenta otra vez.",
            locale="es-ES",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertIn("feedback.elicitation", event_types)

    def test_spanish_review_recuerda(self):
        detected = _detect_feedback_event_types(
            "Recuerda usar quisiera.",
            locale="es-ES",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertIn("feedback.review_item", event_types)

    def test_spanish_recast_not_detected_for_en_us(self):
        # "pequeño ajuste" must NOT fire for English locale (catalog is locale-gated)
        detected = _detect_feedback_event_types(
            "Pequeño ajuste: mejor 'una galleta'.",
            locale="en-US",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertNotIn("feedback.recast", event_types)

    def test_english_recast_still_detected_for_en(self):
        detected = _detect_feedback_event_types(
            "Did you mean you went to the store?",
            locale="en-US",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertIn("feedback.recast", event_types)

    def test_french_recast_still_detected_for_fr(self):
        detected = _detect_feedback_event_types(
            "Tu veux dire que tu es allé au magasin?",
            locale="fr-FR",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertIn("feedback.recast", event_types)

    def test_spanish_praise_no_feedback_events(self):
        # False-positive guard: ordinary praise must not fire feedback events
        detected = _detect_feedback_event_types(
            "¡Muy bien! Gracias.",
            locale="es-ES",
        )
        self.assertEqual(len(detected), 0)

    def test_spanish_bare_otra_vez_no_elicitation(self):
        # False-positive guard: ordinary "otra vez" (non-corrective) must NOT fire elicitation.
        # e.g. assistant re-serving a café order — "otra vez" means "again", not "try again".
        detected = _detect_feedback_event_types(
            "Claro, pediste un cafe otra vez. Aqui tienes.",
            locale="es-ES",
        )
        event_types = [d["eventType"] for d in detected]
        self.assertNotIn("feedback.elicitation", event_types)


class TestDetectStudentErrors(unittest.TestCase):

    def test_english_past_tense_error(self):
        errors = _detect_student_errors(
            "Yesterday I go to the store",
            locale="en-US",
            focus_grammar=["past tense"],
            register="",
        )
        error_ids = [e["errorId"] for e in errors]
        self.assertIn("en.simple_past_mismatch", error_ids)

    def test_english_subject_verb_agreement(self):
        errors = _detect_student_errors(
            "She have a big house",
            locale="en-US",
            focus_grammar=["grammar"],
            register="",
        )
        error_ids = [e["errorId"] for e in errors]
        self.assertIn("en.subject_verb_agreement", error_ids)

    def test_french_subject_verb_agreement(self):
        errors = _detect_student_errors(
            "Ils est tres gentils",
            locale="fr-FR",
            focus_grammar=["grammar"],
            register="",
        )
        error_ids = [e["errorId"] for e in errors]
        self.assertIn("fr.subject_verb_agreement", error_ids)

    def test_french_formal_register_only_fires_when_formal(self):
        errors_formal = _detect_student_errors(
            "Tu as fait quoi?",
            locale="fr-FR",
            focus_grammar=["register"],
            register="formal",
        )
        errors_informal = _detect_student_errors(
            "Tu as fait quoi?",
            locale="fr-FR",
            focus_grammar=["register"],
            register="informal",
        )
        formal_ids = [e["errorId"] for e in errors_formal]
        informal_ids = [e["errorId"] for e in errors_informal]
        self.assertIn("fr.formal_register_mismatch", formal_ids)
        self.assertNotIn("fr.formal_register_mismatch", informal_ids)

    def test_no_errors_for_clean_text(self):
        errors = _detect_student_errors(
            "I went to the store yesterday",
            locale="en-US",
            focus_grammar=["past tense"],
            register="",
        )
        self.assertEqual(len(errors), 0)

    def test_locale_filtering(self):
        errors = _detect_student_errors(
            "She have a big house",
            locale="fr-FR",
            focus_grammar=[],
            register="",
        )
        error_ids = [e["errorId"] for e in errors]
        self.assertNotIn("en.subject_verb_agreement", error_ids)


class TestInferFeedbackErrors(unittest.TestCase):

    def test_detects_missing_target_expression(self):
        inferred = _infer_feedback_errors(
            student_content="I like it",
            assistant_content="You could say 'je voudrais' in this context",
            locale="fr-FR",
            focus_grammar=[],
            target_expressions=["je voudrais"],
            communicative_functions=[],
        )
        error_ids = [e["errorId"] for e in inferred]
        self.assertIn("target_expression.missing", error_ids)

    def test_detects_output_elaboration(self):
        inferred = _infer_feedback_errors(
            student_content="Yes",
            assistant_content="Can you tell me more about that? Why do you think so?",
            locale="en-US",
            focus_grammar=[],
            target_expressions=[],
            communicative_functions=[],
        )
        error_ids = [e["errorId"] for e in inferred]
        self.assertIn("output.elaboration", error_ids)

    def test_empty_content_returns_nothing(self):
        inferred = _infer_feedback_errors(
            student_content="",
            assistant_content="",
            locale="en-US",
            focus_grammar=[],
            target_expressions=[],
            communicative_functions=[],
        )
        self.assertEqual(len(inferred), 0)


# ---------------------------------------------------------------------------
# apply_learning_event_to_session
# ---------------------------------------------------------------------------
class TestApplyStudentTurnEvent(unittest.TestCase):

    def test_increments_turn_counts(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "I think this is great because I really like it"},
        )
        summary = updates["session_summary"]
        self.assertEqual(summary["student_turn_count"], 1)
        self.assertEqual(summary["total_turns"], 1)
        self.assertGreater(summary["total_student_words"], 0)
        self.assertGreater(summary["estimated_speaking_time_seconds"], 0)

    def test_counts_target_expression_hits(self):
        session = _make_session(
            mapping_snapshot={"targetExpressions": ["I think"]},
        )
        updates = apply_learning_event_to_session(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "I think this is what I think about it"},
        )
        summary = updates["session_summary"]
        self.assertEqual(summary["target_expression_hits"].get("I think"), 2)
        self.assertEqual(summary["target_expression_total_hits"], 2)

    def test_counts_target_vocabulary_hits(self):
        session = _make_session(
            mapping_snapshot={"targetVocabulary": ["menu", "receipt"]},
        )
        updates = apply_learning_event_to_session(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "I read the menu and asked for the receipt."},
        )
        summary = updates["session_summary"]
        self.assertEqual(summary["target_vocabulary_hits"].get("menu"), 1)
        self.assertEqual(summary["target_vocabulary_hits"].get("receipt"), 1)
        self.assertEqual(summary["target_vocabulary_total_hits"], 2)

    def test_tracks_voice_cost(self):
        session = _make_session(voice_enabled=True)
        updates = apply_learning_event_to_session(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "Hello world test speaking"},
        )
        self.assertGreater(updates["cost_summary"]["estimated_voice_seconds"], 0)

    def test_tracks_text_cost_when_voice_off(self):
        session = _make_session(voice_enabled=False)
        updates = apply_learning_event_to_session(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "Hello world"},
        )
        self.assertEqual(updates["cost_summary"]["estimated_text_turns"], 1)
        self.assertEqual(updates["cost_summary"]["estimated_voice_seconds"], 0)

    def test_updates_analysis_state(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "Bonjour, ca va?"},
        )
        analysis_state = updates["analysis_state"]
        self.assertEqual(analysis_state["last_student_turn"]["content"], "Bonjour, ca va?")


class TestApplyAssistantTurnEvent(unittest.TestCase):

    def test_increments_assistant_counts(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="assistant.turn",
            turn_index=1,
            payload={"content": "That's great! Did you mean you went there?"},
        )
        summary = updates["session_summary"]
        self.assertEqual(summary["assistant_turn_count"], 1)
        self.assertEqual(summary["total_turns"], 1)

    def test_detects_feedback_in_assistant_turn(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="assistant.turn",
            turn_index=1,
            payload={"content": "Did you mean you went to the park?"},
        )
        summary = updates["session_summary"]
        self.assertGreater(summary["feedback_counts"]["recast"], 0)


class TestApplySessionEndedEvent(unittest.TestCase):

    def test_sets_completed_status(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="session.ended",
            payload={"status": "completed", "reason": "manual_disconnect"},
        )
        self.assertEqual(updates["status"], "completed")
        self.assertIsNotNone(updates["ended_at"])
        self.assertEqual(updates["session_summary"]["ended_reason"], "manual_disconnect")

    def test_sets_abandoned_status(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="session.ended",
            payload={"status": "abandoned", "reason": "page_leave"},
        )
        self.assertEqual(updates["status"], "abandoned")


class TestApplyFeedbackEvents(unittest.TestCase):

    def test_recast_event(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="feedback.recast",
            payload={"count": 1},
        )
        self.assertEqual(updates["session_summary"]["feedback_counts"]["recast"], 1)

    def test_elicitation_event(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="feedback.elicitation",
            payload={"count": 2},
        )
        self.assertEqual(updates["session_summary"]["feedback_counts"]["elicitation"], 2)

    def test_review_item_event(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="feedback.review_item",
            payload={},
        )
        self.assertEqual(updates["session_summary"]["feedback_counts"]["review_item"], 1)


class TestApplyMetricEvents(unittest.TestCase):

    def test_target_expression_hit(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="metric.target_expression_hit",
            payload={"expression": "je voudrais", "count": 1},
        )
        summary = updates["session_summary"]
        self.assertEqual(summary["target_expression_hits"]["je voudrais"], 1)
        self.assertEqual(summary["target_expression_total_hits"], 1)

    def test_self_correction(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="metric.self_correction",
            payload={"count": 1},
        )
        self.assertEqual(updates["session_summary"]["self_correction_count"], 1)

    def test_error_detected(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="metric.error_detected",
            payload={"errorId": "en.simple_past_mismatch", "count": 1, "rubricDimensionIds": ["lexical_grammatical_control"]},
        )
        summary = updates["session_summary"]
        self.assertEqual(summary["error_counts"]["en.simple_past_mismatch"], 1)
        self.assertEqual(summary["rubric_dimension_error_counts"]["lexical_grammatical_control"], 1)

    def test_repeated_error(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="metric.repeated_error",
            payload={"errorId": "en.simple_past_mismatch", "count": 3},
        )
        self.assertEqual(updates["session_summary"]["repeated_error_counts"]["en.simple_past_mismatch"], 3)

    def test_task_completed(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="task.completed",
            payload={"criterion": "min_turns", "count": 1},
        )
        summary = updates["session_summary"]
        self.assertEqual(summary["task_completion_count"], 1)
        self.assertTrue(summary["evidence_progress"]["min_turns_reached"])

    def test_communicative_function_signal(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="metric.communicative_function_signal",
            payload={"functionId": "express_opinion", "count": 1},
        )
        self.assertEqual(updates["session_summary"]["communicative_function_signals"]["express_opinion"], 1)

    def test_discourse_move_signal(self):
        session = _make_session()
        updates = apply_learning_event_to_session(
            session,
            event_type="metric.discourse_move_signal",
            payload={"moveId": "hedging", "count": 2},
        )
        self.assertEqual(updates["session_summary"]["discourse_move_signals"]["hedging"], 2)


# ---------------------------------------------------------------------------
# build_derived_learning_events
# ---------------------------------------------------------------------------
class TestBuildDerivedLearningEvents(unittest.TestCase):

    def test_derives_target_expression_hits(self):
        session = _make_session(
            mapping_snapshot={"targetExpressions": ["I think"]},
        )
        derived = build_derived_learning_events(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "I think this is good"},
        )
        target_events = [e for e in derived if e["event_type"] == "metric.target_expression_hit"]
        self.assertEqual(len(target_events), 1)
        self.assertEqual(target_events[0]["payload"]["expression"], "I think")

    def test_derives_communicative_function_signals(self):
        session = _make_session(
            pedagogy_snapshot={"communicativeFunctions": ["express_opinion"]},
        )
        derived = build_derived_learning_events(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "I think this is the best option"},
        )
        func_events = [e for e in derived if e["event_type"] == "metric.communicative_function_signal"]
        self.assertGreater(len(func_events), 0)

    def test_derives_self_correction(self):
        session = _make_session(
            pedagogy_snapshot={"discourseMoves": ["self_correction"]},
        )
        derived = build_derived_learning_events(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "I went to... I mean, I visited the park"},
        )
        correction_events = [e for e in derived if e["event_type"] == "metric.self_correction"]
        self.assertEqual(len(correction_events), 1)

    def test_derives_error_from_student_turn(self):
        session = _make_session(
            curriculum_snapshot={"package": {"learningLocale": "en-US"}},
            mapping_snapshot={"focusGrammar": ["past tense"]},
        )
        derived = build_derived_learning_events(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "Yesterday I go to school"},
        )
        error_events = [e for e in derived if e["event_type"] == "metric.error_detected"]
        self.assertGreater(len(error_events), 0)

    def test_derives_feedback_from_assistant_turn(self):
        session = _make_session()
        derived = build_derived_learning_events(
            session,
            event_type="assistant.turn",
            turn_index=1,
            payload={"content": "Did you mean you went to the park yesterday?"},
        )
        feedback_events = [e for e in derived if e["event_type"].startswith("feedback.")]
        self.assertGreater(len(feedback_events), 0)

    def test_no_derived_events_for_clean_turn(self):
        session = _make_session(
            pedagogy_snapshot={"communicativeFunctions": [], "discourseMoves": [], "contextTags": []},
            mapping_snapshot={"targetExpressions": []},
        )
        derived = build_derived_learning_events(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "Hello"},
        )
        # Might still have rubric signals, but no target, function, move, or error events
        target_events = [e for e in derived if e["event_type"] == "metric.target_expression_hit"]
        func_events = [e for e in derived if e["event_type"] == "metric.communicative_function_signal"]
        error_events = [e for e in derived if e["event_type"] == "metric.error_detected"]
        self.assertEqual(len(target_events), 0)
        self.assertEqual(len(func_events), 0)
        self.assertEqual(len(error_events), 0)


# ---------------------------------------------------------------------------
# normalize_session_summary / serialize_session_summary
# ---------------------------------------------------------------------------
class TestNormalizeSessionSummary(unittest.TestCase):

    def test_defaults_on_none(self):
        result = normalize_session_summary(None)
        self.assertEqual(result["total_turns"], 0)
        self.assertEqual(result["student_turn_count"], 0)
        self.assertEqual(result["feedback_counts"]["recast"], 0)

    def test_accepts_camelcase(self):
        result = normalize_session_summary({
            "totalTurns": 10,
            "studentTurnCount": 5,
            "totalStudentWords": 50,
        })
        self.assertEqual(result["total_turns"], 10)
        self.assertEqual(result["student_turn_count"], 5)
        self.assertEqual(result["average_student_words_per_turn"], 10.0)

    def test_recomputes_average_words(self):
        result = normalize_session_summary({
            "student_turn_count": 4,
            "total_student_words": 40,
        })
        self.assertEqual(result["average_student_words_per_turn"], 10.0)

    def test_recomputes_total_hits(self):
        result = normalize_session_summary({
            "target_expression_hits": {"bonjour": 3, "merci": 2},
            "target_expression_total_hits": 0,
        })
        self.assertEqual(result["target_expression_total_hits"], 5)


class TestSerializeSessionSummary(unittest.TestCase):

    def test_produces_camelcase(self):
        summary = default_session_summary()
        serialized = serialize_session_summary(summary)
        self.assertIn("totalTurns", serialized)
        self.assertIn("studentTurnCount", serialized)
        self.assertIn("feedbackCounts", serialized)
        self.assertIn("reviewItem", serialized["feedbackCounts"])
        self.assertIn("evidenceProgress", serialized)


# ---------------------------------------------------------------------------
# build_practice_session_payload
# ---------------------------------------------------------------------------
class TestBuildPracticeSessionPayload(unittest.TestCase):

    def test_creates_valid_session_record(self):
        bootstrap = {
            "class": {"id": "class-1", "orgId": "org-1"},
            "assignment": {"id": "assign-1"},
            "mapping": {"targetExpressions": ["bonjour"]},
            "launch": {
                "voiceAllowed": True,
                "textAllowed": True,
                "modality": {"mode": "hybrid"},
            },
            "curriculum": {
                "pedagogy": {"taskModel": "information_gap"},
            },
        }
        payload = build_practice_session_payload(
            bootstrap,
            student_uid="stu-1",
            chat_id="chat-1",
        )
        self.assertEqual(payload["org_id"], "org-1")
        self.assertEqual(payload["class_id"], "class-1")
        self.assertEqual(payload["assignment_id"], "assign-1")
        self.assertEqual(payload["student_uid"], "stu-1")
        self.assertEqual(payload["status"], "active")
        self.assertTrue(payload["voice_enabled"])
        self.assertTrue(payload["text_enabled"])
        self.assertEqual(payload["transcript_ref"]["chat_id"], "chat-1")
        self.assertIn("session_summary", payload)
        self.assertIn("cost_summary", payload)

    def test_snapshot_includes_mapping_and_pedagogy(self):
        bootstrap = {
            "class": {"id": "c-1", "orgId": "o-1"},
            "assignment": {"id": "a-1"},
            "mapping": {"targetExpressions": ["merci"]},
            "launch": {"voiceAllowed": False, "textAllowed": True, "modality": {"mode": "text_only"}},
            "curriculum": {"pedagogy": {"taskModel": "opinion_gap"}},
        }
        payload = build_practice_session_payload(bootstrap, student_uid="stu-1")
        self.assertEqual(payload["mapping_snapshot"]["targetExpressions"], ["merci"])
        self.assertEqual(payload["pedagogy_snapshot"]["taskModel"], "opinion_gap")
        self.assertFalse(payload["voice_enabled"])


# ---------------------------------------------------------------------------
# Multi-turn integration: apply events sequentially
# ---------------------------------------------------------------------------
class TestMultiTurnSession(unittest.TestCase):

    def test_accumulates_across_turns(self):
        session = _make_session(
            mapping_snapshot={"targetExpressions": ["I think"]},
            pedagogy_snapshot={
                "communicativeFunctions": ["express_opinion"],
                "discourseMoves": ["hedging"],
                "objectiveIds": ["obj-1"],
                "rubricIds": ["rubric-1"],
            },
        )

        # Student turn 1
        updates = apply_learning_event_to_session(
            session,
            event_type="student.turn",
            turn_index=0,
            payload={"content": "I think maybe this is okay"},
        )
        session["session_summary"] = updates["session_summary"]
        session["cost_summary"] = updates["cost_summary"]
        session["analysis_state"] = updates["analysis_state"]

        # Assistant turn 1
        updates = apply_learning_event_to_session(
            session,
            event_type="assistant.turn",
            turn_index=1,
            payload={"content": "Good point! Can you tell me more?"},
        )
        session["session_summary"] = updates["session_summary"]
        session["analysis_state"] = updates["analysis_state"]

        # Student turn 2
        updates = apply_learning_event_to_session(
            session,
            event_type="student.turn",
            turn_index=2,
            payload={"content": "I think it works because I believe in the team"},
        )
        session["session_summary"] = updates["session_summary"]
        session["analysis_state"] = updates["analysis_state"]

        summary = session["session_summary"]
        self.assertEqual(summary["student_turn_count"], 2)
        self.assertEqual(summary["assistant_turn_count"], 1)
        self.assertEqual(summary["total_turns"], 3)
        self.assertGreater(summary["total_student_words"], 0)
        self.assertGreater(summary["target_expression_total_hits"], 0)
        self.assertEqual(summary["objective_turn_counts"].get("obj-1"), 2)


class TestAnalysisStateCoverage(unittest.TestCase):
    def test_default_analysis_state_carries_none_coverage(self):
        self.assertIn('coverage', default_analysis_state())
        self.assertIsNone(default_analysis_state()['coverage'])

    def test_normalize_carries_dict_coverage_through(self):
        recycling = {'uncovered': ['quisiera'], 'priorSessionCount': 2}
        normalized = normalize_analysis_state({'coverage': recycling})
        self.assertEqual(normalized['coverage'], recycling)

    def test_normalize_drops_non_dict_coverage_to_none(self):
        self.assertIsNone(normalize_analysis_state({'coverage': 'not-a-dict'})['coverage'])
        self.assertIsNone(normalize_analysis_state({})['coverage'])

    def test_normalize_analysis_state_preserves_and_defaults_coach_review(self):
        from backend.services.practice_analytics import default_analysis_state, normalize_analysis_state

        # default carries the key as None
        self.assertIsNone(default_analysis_state()['coach_review'])

        # a dict coach_review survives normalization (both snake_case and camelCase input)
        review = {'model': 'gpt-5.4-mini-2026-03-17', 'wins': [], 'work_on': []}
        self.assertEqual(normalize_analysis_state({'coach_review': review})['coach_review'], review)
        self.assertEqual(normalize_analysis_state({'coachReview': review})['coach_review'], review)

        # a non-dict coach_review is dropped to None, and absence defaults to None
        self.assertIsNone(normalize_analysis_state({'coach_review': 'nope'})['coach_review'])
        self.assertIsNone(normalize_analysis_state({})['coach_review'])


class AnalysisStateCoachChipsTestCase(unittest.TestCase):
    def test_default_has_empty_coach_chips_list(self):
        from backend.services.practice_analytics import default_analysis_state
        self.assertEqual(default_analysis_state()['coach_chips'], [])

    def test_normalize_preserves_coach_chips_list(self):
        from backend.services.practice_analytics import normalize_analysis_state
        chips = [{'turn_index': 4, 'utterance': 'x', 'better': 'y'}]
        self.assertEqual(normalize_analysis_state({'coach_chips': chips})['coach_chips'], chips)

    def test_normalize_accepts_camelcase_and_defaults_empty(self):
        from backend.services.practice_analytics import normalize_analysis_state
        chips = [{'turn_index': 1}]
        self.assertEqual(normalize_analysis_state({'coachChips': chips})['coach_chips'], chips)
        self.assertEqual(normalize_analysis_state({})['coach_chips'], [])
        self.assertEqual(normalize_analysis_state({'coach_chips': 'nope'})['coach_chips'], [])


class AnalysisStatePromoteBackTestCase(unittest.TestCase):
    def test_default_analysis_state_has_promote_keys(self):
        state = default_analysis_state()
        self.assertEqual(state["promote_back_state"], {})
        self.assertEqual(state["promotions"], [])

    def test_normalize_carries_promote_keys(self):
        out = normalize_analysis_state({
            "promote_back_state": {"counts": {"focus_grammar:ir": 2}, "last_promoted_turn": 4, "promoted_count": 1},
            "promotions": [{"turn_index": 4, "signature": "focus_grammar:ir", "reason": "hard_target",
                            "prompt": "note", "generated_at": "2026-06-24T00:00:00+00:00"}],
        })
        self.assertEqual(out["promote_back_state"]["promoted_count"], 1)
        self.assertEqual(len(out["promotions"]), 1)

    def test_normalize_promote_keys_default_when_absent_or_wrong_type(self):
        out = normalize_analysis_state({"promote_back_state": "bad", "promotions": "bad"})
        self.assertEqual(out["promote_back_state"], {})
        self.assertEqual(out["promotions"], [])


class AnalysisStateAskLogTestCase(unittest.TestCase):
    def test_default_analysis_state_has_ask_log(self):
        from backend.services.practice_analytics import default_analysis_state
        self.assertEqual(default_analysis_state()["ask_log"], [])

    def test_normalize_carries_ask_log_list_only(self):
        from backend.services.practice_analytics import normalize_analysis_state
        entry = {"question": "q", "answer": "a", "kind": "hint", "turn_index": 1,
                 "generated_at": "2026-06-24T00:00:00+00:00", "model": "gpt-5.4-mini-2026-03-17"}
        self.assertEqual(normalize_analysis_state({"ask_log": [entry]})["ask_log"], [entry])
        self.assertEqual(normalize_analysis_state({"ask_log": "bad"})["ask_log"], [])
        self.assertEqual(normalize_analysis_state({})["ask_log"], [])


class AffectStateAnalysisStateTestCase(unittest.TestCase):
    def test_default_carries_affect_state_none(self):
        from backend.services.practice_analytics import default_analysis_state
        self.assertIn('affect_state', default_analysis_state())
        self.assertIsNone(default_analysis_state()['affect_state'])

    def test_normalize_keeps_dict_affect_state(self):
        from backend.services.practice_analytics import normalize_analysis_state
        state = {'affect_state': {'readiness': 'strained', 'signals': {}, 'reason': 'r'}}
        self.assertEqual(normalize_analysis_state(state)['affect_state']['readiness'], 'strained')

    def test_normalize_accepts_camelcase_alias(self):
        from backend.services.practice_analytics import normalize_analysis_state
        state = {'affectState': {'readiness': 'settled', 'signals': {}, 'reason': ''}}
        self.assertEqual(normalize_analysis_state(state)['affect_state']['readiness'], 'settled')

    def test_normalize_absent_affect_state_is_none(self):
        from backend.services.practice_analytics import normalize_analysis_state
        self.assertIsNone(normalize_analysis_state({})['affect_state'])

    def test_normalize_non_dict_affect_state_is_none(self):
        from backend.services.practice_analytics import normalize_analysis_state
        self.assertIsNone(normalize_analysis_state({'affect_state': 'oops'})['affect_state'])


if __name__ == "__main__":
    unittest.main()
