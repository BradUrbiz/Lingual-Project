# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lingual is an AI-powered Korean language learning coach with real-time conversation practice. Users take a diagnostic assessment to determine their proficiency level (mapped to SKLC levels 0-5), then practice speaking with an AI tutor through personalized scenarios.

## Development Commands

### Backend (Flask)
```bash
pip install -r requirements.txt
python main.py  # Runs on localhost:5001
```

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev      # Dev server on localhost:5173
npm run build    # TypeScript compile + Vite build
npm run lint     # ESLint
npm run preview  # Preview production build
```

### Docker
```bash
docker build -t lingual .
docker run -p 8080:8080 lingual
```

## Architecture

### Backend (`main.py`, `database.py`, `scoring.py`)
- **Flask** serves API endpoints and static frontend in production
- **Firestore** stores users, profiles, assessment data, and chat history
- **OpenAI GPT-4o Realtime API** powers live conversation with ephemeral token auth
- Authentication via Firebase ID tokens verified server-side

### Frontend (`frontend/src/`)
- **React 19 + TypeScript + Vite** with React Router v7
- **Contexts**: `AuthContext` (Firebase user, session), `LanguageContext` (en/ko UI)
- **UI**: Radix UI primitives + Tailwind CSS 4 + Framer Motion
- **Key hooks**: `useRealtimeChat` (OpenAI streaming), `useVoiceRecorder` (audio capture)

### Data Flow
1. Firebase Auth issues ID token → `/api/auth/verify` creates session + Firestore user
2. Protected routes check `AuthContext` before rendering
3. Chat uses OpenAI Realtime API with ephemeral tokens from `/api/realtime/session`
4. Vite dev server proxies `/api/*` to Flask backend

### Firestore Schema
```
users/{uid}/
  ├── profile/     (display_name, age, rigor, frequency, ui_language)
  ├── assessment/  (responses, current_item_index, completed)
  ├── results/     (global_stage, domain_bands, domain_raw_scores)
  └── chats/{id}/  (title, messages[], timestamps)
```

## Key Files

### Backend

- `main.py` - Flask app with all API routes (~1150 lines)
- `database.py` - Firestore CRUD operations
- `scoring.py` - Assessment scoring (MCQ, heuristic text, domain aggregation)
- `data/assessment_v1.json` - Assessment questions and scoring config

### Frontend Core

- `frontend/src/App.tsx` - Router and protected route setup
- `frontend/src/hooks/useRealtimeChat.ts` - OpenAI Realtime WebSocket handling

### Pages

- `LandingPage.tsx` - 마케팅 랜딩 페이지
- `AuthPage.tsx` - 로그인/회원가입
- `AssessmentPage.tsx` - 진단 평가
- `ChatPage.tsx` - AI 튜터 대화
- `ProfilePage.tsx` - 사용자 프로필
- `AppLearningPage.tsx` - 학습 메인 (플래시카드, 미니게임)
- `AppProfilePage.tsx` - 앱 내 프로필
- `AppSettingsPage.tsx` - 설정
- `TeacherDashboardPage.tsx` - 교사용 대시보드

### Minigames

- `FlashcardFlip.tsx` - 플래시카드 뒤집기 게임
- `WordMatch.tsx` - 단어 매칭 게임

### Documentation

- `docs/claude-plugins-guide.md` - Claude Code 플러그인 가이드

## Environment Variables

Required in `.env`:
- `OPENAI_API_KEY` - For GPT-4o Realtime API
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Firebase service account JSON
- `GOOGLE_CLOUD_PROJECT` - Firebase project ID
- `SECRET_KEY` - Flask session secret
