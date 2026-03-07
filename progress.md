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

---

## 2026-03-07 - `/app/chat` Realtime + Official Live2D handoff

### Current architecture
- `/app/chat` voice mode is back on the original low-latency browser-direct OpenAI Realtime path.
- The active transport is:
  1. `POST /api/realtime/session`
  2. browser WebRTC connection to OpenAI Realtime
  3. client-side event parsing in `frontend/src/hooks/useRealtimeChat.ts`
  4. client-side avatar planning/rendering
- `/api/avatar-chat/*` websocket orchestration still exists in the repo, but `/app/chat` is not using it now.
- Live2D rendering is no longer Pixi-based. It now uses the official Cubism Web SDK path with:
  - `frontend/src/components/avatar/OfficialCubismModel.ts`
  - `frontend/src/components/avatar/cubismRuntime.ts`
  - `frontend/src/components/avatar/Live2DAvatarPanel.tsx`

### What was implemented
- Added explicit avatar directive channel on the Realtime path.
  - Backend session tool config lives in `backend/routes/chat.py`.
  - Tool name: `emit_avatar_directive`
  - Backend also now exposes `POST /api/realtime/avatar-context` for backend-aware `avatar.hit` context injection.
- Added shared avatar directive types in `frontend/src/components/avatar/types.ts`.
  - `AvatarDirective`
  - `AvatarExpressionId`
  - `AvatarMotionRef`
  - `AvatarReactionIntent`
  - `AvatarDiagnostics`
- Extended `useRealtimeChat()` to:
  - parse Realtime function-call events
  - apply avatar directives locally
  - acknowledge function calls with `function_call_output`
  - queue `avatar.hit` context back into the Realtime conversation
  - return `avatarDirective`, `avatarDirectiveSource`, `avatarDiagnostics`, `queueAvatarHit`
- Switched Live2D expression/motion selection from raw first-match lists to symbolic banks.
  - Manifest banks live in `frontend/src/components/avatar/live2dManifest.ts`
  - Selection logic lives in `frontend/src/components/avatar/live2dSelection.ts`
  - Mapping logic lives in `frontend/src/components/avatar/live2dMapping.ts`
- Added renderer-side debug for mouth diagnosis.
  - Target `ParamA/I/U/E/O`
  - Actual `ParamA/I/U/E/O` readback from Cubism model
  - directive source
  - last explicit directive
  - RMS/audio-level state

### Important current file map
- Backend
  - `backend/routes/chat.py`
  - `backend/tests/test_realtime_chat.py`
- Realtime client
  - `frontend/src/hooks/useRealtimeChat.ts`
  - `frontend/src/hooks/realtimeAvatar.ts`
  - `frontend/src/hooks/realtimeAvatar.test.ts`
- Avatar planner/types
  - `frontend/src/components/avatar/types.ts`
  - `frontend/src/components/avatar/performance.ts`
  - `frontend/src/components/avatar/useAvatarPerformance.ts`
- Live2D runtime
  - `frontend/src/components/avatar/live2dManifest.ts`
  - `frontend/src/components/avatar/live2dMapping.ts`
  - `frontend/src/components/avatar/live2dSelection.ts`
  - `frontend/src/components/avatar/OfficialCubismModel.ts`
  - `frontend/src/components/avatar/Live2DAvatarPanel.tsx`
- `/app/chat` wiring
  - `frontend/src/pages/AppChatPage.tsx`
  - `frontend/src/pages/AppChatPage.avatar.test.tsx`

### Current model/assets state
- Cubism Core is loaded from:
  - `frontend/public/live2d/core/live2dcubismcore.min.js`
- Active Live2D model is Mao:
  - `frontend/public/avatars/live2d/mao-pro-en/mao_pro.model3.json`
- Current manifest assumes Mao-specific params such as:
  - `ParamA/I/U/E/O`
  - `ParamMouthUp`
  - `ParamMouthDown`
  - `ParamMouthAngry`

### Most important known risk
- Realtime voice likely regressed when avatar function-calling was introduced.
- Suspected direct cause:
  - after `emit_avatar_directive`, the client acknowledged the function call but did not continue the response
  - this could leave the assistant silent even though the Realtime connection itself was alive
- A fix was added in `frontend/src/hooks/useRealtimeChat.ts` so `completeDirectiveToolCall()` now sends `response.create()` after `function_call_output`.
- This fix is linted/tested/built, but browser smoke validation has not yet been confirmed in this thread after the patch.

### 2026-03-07 follow-up fix
- The initial continuation fix was still too eager for the Realtime event order.
- Root cause found in `frontend/src/hooks/useRealtimeChat.ts`:
  - `emit_avatar_directive` completion could be processed twice (`response.function_call_arguments.done` and `response.output_item.done`)
  - `response.create()` could be sent before the current response had fully closed
- Why this matters:
  - OpenAI Realtime allows only one response writing to the default conversation at a time
  - so a premature continuation can race the still-open tool-call response and starve or error the spoken reply path
- The fix now does two things:
  - dedupe directive-tool completion by `call_id`
  - defer continuation until `response.done`, then send a single follow-up `response.create()`
- Added regression coverage:
  - `frontend/src/hooks/useRealtimeChat.test.tsx`
- Validation completed for this follow-up:
  - `cd frontend && npm run test -- --run src/hooks/useRealtimeChat.test.tsx src/hooks/realtimeAvatar.test.ts`
  - `cd frontend && npx eslint src/hooks/useRealtimeChat.ts src/hooks/useRealtimeChat.test.tsx`
  - `cd frontend && npm run build`

### 2026-03-07 recovery change
- Browser-side continuation race was fixed, but live failure still persisted according to manual app use.
- A safer recovery path is now in place on the backend:
  - Realtime avatar directive tools are disabled by default
  - `emit_avatar_directive` is only attached when `ENABLE_REALTIME_AVATAR_DIRECTIVES=true`
  - this restores the simpler browser-direct OpenAI Realtime path for `/app/chat` unless the directive path is explicitly re-enabled
- Supporting environment fix:
  - added `from __future__ import annotations` to `backend/route_deps.py`
  - this avoids import-time crashes when an older local virtualenv is still on Python 3.9
- Validation completed for this recovery change:
  - `source .venv/bin/activate && python -m unittest backend.tests.test_realtime_chat`
  - live `POST /api/realtime/session` check returned `200` with `client_secret`

### 2026-03-07 live diagnosis
- Text chat `POST /api/chats/<chat_id>/messages` was failing because the configured OpenAI project/key is currently over quota.
- Direct live OpenAI calls returned `429 insufficient_quota`.
- This likely explains the current user-visible state:
  - text chat returns backend `500`/failure unless quota errors are handled explicitly
  - Realtime session creation can still succeed, but actual model inference may still fail once a response is generated
- Backend text chat route now surfaces quota exhaustion as `429` with an explicit billing/quota message instead of a generic `500`.

### Mouth-animation status
- Mouth diagnostics are now available in the Live2D debug overlay.
- Interpretation rule:
  - if `RMS` and `Mouth target` move but `Actual ParamA` stays flat, it is a renderer/apply issue
  - if `Actual ParamA` changes but the face still looks still, it is a model parameter-range/asset issue
  - if `RMS` stays flat while speaking events fire, it is an audio feed/analysis issue
- This diagnostic path is implemented, but still needs live browser observation during an actual assistant turn.

### Validation completed
- `python3 -m unittest backend.tests.test_realtime_chat backend.tests.test_avatar_chat`
- `python3 -m py_compile backend/routes/chat.py`
- `cd frontend && npm run lint`
- `cd frontend && npm run test -- --run src/hooks/realtimeAvatar.test.ts src/components/avatar/performance.test.ts src/components/avatar/live2dAdapter.test.ts src/components/avatar/live2dMapping.test.ts src/components/avatar/live2dSelection.test.ts src/pages/AppChatPage.avatar.test.tsx`
- `cd frontend && npm run build`
- Build still has only the existing large-chunk warning.

### Immediate next-session checklist
1. Hard-reload `/app/chat` and verify Realtime voice actually speaks again after the `response.create()` continuation fix.
2. With Debug enabled, watch:
   - `Directive source`
   - `Last directive`
   - `Mouth target`
   - `Actual A/I/U/E/O`
3. If voice is still silent:
   - inspect Realtime data-channel events after `response.function_call_arguments.done`
   - confirm assistant audio delta events resume after `function_call_output`
4. If voice works but expression richness still feels weak:
   - tune bank weights/cooldowns in `live2dManifest.ts`
   - verify the model is actually emitting `emit_avatar_directive` calls frequently enough
5. If taps do not feel contextual enough:
   - inspect payloads from `POST /api/realtime/avatar-context`
   - verify queued context is injected on a safe turn and not starved by current response state

### Short summary
- Transport direction is correct again: `/app/chat` uses OpenAI Realtime, not server-orchestrated avatar websocket.
- Renderer direction is correct: official Cubism SDK, not Pixi workaround.
- Expression richness groundwork is in place: explicit directives, symbolic banks, weighted rotation, backend-aware hit context.
- The single most important unresolved question for the next session is live browser confirmation that Realtime audio still flows correctly with the new directive tool path.
