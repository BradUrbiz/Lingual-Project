# Remaining Work

This tracks the open items from the original multi‑phase plan.

## Phase 3 — Page Wiring (finish what’s still partial)
- [ ] Settings (/app/settings): keep non‑Account tabs UI‑only, but wire any additional editable fields if backend support arrives.
- [ ] Teacher dashboard: gate by role or connect to backend once endpoints exist.

## Phase 4 — Data Mapping Details
- [x] Use `/assessment/results` to drive richer “Your Path” tiles in `/app/learn` (level badge, short summary).
- [x] Use `/assessment/results` to show a more detailed progress summary on `/profile` (if profile response lacks it).

## Phase 5 — Assets + Localization
- [x] Move remote images to `frontend/public` (landing + profile mockups) and update references.
- [x] Re‑enable i18n on Figma pages once visual overhaul stabilizes.

## UX / Design Polish
- [ ] Continue onboarding polish (component‑level refinements and copy passes).
- [ ] Align remaining Figma pages (e.g., Settings/Teacher) with final tokens and spacing.

## QA / Cleanup
- [ ] Verify `/chat` and `/app/learn` parity in behavior + styling.
- [ ] Add smoke tests for onboarding -> assessment -> categories -> learn flow.
