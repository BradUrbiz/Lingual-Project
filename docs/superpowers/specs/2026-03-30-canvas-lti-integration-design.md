# Canvas LTI 1.3 Integration Design

**Date:** 2026-03-30
**Status:** Approved
**Owner:** Engineering
**Branch:** `feature/canvas-lti-integration`

## Problem

Lingual's current Canvas integration requires teachers to generate a Personal Access Token (PAT) in Canvas, copy it, and paste it into Lingual. This is friction-heavy for school adoption:

- Teachers need to find Canvas Settings → generate a token → copy/paste
- PATs are long-lived credentials stored encrypted in Firestore
- Schools have no admin control over which PATs are in use
- No way to launch Lingual directly from inside Canvas

## Solution

Add LTI 1.3 as the primary Canvas integration method. Teachers click "Lingual" inside Canvas and are automatically authenticated, connected, and launched into the right context. Students click a Lingual assignment in Canvas and land directly on the practice page.

The existing PAT flow remains as a manual fallback for schools that haven't configured LTI yet. Both paths coexist — `auth_method: "lti" | "pat"` on the connection record.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| LTI library | `pylti1p3` + `pylti1p3-flask` | Battle-tested, handles OIDC/JWT/JWKS/Deep Linking/AGS. Flask extension built-in. |
| Registration model | Per-school (Canvas admin registers Lingual as External Tool) | No dependency on Canvas Edu App Center approval. Immediate rollout. |
| PAT flow | Kept as fallback | Smooth rollout for schools slow to configure LTI |
| Identity matching | Org-scoped email match with manual linking fallback | Uses Canvas email + org's LTI platform to scope the match. Manual page if email mismatch. |
| Student launch | LTI primary, join codes still work | Students clicking Lingual in Canvas auto-enroll. Non-Canvas students use join codes. |
| Deep linking | Assignment-level | Teachers embed specific Lingual assignments as Canvas module items |
| Grade passback | Completion only, teacher sets point value | Simple, unambiguous. Rubric/metrics visible in Lingual analytics but not sent to Canvas gradebook. |
| LTI launch target | Dashboard (teacher) or assignment (student via deep link) | Full Lingual app available after launch — LTI is a door in, not a wall |

## Data Model

### Modified collection: `canvas_connections`

Keep all existing fields. Add:

```
lti_deployment_id: string | null     (Canvas deployment ID)
lti_context_id: string | null        (Canvas course context ID)
lti_lineitem_url: string | null      (AGS lineitem URL for grade passback)
grade_metric: "completion" | null    (only completion for now)
grade_points: number | null          (point value set by teacher)
auth_method: "pat" | "lti"           (which auth flow created this connection)
```

`encrypted_pat` stays for PAT connections. LTI connections leave it empty.

### New collection: `lti_platforms`

One doc per Canvas instance registered with Lingual. Created by school admin.

```
lti_platforms/{platformId}
  org_id: string                    (which Lingual org this belongs to)
  issuer: string                    (Canvas instance URL, e.g. "https://ssfs.instructure.com")
  client_id: string                 (from Canvas Developer Key)
  deployment_id: string             (from Canvas LTI registration)
  auth_login_url: string            (Canvas OIDC login URL)
  auth_token_url: string            (Canvas OAuth token endpoint)
  key_set_url: string               (Canvas JWKS URL for verifying signatures)
  created_at: timestamp
```

This is the `pylti1p3` tool configuration — tells Lingual how to talk to a specific Canvas instance.

### New collection: `lti_sessions`

Short-lived records for active LTI sessions.

```
lti_sessions/{sessionId}
  user_uid: string                  (matched Lingual user)
  platform_id: string               (which lti_platform)
  canvas_user_id: string
  canvas_course_id: string
  roles: string[]                   (LTI roles: Instructor, Learner, etc.)
  access_token: string              (OAuth access token for Canvas API)
  token_expires_at: timestamp
  created_at: timestamp
```

These expire and can be cleaned up. They replace the "decrypt PAT on every request" pattern for LTI connections.

## LTI Flow Architecture

### Registration (one-time per school)

```
School admin in Lingual dashboard
  → Enters Canvas Developer Key details (client_id, deployment_id)
  → Lingual stores as lti_platforms record
  → Canvas admin adds Lingual as External Tool using:
     - Launch URL: https://lingual.app/lti/launch
     - Login URL: https://lingual.app/lti/login
     - JWKS URL: https://lingual.app/lti/jwks
     - Redirect URI: https://lingual.app/lti/callback
```

This is done once per school. The Canvas admin and Lingual admin coordinate — Canvas gives us the client_id/deployment_id, we give them our URLs.

### Teacher Launch Flow

```
Teacher clicks "Lingual" in Canvas
  → Canvas POSTs to /lti/login (OIDC initiation)
  → Lingual redirects to Canvas auth_login_url with state + nonce
  → Canvas validates, POSTs signed JWT to /lti/callback
  → pylti1p3 validates JWT signature against Canvas JWKS
  → Lingual extracts: email, roles, course_id, canvas_user_id
  → Match to Lingual user:
     1. Find lti_platform by issuer → get org_id
     2. Find user by email within that org
     3. If no match → show "Link your Lingual account" page
  → Create/update canvas_connection (auth_method: "lti")
  → Create lti_session with access token
  → Redirect to /app/teacher (or specific class if connection exists)
```

### Student Launch Flow (via deep link)

```
Student clicks Lingual assignment in Canvas module
  → Same OIDC + JWT flow as teacher
  → Lingual extracts: email, roles (Learner), course_id, assignment resource_link
  → Match to Lingual user by email (auto-enroll if pending_sync)
  → Look up deep-linked assignment from resource_link custom params
  → Redirect to /app/assignments/:assignmentId
```

### Deep Linking Flow (teacher embeds assignment)

```
Teacher clicks "Add External Tool → Lingual" in Canvas module editor
  → Canvas sends Deep Linking launch request to /lti/deep-link
  → Lingual shows assignment picker (list of assignments for this class)
  → Teacher selects assignment + sets point value for grade passback
  → Lingual constructs Deep Linking Response JWT with:
     - Resource link to /app/assignments/:assignmentId
     - AGS lineitem config with points_possible
  → Canvas stores the link as a module item
```

## API Surface

### LTI Endpoints (public — Canvas calls these directly)

| Method | Endpoint | What |
|---|---|---|
| `GET` | `/lti/jwks` | Lingual's public key set for Canvas to verify signatures |
| `POST` | `/lti/login` | OIDC initiation — Canvas starts the handshake here |
| `POST` | `/lti/callback` | Receives Canvas-signed JWT, validates, resolves identity, redirects |
| `POST` | `/lti/deep-link` | Deep Linking launch — shows assignment picker to teacher |
| `POST` | `/lti/deep-link/respond` | Teacher submits picker — constructs Deep Linking Response JWT back to Canvas |

### Grade Configuration (teacher)

| Method | Endpoint | What |
|---|---|---|
| `POST` | `/api/teacher/assignments/:id/grade-config` | Set grade passback: `{ metric: "completion", points: 10 }` |
| `GET` | `/api/teacher/assignments/:id/grade-config` | Get current grade config |

### LTI Platform Management (school_admin)

| Method | Endpoint | What |
|---|---|---|
| `POST` | `/api/schools/lti-platform` | Register Canvas instance (client_id, deployment_id, URLs) |
| `GET` | `/api/schools/lti-platform` | Get current LTI platform config |
| `DELETE` | `/api/schools/lti-platform` | Remove LTI registration |

### Grade Passback (automatic, no explicit endpoint)

Triggered when a practice session ends. The backend:
1. Checks if the assignment has `grade_metric: "completion"` + `lti_lineitem_url`
2. Computes score: 1.0 if session status is `completed`, 0.0 otherwise
3. Gets LTI access token (from `lti_sessions` or refreshes via client_credentials)
4. POSTs score to Canvas AGS lineitem URL
5. Canvas multiplies by `points_possible` to get the gradebook entry

### Existing Endpoints (unchanged)

All PAT-based endpoints stay and continue working. LTI connections use the same sync infrastructure but get their access token from `lti_sessions` instead of decrypting a stored PAT.

## Frontend

### New Pages

| Route | Component | Who | Purpose |
|---|---|---|---|
| `/lti/link-account` | `LtiLinkAccountPage` | Any user (during LTI launch) | Shown when email matching fails. User logs into Lingual to manually link their Canvas identity. |
| `/lti/assignment-picker` | `LtiAssignmentPickerPage` | Teacher (during deep linking) | Shows class assignments with point value input. Teacher picks one, sets points, submits back to Canvas. |

### Modified Pages

| Page | Change |
|---|---|
| `CanvasConnectPage` | Add "Connect with Canvas LTI" section above PAT form. If org has `lti_platform`, show LTI as recommended with PAT below as "Manual connection." |
| `TeacherDashboardPage` | In workspace settings, add LTI Platform registration form for school_admin. |
| `AssignmentLaunchPage` | After session ends, if assignment has grade passback configured, show "Score sent to Canvas" badge. |

### Unchanged

- `CanvasModuleView` — items come from the same collection
- `CanvasPracticeBuilderPage` — AI generation works the same
- `CanvasLinkPicker` — assignment linking works the same
- `CanvasSyncStatus` — sync uses same infrastructure, different token source
- All analytics, compliance, pedagogy pages

## Grade Passback Design

### Metric

Completion only. The student either completed the practice session or didn't.

| Outcome | Score sent | Canvas gradebook |
|---|---|---|
| Session completed | 1.0 | Full points (e.g., 10/10) |
| Session abandoned/not started | 0.0 | Zero (0/10) |

### Teacher Configuration

When creating a deep link, the teacher sees:
- Assignment selector (dropdown of published assignments for this class)
- "Grade passback" toggle (on/off)
- If on: "Points" input (e.g., 10) — this becomes `points_possible` in Canvas

The teacher can change points later via the grade config endpoint.

### Score Scaling

Lingual sends a proportion (0.0 or 1.0 for completion). Canvas multiplies by `points_possible`. Clean, no ambiguity.

### Trigger

Scores are sent on `session.ended` event. If the session was already scored (e.g., student retries), the latest score overwrites the previous one in Canvas.

## Identity Matching

### Primary: Org-scoped email match

```
LTI launch JWT contains: issuer, email, canvas_user_id, roles
  → Find lti_platform by issuer → get org_id
  → Find Lingual user where email matches AND has membership in org_id
  → If found: proceed with launch
```

### Fallback: Manual linking

If email doesn't match (different email in Canvas vs Lingual):
```
  → Redirect to /lti/link-account
  → User logs into their Lingual account
  → System links canvas_user_id to their Lingual uid
  → Store the link for future launches (no re-linking needed)
```

### Student auto-enrollment

If a student launches via LTI and has a Lingual account but isn't enrolled:
```
  → Auto-create enrollment with join_source: "lti"
  → Auto-create student membership if needed
  → Redirect to the assignment
```

This mirrors the existing Canvas sync `pending_sync` activation, but happens at launch time instead of login time.

### No Lingual account

If a user launches via LTI and has no Lingual account at all:
```
  → Redirect to /lti/link-account with a message:
    "You don't have a Lingual account yet. Sign up first, then relaunch from Canvas."
  → After signup + relaunch, email matching connects them automatically
```

No auto-account-creation from LTI. The user must have a Lingual account first (via normal signup). This keeps the Lingual signup flow as the single entry point for account creation.

## `pylti1p3` Integration

### Tool Configuration

`pylti1p3` needs a "tool config" that describes the LTI platform. We'll implement a custom `ToolConfAbstract` subclass that reads from our `lti_platforms` Firestore collection instead of a JSON file.

### Session Management

`pylti1p3` needs session/cache storage for the OIDC state + nonce. We'll use Flask sessions (already in use) via the library's Flask extension.

### Key Management

Lingual needs an RSA key pair for signing Deep Linking Response JWTs. Store the private key as a Secret Manager secret (like the existing `CANVAS_PAT_ENCRYPTION_KEY`). The public key is served via `/lti/jwks`.

## Implementation Order

### Piece 1: LTI Platform Registration + OIDC Handshake

**New files:**
- `backend/services/lti/` — LTI service package
- `backend/services/lti/config.py` — Custom `ToolConfAbstract` reading from Firestore
- `backend/services/lti/identity.py` — Email matching + manual linking logic
- `backend/routes/lti.py` — LTI endpoints blueprint (login, callback, jwks)
- `frontend/src/pages/LtiLinkAccountPage.tsx` — Manual account linking page

**Modified files:**
- `database.py` — CRUD for `lti_platforms`, `lti_sessions`
- `main.py` — Register LTI blueprint
- `requirements.txt` — Add `PyLTI1p3`, `PyLTI1p3-flask`
- `TeacherDashboardPage.tsx` — LTI platform registration in workspace settings

**Shippable when:** Teacher can click Lingual in Canvas, complete OIDC handshake, land on Lingual dashboard with identity matched.

### Piece 2: Identity Matching + Auto-Connection

**Modified files:**
- `backend/routes/lti.py` — Add connection auto-creation on launch
- `backend/services/lti/identity.py` — Student auto-enrollment logic
- `database.py` — Add `auth_method` field to `canvas_connections`

**Shippable when:** Teacher launch auto-creates class connection. Student launch auto-enrolls and redirects to assignment.

### Piece 3: Deep Linking

**New files:**
- `frontend/src/pages/LtiAssignmentPickerPage.tsx` — Assignment picker with point value input

**Modified files:**
- `backend/routes/lti.py` — Deep linking launch + response endpoints
- `database.py` — Add `grade_points`, `grade_metric`, `lti_lineitem_url` to connections/assignments

**Shippable when:** Teacher can embed a Lingual assignment as a Canvas module item. Students can launch it from Canvas.

### Piece 4: Grade Passback (Completion)

**New files:**
- `backend/services/lti/grades.py` — AGS score submission logic

**Modified files:**
- `backend/routes/lti.py` — Grade config endpoints
- `backend/services/practice_analytics.py` — Trigger grade passback on session.ended
- `backend/routes/curriculum_admin.py` — Include grade config in assignment serialization

**Shippable when:** Student completes practice → score appears in Canvas gradebook.

### Piece 5: PAT Fallback Polish + Testing

**Modified files:**
- `frontend/src/pages/CanvasConnectPage.tsx` — Show both LTI and PAT options
- `backend/tests/test_lti_*.py` — Unit tests for LTI handshake, identity matching, deep linking, grade passback

**New files:**
- `e2e/test-lti-flow.sh` — E2E test for the full LTI chain

**Shippable when:** Both LTI and PAT paths verified working side by side. Full E2E coverage.

## Security Considerations

- **JWT validation:** All LTI launch JWTs are validated against Canvas's JWKS endpoint. `pylti1p3` handles key rotation and signature verification.
- **Nonce/state:** OIDC login flow uses nonce + state parameters to prevent replay attacks. Managed by `pylti1p3`'s session cache.
- **Access tokens:** LTI access tokens are short-lived (Canvas default: 1 hour). Stored in `lti_sessions`, refreshed via client_credentials grant when expired.
- **Private key:** RSA private key for signing stored in Secret Manager, never in code or Firestore.
- **PAT coexistence:** Existing PAT encryption (AES-256-GCM) unchanged. LTI connections simply don't use the `encrypted_pat` field.
- **HTTPS required:** All LTI endpoints must be served over HTTPS (Canvas requirement for LTI 1.3).
