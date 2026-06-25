# Lingual Korea L2 — Teacher + School-Admin Korean Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to run each cluster as a fresh `frontend-impl` worktree agent, reviewed before merge. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the teacher + school-admin + shared-compliance surfaces render fully in Korean at `/ko`, by extracting hardcoded English JSX to `t('…')` keys and supplying Korean translations.

**Architecture:** A parity test (Task 1) is the safety harness — it fails if `en.json` and `ko.json` key sets ever diverge, and (soft) if a statically-referenced `t('literal')` key is missing. Each subsequent task takes one **cluster** of pages through a uniform extraction recipe, ending with the parity test green and a Korean render review. Clusters touch disjoint files → parallelizable as worktree agents.

**Tech Stack:** React 19 + TypeScript, the existing `useLanguage().t(key)` lookup over `i18n/en.json` + `i18n/ko.json` (fallback `ko → en → key`), Vitest.

**Depends on:** L1 (so `/ko` actually renders Korean for the review step). Extraction can begin before L1 lands, but the render review needs `/ko`.

## Global Constraints

- **Key namespaces:** teacher pages → `teacher.*`; school-admin → `admin.*`; shared compliance/consent → `compliance.*`; shared chrome/nav → `nav.*` / `common.*`. Reuse an existing key if the exact string already exists — DRY.
- **Every new key exists in BOTH `en.json` (source English) and `ko.json` (Korean).** The parity test enforces this.
- **Korean register:** teacher/admin-facing copy uses 존댓말/합쇼체; match the voice already in `ko.json`. The Korean is **draft-for-review** — the product owner (Korean-native) does a final pass.
- **Scope cut (spec §2.5):** do **NOT** translate `pages/LingualAdmin/*` (internal Lingual staff). Leave those strings hardcoded.
- **Fallback safety:** an untranslated key degrades `ko → en` (never a crash or raw key), so partial progress is always shippable.
- **Don't change behavior:** extraction replaces literal strings with `t('key')` returning the same English by default — no logic, layout, or prop-shape changes.
- Run: `cd frontend && npm run test -- --run <file>`. Commit per cluster (no `Co-Authored-By`).

---

### Task 1: i18n parity test + fix the pre-existing gap

**Files:**
- Create: `frontend/src/i18n/i18n.parity.test.ts`
- Modify: `frontend/src/i18n/ko.json` (add the ~4 keys present in `en.json` but missing in `ko.json`)

**Interfaces:**
- Produces: a test that (a) asserts `en.json` and `ko.json` have identical key sets, and (b) soft-checks that every `t('literal')` referenced in `src/**` exists in `en.json`.

- [ ] **Step 1: Write the parity test**

```ts
// frontend/src/i18n/i18n.parity.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from './en.json';
import ko from './ko.json';

const SRC = join(__dirname, '..');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|ts)$/.test(name) && !/\.test\./.test(name)) acc.push(p);
  }
  return acc;
}

describe('i18n parity', () => {
  it('en.json and ko.json have identical key sets', () => {
    const enKeys = new Set(Object.keys(en));
    const koKeys = new Set(Object.keys(ko));
    const missingInKo = [...enKeys].filter((k) => !koKeys.has(k));
    const missingInEn = [...koKeys].filter((k) => !enKeys.has(k));
    expect({ missingInKo, missingInEn }).toEqual({ missingInKo: [], missingInEn: [] });
  });

  it('every statically-referenced t() key exists in en.json', () => {
    const enKeys = new Set(Object.keys(en));
    const missing = new Set<string>();
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) {
        if (!enKeys.has(m[1])) missing.add(`${m[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to reveal the existing gap**

Run: `cd frontend && npm run test -- --run src/i18n/i18n.parity.test.ts`
Expected: FAIL on the first assertion — `missingInKo` lists the ~4 keys (`en.json` has 503, `ko.json` 499).

- [ ] **Step 3: Add the missing Korean keys**

For each key in `missingInKo`, add the same key to `ko.json` with a Korean translation (read the English from `en.json` for context). Keep alphabetical/section grouping consistent with the file.

- [ ] **Step 4: Run it to verify green**

Run: `cd frontend && npm run test -- --run src/i18n/i18n.parity.test.ts`
Expected: PASS (both assertions).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/ko.json frontend/src/i18n/i18n.parity.test.ts
git commit -m "test(lingual-korea): i18n key-parity harness + close the en/ko gap"
```

---

## The Extraction Recipe (applied by every cluster task below)

For each page/component in the cluster:

1. **Add `useLanguage`** if absent: `import { useLanguage } from '@/contexts/LanguageContext'` and `const { t } = useLanguage();` in the component body.
2. **Find hardcoded user-visible English.** Cover ALL of these, not just JSX text nodes:
   - JSX text: `<h1>Class roster</h1>` → `<h1>{t('teacher.classRoster')}</h1>`
   - Attributes: `placeholder`, `aria-label`, `title`, `alt`
   - Button/label strings passed as props
   - `toast.success('Saved')` / `sonner` messages
   - Table headers, empty-state copy, error messages, confirm dialogs
3. **Choose a key** in the cluster's namespace (`teacher.*` / `admin.*` / `compliance.*` / `nav.*` / `common.*`). Reuse an existing key if the exact English already exists.
4. **Add the pair:** the English to `en.json`, the Korean draft to `ko.json` (same key).
5. **Interpolation:** for strings with variables (`` `${n} students` ``), keep a parameter convention — e.g. a key `teacher.studentCount` = `"{count} students"` / `"학생 {count}명"` and a tiny local format (`t('teacher.studentCount').replace('{count}', String(n))`), OR reuse the project's existing interpolation pattern if one exists (grep `replace('{` in `src` first). Do not invent a second pattern.
6. **Leave logic untouched** — only the displayed string changes.

**Per-cluster exit criteria (the "test"):**
- `npm run test -- --run src/i18n/i18n.parity.test.ts` is GREEN (keys balanced + referenced keys exist).
- `npm run test -- --run <the cluster's existing page tests>` is GREEN (extraction didn't break assertions; update any test that asserted a literal English string to assert the rendered `t()` output or the key).
- **Render review:** load each page at `/ko/...` and confirm no English leaks (use the test teacher/admin accounts in root `CLAUDE.md`). File a follow-up for any string still in English.
- Commit the cluster.

> Each cluster is a clean unit for a `frontend-impl` worktree agent. Dispatch in parallel where file sets are disjoint; review each diff before merge.

---

### Task 2: Cluster — Teacher dashboard + authoring

**Files:** `frontend/src/pages/TeacherDashboardPage.tsx`, `frontend/src/pages/TeacherAssignmentBuilderPage.tsx` (+ any `components/` they render that hold copy). Keys: `teacher.*`.

- [ ] Apply the Extraction Recipe to both pages.
- [ ] Update `TeacherDashboardPage.test.tsx` / `TeacherAssignmentBuilderPage.test.tsx` assertions that match literal English.
- [ ] Parity test green; render-review `/ko/app/teacher` + the builder.
- [ ] Commit: `feat(lingual-korea): Korean coverage — teacher dashboard + assignment builder`

---

### Task 3: Cluster — Teacher analytics + debriefs

**Files:** `TeacherAssignmentAnalyticsPage.tsx`, `TeacherAssignmentDebriefPage.tsx`, `TeacherClassAnalyticsPage.tsx`, `TeacherSessionDebriefPage.tsx`, `TeacherStudentDrillDownPage.tsx`. Keys: `teacher.*` (analytics sub-namespace `teacher.analytics.*` for chart labels/metrics).

- [ ] Apply the Extraction Recipe. Watch for Recharts axis/legend labels and metric names.
- [ ] Update the matching `*.test.tsx` assertions.
- [ ] Parity green; render-review each analytics/debrief page at `/ko`.
- [ ] Commit: `feat(lingual-korea): Korean coverage — teacher analytics + debriefs`

---

### Task 4: Cluster — Teacher compliance + onboarding

**Files:** `TeacherClassCompliancePage.tsx`, `TeacherJoinOrgPage.tsx`, `TeacherJoinPendingPage.tsx`. Keys: `teacher.*`, `compliance.*` for consent-status copy.

- [ ] Apply the Extraction Recipe. Compliance status strings are user-critical — translate precisely.
- [ ] Update matching tests.
- [ ] Parity green; render-review at `/ko`.
- [ ] Commit: `feat(lingual-korea): Korean coverage — teacher compliance + onboarding`

---

### Task 5: Cluster — School admin

**Files:** `SchoolAdminHomePage.tsx`, `AdminCompliancePage.tsx`, `AdminDeletionRequestsPage.tsx`, `AdminPendingPage.tsx`, and `pages/AdminOrgWizard/*.tsx` (the 4 wizard steps + `WizardChrome`/`WizardProgress`/`WizardSidebar`/`WizardField`). Keys: `admin.*`, `admin.wizard.*`.

- [ ] Apply the Extraction Recipe to each. The org wizard has the most copy (4 steps + validation messages) — `wizardValidation.ts` user-facing error strings count too.
- [ ] Update matching tests (the wizard has several `*.test.tsx`).
- [ ] Parity green; render-review the wizard + admin pages at `/ko`.
- [ ] Commit (may split into two commits — wizard vs. the rest — if the diff is large): `feat(lingual-korea): Korean coverage — school admin + org wizard`

---

### Task 6: Cluster — Shared compliance/consent + chrome

**Files:** `CompliancePage.tsx`, `GuardianConsentPage.tsx`, and shared `components/layout/*` (`AppLayout`, `UserMenu`, `MobileNav`) + any nav/header copy reused across teacher/admin. Keys: `compliance.*`, `nav.*`, `common.*`.

- [ ] Apply the Extraction Recipe. `GuardianConsentPage` is parent-facing and legally sensitive — translate carefully; flag any legal copy for owner review.
- [ ] Update matching tests.
- [ ] Parity green; render-review at `/ko`.
- [ ] Commit: `feat(lingual-korea): Korean coverage — shared compliance + chrome`

---

### Task 7 (lower priority): Cluster — Canvas / LTI integration surfaces

**Files:** `CanvasConnectPage.tsx`, `LtiLinkAccountPage.tsx`, `LtiAssignmentPickerPage.tsx`. Keys: `integrations.*`.

**Scope note:** Korean schools won't hit Canvas/LTI until the L4 market initiative, so this cluster is **lower priority** — do it for completeness, but it does not block the teacher/admin launch. If deferred, record it in LIMITATIONS (Task 8).

- [ ] Apply the Extraction Recipe (these pages have little copy — `Lti*` pages had ~0 obvious strings; verify).
- [ ] Parity green; render-review at `/ko`.
- [ ] Commit: `feat(lingual-korea): Korean coverage — Canvas/LTI surfaces`

---

### Task 8: Doc-sync + LIMITATIONS

**Files:** `docs/school-integration/LIMITATIONS.md`, `frontend/CLAUDE.md`, root `CLAUDE.md`.

- [ ] Add a LIMITATIONS entry: the **Lingual-Admin internal surface is intentionally English-only**; and (if Task 7 deferred) Canvas/LTI surfaces pending L4.
- [ ] `frontend/CLAUDE.md`: document the `teacher.*`/`admin.*`/`compliance.*` namespace convention and the deferred translation-code-splitting tradeoff (spec §5.3).
- [ ] root `CLAUDE.md`: note that customer-facing surfaces (student/teacher/school-admin) are Korean-capable at `/ko`.
- [ ] Commit: `docs(lingual-korea): record L2 coverage scope + i18n namespace conventions`

---

## Self-Review

- **Spec coverage (§5):** §5.1 extraction of teacher/admin → Tasks 2-6. §5.2 inventory clusters (incl. Lingual-Admin exclusion, Canvas/LTI lower-priority) → Tasks 5,7 + exclusion honored in Global Constraints. §5.3 file org + deferred code-splitting → Global Constraints + Task 8. §5.4 translation production + register + owner review → Recipe + Global Constraints. §5.5 per-cluster worktree agents → noted on the Recipe. Parity/quality harness (spec §9) → Task 1. ✅
- **Placeholder scan:** the Recipe is a concrete, self-contained procedure; per-cluster tasks instantiate it with exact file lists (uniform mechanical work, not a "Similar to Task N" code dodge). ✅
- **Interpolation:** Recipe Step 5 requires grepping for the project's existing pattern before introducing one — prevents two competing conventions. ✅

## Notes for the executor

- The parity test (Task 1) runs in CI after every cluster — it's the contract that keeps `en`/`ko` balanced as the dictionary grows toward ~1500+ keys.
- Sizing reminder (spec §5.2): the `>text<` heuristic undercounts; trust the render review at `/ko` over a string count to judge a cluster "done."
- After all clusters: `make test-frontend`, then a full `/ko` walkthrough with the test teacher + school-admin accounts. Dispatch `cross-layer-review` only if any extraction touched data-shaping (it shouldn't — this is presentation-only).
