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

## Conventions

- **Do not edit `static/react/`** — it is the frontend build output (`npm run build` regenerates it).
- `frontend/src/dataconnect-generated/` is generated (Firebase Data Connect) — do not hand-edit.
