# AGENTS.md

## Project overview
Lingual is a web app for Korean speaking assessment and AI-guided practice. The backend is a Flask API that serves a React SPA and talks to Firebase/Firestore and OpenAI. The frontend is React 19 + TypeScript + Vite + Tailwind.

## Repository layout
- `main.py`: Flask app, API routes, and SPA/static serving.
- `scoring.py`: assessment scoring heuristics and SKLC level mapping.
- `data/assessment_v1.json`: assessment content, scoring rules, and aggregation bands.
- `database.py`: Firestore access helpers and user schema.
- `frontend/`: React app (pages in `frontend/src/pages`, API client in `frontend/src/api`, auth in `frontend/src/contexts`).
- `static/react`: built frontend output consumed by Flask.
- `templates/`: legacy Flask templates (not used by the React SPA).

## Dev commands
Backend (from repo root):
- Install: `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
- Run (for Vite proxy): `PORT=5001 FLASK_ENV=development python main.py`

Frontend (from `frontend/`):
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build` (Docker copies `frontend/dist` to `static/react`)

No automated tests were found in this repo.

## Environment variables
- `OPENAI_API_KEY`: required for chat/realtime/flashcard endpoints.
- `SECRET_KEY`: Flask session signing key.
- `GOOGLE_APPLICATION_CREDENTIALS`: service account JSON for Firebase Admin SDK (or use ADC).
- `GOOGLE_CLOUD_PROJECT`: Firebase/Firestore project id (defaults to `lingu-480600`).
- `PORT`: backend port (defaults 5000; set to 5001 to match Vite proxy).
- `FLASK_ENV`: set to `development` for debug.

## Implementation notes
- Assessment logic: edit `data/assessment_v1.json` for items/banding; add new scoring methods in `scoring.py` and register them in `SCORING_METHODS`.
- API base: frontend uses `/api` via `frontend/src/api/index.ts`; keep backend routes under `/api`.
- SPA serving: Flask serves `static/react` if built; do not edit `static/react` by hand.
- Firebase client config lives in `frontend/src/config/firebase.ts`.
