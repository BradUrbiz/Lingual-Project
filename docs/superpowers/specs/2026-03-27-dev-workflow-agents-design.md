# Development Workflow Agents — Design Spec

Status: Approved
Date: 2026-03-27
Owner: Engineering

## 1. Problem

The Lingual project follows a document-driven development workflow (PRD -> TECH_SPEC -> TASKS -> LIMITATIONS). Four recurring activities happen at phase boundaries:

1. **Pre-implementation spec review** — checking that proposed work aligns with architecture docs
2. **Parallel backend/frontend implementation** — independent work that can run concurrently
3. **Cross-layer review** — tracing features end-to-end to catch integration gaps
4. **Post-ship doc sync** — updating the 4 spec docs to match what actually shipped

These are currently done manually and ad-hoc. Formalizing them as dispatchable agents makes them consistent and harder to skip.

## 2. Approach

**Hybrid: Plugin agents + CLAUDE.md dispatch rules.**

- A project-local plugin (`.claude/plugins/lingual-dev-agents/`) defines 5 agents with project-aware system prompts.
- A new CLAUDE.md section defines when Claude should dispatch each agent during normal workflow.
- Agents are dispatched by Claude autonomously based on the dispatch rules — no manual slash commands needed.

## 3. Plugin Structure

```
.claude/plugins/lingual-dev-agents/
├── plugin.json
├── agents/
│   ├── spec-agent.md
│   ├── backend-impl.md
│   ├── frontend-impl.md
│   ├── cross-layer-review.md
│   └── doc-sync.md
└── CLAUDE.md
```

## 4. Agent Definitions

### 4.1 Spec Agent

**Name:** `lingual-dev-agents:spec-agent`

**Purpose:** Pre-implementation spec review. Reads PRD + TECH_SPEC, checks proposed approach against existing architecture, flags conflicts and scope creep.

**Dispatch trigger:** Before implementing any TASKS.md item or feature that touches architecture, data model, or API surface.

**Skip when:** Pure UI polish, copy changes, or bug fixes confined to one file.

**Behavior:**

1. Read PRD.md + TECH_SPEC.md sections relevant to the feature
2. Read current codebase files that would be touched
3. Flag conflicts between proposed approach and existing architecture
4. Flag scope creep beyond what TASKS.md describes
5. Return implementation brief: files to touch, data flow, doc updates needed

**Constraints:** Read-only. Does not write code or modify files.

**Tools:** Read, Glob, Grep, Bash (read-only git commands). No Edit, no Write.

**System prompt context:**

- 4-doc structure and update order (PRD -> TECH_SPEC -> TASKS -> LIMITATIONS)
- Firestore schema overview (organizations, memberships, classes, enrollments, curriculum_mappings, assignments, practice_sessions, learning_events)
- Rule: if implementation would contradict TECH_SPEC, flag it
- Key file locations: `backend/routes/`, `backend/services/`, `frontend/src/pages/`, `frontend/src/api/`, `frontend/src/types/`

### 4.2 Backend Implementation Agent

**Name:** `lingual-dev-agents:backend-impl`

**Purpose:** Implement backend changes following existing Flask/Firestore/service-layer patterns.

**Dispatch trigger:** During implementation when there is backend work. Dispatched in parallel with `frontend-impl` via `isolation: "worktree"` when work is independent.

**Skip when:** Feature is frontend-only.

**Behavior:**

1. Implement backend changes: routes, services, database helpers, Firestore schema
2. Follow existing patterns: Flask blueprints in `main.py`, Firestore CRUD via `database.py`, domain logic in `backend/services/`, route deps via `backend/route_deps.py`
3. Write/update backend tests in `backend/tests/`
4. Return summary: what was built, new collections/endpoints, API contract for frontend

**Constraints:** Writes code. Works in isolated worktree.

**Tools:** All tools (Read, Write, Edit, Bash, Glob, Grep).

**System prompt context:**

- Flask blueprint registration pattern
- Firestore collection schema and naming conventions
- Service layer patterns: assignment_resolver, practice_analytics, membership_context, pedagogy engine
- Route dependency injection pattern from `route_deps.py`
- Auth pattern: Firebase ID token -> `/api/auth/verify` -> session + memberships
- Compliance awareness: consent gating, disclosure logging, retention policies
- Test patterns from `backend/tests/`

### 4.3 Frontend Implementation Agent

**Name:** `lingual-dev-agents:frontend-impl`

**Purpose:** Implement frontend changes following existing React/TypeScript/Radix patterns.

**Dispatch trigger:** In parallel with `backend-impl` when work is independent, or sequentially after backend when frontend depends on new API endpoints.

**Skip when:** Feature is backend-only.

**Behavior:**

1. Implement frontend changes: pages, components, API client modules, types
2. Follow existing patterns: React 19 + TypeScript, lazy-loaded pages in `App.tsx`, typed API clients in `frontend/src/api/`, DTOs in `frontend/src/types/`, Radix UI + Tailwind CSS 4 + Framer Motion
3. Respect context architecture: AuthContext, MembershipContext, LanguageContext
4. Write/update frontend tests (Vitest)
5. Return summary: what was built, API shape assumptions

**Constraints:** Writes code. Works in isolated worktree.

**Tools:** All tools (Read, Write, Edit, Bash, Glob, Grep).

**System prompt context:**

- React Router v7 lazy-loading pattern
- TeacherRoute guard pattern for role-gated pages
- API client module pattern (typed fetch wrappers)
- DTO conventions in `frontend/src/types/`
- Context usage: AuthContext (session), MembershipContext (org/role/classes), LanguageContext (en/ko UI)
- Radix + Tailwind CSS 4 + Framer Motion component conventions
- Vite proxy setup: `/api/*` -> `:5001`

### 4.4 Cross-Layer Review Agent

**Name:** `lingual-dev-agents:cross-layer-review`

**Purpose:** Post-implementation review that traces features end-to-end across backend and frontend, catching integration gaps.

**Dispatch trigger:** After completing a feature that spans backend + frontend, especially if it touches compliance, pedagogy, or analytics.

**Skip when:** Change is isolated to one layer with no cross-layer contract.

**Behavior:**

1. Trace feature end-to-end: API endpoint -> service logic -> Firestore reads/writes -> API client -> React page/component -> context/guard dependencies
2. Check integration gaps: frontend DTO vs. backend response shape, route membership/role checks, compliance gate wiring
3. Check cross-cutting concerns: disclosure logging on sensitive reads, consent gating on voice features, cost tracking on practice sessions
4. Verify test coverage spans the integration boundary
5. Return prioritized issue list: blockers, concerns, nice-to-haves

**Constraints:** Read-only. Reports issues, does not fix them.

**Tools:** Read, Glob, Grep, Bash (read-only). No Edit, no Write.

**System prompt context:**

- Full data flow: Firebase Auth -> verify -> session -> MembershipContext -> TeacherRoute -> CRUD -> pedagogy -> events -> analytics
- Known cross-layer contracts: assignment DTOs, analytics payloads, compliance state shapes
- Compliance checklist: consent gating, disclosure logging, retention policies, deletion scope
- LIMITATIONS.md pattern: shipped behavior narrower than spec is a limitation to document, not necessarily a bug

### 4.5 Doc Sync Agent

**Name:** `lingual-dev-agents:doc-sync`

**Purpose:** Post-ship documentation synchronization. Diffs code state against the 4 spec docs and proposes updates.

**Dispatch trigger:** After completing a TASKS.md phase or any change that introduces new collections, endpoints, or domain concepts.

**Skip when:** Trivial bug fixes that don't change architecture or shipped behavior.

**Behavior:**

1. Diff current code state against the 4 spec docs
2. Propose TASKS.md updates: mark completed items `[x]`, identify new items
3. Propose LIMITATIONS.md entries for shipped behavior narrower than TECH_SPEC
4. Flag stale TECH_SPEC.md sections: new collections, endpoints, or domain concepts in code but not in docs
5. Return structured diff: what to change in each doc, and why

**Constraints:** Read-only. Proposes changes, does not auto-commit. Doc updates require judgment about phrasing and scope.

**Tools:** Read, Glob, Grep, Bash (git log, git diff). No Edit, no Write.

**System prompt context:**

- 4-doc structure, purpose of each, update order (PRD -> TECH_SPEC -> TASKS -> LIMITATIONS)
- TASKS.md status legend: `[ ]`, `[-]`, `[x]`, `[!]`
- LIMITATIONS.md entry format: impact + planned follow-up
- TECH_SPEC.md section structure
- Rule: docs describe what shipped, not what we wish shipped

## 5. CLAUDE.md Dispatch Rules

A new section added to the project CLAUDE.md:

```markdown
### Development Workflow Agents

This project has a local plugin (`lingual-dev-agents`) with 5 agents. Dispatch them
at phase boundaries — they are not optional nice-to-haves, they are part of the workflow.

**Dispatch rules:**

| Agent | When to dispatch | Skip when |
|-------|-----------------|-----------|
| `spec-agent` | Before implementing any TASKS.md item or feature that touches architecture, data model, or API surface | Pure UI polish, copy changes, or bug fixes confined to one file |
| `backend-impl` | During implementation, in parallel with `frontend-impl` when backend/frontend work is independent | Feature is frontend-only |
| `frontend-impl` | During implementation, in parallel with `backend-impl` when work is independent; sequentially after backend when frontend depends on new API | Feature is backend-only |
| `cross-layer-review` | After completing a feature that spans backend + frontend, especially if it touches compliance, pedagogy, or analytics | Change is isolated to one layer with no cross-layer contract |
| `doc-sync` | After completing a TASKS.md phase or any change that introduces new collections, endpoints, or domain concepts | Trivial bug fixes that don't change architecture or shipped behavior |

**Parallel dispatch pattern:** When a feature decomposes into independent backend + frontend
work, dispatch `backend-impl` and `frontend-impl` simultaneously with `isolation: "worktree"`.
Review both results, then run `cross-layer-review` on the merged state.

**Agent outputs are advisory:** `spec-agent`, `cross-layer-review`, and `doc-sync` propose —
they don't modify files. Review their output before acting on it.
```

## 6. Design Decisions

1. **5 agents, not 4.** Parallel implementation splits into `backend-impl` and `frontend-impl` because they carry fundamentally different domain context (Flask/Firestore vs. React/Radix/Vite).

2. **Read-only vs. read-write.** Advisory agents (spec, cross-layer-review, doc-sync) are read-only. Implementation agents (backend-impl, frontend-impl) have full write access but run in isolated worktrees.

3. **Plugin + CLAUDE.md hybrid.** Plugin carries the "how" (agent capabilities and project context). CLAUDE.md carries the "when" (dispatch judgment rules). Two layers serve different purposes so sync burden is low.

4. **No orchestrator.** Agents are dispatched individually at phase boundaries rather than through a pipeline orchestrator. This matches the project's tight iteration loop where features often go from idea to shipped in one session.

5. **Advisory agents don't auto-commit.** Doc sync and review agents propose changes. The developer reviews and applies them. This is intentional — doc updates and review responses require judgment calls about phrasing and scope.
