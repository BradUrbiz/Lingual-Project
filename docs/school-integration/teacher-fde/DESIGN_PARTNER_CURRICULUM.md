# Teacher FDE — Design Partner Curriculum (grounding reference)

Status: v1 — pulled live from Canvas 2026-06-27 (read-only, via `.env` Canvas PAT)
Last updated: 2026-06-27
Owner: Product + Engineering

Real curriculum of the Teacher FDE design partner, read directly from his Canvas. Grounds the §C
archetypes and worked examples in `DESIGN_LANGUAGE.md`. **No student data was pulled** — course
content + structure only.

## Who / where

- **Teacher:** Eduardo Polón. Canvas instance `ssfs.instructure.com` (read via `CANVAS_ACCESS_TOKEN`).
- **Primary course (current, term 252):** *Advanced Spanish: Contemporary Topics & Culture* (id `3690`)
  — the title maps directly to **AP Spanish Language & Culture**.
- **Sibling/feeder courses:** *Pre-Advanced Spanish* (several sections), *Advanced Spanish 2* (a
  colleague's section, id `2847`, content-rich — useful for the upper grammar progression).

## Textbook + course architecture

Runs **VHL "Imagina"** (Vista Higher Learning — the standard AP-track Spanish series). Organized by
**Lección**, each with a fixed arc Teacher FDE can map archetypes onto:

`Para Empezar` (Vocabulario + theme) → `Cortometraje` (short film + analysis) → `Imagina`
(culture / country focus) → `Estructuras` (grammar) → `Cultura / Literatura` →
**`Presentational` / `Interpersonal` Speaking project**.

**Lecciones seen (themes):**
- **L1 Sentir y Vivir — Las relaciones personales** (country: Estados Unidos; corto: *Café para
  llevar*; lit: Neruda, *Poema 20*).
- **L2 Vivir en la ciudad — En la ciudad** (country: México; corto: *Adiós, mamá*; presentational
  project: *Momentos Recientes que Transformaron el Mundo Hispano*).
- **L3 Un mundo conectado — Los medios de comunicación** (media/communication).

**Grammar progression (Estructuras):** L1 present tense, ser/estar, gustar-type verbs → L2 preterite,
imperfect, preterite-vs-imperfect. The upper sibling course continues into conditional, imperfect/
present-perfect/past-perfect subjunctive, si-clauses, passive voice, relative pronouns, neuter *lo*,
future/conditional perfect — i.e. the full pre-AP → AP grammar ladder.

## Signals that shape our design

1. **He already uses a task taxonomy:** `OVERVIEW · LEARN · PRACTICE · APPLY · ANALYZE · ASSESS`.
   Our design language should *speak this vocabulary*, not impose a parallel one.
2. **ACTFL modes are explicit** in his course: Interpersonal, Interpretive (dedicated listening/reading
   strategy pages), Presentational. Confirms the §C anchor.
3. **He is AI-forward:** dedicated pages *"Guidelines for AI Use in Second Language Learning"* +
   *"Quick Reference Guide for AI Use in Second Language Learning."* Low adoption risk; likely wants a
   say in the AI's behavior (validates the observability + feedback-policy-exposure bets).
4. **His speaking tasks already embed targets in the prompt** ("Interpersonal Communication *by way of
   the Vocabulario*"). The gap Lingual fills is NOT "what to practice" — it's **executing it at
   student scale, with feedback and observability.**

## Real speaking task (verbatim seed for a worked example)

From **L1 §2.2 — Interpersonal Communication by way of the Vocabulario: Las relaciones personales**:
- *Las relaciones, los sentimientos y las personalidades* — **¿Qué deseas en una relación y qué
  prefieres evitar?**
- *Los estados emocionales* — **Me siento… cuando…**
- *Los estados civiles* — **Conozco gente…**

This is grounded into `DESIGN_LANGUAGE.md` §C as the first worked example.

## How to refresh / go deeper

Read-only scripts in the session scratchpad (`canvas_discover.py`, `canvas_course.py`,
`canvas_bodies.py`) reuse `backend/services/canvas/client.py` + the `.env` PAT. Most rich content lives
in linked Google Slides / VHL Central (outside Canvas), so deeper grounding (actual rubrics, vocab
lists) will need either those links or a direct ask to the teacher.
