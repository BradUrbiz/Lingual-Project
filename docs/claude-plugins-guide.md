# Claude Code 플러그인 가이드

이 문서는 활성화된 Claude Code 플러그인들의 기능과 사용법을 정리합니다.

---

## 1. agent-sdk-dev

Claude Agent SDK 애플리케이션 개발을 지원하는 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `new-sdk-app` | `/agent-sdk-dev:new-sdk-app` | 새 Claude Agent SDK 앱 생성 및 설정 |
| `agent-sdk-verifier-ts` | 자동 호출 | TypeScript SDK 앱 검증 (설정, 모범 사례, 배포 준비) |
| `agent-sdk-verifier-py` | 자동 호출 | Python SDK 앱 검증 |

### 사용 예시

```bash
# 새 Agent SDK 앱 생성
/agent-sdk-dev:new-sdk-app

# TypeScript 앱 작성 후 자동으로 verifier가 검증
```

### 적합한 경우
- Claude API를 활용한 커스텀 에이전트 구축
- AI 자동화 도구 개발

---

## 2. claude-code-setup

코드베이스를 분석해서 Claude Code 자동화 설정을 추천하는 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `claude-automation-recommender` | `/claude-code-setup:claude-automation-recommender` | 프로젝트에 적합한 MCP, 훅, 스킬, 서브에이전트 추천 |

### 분석 항목

- **프로젝트 타입**: package.json, pyproject.toml 등 감지
- **프레임워크**: React, Vue, Flask, Django 등
- **린트/포맷터**: ESLint, Prettier, Ruff 설정
- **외부 API**: Stripe, Firebase, OpenAI 등 사용 여부

### 추천 항목

1. **MCP 서버**: context7, Playwright, Supabase 등
2. **훅**: 자동 포맷팅, 린트, 테스트 실행
3. **스킬**: 커밋 자동화, API 문서화
4. **서브에이전트**: 코드 리뷰어, 보안 분석기

### 사용 예시

```bash
/claude-code-setup:claude-automation-recommender
```

---

## 3. claude-md-management

CLAUDE.md 파일을 관리하고 개선하는 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `revise-claude-md` | `/claude-md-management:revise-claude-md` | 세션에서 배운 내용을 CLAUDE.md에 업데이트 |
| `claude-md-improver` | `/claude-md-management:claude-md-improver` | CLAUDE.md 파일 품질 감사 및 개선 |

### 기능

- **품질 감사**: 모든 CLAUDE.md 파일 스캔, 템플릿 기준 평가
- **자동 업데이트**: 프로젝트 구조, 명령어, 패턴 최신화
- **세션 학습**: 작업 중 발견한 정보 자동 반영

### 사용 예시

```bash
# CLAUDE.md 품질 점검 및 개선
/claude-md-management:claude-md-improver

# 이번 세션에서 배운 내용 반영
/claude-md-management:revise-claude-md
```

---

## 4. code-review

풀 리퀘스트 코드 리뷰를 수행하는 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `code-review` | `/code-review:code-review` | PR 코드 리뷰 수행 |

### 검토 항목

- 버그 및 로직 오류
- 보안 취약점
- 코드 품질 이슈
- 프로젝트 컨벤션 준수

### 사용 예시

```bash
# PR 리뷰
/code-review:code-review

# 또는 PR 번호 지정
/code-review:code-review 123
```

---

## 5. code-simplifier

코드 단순화 및 정리를 수행하는 플러그인.

### 기능

| 기능 | 설명 |
|------|------|
| 명확성 개선 | 복잡한 로직을 읽기 쉽게 리팩터링 |
| 일관성 유지 | 코딩 스타일 통일 |
| 유지보수성 향상 | 불필요한 복잡도 제거 |
| 기능 보존 | 동작은 그대로 유지 |

### 특징

- 최근 수정된 코드에 집중 (별도 지시 없으면)
- 모든 기능 보존 보장

### 사용 예시

```bash
# 최근 수정 코드 단순화
/code-simplifier

# 특정 파일 단순화
"src/components/ChatPage.tsx 코드 정리해줘"
```

---

## 6. coderabbit

CodeRabbit AI 기반 코드 리뷰 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `review` | `/coderabbit:review` | CodeRabbit AI 코드 리뷰 실행 |
| `code-review` | `/coderabbit:code-review` | 자율 수정-리뷰 사이클 지원 |

### 기능

- PR 피드백
- 코드 품질 체크
- 보안 이슈 탐지
- 자동 수정 후 재리뷰 사이클

### 사용 예시

```bash
# CodeRabbit 리뷰
/coderabbit:review

# 자율 수정-리뷰 사이클
/coderabbit:code-review
```

---

## 7. commit-commands

Git 커밋 자동화 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `commit` | `/commit` | 변경사항 분석 후 커밋 메시지 자동 생성 |

### 기능

- 스테이징된 변경사항 분석
- 의미 있는 커밋 메시지 생성
- 컨벤셔널 커밋 형식 지원

### 사용 예시

```bash
# 커밋 메시지 자동 생성
/commit

# 또는
git add .
/commit
```

---

## 8. context7

라이브러리 문서를 실시간으로 조회하는 MCP 플러그인.

### MCP 도구

| 도구 | 설명 |
|------|------|
| `resolve-library-id` | 라이브러리 이름 → Context7 ID 변환 |
| `query-docs` | 특정 라이브러리 문서 및 코드 예제 조회 |

### 지원 라이브러리

- React, Vue, Angular, Next.js
- Tailwind CSS, Radix UI
- Firebase, Supabase
- Express, FastAPI, Django
- 그 외 수천 개의 npm/PyPI 패키지

### 사용 방식

Claude가 **자동으로** 사용합니다:

```bash
# 이렇게 요청하면
"Framer Motion으로 스크롤 애니메이션 만들어줘"

# Claude가 자동으로:
# 1. resolve-library-id로 Framer Motion ID 조회
# 2. query-docs로 스크롤 애니메이션 문서 검색
# 3. 최신 API 기반으로 코드 생성
```

### 장점

- 학습 데이터보다 **최신 문서** 사용
- 더 **정확한 API 사용법**
- **deprecated된 코드** 방지

---

## 9. feature-dev

기능 개발을 체계적으로 가이드하는 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `feature-dev` | `/feature-dev:feature-dev` | 코드베이스 이해 + 아키텍처 중심 기능 개발 가이드 |

### 서브에이전트

| 에이전트 | 역할 |
|----------|------|
| `code-reviewer` | 버그, 로직 오류, 보안 취약점, 코드 품질 검토 |
| `code-explorer` | 실행 경로 추적, 아키텍처 분석, 패턴 이해, 의존성 문서화 |
| `code-architect` | 기존 패턴 분석 → 구현 청사진 설계 (파일, 컴포넌트, 데이터 플로우) |

### 워크플로우

1. **탐색**: 기존 코드베이스 패턴 분석
2. **설계**: 아키텍처 청사진 작성
3. **구현**: 단계별 가이드
4. **리뷰**: 코드 품질 검증

### 사용 예시

```bash
# 기능 개발 시작
/feature-dev:feature-dev

"사용자 프로필에 학습 통계 대시보드 추가해줘"
```

---

## 10. figma

Figma 디자인을 코드로 변환하는 플러그인.

### MCP 상태

| MCP | 상태 | 설명 |
|-----|------|------|
| `figma` | ✔ connected | Figma API 연동 |
| `figma-desktop` | ✘ failed | 데스크톱 앱 연동 (선택사항) |

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `implement-design` | `/figma:implement-design` | Figma → 프로덕션 코드 1:1 변환 |
| `code-connect-components` | `/figma:code-connect-components` | Figma ↔ 코드 컴포넌트 연결 |
| `create-design-system-rules` | `/figma:create-design-system-rules` | 프로젝트용 디자인 시스템 규칙 생성 |

### MCP 도구

| 도구 | 설명 |
|------|------|
| `get_design_context` | 노드에서 UI 코드 생성 |
| `get_screenshot` | 디자인 스크린샷 캡처 |
| `get_metadata` | 노드 구조 (ID, 레이어, 위치) 조회 |
| `get_variable_defs` | 디자인 변수 (색상, 폰트, 스페이싱) 추출 |
| `generate_diagram` | Mermaid.js → FigJam 다이어그램 생성 |
| `get_code_connect_map` | 컴포넌트 매핑 조회 |
| `add_code_connect_map` | 새 컴포넌트 매핑 추가 |

### 사용 예시

```bash
# Figma 디자인 → React 코드
/figma:implement-design
"https://figma.com/design/abc123/App?node-id=1-2 구현해줘"

# 컴포넌트 연결
/figma:code-connect-components
"Button을 src/components/ui/button.tsx에 연결해줘"

# 플로우차트 생성
"사용자 인증 플로우 다이어그램 만들어서 FigJam에 추가해줘"
```

### URL 형식

```
https://figma.com/design/:fileKey/:fileName?node-id=:nodeId

예: https://figma.com/design/abc123/Lingual?node-id=1-2
    → fileKey: abc123
    → nodeId: 1:2
```

---

## 11. firebase

Firebase 프로젝트 관리 플러그인.

### MCP 상태

| MCP | 상태 |
|-----|------|
| `firebase` | ✘ failed (설정 필요) |

### 예상 기능

| 기능 | 설명 |
|------|------|
| Firestore 쿼리 | 데이터베이스 직접 조회/수정 |
| Auth 관리 | 사용자 인증 상태 확인 |
| 배포 | Firebase Hosting 배포 |
| Functions | Cloud Functions 관리 |

### 설정 방법

Firebase MCP를 활성화하려면 Firebase CLI 로그인이 필요합니다:

```bash
# Firebase CLI 설치
npm install -g firebase-tools

# 로그인
firebase login

# 프로젝트 선택
firebase use <project-id>
```

### Lingual에서의 활용

현재 Lingual은 Firebase를 다음 용도로 사용:
- **Firestore**: 사용자, 프로필, 채팅 저장
- **Auth**: 사용자 인증

MCP 활성화 시 Claude가 직접 Firestore 쿼리 가능.

---

## 12. frontend-design

독창적인 프론트엔드 UI를 디자인하고 코드로 구현하는 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `frontend-design` | `/frontend-design:frontend-design` | 고품질 UI 컴포넌트/페이지 생성 |

### 디자인 원칙

| 원칙 | 설명 |
|------|------|
| **독특한 타이포그래피** | Inter, Roboto 대신 개성 있는 폰트 선택 |
| **대담한 색상** | 클리셰 보라색 그라디언트 대신 맥락에 맞는 팔레트 |
| **의도적인 레이아웃** | 비대칭, 오버랩, 그리드 브레이킹 |
| **고급 모션** | 페이지 로드 애니메이션, 스크롤 트리거, 호버 효과 |
| **분위기 있는 배경** | 그라디언트 메시, 노이즈 텍스처, 기하학적 패턴 |

### 지원 스타일

- 브루탈리즘 / 미니멀
- 맥시멀리즘 / 카오스
- 레트로-퓨처리스틱
- 럭셔리 / 정제됨
- 에디토리얼 / 매거진
- 아르데코 / 기하학적
- 소프트 / 파스텔
- 인더스트리얼

### 사용 예시

```bash
/frontend-design:frontend-design

"한국어 학습 앱 랜딩 페이지 만들어줘.
 고급스럽고 에디토리얼한 느낌으로."
```

### Figma vs frontend-design

| | **Figma** | **frontend-design** |
|---|---|---|
| 입력 | Figma URL 필요 | 텍스트 설명만 |
| 결과 | 디자인 1:1 재현 | 창의적 해석 |
| 적합한 경우 | 팀 협업, 기존 디자인 | 빠른 프로토타입, 독창성 |

---

## 13. gopls-lsp

Go 언어 개발을 위한 LSP (Language Server Protocol) 플러그인.

### 기능

| 기능 | 설명 |
|------|------|
| 자동 완성 | Go 코드 인텔리센스 |
| 타입 정보 | 변수/함수 타입 호버 |
| 정의로 이동 | 심볼 정의 위치 탐색 |
| 참조 찾기 | 심볼 사용처 검색 |
| 리팩터링 | 이름 변경, 추출 등 |

### 사용 방식

Go 파일 작업 시 **자동으로** 활성화됩니다.

```go
// Claude가 gopls를 통해:
// - 타입 정보 확인
// - 사용 가능한 메서드 제안
// - 임포트 자동 추가
```

---

## 14. greptile

코드베이스 검색 및 PR 분석 MCP 플러그인.

### MCP 상태

| MCP | 상태 |
|-----|------|
| `greptile` | ✔ connected |

### MCP 도구

| 도구 | 설명 |
|------|------|
| `list_custom_context` | 조직 커스텀 컨텍스트 목록 |
| `search_custom_context` | 텍스트 검색으로 컨텍스트 찾기 |
| `list_merge_requests` | PR/MR 목록 조회 |
| `get_merge_request` | PR 상세 정보 + 리뷰 분석 |
| `list_merge_request_comments` | PR 코멘트 목록 |
| `trigger_code_review` | PR 코드 리뷰 트리거 |
| `search_greptile_comments` | Greptile 리뷰 코멘트 검색 |

### 사용 예시

```bash
# PR 목록 조회
"현재 열린 PR들 보여줘"

# PR 리뷰 트리거
"PR #123 리뷰해줘"

# 리뷰 코멘트 검색
"보안 관련 Greptile 코멘트 찾아줘"
```

---

## 15. huggingface-skills

Hugging Face 플랫폼과 연동하는 스킬 모음.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `hugging-face-tool-builder` | 자동 | HF API 활용 스크립트 생성 |
| `hugging-face-evaluation` | 자동 | 모델 평가 결과 관리 |
| `hugging-face-datasets` | 자동 | 데이터셋 생성/관리 |
| `hugging-face-cli` | 자동 | HF CLI 작업 (다운로드, 업로드) |
| `hugging-face-trackio` | 자동 | ML 학습 실험 추적 |
| `hugging-face-jobs` | 자동 | HF 인프라에서 작업 실행 |
| `hugging-face-paper-publisher` | 자동 | 연구 논문 게시 |
| `hugging-face-model-trainer` | 자동 | TRL로 모델 학습/파인튜닝 |

### 사용 예시

```bash
# 모델 다운로드
"meta-llama/Llama-2-7b 모델 다운로드해줘"

# 데이터셋 생성
"한국어 대화 데이터셋 만들어서 HF에 업로드해줘"

# GPU 작업 실행
"이 학습 스크립트를 HF Jobs에서 실행해줘"
```

---

## 16. kotlin-lsp

Kotlin 언어 개발을 위한 LSP 플러그인.

### 기능

| 기능 | 설명 |
|------|------|
| 자동 완성 | Kotlin 코드 인텔리센스 |
| 타입 추론 | 변수/함수 타입 정보 |
| 정의로 이동 | 심볼 정의 탐색 |
| 오류 진단 | 컴파일 오류 실시간 감지 |

### 사용 방식

Kotlin 파일 작업 시 자동 활성화.

---

## 17. laravel-boost

Laravel PHP 프레임워크 개발 지원 플러그인.

### MCP 상태

| MCP | 상태 |
|-----|------|
| `laravel-boost` | ✘ failed (Laravel 프로젝트 필요) |

### 예상 기능

| 기능 | 설명 |
|------|------|
| Artisan 명령 | make:model, migrate 등 |
| 라우트 분석 | 라우트 목록 및 컨트롤러 매핑 |
| Eloquent 지원 | 모델 관계, 쿼리 빌더 |
| Blade 템플릿 | 뷰 파일 작업 |

---

## 18. learning-output-style

대화형 학습과 교육적 설명을 결합한 출력 스타일 플러그인.

### 기능

| 기능 | 설명 |
|------|------|
| **학습 모드** | 사용자가 직접 코드 작성할 기회 제공 |
| **인사이트** | 코드 작성 전후 교육적 설명 제공 |
| **코드 기여 요청** | 5-10줄의 의미 있는 코드 작성 유도 |

### 코드 기여 요청 시점

- 비즈니스 로직에 여러 접근법이 있을 때
- 에러 핸들링 전략 결정
- 알고리즘 구현 선택
- 사용자 경험 결정

### 인사이트 형식

```
★ Insight ─────────────────────────────────────
[2-3개의 교육적 포인트]
─────────────────────────────────────────────────
```

---

## 19. playwright

브라우저 자동화 및 테스트를 위한 MCP 플러그인.

### MCP 도구

| 도구 | 설명 |
|------|------|
| `browser_navigate` | URL로 이동 |
| `browser_snapshot` | 페이지 접근성 스냅샷 (스크린샷보다 효율적) |
| `browser_click` | 요소 클릭 |
| `browser_type` | 텍스트 입력 |
| `browser_take_screenshot` | 스크린샷 캡처 |
| `browser_fill_form` | 폼 필드 채우기 |
| `browser_evaluate` | JavaScript 실행 |
| `browser_console_messages` | 콘솔 로그 조회 |
| `browser_network_requests` | 네트워크 요청 조회 |
| `browser_tabs` | 탭 관리 (목록, 생성, 닫기, 선택) |

### 사용 예시

```bash
# 페이지 테스트
"localhost:5173 열어서 로그인 플로우 테스트해줘"

# 스크린샷 캡처
"랜딩 페이지 스크린샷 찍어줘"

# 폼 자동 채우기
"회원가입 폼에 테스트 데이터 입력해줘"
```

### 장점

- 실제 브라우저에서 테스트
- E2E 테스트 자동화
- 시각적 디버깅

---

## 20. ralph-loop

반복 작업을 자동화하는 루프 플러그인.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `help` | `/ralph-loop:help` | Ralph Loop 설명 |
| `cancel-ralph` | `/ralph-loop:cancel-ralph` | 활성 루프 취소 |
| `ralph-loop` | `/ralph-loop:ralph-loop` | 현재 세션에서 루프 시작 |

### 사용 방식

반복적인 작업을 자동으로 수행:

```bash
/ralph-loop:ralph-loop

"모든 컴포넌트에 TypeScript 타입 추가해줘"
```

---

## 21. stripe

Stripe 결제 통합 지원 플러그인.

### MCP 상태

| MCP | 상태 |
|-----|------|
| `stripe` | △ needs auth (인증 필요) |

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `explain-error` | `/stripe:explain-error` | Stripe 에러 코드 설명 + 해결책 |
| `test-cards` | `/stripe:test-cards` | 테스트 카드 번호 표시 |
| `stripe-best-practices` | 자동 | Stripe 통합 모범 사례 |

### 사용 예시

```bash
# 에러 설명
/stripe:explain-error card_declined

# 테스트 카드 조회
/stripe:test-cards

# 결제 구현 시 자동으로 모범 사례 적용
"Stripe으로 구독 결제 구현해줘"
```

---

## 22. supabase

Supabase 백엔드 서비스 관리 플러그인.

### MCP 상태

| MCP | 상태 |
|-----|------|
| `supabase` | ✔ connected |

### MCP 도구

| 도구 | 설명 |
|------|------|
| `search_docs` | Supabase 문서 검색 (GraphQL) |
| `list_organizations` | 조직 목록 |
| `list_projects` | 프로젝트 목록 |
| `get_project` | 프로젝트 상세 정보 |
| `list_tables` | 테이블 목록 |
| `execute_sql` | SQL 쿼리 실행 |
| `apply_migration` | 마이그레이션 적용 |
| `list_edge_functions` | Edge Functions 목록 |
| `deploy_edge_function` | Edge Function 배포 |
| `get_logs` | 서비스 로그 조회 |
| `get_advisors` | 보안/성능 권고사항 |
| `generate_typescript_types` | TypeScript 타입 생성 |

### 사용 예시

```bash
# 테이블 조회
"users 테이블 구조 보여줘"

# SQL 실행
"최근 가입한 사용자 10명 조회해줘"

# 마이그레이션
"posts 테이블에 views 컬럼 추가해줘"

# Edge Function 배포
"이 함수를 Edge Function으로 배포해줘"
```

---

## 23. superpowers

고급 워크플로우와 개발 방법론을 제공하는 스킬 모음.

### 스킬

| 스킬 | 호출 | 설명 |
|------|------|------|
| `using-superpowers` | 자동 | 스킬 사용법 가이드 |
| `brainstorming` | 자동 | 기능 개발 전 브레인스토밍 |
| `test-driven-development` | 자동 | TDD 워크플로우 |
| `systematic-debugging` | 자동 | 체계적 디버깅 |
| `writing-plans` | 자동 | 구현 계획 작성 |
| `executing-plans` | 자동 | 계획 실행 + 리뷰 체크포인트 |
| `dispatching-parallel-agents` | 자동 | 병렬 에이전트 실행 |
| `subagent-driven-development` | 자동 | 서브에이전트 기반 개발 |
| `using-git-worktrees` | 자동 | Git worktree로 격리된 개발 |
| `finishing-a-development-branch` | 자동 | 브랜치 완료 워크플로우 |
| `requesting-code-review` | 자동 | 코드 리뷰 요청 |
| `receiving-code-review` | 자동 | 코드 리뷰 피드백 처리 |
| `verification-before-completion` | 자동 | 완료 전 검증 |
| `writing-skills` | 자동 | 새 스킬 작성 |

### 핵심 원칙

1. **스킬 우선**: 작업 전 관련 스킬 확인
2. **계획 후 실행**: 복잡한 작업은 계획 먼저
3. **검증 필수**: 완료 주장 전 반드시 검증

### 사용 방식

대부분 **자동으로** 적용됩니다:

```bash
# 기능 개발 요청 시 → brainstorming 자동 적용
"사용자 대시보드 추가해줘"

# 버그 수정 시 → systematic-debugging 자동 적용
"로그인이 안 돼요"

# 복잡한 작업 시 → writing-plans 자동 적용
"전체 인증 시스템 리팩터링해줘"
```

---

## 24. typescript-lsp

TypeScript 개발을 위한 LSP 플러그인.

### 기능

| 기능 | 설명 |
|------|------|
| 자동 완성 | TypeScript/JavaScript 인텔리센스 |
| 타입 체크 | 실시간 타입 오류 감지 |
| 정의로 이동 | 심볼 정의 탐색 |
| 참조 찾기 | 심볼 사용처 검색 |
| 리팩터링 | 이름 변경, 추출, 이동 |
| 자동 임포트 | 누락된 import 자동 추가 |

### 사용 방식

TypeScript/JavaScript 파일 작업 시 **자동 활성화**:

```typescript
// Claude가 typescript-lsp를 통해:
// - 타입 정보 확인
// - 자동 완성 제안
// - 타입 오류 감지 및 수정
```

### Lingual에서의 활용

프론트엔드가 React + TypeScript이므로 자동으로 활성화되어:
- 컴포넌트 props 타입 추론
- 훅 반환 타입 확인
- 자동 임포트

---

## 플러그인 관리 명령어

```bash
# 설치된 플러그인 목록
/plugins

# 플러그인 설치
claude plugins add <plugin-name>

# 플러그인 비활성화
claude plugins disable <plugin-name>

# 플러그인 활성화
claude plugins enable <plugin-name>
```

---

## 추천 조합

### 일반 개발 워크플로우
1. **context7**: 라이브러리 문서 조회
2. **commit-commands**: 커밋 자동화
3. **code-review**: PR 리뷰

### 코드 품질 관리
1. **coderabbit**: AI 코드 리뷰
2. **code-simplifier**: 코드 정리
3. **claude-md-management**: 프로젝트 문서 관리

### 새 프로젝트 설정
1. **claude-code-setup**: 자동화 추천 받기
2. **claude-md-management**: CLAUDE.md 생성/개선
