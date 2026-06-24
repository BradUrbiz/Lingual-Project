import os
import unittest
from unittest import mock

from backend.services.director_service import assess_drift


class _Db:
    def __init__(self, session, chat):
        self._session = session
        self._chat = chat
        self.written = None

    def get_practice_session(self, session_id):
        return self._session

    def get_chat_session(self, uid, chat_id):
        return self._chat

    def update_practice_session_analysis_state(self, session_id, state, sql_engine=None):
        self.written = state


class _Deps:
    def __init__(self, db):
        self.db = db
        self.sql_engine = None


_BOOTSTRAP = {"mapping": {"targetExpressions": ["la cuenta"], "targetVocabulary": ["mesa"]}}


def _session(analysis_state=None, modality="text"):
    return {
        "student_uid": "u1",
        "assignment_id": "a1",
        "modality": modality,
        "transcript_ref": {"chat_id": "c1"},
        "analysis_state": analysis_state or {},
    }


def _chat(tutor_turns):
    # interleave learner/tutor; only assistant content matters to the detector
    msgs = []
    for t in tutor_turns:
        msgs.append({"role": "user", "content": "..."})
        msgs.append({"role": "assistant", "content": t})
    return {"messages": msgs}


class AssessDriftTests(unittest.TestCase):
    def _on(self):
        return mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DIRECTOR": "1"})

    def test_flag_off_returns_none_no_write(self):
        db = _Db(_session(), _chat(["hola", "que tal", "adios"]))
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_DIRECTOR", None)
            self.assertIsNone(assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4))
        self.assertIsNone(db.written)

    def test_drift_fires_returns_payload_and_persists(self):
        db = _Db(_session(), _chat(["hola", "que tal el dia", "te gusta el cafe"]))
        with self._on():
            out = assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4)
        self.assertIsNotNone(out)
        self.assertTrue(out["resteer"])
        self.assertEqual(out["target"], "la cuenta")
        self.assertIn("la cuenta", out["resteer_prompt"])
        self.assertEqual(db.written["director_state"], {"last_resteer_turn": 4, "resteer_count": 1})
        self.assertEqual(len(db.written["resteers"]), 1)

    def test_lesson_live_returns_none(self):
        db = _Db(_session(), _chat(["habla de la cuenta", "si", "claro"]))
        with self._on():
            self.assertIsNone(assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4))
        self.assertIsNone(db.written)

    def test_no_concrete_targets_returns_none(self):
        boot = {"mapping": {"focusGrammar": ["ser vs estar"]}}
        db = _Db(_session(), _chat(["hola", "que tal", "adios"]))
        with self._on():
            self.assertIsNone(assess_drift(_Deps(db), boot, "u1", "s1", 4))

    def test_dedup_returns_existing_record(self):
        existing = {"turn_index": 4, "kind": "target_neglect", "target": "la cuenta"}
        db = _Db(_session({"resteers": [existing]}), _chat(["hola", "que tal", "adios"]))
        with self._on():
            out = assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4)
        self.assertEqual(out, existing)
        self.assertIsNone(db.written)  # no re-write on dedup hit

    def test_fail_open_on_db_error(self):
        class _BoomDb(_Db):
            def get_practice_session(self, session_id):
                raise RuntimeError("boom")
        db = _BoomDb(_session(), _chat([]))
        with self._on():
            self.assertIsNone(assess_drift(_Deps(db), _BOOTSTRAP, "u1", "s1", 4))


# A bootstrap carrying the learning locale (assess_drift reads bootstrap['class']['learningLocale']).
_KO_BOOTSTRAP = {
    "class": {"learningLocale": "ko-KR"},
    "mapping": {"targetExpressions": ["계산서"], "targetVocabulary": []},
}
_KO_GRAMMAR_ONLY = {  # no concrete targets — only language-drift can fire
    "class": {"learningLocale": "ko-KR"},
    "mapping": {"focusGrammar": ["honorifics"]},
}


class AssessLanguageDriftTests(unittest.TestCase):
    def _on(self):
        return mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_DIRECTOR": "1"})

    def test_language_drift_fires_and_returns_payload(self):
        # latest tutor turn is English in a Korean assignment
        db = _Db(_session(), _chat(["안녕하세요 반갑습니다 오늘", "Okay so what would you like to order today my friend?"]))
        with self._on():
            out = assess_drift(_Deps(db), _KO_BOOTSTRAP, "u1", "s1", 4)
        self.assertIsNotNone(out)
        self.assertEqual(out["kind"], "language_drift")
        self.assertEqual(out["target"], "Korean")
        self.assertIn("Korean", out["resteer_prompt"])

    def test_grammar_only_assignment_still_language_checked(self):
        db = _Db(_session(), _chat(["안녕하세요 반갑습니다 오늘", "What can I get for you today, friend?"]))
        with self._on():
            out = assess_drift(_Deps(db), _KO_GRAMMAR_ONLY, "u1", "s1", 4)
        self.assertIsNotNone(out)
        self.assertEqual(out["kind"], "language_drift")

    def test_clean_korean_no_language_drift_falls_back(self):
        # all-Korean turns, target referenced → no language drift; target-neglect also clean
        db = _Db(_session(), _chat(["계산서 드릴까요", "네 계산서 여기 있습니다 감사합니다", "또 오세요 안녕히 가세요"]))
        with self._on():
            out = assess_drift(_Deps(db), _KO_BOOTSTRAP, "u1", "s1", 4)
        self.assertIsNone(out)


if __name__ == "__main__":
    unittest.main()
