"""Seeded coverage scenarios for the S2 behavioral eval.

Each scenario pins a coverage state (built via ``compute_coverage_state``) plus
the behavioural claims the live tutor must satisfy when the recycling directive
is rendered into its system prompt. Consumed by
``test_recycling_behavioral_eval``.

Import boundary: stdlib + the pure ``coverage`` module only — no OpenAI/main.
"""

from __future__ import annotations

from backend.services.pedagogy.coverage import compute_coverage_state

TARGETS = ["quisiera", "la cuenta", "gracias"]

SCENARIOS = [
    {
        "name": "uncovered_accuracy_first",
        "feedback_mode": "accuracy_first",
        # "quisiera" never attempted (uncovered); "gracias"/"la cuenta" solid (>=3).
        "coverage": compute_coverage_state(
            TARGETS, {"quisiera": 0, "la cuenta": 4, "gracias": 4}, {}, 2
        ),
        "claims": {
            "elicits_uncovered": "quisiera",
            "no_overdrill": "gracias",
            "flags_error": None,
        },
    },
    {
        "name": "repeated_error_fluency_first",
        "feedback_mode": "fluency_first",
        # All targets emerging; ser/estar is a repeated error (count 3 >= 2).
        "coverage": compute_coverage_state(
            TARGETS,
            {"quisiera": 2, "la cuenta": 2, "gracias": 2},
            {"ser/estar": 3},
            3,
        ),
        "claims": {
            "elicits_uncovered": None,
            "no_overdrill": None,
            "flags_error": "ser/estar",
        },
    },
]
