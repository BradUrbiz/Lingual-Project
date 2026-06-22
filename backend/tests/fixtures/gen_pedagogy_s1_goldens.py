"""Regenerate the frozen golden prompts for the Pedagogy Engine S1 harness.

Run from the repo root, BEFORE relocating any prompt-builder code:

    python3 -m backend.tests.fixtures.gen_pedagogy_s1_goldens

Each golden is the exact output of the *current* ``build_assignment_system_prompt``
for one corpus fixture. The S1 characterization test asserts the live builder
still matches these byte-for-byte, so the goldens must only ever be regenerated
on an *intentional* prompt change (and that diff reviewed deliberately).
"""

from __future__ import annotations

import pathlib

from backend.services.assignment_resolver import build_assignment_system_prompt
from backend.tests._pedagogy_s1_corpus import CORPUS

GOLDEN_DIR = pathlib.Path(__file__).parent / "pedagogy_s1_goldens"


def regenerate() -> list[str]:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for fixture in CORPUS:
        rendered = build_assignment_system_prompt(fixture.bootstrap)
        path = GOLDEN_DIR / f"{fixture.name}.txt"
        path.write_text(rendered, encoding="utf-8")
        written.append(fixture.name)
    return written


if __name__ == "__main__":
    names = regenerate()
    print(f"Wrote {len(names)} goldens to {GOLDEN_DIR}:")
    for name in names:
        print(f"  - {name}.txt")
