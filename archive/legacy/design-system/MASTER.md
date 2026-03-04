# Lingual Design System (v1) — Warm Brutalism

This is the **single source of truth** for Lingual UI decisions. It codifies the existing “warm brutalist” theme already implemented in `frontend/src/index.css`.

## Product & UX Goals

- **Primary job-to-be-done:** Help learners build real speaking confidence through curriculum-driven practice.
- **North Star:** Every session, prompt, and feedback loop should map back to a curriculum objective.
- **Personality:** Warm, bold, friendly, credible. “Playful, but not childish.”

## Visual Language

### Style Keywords

- Warm neo-brutalism, chunky borders, stamp shadows, bold typography
- Friendly educational product (edtech), not corporate SaaS
- Strong hierarchy, high scannability, low cognitive load

### Core Tokens (CSS Variables)

Source: `frontend/src/index.css`

- **Fonts**
  - Display: `Bricolage Grotesque`
  - Body: `Satoshi`
- **Colors**
  - `--background`: warm cream
  - `--foreground`: charcoal
  - `--card`: warm white
  - `--primary`: terracotta
  - `--accent`: mustard
  - `--success`: sage
  - `--secondary`: soft clay
- **Geometry**
  - Radius baseline: `--radius: 1rem` (chunky corners)
  - Borders: `border-2` (subtle), `border-3` (emphasis), `border-4` (hero)
- **Shadows**
  - `shadow-stamp`: 4px stamp shadow (default depth)
  - `shadow-stamp-sm`: 2px stamp shadow (subtle)

### Contrast (Accessibility Note)

Current token pairings are strong for most text, but a few combos may fall below WCAG AA for normal text:

- `primary-foreground` on `primary` is ~4.09:1 (target: **4.5:1**).
- `success-foreground` on `success` is ~3.06:1 (target: **4.5:1**).
- `primary` as **text** on `background` is ~3.66:1 (target: **4.5:1**).

**Guideline:** Prefer **primary as a surface** (buttons/chips) rather than long-form text color. For links, use underline + weight, not color-only.

## Layout System

### Containers

- App shell max width: `max-w-7xl`
- Content max width:
  - Dashboard pages: `max-w-5xl`
  - Reading/assessment forms: `max-w-3xl` to `max-w-md`
- Spacing rhythm: use Tailwind’s 4/6/8 spacing steps; avoid arbitrary pixel values unless needed for tight UI.

### Navigation

- Authenticated area should feel like **one product**:
  - Prefer a single shell (`AppLayout`) for all authenticated routes.
  - Avoid mixing two different headers/nav paradigms.
- Mobile navigation should keep the “next action” within 1 tap:
  - Bottom tabs (Learn / Chat / Practice / Games / Progress) or a clear persistent nav pattern.

## Component Standards

### Buttons

- Use `frontend/src/components/ui/button.tsx` everywhere.
- Default interaction:
  - Hover: subtle lift (`-translate-y-0.5`) + bigger stamp
  - Active: press (`translate-y-0.5`) + smaller stamp
- Loading: use built-in `loading` prop; avoid custom spinners in buttons.

### Cards

- Default: `border-3 border-foreground shadow-stamp rounded-2xl`
- Subtle/data-dense views (e.g., teacher dashboards):
  - Prefer `border-2 border-border shadow-sm`
  - Use stamp shadows sparingly to reduce visual noise.

### Forms

- Always provide visible labels (not placeholder-only).
- Errors appear near the field, in plain language, with a single clear fix action.
- Touch target minimum: **44×44px** for any primary interactive element.

### Icons

- Use a single icon family (Lucide already used).
- Avoid emoji icons in UI (marketing illustrations are fine).
- Icon-only buttons require `aria-label`.

## Motion & Feedback

- Micro-interactions: 150–250ms; use transform/opacity.
- Respect `prefers-reduced-motion` for non-essential motion and infinite animations.
- Always show one of:
  - Loading state (skeleton/spinner)
  - Empty state (what to do next)
  - Error state (how to recover)

## Accessibility (Non-Negotiables)

- Visible focus rings on all interactive elements (keyboard users).
- Color is not the only indicator (use icon, border, underline, text).
- Headings are semantic (`h1` → `h2`…), and button/link semantics match behavior.
- Avoid click handlers on non-interactive elements (`div`); use `button`/`a`.

## Anti-Patterns to Avoid

- Mixing an unrelated palette (e.g., slate/purple) in core flows.
- Using `confirm()` for destructive actions instead of branded dialogs.
- Icon-only controls without labels/tooltips.
- Long paragraphs in chat/feedback without chunking (use bullets, headings, or cards).

## “Definition of Done” for New UI

- Uses tokens (`bg-card`, `text-foreground`, `border-3`, `shadow-stamp`) consistently.
- Mobile works at 375px without horizontal scroll.
- Keyboard navigable; focus visible.
- AA contrast for normal text (4.5:1) or justified exception for large/bold text.
- Loading/empty/error states implemented.

