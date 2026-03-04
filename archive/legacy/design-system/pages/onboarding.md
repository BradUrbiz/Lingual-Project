# Page Override — Onboarding (General → Assessment → Categories)

Goal: Keep onboarding fast, consistent, and confidence-building. Learners should never feel like they “entered a different app” mid-flow.

## Layout

- Form width: `max-w-md` to `max-w-3xl` depending on step density.
- One primary action per step (Next / Continue).
- Persist progress and allow resume (no surprises if user refreshes).

## Visual Consistency

- Use warm brutalism tokens and shared components:
  - `Card`, `Button`, `Input`, `Textarea`, `Progress`, `Badge`
- Do not introduce a separate slate/purple theme.

## UX Requirements

- Show time estimate (“~2 minutes”) and step count.
- Clear “why we ask” microcopy for sensitive fields (age/gender).
- Validation is inline, immediate, and friendly.

## Accessibility

- Labels are associated with inputs (`htmlFor` + `id`).
- All step navigation controls are keyboard accessible.

