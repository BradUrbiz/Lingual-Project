# Pilot Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the school integration beta pilot-ready by adding in-app onboarding hints, a public compliance page, Firestore rules emulator tests, and sensitive access disclosure logging.

**Architecture:** Four independent deliverables. (1) A reusable `<OnboardingHint>` React component placed on 3 existing pages, driven by data those pages already load. (2) A new public `/compliance` route with static content. (3) Firebase Emulator rule tests validating existing `firestore.rules`. (4) A backend disclosure logging service called from existing route handlers.

**Tech Stack:** React 19 + TypeScript + Tailwind CSS 4, Flask + Firestore, `@firebase/rules-unit-testing` + Firebase Emulator.

**Spec:** `docs/superpowers/specs/2026-03-11-pilot-hardening-design.md`

---

## Chunk 1: OnboardingHint component and dashboard hints

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/components/ui/OnboardingHint.tsx` | Reusable hint banner component |
| Create | `frontend/src/components/ui/OnboardingHint.test.tsx` | Component unit tests |
| Modify | `frontend/src/pages/TeacherDashboardPage.tsx` | Add 3 hint placements |
| Modify | `frontend/src/pages/TeacherClassAnalyticsPage.tsx` | Add 3 hint placements (0 enrollments, no mappings proxy, no assignments) |
| Modify | `frontend/src/pages/TeacherClassCompliancePage.tsx` | Add 1 hint placement |

### Task 1: Create the OnboardingHint component

- [ ] **Step 1: Write the component tests**

Create `frontend/src/components/ui/OnboardingHint.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingHint } from './OnboardingHint';

describe('OnboardingHint', () => {
  const wrap = (ui: React.ReactNode) =>
    render(<MemoryRouter>{ui}</MemoryRouter>);

  it('renders nothing when show is false', () => {
    const { container } = wrap(
      <OnboardingHint show={false} message="Test" ctaLabel="Go" ctaTo="/test" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders banner with message and CTA when show is true', () => {
    wrap(
      <OnboardingHint show={true} message="Create your first class" ctaLabel="Create Class" ctaTo="/create" />
    );
    expect(screen.getByText('Create your first class')).toBeTruthy();
    expect(screen.getByText('Create Class')).toBeTruthy();
  });

  it('renders CTA as a link to ctaTo', () => {
    wrap(
      <OnboardingHint show={true} message="Test" ctaLabel="Go" ctaTo="/target" />
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link.getAttribute('href')).toBe('/target');
  });

  it('renders without CTA when ctaLabel is omitted', () => {
    wrap(
      <OnboardingHint show={true} message="Just info" />
    );
    expect(screen.getByText('Just info')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ui/OnboardingHint.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement OnboardingHint component**

Create `frontend/src/components/ui/OnboardingHint.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';

interface OnboardingHintProps {
  show: boolean;
  message: string;
  ctaLabel?: string;
  ctaTo?: string;
}

export function OnboardingHint({ show, message, ctaLabel, ctaTo }: OnboardingHintProps) {
  if (!show) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
      <Lightbulb className="h-5 w-5 shrink-0" />
      <span className="flex-1">{message}</span>
      {ctaLabel && ctaTo && (
        <Link
          to={ctaTo}
          className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ui/OnboardingHint.test.tsx`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/OnboardingHint.tsx frontend/src/components/ui/OnboardingHint.test.tsx
git commit -m "feat: add OnboardingHint component for pilot onboarding"
```

### Task 2: Add hints to TeacherDashboardPage

The dashboard already loads `TeacherDashboardData` which contains `classes[]` with student counts and assignment counts. Use this existing data.

**Key context:** The dashboard data shape (from `frontend/src/api/teacher.ts` → `getTeacherDashboard()`) includes:
- `dashboard.classes` — array of class objects
- `dashboard.summaryStats.totalStudents`
- `dashboard.summaryStats.totalAssignments`

- [ ] **Step 1: Add hint import and compute show conditions**

Modify `frontend/src/pages/TeacherDashboardPage.tsx`:

Add import at the top:

```tsx
import { OnboardingHint } from '@/components/ui/OnboardingHint';
```

- [ ] **Step 2: Add hint JSX above the class list section**

Find the section where the class list renders (after summary stats cards, before the class cards). Insert hints in priority order — only the first matching one shows:

```tsx
{dashboard && (
  <>
    <OnboardingHint
      show={dashboard.classes.length === 0}
      message="Create your first class to get started."
      ctaLabel="Create Class"
      ctaTo="/app/teacher"
    />
    <OnboardingHint
      show={dashboard.classes.length > 0 && dashboard.summaryStats.totalStudents === 0}
      message="Invite students to your class using a join code."
      ctaLabel="Go to Class"
      ctaTo={`/app/teacher/classes/${dashboard.classes[0]?.id}/analytics`}
    />
    <OnboardingHint
      show={dashboard.classes.length > 0 && dashboard.summaryStats.totalStudents > 0 && dashboard.summaryStats.totalAssignments === 0}
      message="Create your first assignment from a class page."
      ctaLabel="Go to Class"
      ctaTo={`/app/teacher/classes/${dashboard.classes[0]?.id}/assignments`}
    />
  </>
)}
```

Note: The "Create Class" CTA points to the dashboard itself where the create class dialog lives. The implementer should check where the create class dialog trigger is and link the CTA accordingly — it may be better as an `onClick` that opens the dialog instead of a link. Adapt based on the existing page structure.

- [ ] **Step 3: Verify in dev server**

Run: `cd frontend && npm run dev`
Navigate to `/app/teacher` as a teacher with no classes. Verify the "Create your first class" hint appears.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/TeacherDashboardPage.tsx
git commit -m "feat: add onboarding hints to teacher dashboard"
```

### Task 3: Add hints to TeacherClassAnalyticsPage

The class analytics page already loads `ClassAnalyticsData` which includes `enrolledStudents`, `assignments[]`, and curriculum mapping counts.

**Key context:** `getClassAnalytics(classId)` returns data with:
- `analytics.enrolledStudents` — student count
- `analytics.assignments` — array of assignment summaries
- The page already has `classId` from `useParams()`

The analytics payload includes `enrolledStudents` (count) and `assignments[]` (array). Use `assignments.length === 0` as a proxy for "no curriculum mappings" since assignments require mappings.

- [ ] **Step 1: Add hint import and JSX**

Modify `frontend/src/pages/TeacherClassAnalyticsPage.tsx`:

Add import:

```tsx
import { OnboardingHint } from '@/components/ui/OnboardingHint';
```

Add hints above the main analytics content (after loading/error checks, before summary stats). Priority order — only the first matching hint renders (the component returns null when `show` is false, so earlier truthy conditions naturally take priority):

```tsx
{analytics && (
  <>
    <OnboardingHint
      show={analytics.enrolledStudents === 0}
      message="Share the join code with your students to get started."
      ctaLabel="Manage Join Code"
      ctaTo={`/app/teacher`}
    />
    <OnboardingHint
      show={analytics.enrolledStudents > 0 && analytics.assignments.length === 0}
      message="Map your curriculum to create assignments."
      ctaLabel="Map Curriculum"
      ctaTo={`/app/teacher/classes/${classId}/assignments`}
    />
    <OnboardingHint
      show={analytics.enrolledStudents > 0 && analytics.assignments.length > 0 && analytics.assignments.every((a: { sessionCount?: number }) => (a.sessionCount ?? 0) === 0)}
      message="Your assignments are ready — students can start practicing."
    />
  </>
)}
```

Note: The third hint ("assignments ready but no sessions") is informational only — no CTA needed since it's about student action. The "Manage Join Code" CTA links to the dashboard where join code dialogs live.

- [ ] **Step 2: Verify in dev server**

Navigate to a class with 0 students → hint appears. Add a student → hint changes to assignment hint (if no assignments). Create an assignment → hints disappear.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/TeacherClassAnalyticsPage.tsx
git commit -m "feat: add onboarding hints to class analytics page"
```

### Task 4: Add hint to TeacherClassCompliancePage

The compliance page already loads `ClassComplianceRosterData` which contains a summary with `voiceBlockedCount`.

**Key context:** `getClassComplianceRoster(classId)` returns:
- `roster.summary.voiceBlockedCount`
- `roster.summary.unknownConsentCount`
- `roster.summary.guardianActionRequiredCount`

- [ ] **Step 1: Add hint import and JSX**

Modify `frontend/src/pages/TeacherClassCompliancePage.tsx`:

Add import:

```tsx
import { OnboardingHint } from '@/components/ui/OnboardingHint';
```

Add hint above the roster (after summary stats):

```tsx
{roster && (
  <OnboardingHint
    show={roster.summary.unknownConsentCount > 0 || roster.summary.guardianActionRequiredCount > 0}
    message="Review consent status for students before enabling voice practice."
  />
)}
```

No CTA needed — the action is on the same page (the roster below).

- [ ] **Step 2: Verify in dev server**

Navigate to compliance page for a class with students missing consent → hint appears. Update all students → hint disappears.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/TeacherClassCompliancePage.tsx
git commit -m "feat: add onboarding hint to class compliance page"
```

---

## Chunk 2: Public compliance page

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/pages/CompliancePage.tsx` | Static compliance info page |
| Modify | `frontend/src/App.tsx` | Add public `/compliance` route |

### Task 5: Create CompliancePage component

- [ ] **Step 1: Create the page component**

Create `frontend/src/pages/CompliancePage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Shield, Database, Users, Clock, Trash2, Scale } from 'lucide-react';

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-blue-600" />
        <h2 className="text-xl font-semibold">{title}</h2>
      </div>
      <div className="text-gray-700 dark:text-gray-300 space-y-2">{children}</div>
    </section>
  );
}

export default function CompliancePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Lingual — Data & Compliance Overview</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Information for school administrators and coordinators evaluating Lingual for pilot use.
        </p>
      </div>

      <div className="space-y-8">
        <Section icon={Database} title="What data we collect">
          <ul className="list-disc pl-5 space-y-1">
            <li>Student text transcripts from practice sessions</li>
            <li>Voice transcripts when voice mode is enabled and consented</li>
            <li>Session metadata: duration, turn counts, modality used</li>
            <li>Learning events: target expression usage, feedback events, self-corrections</li>
            <li>Consent records and audit trails for compliance tracking</li>
          </ul>
          <p>We do not collect biometric identifiers, voiceprints, or speaker recognition data.</p>
        </Section>

        <Section icon={Shield} title="How consent works">
          <ul className="list-disc pl-5 space-y-1">
            <li>Voice-enabled practice requires explicit consent before any session can start.</li>
            <li>If voice consent is not granted, sessions are blocked or downgraded to text-only when the teacher has enabled text fallback.</li>
            <li>Guardian consent can be collected via secure-link packets issued by school staff.</li>
            <li>Consent status is tracked per student per organization with a full audit trail.</li>
            <li>Teachers and school admins can review and update consent within their authorized scope.</li>
          </ul>
        </Section>

        <Section icon={Users} title="Who can access what">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Students</strong> can view their own profile, practice history, and compliance state.</li>
            <li><strong>Teachers</strong> can view data for students in their own classes only.</li>
            <li><strong>School administrators</strong> can view organization-wide data, manage consent, and initiate deletion requests.</li>
          </ul>
          <p>All access follows role-based scoping enforced at both the API and database rule level.</p>
        </Section>

        <Section icon={Clock} title="Data retention defaults">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Raw audio:</strong> 30 days (when stored)</li>
            <li><strong>Transcripts and session summaries:</strong> 365 days</li>
            <li><strong>Aggregated analytics:</strong> academic term length plus 1 year</li>
          </ul>
          <p>Retention policies are configurable per organization. These are conservative defaults.</p>
        </Section>

        <Section icon={Trash2} title="Deletion process">
          <ul className="list-disc pl-5 space-y-1">
            <li>School administrators can submit deletion requests for student, class, or organization scope.</li>
            <li>Requests go through an approval gate before execution.</li>
            <li>Execution is auditable with detailed summaries of what was deleted.</li>
            <li>Failed or partial deletions can be retried.</li>
            <li>Target SLA: 7 days from approval to completion.</li>
          </ul>
        </Section>

        <Section icon={Scale} title="Compliance posture">
          <p>
            Lingual's school integration is designed with awareness of COPPA, FERPA, and state
            biometric privacy laws including Illinois BIPA. The architecture enforces consent-gated
            voice access, role-scoped data visibility, auditable consent trails, and configurable
            retention policies.
          </p>
          <p>
            This is not a certification claim. Formal counsel review is part of our production
            readiness process. Schools should evaluate Lingual's controls against their own
            compliance requirements.
          </p>
        </Section>
      </div>

      <div className="mt-12 border-t pt-6 text-sm text-gray-500 dark:text-gray-400">
        <p>
          Questions? Contact us at{' '}
          <a href="mailto:support@lingual.app" className="text-blue-600 hover:underline">
            support@lingual.app
          </a>
        </p>
        <p className="mt-1">
          <Link to="/" className="text-blue-600 hover:underline">← Back to Lingual</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route to App.tsx**

Modify `frontend/src/App.tsx`:

Add lazy import near other lazy imports:

```tsx
const CompliancePage = lazy(() => import('./pages/CompliancePage'));
```

Add route as a public (unauthenticated) route alongside `/auth` and `/guardian/consent/:token`:

```tsx
<Route path="/compliance" element={<Suspense fallback={<div />}><CompliancePage /></Suspense>} />
```

- [ ] **Step 3: Verify in dev server**

Run: `cd frontend && npm run dev`
Navigate to `http://localhost:5173/compliance` without logging in. Page should render all 6 sections.

- [ ] **Step 4: Run build to check for type errors**

Run: `cd frontend && npm run build`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CompliancePage.tsx frontend/src/App.tsx
git commit -m "feat: add public compliance information page"
```

---

## Chunk 3: Firestore rules emulator tests

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `firebase-tests/package.json` | Test project dependencies |
| Create | `firebase-tests/firestore-rules.test.ts` | Rule validation tests |
| Create | `firebase-tests/tsconfig.json` | TypeScript config for tests |
| Modify | `docs/school-integration/LIMITATIONS.md` | Update item #10 |

### Task 6: Set up Firebase test project

- [ ] **Step 1: Create test project**

```bash
mkdir -p firebase-tests
```

Create `firebase-tests/package.json`:

```json
{
  "name": "lingual-firestore-rules-tests",
  "private": true,
  "scripts": {
    "test": "firebase emulators:exec --only firestore --project lingu-480600 'npx vitest run'"
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^3.0.0",
    "firebase": "^10.0.0",
    "vitest": "^1.0.0",
    "typescript": "^5.0.0"
  }
}
```

Create `firebase-tests/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "types": ["vitest/globals"]
  },
  "include": ["*.test.ts"]
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd firebase-tests && npm install`
Expected: dependencies install successfully

- [ ] **Step 3: Commit test project setup**

```bash
git add firebase-tests/package.json firebase-tests/tsconfig.json
git commit -m "chore: set up Firebase rules test project"
```

### Task 7: Write Firestore rules tests

This is a large test file. The key challenge is setting up test data correctly — each Firestore rule depends on reading related documents (users, memberships, classes, enrollments) to evaluate access.

- [ ] **Step 1: Create the test file with full implementation**

Create `firebase-tests/firestore-rules.test.ts`:

```typescript
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'lingu-480600',
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // Seed test data using admin context (bypasses rules)
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Users
    await setDoc(doc(db, 'users', 'teacher1'), {
      last_active_membership_id: 'mem_teacher1',
    });
    await setDoc(doc(db, 'users', 'admin1'), {
      last_active_membership_id: 'mem_admin1',
    });
    await setDoc(doc(db, 'users', 'student1'), {
      last_active_membership_id: 'mem_student1',
    });
    await setDoc(doc(db, 'users', 'outsider'), {});

    // Memberships
    await setDoc(doc(db, 'memberships', 'mem_teacher1'), {
      org_id: 'org1', uid: 'teacher1', roles: ['teacher'], status: 'active',
    });
    await setDoc(doc(db, 'memberships', 'mem_admin1'), {
      org_id: 'org1', uid: 'admin1', roles: ['school_admin'], status: 'active',
    });
    await setDoc(doc(db, 'memberships', 'mem_student1'), {
      org_id: 'org1', uid: 'student1', roles: ['student'], status: 'active',
    });

    // Organization
    await setDoc(doc(db, 'organizations', 'org1'), { name: 'Test School' });

    // Class
    await setDoc(doc(db, 'classes', 'class1'), {
      org_id: 'org1', teacher_membership_ids: ['mem_teacher1'],
    });

    // Enrollment (composite ID matching rule: classId + '_' + uid)
    await setDoc(doc(db, 'enrollments', 'class1_student1'), {
      class_id: 'class1', student_uid: 'student1', status: 'active',
    });

    // Curriculum mapping
    await setDoc(doc(db, 'curriculum_mappings', 'map1'), {
      class_id: 'class1',
    });

    // Assignment
    await setDoc(doc(db, 'assignments', 'assign1'), {
      class_id: 'class1',
    });

    // Compliance record
    await setDoc(doc(db, 'student_compliance_records', 'rec1'), {
      org_id: 'org1', student_uid: 'student1',
    });

    // Consent event
    await setDoc(doc(db, 'consent_events', 'evt1'), {
      org_id: 'org1', student_uid: 'student1',
    });

    // Deletion request
    await setDoc(doc(db, 'deletion_requests', 'del1'), {
      org_id: 'org1',
    });

    // Deletion execution run
    await setDoc(doc(db, 'deletion_execution_runs', 'run1'), {
      org_id: 'org1',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// Helper: get authenticated firestore for a specific user
function authedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

function unauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

describe('users/{uid}', () => {
  it('owner can read own doc', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'users', 'teacher1')));
  });

  it('owner can write own doc', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(setDoc(doc(db, 'users', 'teacher1'), { name: 'updated' }));
  });

  it('other user cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'users', 'teacher1')));
  });

  it('other user cannot write', async () => {
    const db = authedDb('outsider');
    await assertFails(setDoc(doc(db, 'users', 'teacher1'), { name: 'hacked' }));
  });
});

describe('organizations/{orgId}', () => {
  it('active org member can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'organizations', 'org1')));
  });

  it('non-member cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'organizations', 'org1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'organizations', 'org1'), { name: 'hacked' }));
  });
});

describe('memberships/{membershipId}', () => {
  it('owner can read own membership', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'memberships', 'mem_teacher1')));
  });

  it('school_admin can read org member memberships', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'memberships', 'mem_teacher1')));
  });

  it('non-owner non-admin cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'memberships', 'mem_teacher1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'memberships', 'mem_teacher1'), { roles: ['school_admin'] }));
  });
});

describe('classes/{classId}', () => {
  it('teacher in teacher_membership_ids can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'classes', 'class1')));
  });

  it('enrolled student can read', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'classes', 'class1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'classes', 'class1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('teacher1');
    await assertFails(setDoc(doc(db, 'classes', 'class1'), { name: 'changed' }));
  });
});

describe('enrollments/{enrollmentId}', () => {
  it('student can read own enrollment', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'enrollments', 'class1_student1')));
  });

  it('class teacher can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'enrollments', 'class1_student1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'enrollments', 'class1_student1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('teacher1');
    await assertFails(setDoc(doc(db, 'enrollments', 'class1_student1'), { status: 'removed' }));
  });
});

describe('curriculum_mappings/{mappingId}', () => {
  it('class teacher can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'curriculum_mappings', 'map1')));
  });

  it('student cannot read', async () => {
    const db = authedDb('student1');
    await assertFails(getDoc(doc(db, 'curriculum_mappings', 'map1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('teacher1');
    await assertFails(setDoc(doc(db, 'curriculum_mappings', 'map1'), { target: 'changed' }));
  });
});

describe('assignments/{assignmentId}', () => {
  it('class teacher can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'assignments', 'assign1')));
  });

  it('enrolled student can read', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'assignments', 'assign1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'assignments', 'assign1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('teacher1');
    await assertFails(setDoc(doc(db, 'assignments', 'assign1'), { title: 'changed' }));
  });
});

describe('student_compliance_records/{recordId}', () => {
  it('student can read own record', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'student_compliance_records', 'rec1')));
  });

  it('teacher in org can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'student_compliance_records', 'rec1')));
  });

  it('admin in org can read', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'student_compliance_records', 'rec1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'student_compliance_records', 'rec1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'student_compliance_records', 'rec1'), { voice_allowed: true }));
  });
});

describe('consent_events/{eventId}', () => {
  it('school_admin in org can read', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'consent_events', 'evt1')));
  });

  it('teacher cannot read', async () => {
    const db = authedDb('teacher1');
    await assertFails(getDoc(doc(db, 'consent_events', 'evt1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'consent_events', 'evt1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'consent_events', 'evt1'), { event_type: 'tampered' }));
  });
});

describe('deletion_requests/{requestId}', () => {
  it('school_admin in org can read', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'deletion_requests', 'del1')));
  });

  it('teacher cannot read', async () => {
    const db = authedDb('teacher1');
    await assertFails(getDoc(doc(db, 'deletion_requests', 'del1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'deletion_requests', 'del1'), { status: 'approved' }));
  });
});

describe('deletion_execution_runs/{runId}', () => {
  it('school_admin in org can read', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'deletion_execution_runs', 'run1')));
  });

  it('teacher cannot read', async () => {
    const db = authedDb('teacher1');
    await assertFails(getDoc(doc(db, 'deletion_execution_runs', 'run1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'deletion_execution_runs', 'run1'), { status: 'completed' }));
  });
});

describe('catch-all', () => {
  it('denies read on unknown collection', async () => {
    const db = authedDb('admin1');
    await assertFails(getDoc(doc(db, 'unknown_collection', 'doc1')));
  });

  it('denies write on unknown collection', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'unknown_collection', 'doc1'), { data: 'test' }));
  });

  it('unauthenticated user denied everywhere', async () => {
    const db = unauthDb();
    await assertFails(getDoc(doc(db, 'users', 'teacher1')));
    await assertFails(getDoc(doc(db, 'organizations', 'org1')));
    await assertFails(getDoc(doc(db, 'classes', 'class1')));
  });
});
```

- [ ] **Step 2: Run tests with emulator**

Run: `cd firebase-tests && npm test`
Expected: All tests pass. If any fail, it reveals a real rule gap to investigate.

- [ ] **Step 3: Update LIMITATIONS.md item #10**

Change item #10 in `docs/school-integration/LIMITATIONS.md` from:

> Firestore rules are now school-aware for the current collections, but they have not yet been validated in a Firebase emulator or deployment rehearsal for all school flows.

To:

> Firestore rules are now school-aware and validated via Firebase Emulator rule tests (`firebase-tests/`). Deployment rehearsal is still pending before pilot hardening is complete.

- [ ] **Step 4: Commit**

```bash
git add firebase-tests/firestore-rules.test.ts docs/school-integration/LIMITATIONS.md
git commit -m "test: add Firestore rules emulator tests, update LIMITATIONS.md"
```

---

## Chunk 4: Sensitive access disclosure logging

### File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `backend/services/disclosure_logging.py` | Deduped disclosure event service |
| Create | `backend/tests/test_disclosure_logging.py` | Unit tests for the service |
| Modify | `backend/routes/curriculum_admin.py` | Add logging to student drill-down |
| Modify | `backend/routes/admin.py` | Add logging to admin compliance roster |
| Modify | `docs/school-integration/TASKS.md` | Mark item complete |

### Task 8: Create disclosure logging service

- [ ] **Step 1: Write the service tests**

Create `backend/tests/test_disclosure_logging.py`:

```python
import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

class TestDisclosureLogging(unittest.TestCase):

    @patch('backend.services.disclosure_logging.get_consent_events_collection')
    @patch('backend.services.disclosure_logging.create_consent_event')
    def test_logs_event_when_no_existing_event_today(self, mock_create, mock_collection):
        """First access today should create a consent event."""
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get.return_value = []  # no existing events
        mock_collection.return_value = mock_query

        from backend.services.disclosure_logging import log_disclosure_if_new
        log_disclosure_if_new(
            org_id='org1',
            actor_uid='teacher1',
            actor_role='teacher',
            student_uid='student1',
            event_type='disclosure.compliance_viewed',
            payload={'endpoint': '/api/test', 'class_id': 'class1'}
        )

        mock_create.assert_called_once()
        call_kwargs = mock_create.call_args[1]
        self.assertEqual(call_kwargs['org_id'], 'org1')
        self.assertEqual(call_kwargs['event_type'], 'disclosure.compliance_viewed')
        self.assertEqual(call_kwargs['actor_id'], 'teacher1')
        self.assertEqual(call_kwargs['student_uid'], 'student1')

    @patch('backend.services.disclosure_logging.get_consent_events_collection')
    @patch('backend.services.disclosure_logging.create_consent_event')
    def test_skips_event_when_already_logged_today(self, mock_create, mock_collection):
        """Duplicate access same day should not create another event."""
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get.return_value = [MagicMock()]  # existing event found
        mock_collection.return_value = mock_query

        from backend.services.disclosure_logging import log_disclosure_if_new
        log_disclosure_if_new(
            org_id='org1',
            actor_uid='teacher1',
            actor_role='teacher',
            student_uid='student1',
            event_type='disclosure.compliance_viewed',
            payload={'endpoint': '/api/test', 'class_id': 'class1'}
        )

        mock_create.assert_not_called()

if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest backend.tests.test_disclosure_logging`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the service**

Create `backend/services/disclosure_logging.py`:

```python
from datetime import datetime, timezone, timedelta
from database import get_consent_events_collection, create_consent_event


def log_disclosure_if_new(
    *,
    org_id: str,
    actor_uid: str,
    actor_role: str,
    student_uid: str,
    event_type: str,
    payload: dict | None = None,
):
    """Log a disclosure event if this actor hasn't accessed this student's data today."""
    now = datetime.now(timezone.utc)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_next_day = start_of_day + timedelta(days=1)

    existing = (
        get_consent_events_collection()
        .where('actor_id', '==', actor_uid)
        .where('student_uid', '==', student_uid)
        .where('event_type', '==', event_type)
        .where('created_at', '>=', start_of_day)
        .where('created_at', '<', start_of_next_day)
        .limit(1)
        .get()
    )

    if len(list(existing)) > 0:
        return

    create_consent_event(
        org_id=org_id,
        student_uid=student_uid,
        scope_type='student',
        scope_id=student_uid,
        event_type=event_type,
        actor_type=actor_role,
        actor_id=actor_uid,
        payload=payload or {},
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest backend.tests.test_disclosure_logging`
Expected: PASS — both tests

- [ ] **Step 5: Commit**

```bash
git add backend/services/disclosure_logging.py backend/tests/test_disclosure_logging.py
git commit -m "feat: add disclosure logging service with daily deduplication"
```

### Task 9: Wire disclosure logging into routes

- [ ] **Step 1: Add logging to student analytics and student compliance endpoints**

Modify `backend/routes/curriculum_admin.py`:

Add import at top:

```python
from backend.services.disclosure_logging import log_disclosure_if_new
```

In the `GET /api/teacher/classes/<class_id>/students/<student_uid>/analytics` handler, after `_require_teacher_context(deps, class_id)` succeeds and before returning the response, add:

```python
log_disclosure_if_new(
    org_id=ctx['org_id'],
    actor_uid=ctx['uid'],
    actor_role='teacher',
    student_uid=student_uid,
    event_type='disclosure.practice_data_viewed',
    payload={'endpoint': f'/api/teacher/classes/{class_id}/students/{student_uid}/analytics', 'class_id': class_id}
)
```

Also find the student compliance GET handler. Based on `frontend/src/api/teacher.ts`, the endpoint is `GET /api/teacher/classes/<class_id>/students/<student_uid>/compliance`. In that handler, after the teacher context check, add:

```python
log_disclosure_if_new(
    org_id=ctx['org_id'],
    actor_uid=ctx['uid'],
    actor_role='teacher',
    student_uid=student_uid,
    event_type='disclosure.compliance_viewed',
    payload={'endpoint': f'/api/teacher/classes/{class_id}/students/{student_uid}/compliance', 'class_id': class_id}
)
```

Note: The teacher context variable name (`ctx`) depends on the handler — `_require_teacher_context(deps, class_id)` returns a dict with `org_id` and `uid`. Check the actual variable name in the handler. If the compliance endpoint is in `backend/routes/admin.py` instead, add the import and logging call there.

- [ ] **Step 2: Add logging to admin compliance roster**

Modify `backend/routes/admin.py`:

Add import at top:

```python
from backend.services.disclosure_logging import log_disclosure_if_new
```

In the `GET /api/admin/compliance/roster` handler, after building the roster but before returning, log a single org-scoped disclosure event (not per-student) to avoid N+1 Firestore writes on every roster load. The roster view is a bulk access event, not individual student access:

```python
log_disclosure_if_new(
    org_id=org_id,
    actor_uid=uid,
    actor_role='school_admin',
    student_uid='',  # org-scoped, not student-specific
    event_type='disclosure.compliance_viewed',
    payload={'endpoint': '/api/admin/compliance/roster', 'student_count': len(roster_students)}
)
```

Note: Since `student_uid` is empty, the dedup query will match on `(actor_id, '', event_type, today)` — one event per admin per day for this roster view. Per-student logging happens when the admin drills into individual student views.

- [ ] **Step 3: Run existing backend tests to check for regressions**

Run: `python3 -m unittest backend.tests.test_curriculum_admin_routes backend.tests.test_deletion_requests`
Expected: PASS — no regressions

- [ ] **Step 4: Commit**

```bash
git add backend/routes/curriculum_admin.py backend/routes/admin.py
git commit -m "feat: wire disclosure logging into student and admin endpoints"
```

### Task 10: Update TASKS.md and final docs

- [ ] **Step 1: Update TASKS.md**

In `docs/school-integration/TASKS.md`, change the sensitive access logging item from:

```
- [-] Log sensitive access and disclosure events required by policy.
```

To:

```
- [x] Log sensitive access and disclosure events required by policy.
```

- [ ] **Step 2: Commit**

```bash
git add docs/school-integration/TASKS.md
git commit -m "docs: mark disclosure logging task complete in TASKS.md"
```
