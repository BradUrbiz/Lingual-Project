# CLAUDE.md — Frontend (React 19 + TypeScript + Vite)

Local conventions for the React SPA. The root `CLAUDE.md` carries product context and repo-wide conventions — both load together.

## Commands

```bash
cd frontend
npm install
npm run dev       # Vite on localhost:5173, proxies /api/* to :5001
npm run build     # tsc -b && vite build → outputs to frontend/dist (Docker copies to static/react)
npm run lint
npm run test      # Vitest
```

Single test file: `npm run test -- --run src/pages/TeacherAssignmentBuilderPage.test.tsx`. From the repo root: `make test-frontend`.

## Stack

React 19, React Router v7, Radix UI primitives, Tailwind CSS 4 (`@tailwindcss/vite`), Framer Motion + `motion`, Recharts, Sonner, axios, Firebase JS SDK. Avatar: `pixi-live2d-display` + Cubism SDK for Live2D and `@pixiv/three-vrm` + three.js for VRM. Speech: `microsoft-cognitiveservices-speech-sdk`.

## Context stack

Outermost → innermost, in `App.tsx`:
`AuthProvider` → `MembershipProvider` → `LanguageProvider` (en/ko UI) → `LearningLocaleProvider` (target language per session).

## Routing

`App.tsx` uses React Router v7 with `React.lazy()` per page. Protection layers:
- `ProtectedRoute` — signed-in users
- `AppProtectedRoute` — users inside the `/app` shell
- `TeacherRoute` — membership role must be teacher or admin
- `LingualAdminRoute` — Lingual-side superadmin

Production build uses `base: '/'` in Vite. `basename` in `App.tsx` is computed dynamically from the URL: `detectLocale(window.location.pathname, BASE_URL)` appends `/ko` when the path is locale-prefixed, so `/ko/…` URLs render the Korean UI with no route duplication (React Router prepends `basename` to every link). See `src/lib/localeRouting.ts`.

## Layout (`frontend/src/`)

- `api/` — typed API client modules per backend blueprint (`teacher.ts`, `assignments.ts`, `canvas.ts`, `guardian.ts`, `lti.ts`, `admin.ts`, etc.). All go through `api/index.ts`'s shared axios instance.
- `types/` — DTOs matching backend contracts (`assignment.ts`, `school.ts`, `canvas.ts`, `avatarChat.ts`).
- `pages/` — one file per route; lazy-loaded.
- `hooks/` — `useRealtimeChat`, `useAvatarChatSession`, `useVoiceRecorder`, `usePronunciationPractice`, `realtimeAvatar`, `realtimeSpeechGate`.
- `contexts/`, `components/`, `lib/`, `i18n/`.

## Key files

- `frontend/src/App.tsx` — router, providers, route guards
- `frontend/src/contexts/MembershipContext.tsx` — active org, role, classes
- `frontend/src/pages/TeacherDashboardPage.tsx`, `TeacherAssignmentBuilderPage.tsx`, `TeacherAssignmentAnalyticsPage.tsx`, `TeacherClassAnalyticsPage.tsx`, `TeacherClassCompliancePage.tsx`, `TeacherStudentDrillDownPage.tsx`
- `frontend/src/pages/AppLearningPage.tsx`, `AssignmentLaunchPage.tsx`, `AppChatPage.tsx`, `PronunciationPracticePage.tsx`
- `frontend/src/pages/CanvasConnectPage.tsx`, `LtiLinkAccountPage.tsx`, `LtiAssignmentPickerPage.tsx`
- `frontend/src/pages/AdminCompliancePage.tsx`, `AdminDeletionRequestsPage.tsx`, `LingualSchoolRequestsPage.tsx`
- `frontend/src/hooks/useRealtimeChat.ts`, `useAvatarChatSession.ts`

## Internationalization (i18n)

UI strings render through `useLanguage().t(key)` (`contexts/LanguageContext.tsx`) over `i18n/en.json` (source) + `i18n/ko.json` (Korean), fallback `ko → en → key`. UI language is driven by the `/ko` URL prefix (see Routing) — separate from the *learning target* (`LearningLocaleContext`).

- **Parity is enforced by a test.** `i18n/i18n.parity.test.ts` fails if `en.json`/`ko.json` key sets diverge, or if a statically-referenced `t('literal')` key is missing from `en.json`. Every new key goes in BOTH files. Run it after any string change.
- **Namespaces** (dotted keys): `auth.*` / `landing.*` (consumer, 해요체), `teacher.*` / `admin.*` / `integrations.*` (professional, 합쇼체/존댓말), `compliance.*` / `guardian.*` (legal — counsel-review pending, see LIMITATIONS (ss)). Reuse an existing exact-English key before adding one.
- **Adding a string:** wire it to `t('namespace.key')`, add en→ko pair, keep parity green. No hardcoded user-visible English in pages/components. Interpolation uses `t('key').replace('{token}', value)` — don't introduce a second convention.
- **Scope:** the full customer surface is Korean-capable. `pages/LingualAdmin/*` (internal staff) is intentionally English-only (LIMITATIONS (tt)). Translation dictionaries are not code-split yet (LIMITATIONS (uu)).

## Conventions

- **Do not edit `static/react/`** — it is the frontend build output (`npm run build` regenerates it).
- `frontend/src/dataconnect-generated/` is generated (Firebase Data Connect) — do not hand-edit.
