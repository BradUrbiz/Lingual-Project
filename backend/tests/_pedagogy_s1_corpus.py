"""Fixture corpus for the Pedagogy Engine S1 (thin spine) harness.

Not a test module (underscore prefix keeps it out of ``test_*`` discovery).
Both the golden generator (``fixtures/gen_pedagogy_s1_goldens.py``) and the
S1 test suite import :data:`CORPUS` from here so the snapshot, equivalence,
routing, and plan tests all run against the *same* bootstrap shapes.

Each entry is a ``Fixture(name, bootstrap, has_grammar, is_custom_prompt)``:
  * ``bootstrap`` mirrors what ``build_assignment_system_prompt`` receives at
    ``chat.py:489`` / ``:856`` today (systemPromptPreview + assignment +
    mapping + class + curriculum.pedagogy).
  * ``has_grammar`` flags whether ``mapping.focusGrammar`` is non-empty — the
    S1 behaviour-win (grammar -> prompt-first routing) only fires when True, so
    no-grammar fixtures must stay byte-identical between the old and new paths.
  * ``is_custom_prompt`` flags the raw-tutor-mode bypass (engine off; base
    prompt passes through untouched).

The matrix deliberately spans every ``task_type``, both target-presence
states, every ``feedbackPolicy.mode``, the scaffold/review edge cases the
existing suite already pins, a non-English locale base, and the custom_prompt
bypass.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Fixture:
    name: str
    bootstrap: dict[str, Any]
    has_grammar: bool
    is_custom_prompt: bool = False


def _restaurant_curriculum() -> dict[str, Any]:
    return {
        "objectives": [
            {"id": "OBJ1", "canDo": {"en": "I can order food politely in a restaurant."}},
        ],
        "rubrics": [
            {
                "id": "rub.speaking.v1",
                "title": {"en": "Speaking Rubric"},
                "dimensions": [
                    {
                        "id": "task_completion",
                        "title": {"en": "Task completion"},
                        "description": {"en": "Completes the assigned task clearly."},
                    }
                ],
            },
        ],
        "situation": {
            "seed": {
                "setting": "Restaurant",
                "roles": ["learner", "server"],
                "register": "mixed",
            }
        },
        "pedagogy": {
            "taskModel": "ap.conversation",
            "contextTags": ["restaurant", "ordering"],
            "communicativeFunctions": ["ask_follow_up"],
            "discourseMoves": ["turn_taking"],
            "foundationDomains": ["communication_strategies"],
            "evidence": {"minTurns": 4, "maxTurns": 8, "timeLimitSec": 90},
            "templateRefs": ["tpl.restaurant_roleplay.v1"],
            "activityTemplates": [
                {
                    "id": "tpl.restaurant_roleplay.v1",
                    "title": {"en": "Restaurant Roleplay"},
                    "mode": "interpersonal_speaking",
                    "assistantRole": "Stay in character as the server and reveal menu details only when asked.",
                    "interactionPattern": {
                        "openingMoves": ["Greet the learner and wait for the first ordering move."],
                        "sustainMoves": ["Answer questions briefly, then push the learner to confirm or refine the order."],
                        "closingMoves": ["Close after the learner confirms the final order and any follow-up request."],
                        "completionRule": "The learner must place an order and clarify at least one detail before closing.",
                    },
                    "promptCues": ["Keep the server voice natural and concise."],
                }
            ],
        },
    }


def _feedback(mode: str, **overrides: Any) -> dict[str, Any]:
    policy = {
        "mode": mode,
        "targetOnlyStrict": False,
        "recastDefault": True,
        "elicitationRepeatThreshold": 3,
        "endReviewEnabled": True,
    }
    policy.update(overrides)
    return policy


CORPUS: list[Fixture] = [
    # 1. Full information-gap assignment, grammar present, balanced mode.
    Fixture(
        name="information_gap_full_grammar_balanced",
        has_grammar=True,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (restaurant, ko-KR).",
            "assignment": {
                "title": "Restaurant Ordering Practice",
                "taskType": "information_gap",
                "successCriteria": ["Use one polite request", "Ask one follow-up question"],
                "description": "Order a meal and ask about one menu item.",
            },
            "mapping": {
                "targetExpressions": ["Could I have", "I would like"],
                "targetVocabulary": ["appetizer", "receipt"],
                "focusGrammar": ["polite requests"],
                "teacherNotes": "Keep the learner in the restaurant ordering lane.",
                "feedbackPolicy": _feedback("balanced"),
                "scaffoldPolicy": {
                    "silenceToleranceMs": 3200,
                    "hintLadder": ["wait", "context_hint", "choice_prompt"],
                    "maxModelingSteps": 1,
                },
            },
            "class": {"name": "French 2 - Period 3"},
            "curriculum": _restaurant_curriculum(),
        },
    ),
    # 2. Same shape, grammar removed -> must stay byte-identical across paths.
    Fixture(
        name="information_gap_no_grammar_balanced",
        has_grammar=False,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (restaurant, ko-KR).",
            "assignment": {
                "title": "Restaurant Ordering Practice",
                "taskType": "information_gap",
                "successCriteria": ["Use one polite request"],
            },
            "mapping": {
                "targetExpressions": ["Could I have", "I would like"],
                "targetVocabulary": ["appetizer", "receipt"],
                "teacherNotes": "Keep the learner in the restaurant ordering lane.",
                "feedbackPolicy": _feedback("balanced"),
            },
            "class": {"name": "French 2 - Period 3"},
            "curriculum": _restaurant_curriculum(),
        },
    ),
    # 3. Opinion-gap, grammar present, accuracy_first (reinforces elicitation).
    Fixture(
        name="opinion_gap_grammar_accuracy",
        has_grammar=True,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (debate, es-ES).",
            "assignment": {
                "title": "Weekend Plans Debate",
                "taskType": "opinion_gap",
                "successCriteria": ["State a preference", "Give one reason"],
            },
            "mapping": {
                "targetExpressions": ["In my opinion", "I disagree because"],
                "focusGrammar": ["subjunctive of doubt", "comparatives"],
                "feedbackPolicy": _feedback("accuracy_first", targetOnlyStrict=True, elicitationRepeatThreshold=2),
            },
            "class": {"name": "Spanish 3"},
            "curriculum": {"objectives": [], "pedagogy": {}},
        },
    ),
    # 4. Opinion-gap, NO targets at all, fluency_first (softens routing).
    Fixture(
        name="opinion_gap_no_targets_fluency",
        has_grammar=False,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (open chat, fr-FR).",
            "assignment": {
                "title": "Free Opinion Chat",
                "taskType": "opinion_gap",
            },
            "mapping": {
                "feedbackPolicy": _feedback("fluency_first"),
            },
            "class": {},
            "curriculum": {"pedagogy": {}},
        },
    ),
    # 5. Decision-making, grammar present, fluency_first.
    Fixture(
        name="decision_making_grammar_fluency",
        has_grammar=True,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (planning, fr-FR).",
            "assignment": {
                "title": "Trip Planning",
                "taskType": "decision_making",
                "successCriteria": ["Compare two options", "Commit to one plan"],
            },
            "mapping": {
                "targetExpressions": ["What if we", "I'd rather"],
                "targetVocabulary": ["itinerary", "budget"],
                "focusGrammar": ["conditional tense"],
                "feedbackPolicy": _feedback("fluency_first"),
                "scaffoldPolicy": {
                    "silenceToleranceMs": 2500,
                    "hintLadder": ["wait", "context_hint", "choice_prompt", "model_and_retry"],
                    "maxModelingSteps": 2,
                },
            },
            "class": {"name": "French 4"},
            "curriculum": {"objectives": [], "pedagogy": {}},
        },
    ),
    # 6. Expressions + vocab but NO grammar, accuracy_first -> still byte-equal.
    Fixture(
        name="expressions_vocab_no_grammar_accuracy",
        has_grammar=False,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (market, he-IL).",
            "assignment": {
                "title": "Market Haggling",
                "taskType": "decision_making",
                "successCriteria": ["Negotiate a price"],
            },
            "mapping": {
                "targetExpressions": ["How much is", "That's too expensive"],
                "targetVocabulary": ["discount", "cash"],
                "feedbackPolicy": _feedback("accuracy_first"),
            },
            "class": {"name": "Hebrew 1"},
            "curriculum": {"objectives": [], "pedagogy": {}},
        },
    ),
    # 7. Legacy / unknown task type, minimal mapping.
    Fixture(
        name="legacy_unknown_tasktype_minimal",
        has_grammar=False,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (legacy).",
            "assignment": {"title": "Legacy Conversation"},
            "mapping": {},
            "class": {},
            "curriculum": {"pedagogy": {}},
        },
    ),
    # 8. Teacher notes only (mirrors existing suite).
    Fixture(
        name="teacher_notes_only",
        has_grammar=False,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt",
            "assignment": {"title": "Museum Ticket Practice"},
            "mapping": {
                "teacherNotes": "Keep the learner at the museum ticket desk and do not drift into sightseeing small talk.",
            },
            "class": {},
            "curriculum": {"pedagogy": {}},
        },
    ),
    # 9. Scaffold zero-limits edge (mirrors existing suite).
    Fixture(
        name="scaffold_zero_limits",
        has_grammar=False,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt",
            "assignment": {"title": "Lost and Found Practice"},
            "mapping": {
                "scaffoldPolicy": {
                    "silenceToleranceMs": 0,
                    "hintLadder": ["wait", "context_hint"],
                    "maxModelingSteps": 0,
                },
            },
            "class": {},
            "curriculum": {"pedagogy": {}},
        },
    ),
    # 10. Disabled end-review + clarification (mirrors existing suite).
    Fixture(
        name="disabled_end_review_and_clarification",
        has_grammar=False,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt",
            "assignment": {"title": "Phone Call Practice"},
            "mapping": {
                "feedbackPolicy": {"endReviewEnabled": False},
                "outputPolicy": {"allowClarificationRequests": False},
            },
            "class": {},
            "curriculum": {"pedagogy": {}},
        },
    ),
    # 11. Grammar-only targets (no expressions/vocab), balanced.
    Fixture(
        name="grammar_only_targets_balanced",
        has_grammar=True,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (grammar drill, ru-RU).",
            "assignment": {
                "title": "Past Tense Story",
                "taskType": "information_gap",
                "successCriteria": ["Narrate three past events"],
            },
            "mapping": {
                "focusGrammar": ["past tense (perfective)", "time adverbs"],
                "feedbackPolicy": _feedback("balanced"),
            },
            "class": {"name": "Russian 2"},
            "curriculum": {"objectives": [], "pedagogy": {}},
        },
    ),
    # 12. Grammar + evidence.minTurns >= 5 — exercises the output-policy
    #     double-normalization (evidence bump) that must survive plan compilation.
    Fixture(
        name="grammar_evidence_heavy_accuracy",
        has_grammar=True,
        bootstrap={
            "systemPromptPreview": "Base assignment prompt (interview, es-ES).",
            "assignment": {
                "title": "Job Interview",
                "taskType": "opinion_gap",
                "successCriteria": ["Answer three questions in full sentences"],
            },
            "mapping": {
                "targetExpressions": ["I am responsible for"],
                "focusGrammar": ["present perfect"],
                "feedbackPolicy": _feedback("accuracy_first"),
            },
            "class": {"name": "Spanish 4"},
            "curriculum": {
                "objectives": [],
                "pedagogy": {"evidence": {"minTurns": 6, "maxTurns": 12}},
            },
        },
    ),
    # 13. custom_prompt raw-tutor-mode bypass (engine off; base passes through).
    Fixture(
        name="custom_prompt_bypass",
        has_grammar=False,
        is_custom_prompt=True,
        bootstrap={
            "systemPromptPreview": "Raw teacher instructions only, no overlay. (tl-PH)",
            "assignment": {
                "title": "Teacher Freeform",
                "taskType": "custom_prompt",
                "successCriteria": ["Whatever the teacher wrote"],
            },
            "mapping": {
                "targetExpressions": ["ignored"],
                "focusGrammar": ["ignored"],
                "feedbackPolicy": _feedback("accuracy_first"),
            },
            "class": {"name": "Tagalog 1"},
            "curriculum": {"pedagogy": {}},
        },
    ),
]
