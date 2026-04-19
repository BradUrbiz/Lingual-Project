# Hidden Assignment Time Limit Design

**Date:** 2026-04-19

## Goal

Keep assignment conversations effectively untimed in product behavior while preserving a hidden backend compatibility cap of 100 minutes (`6000` seconds).

## Problem

The current assignment system treats `timeLimitSec` as a visible evidence target. That leaks into:

- prompt assembly ("finish within about X seconds")
- teacher analytics UI
- assignment analytics framing
- test fixtures and defaults

This conflicts with the product direction that assignment conversations should not feel time-limited.

## Decision

`timeLimitSec` remains in the backend model only as a hidden internal cap for compatibility and normalization.

- Default internal value: `6000`
- Teacher UI: do not display time limit
- Student UI: do not display time limit
- Prompt text: do not instruct the model to finish within a time limit
- Analytics framing: assignment drill-down should focus on assignment evidence and rubric outcomes, not class-style engagement rollups

## Scope

### Backend

- Change assignment/bootstrap defaults from `300` to `6000`
- Preserve `timeLimitSec` in normalized payloads for internal use
- Remove time-limit wording from task-template prompt assembly
- Remove time-limit wording from assignment system-prompt overlay text

### Frontend

- Remove the `Time limit` card from teacher assignment analytics
- Remove the `Signal coverage` panel from teacher assignment analytics
- Remove class-style summary cards from teacher assignment analytics (`Sessions`, `Students`, `Speaking minutes`, etc.)
- Keep `Recent sessions`, since it is already assignment-filtered, but relabel it as assignment attempt history

### Docs

- Update school-integration BDD to stop describing assignment evidence targets as including time limit

## Intended UX

### Assignment authoring and launch

Assignments can still carry internal evidence metadata, but the product should not communicate that a conversation must end within a countdown or time box.

### Assignment analytics

The page should answer:

- What was this assignment trying to elicit?
- Which target expressions and objectives showed up?
- What repeated error patterns and rubric evidence appeared?
- What happened in recent assignment attempts?

It should not read like class-wide operational analytics.

## Risks

### Compatibility risk

Existing stored records and normalizers still expect `timeLimitSec`.

Mitigation:

- keep the field internally
- update defaults rather than removing the field

### Scope confusion risk

Assignment analytics previously mixed assignment evidence with activity totals that are more natural at class scope.

Mitigation:

- remove those summary cards from assignment drill-down
- keep class-level engagement metrics on class analytics only

## Validation

- backend test proves prompt assembly no longer mentions time-limit wording
- backend test proves hidden default is `6000`
- frontend test proves assignment analytics no longer renders `Signal coverage`, `Time limit`, or the removed summary cards
- existing assignment analytics test still proves rubric/objective/evidence content renders
