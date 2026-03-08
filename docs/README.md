# Documentation

This directory holds product and implementation documents that should guide feature work before code is written.

## Active tracks

- `school-integration/PRD.md`
  Product requirements for opening Lingual beta to schools.
- `school-integration/TECH_SPEC.md`
  Architecture and implementation blueprint for the school integration stack.
- `school-integration/TASKS.md`
  Phased execution checklist for engineering, product, and pilot operations.
- `school-integration/LIMITATIONS.md`
  Running log of current implementation constraints, temporary shortcuts, and known gaps.
- `avatar-expression-improvement-plan.md`
  Improvement plan for `/app/chat` Live2D acting quality, benchmarked against Open-LLM-VTuber.
- `avatar-expression-limitations.md`
  Running limitations log for the current `/app/chat` Live2D avatar stack.

## Working rule

For the school track, update the docs in this order when scope changes:

1. `PRD.md`
2. `TECH_SPEC.md`
3. `TASKS.md`

Implementation should follow the docs unless an explicit architecture decision updates them first.

For the school track, keep `school-integration/LIMITATIONS.md` updated whenever shipped behavior is narrower than the intended target architecture.
