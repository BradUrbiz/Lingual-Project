Original prompt: "read and understand our app's purpose (both PRD and AGENTS.md and codebase) to brainstorm and plan for making more games on game page"

## 2026-02-06 - Implementation kickoff
- Confirmed direction with user:
  1) no chat-driven games
  2) minigame results visible in /app/progress
  3) implement Listening Quiz + Grammar Challenge
- Starting TDD with failing tests for curriculum-based content generators.

## 2026-02-06 - TDD cycle 1 complete
- Added failing tests for new curriculum-based minigame content module (`frontend/src/lib/minigameContent.test.ts`).
- Verified RED state: import resolution failed because module did not exist.
- Implemented `frontend/src/lib/minigameContent.ts` with:
  - listening quiz question builder
  - grammar challenge question builder
- Verified GREEN state: tests now pass (`npm run test -- src/lib/minigameContent.test.ts`).

## 2026-02-06 - Implementation complete
- Added backend minigame persistence and reporting:
  - `POST /api/minigames/attempts`
  - `GET /api/minigames/summary`
  - Firestore helpers in `database.py` for attempts + aggregates.
- Replaced `/app/games` flow with objective/scenario-driven games (no chat/session dependency).
- Added new game components:
  - `ListeningQuiz`
  - `GrammarChallenge`
- Added minigame content generator module + tests.
- Wired result persistence to backend and progress visibility in `/app/progress`.
- Updated EN/KO localization keys for new games/progress labels.

## Verification run
- `npm run lint` (frontend): pass
- `npm run test` (frontend): pass
- `python3 -m py_compile main.py database.py`: pass
- `npm run build` (frontend): fails due pre-existing TypeScript issues in pronunciation files unrelated to this change set.

## TODO / next iteration
- Replace static curriculum source with backend-delivered curriculum per locale.
- Expand grammar challenge generator beyond particle-based items.
- Add dedicated tests for minigame API clients and `/app/progress` rendering with minigame data.

## 2026-02-06 - Build blocker fix (pronunciation)
- Fixed TypeScript build errors in pronunciation modules:
  - `usePronunciationPractice.ts`: replaced impossible `LearningLocale === 'en-US'` comparison with string-safe check.
  - `PronunciationPracticePage.tsx`: widened objective stats accumulator arrays to include optional score values.
  - `PronunciationPracticePage.tsx`: removed unsupported `t(key, params)` call and replaced with placeholder string substitution.
- Verification:
  - `npm run build` (frontend): pass
  - `npm run lint` (frontend): pass

## 2026-02-07 - Restored chat-based games on /app/games
- Added regression test `frontend/src/pages/AppGamesPage.test.tsx` to ensure `/app/games` includes both game families.
- Restored chat-based game section in `AppGamesPage`:
  - loads chat sessions with messages
  - allows chat selection
  - launches existing `FlashcardFlip` and `WordMatch`
- Kept curriculum-driven `Listening Quiz` and `Grammar Challenge` intact.
- Added EN/KO i18n keys for chat-based section labels/errors.

## Verification
- `npm run lint` (frontend): pass
- `npm run test` (frontend): pass
- `npm run build` (frontend): pass (warnings only: CSS @import order, large bundle chunk)

---

## 2026-03-05 - /app/chat 레이아웃 대폭 개선

### 문제
채팅 페이지의 여백이 과도하게 많아 화면 공간을 비효율적으로 사용하고 있었음. 글자 크기를 줄인 후 여백이 더 눈에 띄게 됨.

### 변경 사항

#### 1. 여백/패딩 최적화 (AppChatPage + AppLayout)
- **AppLayout 전역**: `max-w-7xl` (1280px) -> `max-w-screen-2xl` (1536px), `px-8` -> `px-6`
- **AppLayout 수직**: `py-8` -> `py-6`
- **채팅 메시지 영역**: `p-6` -> `p-4`
- **메시지 간 간격**: `space-y-6` -> `space-y-3`
- **플로팅 인풋 하단 여백**: `pb-32` -> `pb-20`, `p-6` -> `p-4`
- **메시지 컨테이너**: `max-w-3xl mx-auto` 제거 (개별 버블에 `max-w-[85%]`로 충분)
- **음수 마진**: `-mx-2 sm:-mx-3 lg:-mx-3`으로 부모 패딩 부분 상쇄

#### 2. 사이드바 오버레이 전환
- **Before**: 사이드바 확장 시 다른 컴포넌트를 밀어내는 방식 (`transition-[width]`)
- **After**: 아이콘 바(`w-14`)는 레이아웃 고정, 확장 패널은 `absolute` + `z-30`으로 오버레이
- 투명 백드롭 클릭으로 사이드바 닫기 지원

#### 3. LearningPathCard 통합
- 사이드바에서 LearningPathCard 위젯 제거 (데스크톱 + 모바일 다이얼로그)
- 해당 정보(레벨, 포커스 영역, 도메인 점수)는 이미 채팅 헤더 뱃지에 표시됨
- 채팅 헤더에 `levelDescription` 한 줄 추가 (`line-clamp-1`)

#### 4. 버추얼 아바타 공간 (5:3 분할)
- 메인 채팅 영역을 **아바타(flex-[5])** + **채팅(flex-[3])** 으로 분할
- 아바타 패널: placeholder UI (추후 3D/2D 아바타 연동)
- 아바타 on/off 토글 버튼 (`MonitorPlay` 아이콘) 추가
  - ON: 5:3 비율, 아바타 패널 표시
  - OFF: 채팅이 `flex-1`로 전체 너비 차지
- 데스크톱에서만 표시 (`hidden lg:inline-flex`)

### 수정된 파일
- `frontend/src/pages/AppChatPage.tsx` - 레이아웃, 사이드바 오버레이, 아바타 분할
- `frontend/src/components/layout/AppLayout.tsx` - max-width, padding 조정
- `frontend/src/components/learning/LearningPathCard.tsx` - overflow-hidden 추가

### 검증
- TypeScript 컴파일: pass (`tsc --noEmit`)

### TODO
- 아바타 패널에 실제 3D/2D 버추얼 아바타 연동
- 아바타 on/off 상태 localStorage 저장 (세션 유지)
- 모바일 레이아웃에서 아바타 패널 처리 (현재 `hidden lg:flex`)
