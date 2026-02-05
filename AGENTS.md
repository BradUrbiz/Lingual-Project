# AGENTS.md

## Project overview
Lingual is an AI-powered platform for learning colloquial/spoken language through a diagnostic assessment and curriculum-driven conversation practice.

- **Mission:** Become the standard for spoken/colloquial language learning
- **Current (v1):** Korean (SKLC-aligned), web app, B2C
- **Roadmap (v2+):** B2B-first (schools/institutes) with multi-tenancy + roles (Student/Teacher/Admin) and multi-language expansion (Spanish/French/Russian)

**Key principle:** Curriculum is the backbone of learning — sessions and feedback should trace back to curriculum objectives. Teachers can upload custom curricula or use Lingual’s standard curricula.

## Repository layout
- Backend
  - `main.py`: Flask app + API routes; serves the built React app from `static/react` in production.
  - `database.py`: Firestore CRUD helpers and user/chat schema.
  - `scoring.py`: assessment scoring and proficiency/level mapping.
  - `data/assessment_v1.json`: assessment content + scoring configuration.
- Frontend (`frontend/`)
  - React 19 + TypeScript + Vite + React Router v7
  - UI: Radix UI + Tailwind CSS 4 + Framer Motion
  - Pages: `frontend/src/pages`
  - API client: `frontend/src/api` (calls backend under `/api`)
  - Auth/UI language contexts: `frontend/src/contexts`
  - Key hooks: `frontend/src/hooks/useRealtimeChat.ts`, `frontend/src/hooks/useVoiceRecorder.ts`
  - Firebase client config: `frontend/src/config/firebase.ts`
- Infra / other
  - `static/`: static assets; `static/react` is the built frontend output (do not edit by hand).
  - `functions/`: serverless functions (Python) used by the Firebase/GCP deployment.
  - `dataconnect/`: Firebase Data Connect config/schema (optional/experimental).
  - `docs/`: internal documentation.
  - `templates/`: legacy Flask templates (not used by the React SPA).

## Dev commands
Backend (from repo root):
- Install: `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
- Run (for Vite proxy): `PORT=5001 FLASK_ENV=development python main.py` (defaults to `PORT=5000` if unset)

Frontend (from `frontend/`):
- Install: `npm install`
- Dev server: `npm run dev` (Vite on `localhost:5173`, proxies `/api/*` to `http://localhost:5001`)
- Build: `npm run build` (Docker copies `frontend/dist` to `static/react`)
- Lint: `npm run lint`
- Test: `npm run test` (Vitest; may be empty depending on current coverage)

Docker (from repo root):
- Build: `docker build -t lingual .`
- Run: `docker run -p 8080:8080 lingual`

## Environment variables
- `OPENAI_API_KEY`: required for OpenAI-backed endpoints (including Realtime session creation).
- `SECRET_KEY`: Flask session signing key.
- `GOOGLE_APPLICATION_CREDENTIALS`: service account JSON for Firebase Admin SDK (or use ADC).
- `GOOGLE_CLOUD_PROJECT`: Firebase/Firestore project id (defaults to `lingu-480600`).
- `PORT`: backend port (defaults to `5000`; set to `5001` to match the Vite proxy for local dev).
- `FLASK_ENV`: set to `development` for debug.

## Implementation notes
- Assessment logic: edit `data/assessment_v1.json` for items/banding; add new scoring methods in `scoring.py` and register them in `SCORING_METHODS`.
- API base: frontend uses `/api` via `frontend/src/api/index.ts`; keep backend routes under `/api`.
- Auth flow: Firebase ID token → `POST /api/auth/verify` → server verifies token, creates session, and upserts Firestore user data.
- Realtime flow: `POST /api/realtime/session` → server creates OpenAI Realtime session (ephemeral credentials) → frontend connects via `useRealtimeChat`.
- SPA serving: Flask serves `static/react` if built; do not edit `static/react` by hand.
- Firebase client config lives in `frontend/src/config/firebase.ts`.
- Architecture principles (from PRD): keep the learning core language-agnostic, curriculum-driven, and multi-tenancy ready for B2B.
