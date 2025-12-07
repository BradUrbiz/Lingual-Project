# Product Requirements Document (v1.0)

**Product name (working):** Korean Speaking Coach (Lingual)  
**Owner:** [TBD]  
**Platform:** Web (desktop + mobile web)  
**Status:** v1.0  
**Pricing:** Free (no paid tiers)  
**UI language:** User-selectable (start with English and Korean)  
**Curriculum reference:** Explicitly show equivalence to Standard Korean Language Curriculum (SKLC) levels

## 1. Product Overview

Web-based AI coach that helps anyone improve Korean speaking and listening through personalized, scenario-based practice. Focus domains: Grammar, Vocabulary, Pragmatics (speech levels/politeness/context), Pronunciation. Every user completes a short diagnostic to profile strengths/needs, then practices via 7–10 minute AI-guided conversations and receives targeted feedback. UI surfaces SKLC-equivalent levels for transparency.

## 2. Objectives & Success Criteria

- **Accurate profiling:** Short (~10 minute) diagnostic estimating domain abilities and mapping to SKLC-equivalent levels.  
- **Personalized, curriculum-backed learning:** Define per-domain goals aligned with SKLC and present them clearly to users.  
- **Effective 7–10 minute sessions:** AI role-plays scenarios, elicits targeted forms/lexis/pragmatics, and keeps conversation flowing.  
- **Visible progress:** Post-session feedback lists practiced patterns, pronunciation clarity, and SKLC-equivalent references (e.g., “Overall ≈ SKLC Level X”).  
- **Success indicators (conceptual):** High completion of the diagnostic and at least one session; users perceive SKLC labels as accurate; feedback is rated specific/actionable; repeated use shows improvement in domain scores.

## 3. Target Users & Use Cases

- **Audience:** Broad, general population—anyone wanting better Korean conversations (beginners to near-native, in or outside Korea).  
- **Use cases:**  
  - Onboarding and self-knowledge of speaking ability.  
  - Goal-based practice (e.g., polite requests to a professor, past-tense storytelling with friends).  
  - Domain-focused improvement (e.g., ㅓ vs ㅗ pronunciation; 존댓말 vs 반말).  
  - Long-term growth with SKLC equivalence made visible.

## 4. Product Scope (v1)

### In-scope
- **Initial assessment (~7–10 minutes):** MCQs, micro-writing, short audio reads → outputs domain bands (0–5), global stage (0–5), and SKLC-equivalent level.  
- **Domain profile & goal selection:** Visualize domains; predefined goals per domain/band aligned with SKLC; system recommends goals.  
- **User-selected focus:** Multi-select domains (Grammar, Vocabulary, Pragmatics, Pronunciation); optional context selection (e.g., school, work, travel, friends, daily life).  
- **AI-guided sessions (7–10 minutes):** Clear goals shown; AI role-play aligned to level/context; elicits targets; provides light scaffolding (recasts, hints, speech-level coaching).  
- **Post-session debrief:** Recap of goals, patterns used, key vocab, pragmatics fit, pronunciation clarity with 1–3 concrete points; short fluency descriptors per selected domain; option to save phrases/patterns to a review list.  
- **Level alignment:** Display “Equivalent to SKLC Level X” overall and, when useful, per domain.

### Out-of-scope (v1)
- Native mobile apps.  
- Paid features/subscriptions or gated content.  
- Complex scheduling, streaks, or enforced usage frequency (users decide cadence).  
- Alignment with exams beyond SKLC (e.g., TOPIK, KIIP).

## 5. User Flows

- **Onboarding & assessment:** User picks UI language → brief explanation → ~10-minute diagnostic → results page with domain bands, global stage, and SKLC-equivalent level plus a simple description of what that level means.  
- **Session setup:** System suggests focus domains; user can override/multi-select domains and pick context; system generates 1–3 goals based on SKLC level + context; user confirms.  
- **Conversation (7–10 minutes):** AI sets scene; turn-by-turn role-play; AI elicits targets, gives light corrections/explanations, and keeps scenario coherent.  
- **Debrief:** Shows goals practiced, grammar/pragmatics patterns, key vocab, pronunciation highlights (1–3 specifics), short progress note (e.g., “practiced SKLC Level 2 grammar today”); options to save items or start another session.

## 6. Functional Requirements (Non-technical)

- **Assessment:** Completable in one web session (~10 minutes); outputs domain and global bands plus SKLC-equivalent level; messaging is plain-language.  
- **Goal mapping:** Maintain tables mapping domain bands (0–5) to SKLC levels and concrete goals (e.g., Grammar band 2 → past/present/future basics, connectives -고/-아서/어서). Select 1–3 goals per session based on level and practice history.  
- **Session creation:** Generate scenarios appropriate to SKLC level and selected domains/context; fit interaction to 7–10 minutes.  
- **AI behavior:** Keep role/setting consistent; balance natural conversation with targeted elicitation, reformulation, and “try again using X” prompts; scale correction density by level.  
- **Feedback & progress:** Track in-session patterns and user usage to produce per-domain recaps and concise pronunciation notes; no enforced frequency, but maintain history of goals practiced.  
- **Localization:** All non-Korean UI text (menus, instructions, feedback summaries) respect user-chosen UI language; practice stays in Korean.  
- **Web delivery:** Works on modern desktop/mobile browsers; reliable in-browser audio capture for pronunciation and speaking input.

## 7. Risks & Open Questions

- ASR robustness in noisy environments may affect pronunciation scoring and UX.  
- Perceived accuracy of SKLC equivalence could vary; need clear expectation-setting.  
- Balancing conversational flow vs. correction density, especially for beginners.  
- Tuning of teaching tone and reassessment cadence (how often to re-run diagnostics) remains open.  
- Breadth vs. depth: covering all SKLC levels across four domains for a wide audience may stretch content depth initially.
