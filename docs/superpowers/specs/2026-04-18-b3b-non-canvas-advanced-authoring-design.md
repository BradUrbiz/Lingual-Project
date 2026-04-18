# B3b Non-Canvas Advanced Authoring Design

**Problem**

The current branch shipped only the Canvas-structured subset of Advanced mode. Teachers can generate assignments from Canvas content and edit the resulting fields, but they cannot create assignments from non-Canvas materials even though the product requirement now includes both Canvas and non-Canvas authoring.

**Approved product direction**

Quick Assign remains Canvas-only.

Advanced becomes the mixed authoring surface with three entry modes:
- `Canvas item`
- `AI-assisted source`
- `Manual authoring`

For `AI-assisted source`, the minimum required teacher input is a pasted source packet. Expected inputs include key vocabulary, teacher-written prompt text, rubric notes, lesson context, and similar instructional material.

For `Manual authoring`, the minimum required fields are:
- `title`
- `instructions`
- `scenario`
- `taskType`

Teachers may also optionally provide:
- `objectives`
- `targetExpressions`
- `focusGrammar`
- `successCriteria`
- `teacherNotes`

## UX Design

The existing `TeacherAssignmentBuilderPage` keeps its current Quick Assign surface unchanged for Canvas.

Advanced mode adds an entry-mode selector with three mutually exclusive options:
- `Canvas item`
- `AI-assisted source`
- `Manual authoring`

The `Canvas item` mode reuses the current Canvas generate/create behavior.

The `AI-assisted source` mode presents a large source-text textarea. Once the teacher pastes content, Lingual generates the same draft fields already used by the Canvas path:
- suggested title
- suggested description
- scenario
- target expressions
- focus grammar
- success criteria
- task type
- optional objectives
- optional teacher notes

The `Manual authoring` mode skips generation and exposes the editable assignment form directly, with the required fields enforced before draft/publish.

All three Advanced modes converge on a shared editable review surface rather than separate forms. This keeps the field set consistent and reduces maintenance.

## Backend Design

Two backend capabilities are required.

### 1. Source-text draft generation

Add a teacher-authenticated route:

`POST /api/teacher/classes/<class_id>/assignment-drafts/generate`

Request:

```json
{
  "sourceText": "Key vocabulary: reservar, camarero..."
}
```

Response:

```json
{
  "success": true,
  "suggestions": {
    "suggestedTitle": "...",
    "suggestedDescription": "...",
    "scenario": "...",
    "targetExpressions": [],
    "focusGrammar": [],
    "successCriteria": [],
    "taskType": "information_gap",
    "objectives": [],
    "teacherNotes": "..."
  }
}
```

This route is content-agnostic. It must not require Canvas ids or Canvas-linked metadata.

### 2. Direct-field assignment creation without mapping

Broaden the existing generic teacher assignment create route:

`POST /api/teacher/classes/<class_id>/assignments`

Today it requires `mappingId`. For B3b it must support a second path where `mappingId` is omitted and the assignment is created from direct fields on the assignment doc.

That direct-field path should accept:
- `title`
- `description`
- `status`
- `taskType`
- `successCriteria`
- `instructions`
- `generatedScenario`
- `objectives`
- `targetExpressions`
- `focusGrammar`
- `teacherNotes`

Canvas-specific create remains in `/canvas-practice/create` because it also links Canvas content.

## Data Model

Direct-field assignments are stored on the assignment doc using the same assignment-first model already introduced in Commit A.

For B3b, the assignment doc must continue to support:
- `instructions`
- `objectives`
- `target_expressions`
- `focus_grammar`
- `generated_scenario`
- `teacher_notes`

No Canvas reference is required for non-Canvas assignments.

## Compatibility

Legacy mapping-based assignments continue to work.

Canvas-first direct-field assignments continue to work.

New non-Canvas direct-field assignments reuse the same bootstrap behavior, with the resolver exposing mapping-shaped DTO fields for downstream UI and analytics compatibility until Commit C cleanup fully removes the older dependency surface.

## Testing

Minimum test coverage for this follow-up:

1. Backend route test: teacher can create direct-field assignment without `mappingId`
2. Backend route test: teacher can generate assignment draft from `sourceText`
3. Frontend test: Advanced AI-assisted mode generates from pasted source text and saves via generic assignment create
4. Frontend test: Advanced manual mode creates an assignment without Canvas selection
5. Regression: existing Canvas Quick Assign and Canvas Advanced subset still pass unchanged

## Non-goals

This follow-up does not:
- generalize all Canvas routes into a full content-source abstraction
- remove legacy curriculum mapping routes yet
- redesign Quick Assign
- introduce organization-level custom template libraries
