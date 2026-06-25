# Lingual Korea L1 — `/ko` Locale Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the existing SPA in Korean at `l1ngual.com/ko/…` as first-class, shareable URLs, with the UI language driven by the path prefix and the choice persisted.

**Architecture:** Compute the React Router `basename` **dynamically** from the URL — append `/ko` when the path starts with it. Because React Router prepends `basename` to every `<Link>`/`navigate`, all 37 existing routes and links work under `/ko` with **no route duplication and no link-helper migration**. `LanguageProvider` is seeded with the URL-derived language; switching language is a single hard-navigation that re-seeds `basename` and persists the choice. No server change (Vite `base:'/'` + Flask catch-all already serve `/ko/*`).

**Tech Stack:** React 19, React Router v7, Vite, Vitest. Pure path helpers carry the logic; the router/provider wiring is thin.

**Supersedes spec §4.2:** the spec described a `useLocalizedNavigate` link helper; the dynamic-`basename` approach makes that unnecessary. The spec's *requirements* (shareable `/ko`, no duplication, persisted choice, `<html lang>`) are all met.

## Global Constraints

- **No route duplication:** the 37 `<Route>` definitions in `App.tsx` are not copied or wrapped per-locale.
- **URL is authoritative for rendered language:** `/ko/*` ⇒ `lang='ko'`; everything else ⇒ `lang='en'`. Never render Korean at a non-`/ko` URL (avoids URL↔content desync).
- **No surprise geo-redirect:** never auto-switch to Korean from `navigator.language` or IP. Korean is reached only by an explicit `/ko` URL or the toggle. (Spec §4.1.)
- **Provider order (unchanged):** `BrowserRouter` → `AuthProvider` → `MembershipProvider` → `LanguageProvider` → `LearningLocaleProvider` (`App.tsx:301-308`).
- **Byte-identical default:** with no `/ko` prefix, behavior is identical to today (`lang` defaults `'en'`).
- Run frontend tests: `cd frontend && npm run test -- --run <file>`. Commit after each task (no `Co-Authored-By`).

---

### Task 1: Pure locale-path helpers

**Files:**
- Create: `frontend/src/lib/localeRouting.ts`
- Test: `frontend/src/lib/localeRouting.test.ts`

**Interfaces:**
- Produces:
  - `detectLocale(pathname: string, base: string): { localePrefix: '' | '/ko'; lang: 'en' | 'ko' }`
  - `buildLocalePath(pathname: string, toLang: 'en' | 'ko', base: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/localeRouting.test.ts
import { describe, it, expect } from 'vitest';
import { detectLocale, buildLocalePath } from './localeRouting';

describe('detectLocale', () => {
  it('detects ko from a /ko path', () => {
    expect(detectLocale('/ko/app/teacher', '')).toEqual({ localePrefix: '/ko', lang: 'ko' });
  });
  it('detects ko from the bare /ko path', () => {
    expect(detectLocale('/ko', '')).toEqual({ localePrefix: '/ko', lang: 'ko' });
  });
  it('defaults to en with no prefix', () => {
    expect(detectLocale('/app/teacher', '')).toEqual({ localePrefix: '', lang: 'en' });
  });
  it('does not treat /korean as a ko prefix', () => {
    expect(detectLocale('/korean-class', '')).toEqual({ localePrefix: '', lang: 'en' });
  });
  it('honors an existing Vite base', () => {
    expect(detectLocale('/app-base/ko/login', '/app-base')).toEqual({ localePrefix: '/ko', lang: 'ko' });
  });
});

describe('buildLocalePath', () => {
  it('adds /ko when switching to ko', () => {
    expect(buildLocalePath('/app/teacher', 'ko', '')).toBe('/ko/app/teacher');
  });
  it('removes /ko when switching to en', () => {
    expect(buildLocalePath('/ko/app/teacher', 'en', '')).toBe('/app/teacher');
  });
  it('is idempotent switching ko→ko', () => {
    expect(buildLocalePath('/ko/login', 'ko', '')).toBe('/ko/login');
  });
  it('maps bare /ko → / when switching to en', () => {
    expect(buildLocalePath('/ko', 'en', '')).toBe('/');
  });
  it('preserves an existing base', () => {
    expect(buildLocalePath('/app-base/login', 'ko', '/app-base')).toBe('/app-base/ko/login');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/lib/localeRouting.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helpers**

```ts
// frontend/src/lib/localeRouting.ts
export type UiLang = 'en' | 'ko';

function stripBase(pathname: string, base: string): string {
  if (base && pathname.startsWith(base)) {
    return pathname.slice(base.length) || '/';
  }
  return pathname;
}

/** Returns the locale prefix segment and the UI language implied by the URL. */
export function detectLocale(
  pathname: string,
  base: string,
): { localePrefix: '' | '/ko'; lang: UiLang } {
  const rest = stripBase(pathname, base);
  if (rest === '/ko' || rest.startsWith('/ko/')) {
    return { localePrefix: '/ko', lang: 'ko' };
  }
  return { localePrefix: '', lang: 'en' };
}

/** Rebuilds the full path (incl. base) for the target language. */
export function buildLocalePath(pathname: string, toLang: UiLang, base: string): string {
  const rest = stripBase(pathname, base);
  // Strip an existing /ko prefix to get the logical path.
  let logical = rest;
  if (rest === '/ko') {
    logical = '/';
  } else if (rest.startsWith('/ko/')) {
    logical = rest.slice('/ko'.length);
  }
  const prefixed = toLang === 'ko' ? `/ko${logical === '/' ? '' : logical}` : logical;
  const normalized = prefixed === '' ? '/' : prefixed;
  return `${base}${normalized}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/lib/localeRouting.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localeRouting.ts frontend/src/lib/localeRouting.test.ts
git commit -m "feat(lingual-korea): pure locale-path helpers for /ko routing"
```

---

### Task 2: `LanguageProvider` — seed from URL + persist + `<html lang>`

**Files:**
- Modify: `frontend/src/contexts/LanguageContext.tsx`
- Test: `frontend/src/contexts/LanguageContext.test.tsx` (new or extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LanguageProvider` accepts optional `initialLang?: Language`; `setLang` persists to `localStorage['lingual.uiLanguage']`; an effect keeps `document.documentElement.lang` in sync. `useLanguage()` API unchanged (`{ lang, setLang, t }`).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/contexts/LanguageContext.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LanguageProvider, useLanguage } from './LanguageContext';

function Probe() {
  const { lang, setLang } = useLanguage();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <button onClick={() => setLang('ko')}>ko</button>
    </div>
  );
}

describe('LanguageProvider', () => {
  beforeEach(() => localStorage.clear());

  it('uses initialLang when provided', () => {
    render(<LanguageProvider initialLang="ko"><Probe /></LanguageProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('defaults to en with no initialLang', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('en');
  });

  it('persists setLang to localStorage', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    act(() => { screen.getByText('ko').click(); });
    expect(localStorage.getItem('lingual.uiLanguage')).toBe('ko');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/contexts/LanguageContext.test.tsx`
Expected: FAIL — `initialLang` prop unsupported; `document.documentElement.lang` not set.

- [ ] **Step 3: Modify `LanguageContext.tsx`**

```tsx
/* eslint-disable react-refresh/only-export-components */
import { createContext, use, useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import type { Language } from '../types';
import en from '../i18n/en.json';
import ko from '../i18n/ko.json';

type Translations = Record<string, string>;

const translations: Record<Language, Translations> = { en, ko };

const UI_LANG_STORAGE_KEY = 'lingual.uiLanguage';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  initialLang?: Language;
}) {
  const [lang, setLangState] = useState<Language>(initialLang ?? 'en');

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(UI_LANG_STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const t = useCallback((key: string): string => {
    return translations[lang][key] || translations.en[key] || key;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = use(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/contexts/LanguageContext.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/LanguageContext.tsx frontend/src/contexts/LanguageContext.test.tsx
git commit -m "feat(lingual-korea): LanguageProvider seeds from URL, persists choice, syncs <html lang>"
```

---

### Task 3: Wire dynamic `basename` + seed language in `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx:294-311` (the `App()` function)

**Interfaces:**
- Consumes: `detectLocale` (Task 1), `LanguageProvider initialLang` (Task 2).

- [ ] **Step 1: Modify `App()`**

Add the import near the top of `App.tsx`:

```tsx
import { detectLocale } from './lib/localeRouting';
```

Replace the body of `App()` (lines 294-311) so `basename` includes the locale prefix and `LanguageProvider` is seeded:

```tsx
function App() {
  const existingBase = import.meta.env.BASE_URL.replace(/\/$/, '') || '';
  const { localePrefix, lang } = detectLocale(window.location.pathname, existingBase);
  const basename = `${existingBase}${localePrefix}`;

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter basename={basename}>
          <AuthProvider>
            <MembershipProvider>
              <LanguageProvider initialLang={lang}>
                <LearningLocaleProvider>
                  <AnimatedRoutes />
                </LearningLocaleProvider>
              </LanguageProvider>
            </MembershipProvider>
          </AuthProvider>
        </BrowserRouter>
      </MotionConfig>
    </LazyMotion>
  );
}
```

> Copy the existing `LazyMotion`/`MotionConfig` wrapper exactly as it is in the current `App()` (lines 294-300) — only `basename` and the `LanguageProvider initialLang` are new. Verify the surrounding JSX against the current file before editing.

- [ ] **Step 2: Build + smoke check**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes (type-clean), Vite build succeeds.

- [ ] **Step 3: Run the full frontend suite (regression)**

Run: `cd frontend && npm run test -- --run`
Expected: PASS — existing routing tests unaffected (basename is `''` for non-`/ko` paths).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(lingual-korea): dynamic /ko basename + URL-seeded UI language"
```

---

### Task 4: `LanguageToggle` navigates (and persists) instead of in-place switch

**Files:**
- Modify: `frontend/src/components/common/LanguageToggle.tsx`
- Test: `frontend/src/components/common/LanguageToggle.test.tsx` (new)

**Interfaces:**
- Consumes: `buildLocalePath` (Task 1), `useLanguage` (Task 2).

**Why:** with dynamic `basename`, `lang` is fixed by the URL for the page's lifetime; an in-place `setLang` would desync URL and content. The toggle must navigate to the locale-rebuilt URL (a hard navigation cleanly re-seeds `basename`).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/common/LanguageToggle.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../contexts/LanguageContext';
import { LanguageToggle } from './LanguageToggle';

describe('LanguageToggle', () => {
  beforeEach(() => localStorage.clear());

  it('navigates to the /ko path when switching to KO', () => {
    const assign = vi.fn();
    // jsdom: stub the navigation sink the toggle uses.
    vi.stubGlobal('location', { pathname: '/app/teacher', assign } as unknown as Location);
    render(<LanguageProvider initialLang="en"><LanguageToggle /></LanguageProvider>);
    screen.getByText('KO').click();
    expect(assign).toHaveBeenCalledWith('/ko/app/teacher');
    expect(localStorage.getItem('lingual.uiLanguage')).toBe('ko');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/common/LanguageToggle.test.tsx`
Expected: FAIL — toggle calls `setLang` only, no navigation.

- [ ] **Step 3: Rewrite `LanguageToggle.tsx`**

```tsx
import { m } from 'framer-motion';
import { useLanguage } from '../../contexts/LanguageContext';
import { buildLocalePath } from '@/lib/localeRouting';
import { cn } from '@/lib/utils';
import type { Language } from '../../types';

interface LanguageToggleProps {
  className?: string;
}

const languages: { value: Language; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'ko', label: 'KO' },
];

export function LanguageToggle({ className = '' }: LanguageToggleProps) {
  const { lang, setLang } = useLanguage();

  const switchTo = (value: Language) => {
    if (value === lang) return;
    setLang(value); // persists to localStorage
    const base = import.meta.env.BASE_URL.replace(/\/$/, '') || '';
    const target = buildLocalePath(window.location.pathname, value, base);
    window.location.assign(target); // hard nav re-seeds basename + providers
  };

  return (
    <div className={cn('flex gap-1 bg-muted p-1 rounded-lg relative', className)}>
      {languages.map(({ value, label }) => (
        <button type="button"
          key={value}
          onClick={() => switchTo(value)}
          className={cn(
            'px-3 py-1 rounded-md text-sm font-medium transition-colors relative z-10',
            lang === value ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {lang === value && (
            <m.div
              layoutId="language-indicator"
              className="absolute inset-0 bg-card rounded-md shadow-sm"
              style={{ zIndex: -1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/components/common/LanguageToggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/common/LanguageToggle.tsx frontend/src/components/common/LanguageToggle.test.tsx
git commit -m "feat(lingual-korea): LanguageToggle navigates to /ko path + persists"
```

---

### Task 5 (optional): Honor a saved Korean preference at the bare root

**Files:**
- Modify: `frontend/src/App.tsx` (or a tiny `LocaleBootstrap` effect)
- Test: extend `localeRouting.test.ts` with a `shouldRedirectToSaved` helper

**Scope note:** This is the ONE place persistence could trigger a redirect. It fires **only** at the exact root path and **only** from an explicit prior toggle choice in `localStorage` — never from `navigator.language`/geo (honoring the "no surprise geo-redirect" constraint). Drop this task if you'd rather keep redirects out entirely; the `/ko` bookmark already gives returning Korean users a durable entry point.

- [ ] **Step 1: Add a pure decision helper to `localeRouting.ts`**

```ts
/** Only the exact root, only an explicit saved 'ko' choice → redirect target, else null. */
export function savedRootRedirect(
  pathname: string,
  base: string,
  saved: string | null,
): string | null {
  const rest = pathname === base || pathname === `${base}/` ? '/' : pathname.slice(base.length);
  if (rest === '/' && saved === 'ko') return `${base}/ko`;
  return null;
}
```

- [ ] **Step 2: Test it**

```ts
it('redirects bare root to /ko when saved=ko', () => {
  expect(savedRootRedirect('/', '', 'ko')).toBe('/ko');
});
it('does not redirect deep links', () => {
  expect(savedRootRedirect('/login', '', 'ko')).toBeNull();
});
it('does not redirect without a saved choice', () => {
  expect(savedRootRedirect('/', '', null)).toBeNull();
});
```

- [ ] **Step 3: Apply once at App mount (before Router renders)**

```tsx
const saved = (() => { try { return localStorage.getItem('lingual.uiLanguage'); } catch { return null; } })();
const redirect = savedRootRedirect(window.location.pathname, existingBase, saved);
if (redirect && redirect !== window.location.pathname) {
  window.location.replace(redirect);
}
```

- [ ] **Step 4: Run tests + commit**

Run: `cd frontend && npm run test -- --run src/lib/localeRouting.test.ts`

```bash
git add frontend/src/lib/localeRouting.ts frontend/src/lib/localeRouting.test.ts frontend/src/App.tsx
git commit -m "feat(lingual-korea): honor saved Korean preference at the bare root (explicit choice only)"
```

---

## Self-Review

- **Spec coverage (§4):** §4.1 init precedence (URL authoritative; localStorage persistence; no geo-redirect) → Tasks 2,3,5. §4.2 (no route duplication; `<html lang>`) → Tasks 2,3 (basename approach supersedes the link-helper). §4.3 persistence → Task 2 (localStorage) + optional profile persistence noted below. §4.4 router shape (no duplication) → Task 3. ✅
- **Placeholder scan:** all components shown in full; Task 3 instructs verifying the `LazyMotion` wrapper against the live file (grounded, not a placeholder). ✅
- **Type consistency:** `detectLocale`/`buildLocalePath`/`savedRootRedirect` signatures match across tasks; `Language` = `'en' | 'ko'` (`types/index.ts:261`). ✅

## Deferred / notes

- **Profile persistence of `ui_language`** (cross-device): not required for correctness — the backend already receives `uiLanguage` per request from the current `lang`, and the `/ko` URL is the durable artifact. If wanted, add a `ui_language` field to the profile-update endpoint and PATCH it from `setLang` (small follow-up; not blocking).
- **Depends on / unlocks:** independent of L3, but once both land, a Korean user at `/ko` sends `uiLanguage='ko'`, which L3 turns into Korean tutor scaffolding.
- After all tasks: `make test-frontend`; manual smoke at `/ko/login` and `/login` (test accounts in root `CLAUDE.md`). Run `doc-sync` to fix the stale `base:'/app/'` note in `frontend/CLAUDE.md` and document the `/ko` routing model.
