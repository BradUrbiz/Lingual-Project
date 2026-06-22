"""Regenerate the frozen golden prompts for the Pedagogy Engine prompt harness.

Run from the repo root:

    python3 -m backend.tests.fixtures.gen_pedagogy_s1_goldens

Each golden is the exact output of the engine render
(``render_assignment_prompt(compile_prompt_plan(bootstrap), "text")``) for one
corpus fixture — the assignment prompt path is now unconditionally engine-rendered
(the legacy ``build_assignment_system_prompt`` builder was retired). The
characterization test asserts the live engine render still matches these
byte-for-byte, so the goldens must only ever be regenerated on an *intentional*
prompt change (and that diff reviewed deliberately).
"""

from __future__ import annotations

import pathlib

from backend.services.pedagogy.plan import compile_prompt_plan
from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
from backend.tests._pedagogy_s1_corpus import CORPUS

GOLDEN_DIR = pathlib.Path(__file__).parent / "pedagogy_s1_goldens"


def regenerate() -> list[str]:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for fixture in CORPUS:
        rendered = render_assignment_prompt(compile_prompt_plan(fixture.bootstrap), "text")
        path = GOLDEN_DIR / f"{fixture.name}.txt"
        path.write_text(rendered, encoding="utf-8")
        written.append(fixture.name)
    return written


if __name__ == "__main__":
    names = regenerate()
    print(f"Wrote {len(names)} goldens to {GOLDEN_DIR}:")
    for name in names:
        print(f"  - {name}.txt")
