# Teacher FDE — Design Partner Curriculum (grounding reference)

Status: v2 — re-pulled 2026-06-28 (added his live Lingual usage + AI-use policy + full L1–L3 task spine)
Last updated: 2026-06-28
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

## He is ALREADY a Lingual user (pulled 2026-06-28)

Not a hypothetical partner — his live Canvas has running Lingual assignments:
- **"PRACTICE — Interpersonal Speaking *Free Practice* with Lingual"** — *"participate in a 'Free
  Practice' 1-on-1 interpersonal speaking exchange with Lingual's chatbot, Lingu. Get to know 'her.'"*
- **"LEARN — Ahead of an interpersonal *Guided Practice* on Lingual, refamiliarize yourself with
  Imagina, Capítulo 5: Las riquezas naturales Vocabulario (Nuestro Mundo) and Guided Practice
  expectations."**
- **"PRACTICE — Interpersonal Speaking *Guided Practice* with Lingual"** — *"…based on these
  expectations: Imagina, Capítulo 5 Vocabulario (Nuestro Mundo)…"*

He runs a **Free Practice → Guided Practice** progression. Critically, he conveys the
targets/expectations as **prose in the Canvas assignment + a referenced textbook Vocabulario** — i.e.
the task–target alignment lives in his head and in Canvas text, **NOT as structured engine input.**
**This is the Teacher FDE gap, observed in his real behavior** (CHARTER §2 made literal). Phase 2
guided authoring must absorb exactly this "expectations paragraph → structured input" move.

## His AI-use policy — his real voice (SSFS Global Languages Dept, Google Doc)

From *"Guidelines for AI Use in Second Language Learning"* + its Quick Reference (dept-level, his course):
- **#1 guiding principle: "Language learning requires productive struggle. AI may provide support, but
  students must engage directly…"** → strongly **pre-validates** the engine's anti-answer-dump /
  elicitation-over-recast stance and the bet to **expose feedback policy** (he already thinks in
  accuracy/struggle terms).
- *"Authentic voice matters… at their current stage of learning."* → level-matched scaffolding
  (§D #4 / language-mix intensity).
- **AI Use Levels 0–3:** **Level 0 (No AI)** = graded **speaking ASSESSMENTS** + in-class proficiency
  work. **Level 1 (Tutor, permitted w/ disclosure)** = *"simulate a conversation partner for extra
  oral practice **outside of class**."* → **Lingual sits at Level 1 (practice/tutor), explicitly NOT
  the graded ASSESS tasks.** He already draws this line in Canvas (Lingual = "PRACTICE"; speaking
  assessments = separate "ASSESS", in-class, pointed). **Positioning rule for us: the alignment view is
  a *practice* diagnostic, not a grade.**
- His canonical Level 1 example is literally *"practicing a conversation with an AI chatbot about
  ordering in a café… then writing a short reflection"* → the demo café task is on-message, not a
  mismatch.
- He also requires **transparency / disclosure of AI-use level** — an integrity value, not a pedagogy
  knob, but signals he wants AI behavior legible (validates the observability bet).

## Full interpersonal task spine (L1–L3, verbatim prompts)

All framed *"Interpersonal Communication by way of the Vocabulario: [theme]."* The prompt questions ARE
his target-elicitation design:
- **L1 relaciones:** *¿Qué deseas en una relación y qué prefieres evitar?* · *Me siento… cuando…* ·
  *Conozco gente…*
- **L2 en la ciudad:** *¿Dónde queda…?* · *¿Cómo tiendes pasar el fin de semana…?*
- **L3 los medios:** *¿Qué medios utilizas para enterarte de la actualidad y por qué? ¿…imparciales o
  tienen parcialidad?* · favorite actor/cantante/directora · cine y TV (subtítulos vs doblaje) · la
  prensa (which section, titulares vs investigar).

Grammar/Estructuras speaking assessments run 1.x → 5.x (present/ser-estar/gustar → preterite/imperfect →
… → subjunctive/conditional) — the pre-AP→AP ladder, assessed separately from the Lingual practice.

## How to refresh / go deeper

Read-only scripts in the session scratchpad (`canvas_discover.py`, `canvas_course.py`,
`canvas_bodies.py`) reuse `backend/services/canvas/client.py` + the `.env` PAT. Most rich content lives
in linked Google Slides / VHL Central (outside Canvas), so deeper grounding (actual rubrics, vocab
lists) will need either those links or a direct ask to the teacher.
