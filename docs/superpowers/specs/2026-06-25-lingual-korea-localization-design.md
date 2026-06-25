# Lingual Korea — Korean Localization Slice (Design)

- **Date:** 2026-06-25
- **Status:** Approved design → ready for implementation plan
- **Scope tag:** `lingual-korea-localization` (L1 + L2 + L3)
- **Author:** brainstormed with user (supremekim17), 2026-06-25

---

## 1. Context & Motivation

Lingual is maturing. The next strategic step is **Lingual Korea**: a fully-Korean
rendering of the product, served at a separate path (`l1ngual.com/ko/…`), whose
primary learning target is **English** (other targets later). The Korean market is
both a large B2C English-learning market and a B2B school market; this slice is
**B2B-first** (mirror the US school-integration product for Korean schools/teachers)
while B2C rides along for free because the student surface is already translated.

This document specifies a **localization slice** — Korean UI + English-as-target +
native-language scaffolding — on the **same product, school architecture, and
compliance model** as the US product. Korea-specific compliance (PIPA), non-Canvas
Korean school integrations, KR payment, and go-to-market are a **separate, later
initiative (L4)** and are explicitly out of scope here.

### Existing foundation (already in the codebase)

- **Two-axis locale model already exists and is correct:**
  - `LanguageContext` (`frontend/src/contexts/LanguageContext.tsx`) — *UI language*
    (`en`/`ko`), `t(key)` lookup over `i18n/en.json` + `i18n/ko.json` with fallback
    chain `ko → en → key`.
  - `LearningLocaleContext` (`frontend/src/contexts/LearningLocaleContext.tsx`) —
    *learning target* language, loaded from `profile.learningLocale`.
- Backend already declares `SUPPORTED_UI_LANGUAGES = {'en', 'ko'}` (`main.py:77`) and
  validates `uiLanguage` at the chat/realtime route boundary
  (`backend/routes/chat.py:458`, `:868`).
- Vite `base: '/'` + Flask catch-all (`serve_react_or_static`, `main.py:674`) →
  `/ko/*` URLs already serve the SPA with correctly-resolving assets. **No server
  routing change is required for L1.**

### The real gaps

| Gap | State today |
|---|---|
| **L1** — `/ko` path drives Korean UI, persisted | Infra exists but UI language is an in-memory toggle defaulting to `en`; **not URL-driven, not persisted** |
| **L2** — Korean coverage of Teacher + School-Admin surfaces | **0% — those pages are hardcoded English with zero `t()` calls** |
| **L3** — English as a learnable target + Korean scaffolding | `en-US` absent from `ALLOWED_LEARNING_LOCALES`; `ui_language` not threaded into prompt assembly; intensity policy hardcodes "English" as the support language |

---

## 2. Decisions (from brainstorming)

1. **Scope = localization slice (L1–L3).** Same product/compliance/integration model.
   PIPA, non-Canvas integrations, KR payment/GTM deferred to a later L4 initiative.
2. **Audience = B2B-first (both eventually).** Translate the full teacher +
   school-admin surface; B2C student surfaces are already Korean.
3. **Routing = path-prefix (`/ko/…`).** Not cookie-redirect (fails the explicit URL
   requirement), not subdomain (user asked for a path; subdomain deferred to L4).
4. **Include Korean scaffolding.** The tutor scaffolds in the learner's native
   language (Korean) when teaching English, governed by the existing
   `target_language_intensity` knob — not English-immersion-only.
5. **Scope cut:** the **Lingual-Admin internal surface** (`pages/LingualAdmin/*`,
   used by Lingual's own staff to approve school requests) is **NOT translated** —
   it is not customer-facing. "Fully-Korean" applies to Korean *users* (students,
   teachers, school admins).

---

## 3. Architecture: the two axes

```
UI language  (LanguageContext)      ← what the chrome/labels render in:  en | ko
Learning target (LearningLocaleContext) ← what the learner practices:    en-US | ko-KR | es-ES | …
Native/support language (NEW, derived) ← scaffolding tongue in prompts:  = UI language
```

The key conceptual addition: **native language becomes a real variable.** Until now
the UI was always English, so the tutor implicitly scaffolded in English. A Korean
UI means the support language can be Korean. We derive `native_language` from
`ui_language` and thread it into prompt assembly.

**Backward-compatibility invariant (the safety net):**
> When `ui_language == 'en'`, `native_language` resolves to "English" and **every
> existing US prompt is byte-identical to today.** Only the Korean UI path changes
> tutor behavior. (Same "byte-identical off" discipline as the pedagogy engine.)

---

## 4. L1 — Locale routing (frontend only)

### 4.1 URL → UI-language resolution

`LanguageProvider` initializes `lang` by this precedence:

1. URL path prefix (`/ko/…` → `ko`; otherwise no prefix → candidate `en`)
2. `profile.ui_language` (signed-in users)
3. `localStorage['lingual.uiLanguage']` (anonymous persistence)
4. `navigator.language` (first visit heuristic; `ko*` → `ko`)
5. default `en`

`l1ngual.com/` (bare root) **stays English** — no surprise geo-redirect. Korean is
always an explicit, bookmarkable choice via `/ko` or the toggle.

### 4.2 Components

- **`LocaleLayout`** — a routing wrapper that reads the leading path segment, keeps
  `LanguageProvider.lang` and the URL in sync, and sets `document.documentElement.lang`
  (`ko`/`en`) for a11y + SEO. (Note: this is distinct from `LearningLocaleContext`'s
  existing `dir` handling, which stays LTR for chrome.)
- **`useLocalizedNavigate()` / `localizedPath(path)` helper** — preserves the active
  prefix so internal navigation stays within `/ko`. All internal `Link`/`navigate`
  call sites in shared layout/nav are migrated to use it. (One-time plumbing cost;
  this is the only non-trivial mechanical change in L1.)
- **`LanguageToggle`** — rewrites the current path between prefixed/unprefixed
  (`/teacher` ⇄ `/ko/teacher`), persists the choice, and updates context.

### 4.3 Persistence

- Signed-in: persist `ui_language` to the user profile via the existing
  profile/onboarding update endpoint (extend its accepted fields; validate against
  `SUPPORTED_UI_LANGUAGES`). The profile already round-trips `ui_language`-adjacent
  fields, so this is an additive field, not a new endpoint.
- Anonymous: `localStorage['lingual.uiLanguage']`.

### 4.4 Router shape

React Router v7 in `App.tsx`. Wrap the existing route tree so both `/*` and `/ko/*`
resolve the same page elements through `LocaleLayout`. Approaches considered:

- **Chosen:** a single tree rendered under an optional `:locale?`-style prefix
  boundary (a `/ko` parent route whose element is `LocaleLayout`, plus the existing
  unprefixed tree) so page route definitions are **not duplicated**. The exact
  React-Router-v7 mechanism (wildcard re-mount vs. layout route with relative
  children) is an implementation detail for the plan; the requirement is **no
  duplication of the ~40 route definitions**.

---

## 5. L2 — Korean coverage of Teacher + School-Admin surfaces

### 5.1 The work

The student/B2C surface already uses `t()` (~330 distinct keys, Korean complete).
The **teacher + school-admin surfaces are hardcoded English JSX (0 `t()` calls)**.
This is the dominant cost of the whole effort. Each string must be:

1. Extracted to a `t('teacher.*')` / `t('admin.*')` key.
2. Added to `en.json` (source) and `ko.json` (Korean draft).

### 5.2 Coverage inventory (clusters, by rough size)

**In scope (customer-facing):**

| Cluster | Pages |
|---|---|
| Teacher dashboard + authoring | `TeacherDashboardPage`, `TeacherAssignmentBuilderPage` |
| Teacher analytics + debriefs | `TeacherAssignmentAnalyticsPage`, `TeacherAssignmentDebriefPage`, `TeacherClassAnalyticsPage`, `TeacherSessionDebriefPage`, `TeacherStudentDrillDownPage` |
| Teacher compliance | `TeacherClassCompliancePage` |
| Teacher onboarding | `TeacherJoinOrgPage`, `TeacherJoinPendingPage` |
| School admin | `SchoolAdminHomePage`, `AdminCompliancePage`, `AdminDeletionRequestsPage`, `AdminPendingPage`, `AdminOrgWizard/*` (4 wizard steps + chrome) |
| Shared compliance/consent | `CompliancePage`, `GuardianConsentPage` |
| Integration surfaces (lower priority — Korean schools won't hit these until L4) | `CanvasConnectPage`, `LtiLinkAccountPage`, `LtiAssignmentPickerPage` |
| Shared teacher/app components | nav, layout, headers, toasts, table headers, empty states under `components/` used by the above |

**Out of scope:** `pages/LingualAdmin/*` (internal Lingual staff back-office).

> Sizing note: a `>text<` heuristic counts ~150 obvious strings across these pages,
> but that undercounts — `placeholder`, `aria-label`, `title`, toast/`sonner`
> messages, button labels passed as props, and `components/` shared chrome are not
> caught. Treat the true string count as meaningfully higher; the plan should
> extract per-cluster and verify by reviewing each page rendered in `ko`.

### 5.3 i18n file organization

- **Keep two flat files** (`en.json`, `ko.json`), grown under clear key prefixes
  (`teacher.*`, `admin.*`, `compliance.*`, `nav.*`). Static import in
  `LanguageContext` is preserved — simplest thing that works.
- **Deferred (flagged tradeoff):** code-splitting translations by route so teachers
  don't ship the student dictionary and vice-versa. At ~1500+ total keys the upfront
  dictionary grows (~tens of KB gzipped, loaded for everyone). This is a **known,
  documented bundle tradeoff**, not an oversight; revisit as an optimization if the
  dictionary becomes a measured problem.

### 5.4 Translation production

- I (Claude) produce native-quality Korean drafts during implementation.
- The user (Korean-native, product owner) does a review pass — Korean tone/register
  for a school context is a taste call the owner should hold.
- Korean school register: default to 합쇼체/존댓말 for teacher- and admin-facing
  copy; keep student-facing copy consistent with the existing `ko.json` voice.

### 5.5 Execution

Extract **per-cluster** via parallel `frontend-impl` agents in worktrees (matches the
repo's agent workflow), reviewed before merge. Clusters are independent (disjoint
files) → good parallelization, low merge conflict.

---

## 6. L3 — English as a learnable target + Korean scaffolding (backend)

### 6.1 Enable `en-US` as a learning target

- `main.py:75` — add `'en-US'` to `ALLOWED_LEARNING_LOCALES`. All six existing
  validation gates (`auth.py:322/380`, `schools.py:194`, `teacher.py:306`,
  `pronunciation.py:122/182`, `games.py:31`) then accept it automatically — they all
  read the shared set via `RouteDeps`.
- `main.py:78` — add `LEARNING_LOCALE_PROMPT_CONFIG['en-US']` with the existing
  3-field shape (`language_name='English'`, `conversation_note`, `register_note`).
- **Realtime transcription:** verify `resolve_realtime_transcription_language_hint`
  (`backend/routes/chat.py:576`) maps `en-US` to an English transcription hint
  (`en`). Add the mapping if absent.

### 6.2 Thread `native_language` into prompt assembly

`ui_language` is **already** extracted at the route boundary and (for assignments)
already passed into `resolve_assignment_bootstrap_for_user(..., ui_language=…)`
(`chat.py:523`). It is simply **not used in prompt composition** yet. Two paths:

- **Free practice** (`build_system_prompt`, `main.py:338`): add an optional
  `native_language: str | None = None` parameter; pass the resolved `ui_language`
  from `chat.py:945` (text) and `chat.py:571` (voice).
- **Assignment** (`resolve_assignment_system_prompt` → `compile_prompt_plan` →
  `render_assignment_prompt`, and the base prompt in
  `backend/services/assignment_resolver.py:860–1072`): thread `native_language`
  (derived from the bootstrap's already-present `uiLanguage`) into the policy
  renderer.

A small map `UI_LANGUAGE_TO_NATIVE_NAME = {'en': 'English', 'ko': 'Korean'}` resolves
the display name. Default → `'English'` (preserves §3 invariant).

### 6.3 Parametrize the language-mix policy on native language (the crux)

`target_language_intensity` (`assignment_resolver.py:934–969`) renders policy text
that **hardcodes "English"** as the support/fallback tongue (modes `target_only`,
`target_led`, `balanced`, `english_led`, `english_first`). This assumes the learner's
L1 is English.

- **Change:** the rendered policy substitutes **`native_language`** wherever it
  currently hardcodes "English" as the *support* language. The *target* language stays
  the learning-locale language.
- **Enum values are preserved** (assignments store them; no migration). The legacy
  names `english_led` / `english_first` are kept as stored values but documented as
  meaning "**support-language**-led / -first"; only the rendered *text* changes.
- **Worked example** (Korean learner, target English, `english_first`): renders
  "Lead in Korean for novices; introduce English with translations" — instead of the
  nonsensical "lead in English … introduce English."
- **Invariant test:** for `native_language='English'`, every intensity mode renders
  byte-identical text to today.

### 6.4 Frontend learning-target surface

- `frontend/src/lib/learningLocales.ts` — add
  `{ value: 'en-US', label: 'English (US)', shortLabel: 'English', flag: '🇺🇸' }` to
  `LEARNING_LOCALES`; add `'en-US'` to the `LearningLocale` type
  (`frontend/src/types`).
- **UI-aware default:** make `DEFAULT_LEARNING_LOCALE` resolve by UI language —
  Korean UI → default target `en-US`; English UI → existing default `ko-KR`. (A
  small function `defaultLearningLocaleFor(uiLanguage)` rather than a bare constant;
  audit existing import sites of `DEFAULT_LEARNING_LOCALE`.)
- `en-US` is LTR — no `RTL_LEARNING_LOCALES` change.

---

## 7. API & data-model changes (summary)

| Change | Where | Type |
|---|---|---|
| Accept `ui_language` in profile update | profile/onboarding endpoint (`auth.py`) | additive field, validated vs `SUPPORTED_UI_LANGUAGES` |
| `en-US` in `ALLOWED_LEARNING_LOCALES` | `main.py:75` | additive |
| `LEARNING_LOCALE_PROMPT_CONFIG['en-US']` | `main.py:78` | additive |
| `native_language` param on prompt builders | `main.py:338`, `assignment_resolver.py`, pedagogy render seam | additive, defaulted |
| Intensity policy parametrized on native language | `assignment_resolver.py:934` | behavior change, en-byte-identical |

No new collections, no Firestore/PG schema migration. `profile.ui_language` is an
additive document field.

---

## 8. Backward-compatibility & safety

- **§3 invariant** is the primary guard: `ui_language='en'` ⇒ all prompts byte-identical.
- L1 is additive: unprefixed routes unchanged; `/ko` is new surface.
- L2 is additive: untranslated keys fall back through `ko → en → key`, so a missing
  Korean string degrades to English, never to a crash or a raw key in the common case.
- **Optional rollback flag:** gate the §6.3 native-scaffolding behavior behind a
  lightweight env flag (e.g. `PEDAGOGY_NATIVE_SCAFFOLDING`, default on) so the prompt
  behavior can be reverted without a redeploy, consistent with the repo's flag
  discipline on the high-scrutiny prompt path. (L1/L2 need no flag.)

---

## 9. Testing strategy

- **i18n parity test** (new): every key referenced via `t('…')` exists in both
  `en.json` and `ko.json`; and `en.json`/`ko.json` key sets match. (This also catches
  the **pre-existing 503 vs 499 gap.**)
- **L1 routing tests:** `/ko` prefix resolves Korean UI; toggle rewrites path and
  persists; init-order precedence (URL > profile > localStorage > navigator > en);
  `<html lang>` updates; internal navigation preserves prefix.
- **L3 prompt tests:**
  - `en-US` passes every validation gate.
  - `native_language='English'` ⇒ free-practice + every intensity mode render
    byte-identical to a captured golden (the invariant).
  - `native_language='Korean'` ⇒ policy text references Korean as support language.
  - Realtime transcription hint resolves for `en-US`.
- **Rendered review:** each translated cluster reviewed rendered in `ko` (the
  `>text<` heuristic can't prove completeness; human/agent review of the live page can).

---

## 10. Review gates

- **`cross-layer-review`** after L3 (spans backend prompt assembly + frontend locale
  surface). Required — prompt assembly is high-scrutiny per repo conventions.
- **Pedagogy lens** on §6.3 (native-language parametrization touches the language-mix
  policy the pedagogy engine renders).
- **`doc-sync`** after the phase: update `frontend/CLAUDE.md` (stale `base: '/app/'`
  → `/`; add locale-routing + i18n-namespacing notes), root `CLAUDE.md` (locale list
  gains `en-US`; note the Korean UI + `/ko` path), and `docs/school-integration/`
  (`TECH_SPEC` locale/prompt surface, `TASKS`, `LIMITATIONS` for deferred L4 +
  deferred translation-code-splitting + untranslated Lingual-Admin surface).

---

## 11. Out of scope (deferred to L4 — "Lingual Korea as a market")

- PIPA compliance architecture (distinct from FERPA/COPPA).
- Non-Canvas Korean school integrations (KERIS/NEIS/Korean LMS/SSO).
- KR payment / billing / go-to-market.
- Subdomain split (`ko.l1ngual.com`) — only if ever wanted; path `/ko` is the chosen
  shape.
- Translating the Lingual-Admin internal back-office.
- Code-splitting translation dictionaries by route (bundle optimization).

L4 is a separate brainstorm → spec → plan cycle.

---

## 12. Phasing (for the implementation plan)

1. **L3-backend** first — enable `en-US` + native-scaffolding behind the invariant
   (small, unblocks "learn English" and is independently testable).
2. **L1-routing** — `/ko` path + persistence + link helper.
3. **L2-translation** — per-cluster extraction + Korean drafts (largest; parallelizable
   after L1 link-helper lands so new strings use localized nav).
4. **Review + doc-sync**, then deploy behind the optional flag, runtime-verify with the
   test teacher/student accounts (Korean UI at `/ko`, English-target practice).

---

## 13. File touch-list (grounding for the plan)

**Frontend**
- `frontend/src/contexts/LanguageContext.tsx` — init precedence, persistence
- `frontend/src/App.tsx` — `/ko` prefix wiring, `LocaleLayout`
- `frontend/src/components/layout/*`, `MobileNav`, `UserMenu`, `LanguageToggle` —
  localized nav helper
- `frontend/src/lib/learningLocales.ts` + `frontend/src/types` — `en-US`, UI-aware default
- `frontend/src/i18n/en.json`, `ko.json` — teacher/admin/compliance namespaces
- Teacher + School-Admin + shared-compliance pages/components (§5.2) — extraction
- New: `LocaleLayout`, `useLocalizedNavigate`, i18n parity test

**Backend**
- `main.py:75/78` — `ALLOWED_LEARNING_LOCALES`, `LEARNING_LOCALE_PROMPT_CONFIG`,
  `UI_LANGUAGE_TO_NATIVE_NAME`, `build_system_prompt` signature
- `backend/routes/chat.py` — pass `native_language` (text + voice); transcription hint
- `backend/services/assignment_resolver.py` — native-language-parametric intensity policy
- `backend/services/pedagogy/*` render seam — thread `native_language`
- `backend/routes/auth.py` — accept/persist `ui_language` on profile update
- Backend tests — gates, byte-identical golden, Korean-support-language assertion
