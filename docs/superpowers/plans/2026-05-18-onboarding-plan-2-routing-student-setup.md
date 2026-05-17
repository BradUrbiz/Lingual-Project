# Onboarding Plan 2 — Routing + Student Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `/auth` page with a purpose-built `/login` + `/signup` pair, drive post-auth navigation from a role + onboarding-state dispatcher, and anchor the existing student setup flow at the canonical `/signup/student/setup` URL. Visible behavior for student learners is preserved; teacher and admin signup paths render a placeholder until Plans 3 and 4 land.

**Architecture:** Three layers.
1. **Auth surface:** extend `AuthContext.signUpWithEmail` and `signInWithGoogle` to forward the user's chosen `intendedRole` to `/api/auth/verify` (Plan 1 already accepts it). `signInWithEmail` stays role-blind.
2. **Routing:** introduce `getOnboardingDestination(user)` in `lib/homeRoutes.ts` — a pure dispatcher that maps `(memberships, onboarding_state, intended_role, requires_legacy_role_pick)` to the right route. Every post-auth caller funnels through it.
3. **Signup UX:** new `SignupPage` is a two-step shell. Step 1 (`RolePicker`) writes role to local state; Step 2 (`AccountCreator`) creates the Firebase account and dispatches by role. Teacher and admin lead to thin "Coming soon" placeholder pages so the dispatcher always lands somewhere coherent before Plans 3 and 4 ship.

**Tech Stack:** React 19 + TypeScript, React Router v7, Vitest + React Testing Library, Tailwind 4, Framer Motion. Backend untouched in this plan.

**Spec reference:** `docs/superpowers/specs/2026-05-18-teacher-school-onboarding-design.md` — sections 1 and 2, plus the rollout-plan phases 3 and 4.

**Builds on:** `docs/superpowers/plans/2026-05-18-onboarding-plan-1-foundations-outbox.md` (auth contract + user payload fields are already shipped).

**Out of scope** (covered later):
- Teacher join-org flow → Plan 4 replaces `TeacherJoinOrgPlaceholderPage`
- Admin 4-step org wizard → Plan 3 replaces `AdminOrgWizardPlaceholderPage`
- Lingual admin panel → Plan 5
- Legacy role-pick modal → Plan 6 (the dispatcher routes `requires_legacy_role_pick=true` users to the existing student flow until then)
- Email notifications wired to anything in this plan (no new outbox writes)

---

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `frontend/src/contexts/AuthContext.tsx` | `signUpWithEmail` and `signInWithGoogle` take `{ intendedRole }` and forward to `verifyToken` |
| Modify | `frontend/src/lib/homeRoutes.ts` | Add `getOnboardingDestination(user)` dispatcher; keep `getPrivilegedHomeRoute` as a thin alias for back-compat |
| Create | `frontend/src/lib/homeRoutes.test.ts` | Unit tests for dispatcher matrix |
| Create | `frontend/src/components/signup/RolePicker.tsx` | Three-card role selector (controlled component) |
| Create | `frontend/src/components/signup/RolePicker.test.tsx` | Render + selection tests |
| Create | `frontend/src/components/signup/AccountCreator.tsx` | Email/password form + Google button; forwards `intendedRole` to auth |
| Create | `frontend/src/components/signup/AccountCreator.test.tsx` | Form submit + role forwarding tests |
| Create | `frontend/src/components/signup/index.ts` | Barrel export |
| Create | `frontend/src/pages/LoginPage.tsx` | Sign-in + password-reset only (extracted from `AuthPage`) |
| Create | `frontend/src/pages/LoginPage.test.tsx` | Sign-in + reset interactions |
| Create | `frontend/src/pages/SignupPage.tsx` | Two-step shell: `?role=` deep-link + dispatch on success |
| Create | `frontend/src/pages/SignupPage.test.tsx` | Step transitions + dispatch |
| Create | `frontend/src/pages/TeacherJoinOrgPlaceholderPage.tsx` | "Coming soon" landing for `/signup/teacher/join-org` |
| Create | `frontend/src/pages/AdminOrgWizardPlaceholderPage.tsx` | "Coming soon" landing for `/signup/admin/org-wizard` |
| Modify | `frontend/src/pages/LandingPage.tsx` | Three role-aware CTAs route to `/signup?role=…`; login button routes to `/login` |
| Modify | `frontend/src/components/layout/ProtectedRoute.tsx` | Redirect unauth'd users to `/login`, not `/auth` |
| Modify | `frontend/src/App.tsx` | New routes (`/login`, `/signup`, `/signup/student/setup`, `/signup/teacher/join-org`, `/signup/admin/org-wizard`); legacy redirects (`/auth` → `/login`, `/school/setup` → `/signup/admin/org-wizard`); `AppIndexRedirect` uses new dispatcher |
| Delete | `frontend/src/pages/AuthPage.tsx` | Replaced by `LoginPage` + `SignupPage` |
| Delete | `frontend/src/pages/AuthPage.test.tsx` | Superseded by `LoginPage.test.tsx` |

---

## Task 1: Forward `intendedRole` through `AuthContext.signUpWithEmail` and `signInWithGoogle`

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx`
- Test: `frontend/src/contexts/AuthContext.test.tsx` (create)

**Why:** `verifyToken` already accepts `{ intendedRole }` (Plan 1, `frontend/src/api/auth.ts:14-22`), but `AuthContext` calls it without options. Until this is fixed, the Signup page has no way to communicate the chosen role to the backend.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/contexts/AuthContext.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from './AuthContext';
import { useAuth } from '@/hooks/useAuth';
import { useEffect } from 'react';

const verifyTokenMock = vi.fn();

vi.mock('../api/auth', () => ({
  verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
  logout: vi.fn(),
}));

vi.mock('firebase/auth', async () => {
  const actual = await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
  return {
    ...actual,
    onAuthStateChanged: (_auth: unknown, cb: (u: null) => void) => {
      cb(null);
      return () => {};
    },
    createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
      user: { getIdToken: vi.fn().mockResolvedValue('id-token-signup') },
    }),
    signInWithPopup: vi.fn().mockResolvedValue({
      user: { getIdToken: vi.fn().mockResolvedValue('id-token-google') },
    }),
    signInWithEmailAndPassword: vi.fn().mockResolvedValue({
      user: { getIdToken: vi.fn().mockResolvedValue('id-token-signin') },
    }),
  };
});

vi.mock('../config/firebase', () => ({
  auth: { currentUser: null },
  googleProvider: {},
  githubProvider: {},
  facebookProvider: {},
}));

function CallSignUp({ role }: { role?: 'student' | 'teacher' | 'admin' }) {
  const { signUpWithEmail } = useAuth();
  useEffect(() => {
    signUpWithEmail('a@b.test', 'password123', role ? { intendedRole: role } : undefined);
  }, [signUpWithEmail, role]);
  return <div>ready</div>;
}

function CallGoogle({ role }: { role?: 'student' | 'teacher' | 'admin' }) {
  const { signInWithGoogle } = useAuth();
  useEffect(() => {
    signInWithGoogle(role ? { intendedRole: role } : undefined);
  }, [signInWithGoogle, role]);
  return <div>ready</div>;
}

describe('AuthContext intendedRole forwarding', () => {
  beforeEach(() => {
    verifyTokenMock.mockReset();
    verifyTokenMock.mockResolvedValue({ success: true, user: { uid: 'u1' } });
    localStorage.clear();
  });

  it('forwards intendedRole on email signup', async () => {
    render(
      <AuthProvider>
        <CallSignUp role="teacher" />
      </AuthProvider>,
    );
    await screen.findByText('ready');
    await waitFor(() => {
      expect(verifyTokenMock).toHaveBeenCalledWith('id-token-signup', { intendedRole: 'teacher' });
    });
  });

  it('forwards intendedRole on Google sign-in', async () => {
    render(
      <AuthProvider>
        <CallGoogle role="admin" />
      </AuthProvider>,
    );
    await screen.findByText('ready');
    await waitFor(() => {
      expect(verifyTokenMock).toHaveBeenCalledWith('id-token-google', { intendedRole: 'admin' });
    });
  });

  it('omits intendedRole when not provided', async () => {
    render(
      <AuthProvider>
        <CallSignUp />
      </AuthProvider>,
    );
    await screen.findByText('ready');
    await waitFor(() => {
      expect(verifyTokenMock).toHaveBeenCalledWith('id-token-signup', undefined);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/contexts/AuthContext.test.tsx`
Expected: FAIL — `signUpWithEmail` only takes 2 args; `expect(verifyTokenMock).toHaveBeenCalledWith('id-token-signup', { intendedRole: 'teacher' })` fails because the mock was called with no options.

- [ ] **Step 3: Implement: accept and forward `intendedRole`**

Modify `frontend/src/contexts/AuthContext.tsx`. Change the context type and the two methods:

```tsx
// near the existing IntendedRole import region:
import { verifyToken, type IntendedRole } from '../api/auth';

// in AuthContextType:
interface AuthContextType {
  // ... existing fields ...
  signUpWithEmail: (
    email: string,
    password: string,
    options?: { intendedRole?: IntendedRole },
  ) => Promise<void>;
  signInWithGoogle: (options?: { intendedRole?: IntendedRole }) => Promise<void>;
  // ... rest unchanged ...
}
```

Then update the implementations:

```tsx
const signUpWithEmail = async (
  email: string,
  password: string,
  options?: { intendedRole?: IntendedRole },
) => {
  setLoading(true);
  setError(null);

  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const idToken = await result.user.getIdToken();
    const verifyResult = await verifyToken(idToken, options);

    if (verifyResult.success && verifyResult.user) {
      setUser(verifyResult.user);
    } else {
      throw new Error(verifyResult.error || 'Failed to verify token');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sign up failed';
    setError(message);
    throw err;
  } finally {
    setLoading(false);
  }
};

const signInWithGoogle = async (options?: { intendedRole?: IntendedRole }) => {
  setLoading(true);
  setError(null);

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const idToken = await result.user.getIdToken();
    const verifyResult = await verifyToken(idToken, options);

    if (verifyResult.success && verifyResult.user) {
      setUser(verifyResult.user);
    } else {
      throw new Error(verifyResult.error || 'Failed to verify token');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Google sign in failed';
    setError(message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

Note: only the third argument of `signUpWithEmail` and the new argument of `signInWithGoogle` change. `verifyToken` already handles `undefined` options because `api/auth.ts` defaults to `{}`. Passing `undefined` straight through is fine — `verifyToken` calls `if (options.intendedRole)` so a missing key is a no-op on the request body.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/contexts/AuthContext.test.tsx`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/contexts/AuthContext.test.tsx
git commit -m "feat(auth): forward intendedRole through signUpWithEmail and signInWithGoogle"
```

---

## Task 2: Add `getOnboardingDestination` dispatcher in `homeRoutes.ts`

**Files:**
- Modify: `frontend/src/lib/homeRoutes.ts`
- Create: `frontend/src/lib/homeRoutes.test.ts`

**Why:** Centralizes the role + onboarding_state → route mapping. Every post-auth navigation (Login success, Signup success, App index redirect, ProtectedRoute redirect-back) must go through this single function so the rules in spec §1 stay consistent. Leaving `getPrivilegedHomeRoute` around lets the migration happen incrementally without a big-bang refactor.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/homeRoutes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  getOnboardingDestination,
  LEARNER_HOME_ROUTE,
  TEACHER_HOME_ROUTE,
  ADMIN_HOME_ROUTE,
  LINGUAL_ADMIN_HOME_ROUTE,
  STUDENT_SETUP_ROUTE,
  TEACHER_JOIN_ORG_ROUTE,
  ADMIN_ORG_WIZARD_ROUTE,
  ROLE_PICKER_ROUTE,
} from './homeRoutes';
import type { User } from '@/types';

function userOf(overrides: Partial<User> = {}): User {
  return {
    uid: 'u1',
    email: 'u@example.test',
    name: 'U',
    memberships: [],
    activeRoles: [],
    ...overrides,
  };
}

describe('getOnboardingDestination', () => {
  it('routes lingual admins to the lingual admin home', () => {
    const dest = getOnboardingDestination(userOf({ lingualAdmin: true }));
    expect(dest).toBe(LINGUAL_ADMIN_HOME_ROUTE);
  });

  it('routes active school_admin to teacher home (admin dashboard in this plan)', () => {
    const dest = getOnboardingDestination(
      userOf({
        memberships: [
          { membership_id: 'm1', org_id: 'o1', roles: ['school_admin'], status: 'active' },
        ],
        activeRoles: ['school_admin'],
      }),
    );
    expect(dest).toBe(TEACHER_HOME_ROUTE);
  });

  it('routes active teacher to teacher home', () => {
    const dest = getOnboardingDestination(
      userOf({
        memberships: [
          { membership_id: 'm1', org_id: 'o1', roles: ['teacher'], status: 'active' },
        ],
        activeRoles: ['teacher'],
      }),
    );
    expect(dest).toBe(TEACHER_HOME_ROUTE);
  });

  it('routes completed students to learner home', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'student', onboardingState: 'complete' }),
    );
    expect(dest).toBe(LEARNER_HOME_ROUTE);
  });

  it('routes intended student without state to student setup', () => {
    const dest = getOnboardingDestination(userOf({ intendedRole: 'student' }));
    expect(dest).toBe(STUDENT_SETUP_ROUTE);
  });

  it('resumes intended teacher to teacher join-org page', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'teacher', onboardingState: 'role_selected' }),
    );
    expect(dest).toBe(TEACHER_JOIN_ORG_ROUTE);
  });

  it('resumes intended teacher pending to teacher join-org page', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'teacher', onboardingState: 'teacher_pending' }),
    );
    expect(dest).toBe(TEACHER_JOIN_ORG_ROUTE);
  });

  it('resumes intended admin to wizard', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'admin', onboardingState: 'role_selected' }),
    );
    expect(dest).toBe(ADMIN_ORG_WIZARD_ROUTE);
  });

  it('resumes intended admin awaiting Lingual to the wizard pending page', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'admin', onboardingState: 'awaiting_lingual' }),
    );
    expect(dest).toBe(ADMIN_ORG_WIZARD_ROUTE);
  });

  it('legacy user without role falls back to student setup until Plan 6', () => {
    const dest = getOnboardingDestination(
      userOf({ requiresLegacyRolePick: true }),
    );
    expect(dest).toBe(STUDENT_SETUP_ROUTE);
  });

  it('user with no signals lands on role picker', () => {
    const dest = getOnboardingDestination(userOf());
    expect(dest).toBe(ROLE_PICKER_ROUTE);
  });

  it('returns null for unauthenticated', () => {
    expect(getOnboardingDestination(null)).toBeNull();
    expect(getOnboardingDestination(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/lib/homeRoutes.test.ts`
Expected: FAIL — `getOnboardingDestination is not a function`, plus missing constant exports.

- [ ] **Step 3: Implement: replace the body of `homeRoutes.ts`**

Replace the entire contents of `frontend/src/lib/homeRoutes.ts` with:

```ts
import type { User } from '@/types';
import type { SchoolRole } from '@/types/school';

// ── Routes the dispatcher can return ───────────────────────────────────────
export const LEARNER_HOME_ROUTE = '/app/learn';
export const TEACHER_HOME_ROUTE = '/app/teacher';
export const ADMIN_HOME_ROUTE = '/app/admin/school-requests';
export const LINGUAL_ADMIN_HOME_ROUTE = '/app/admin/school-requests';

export const STUDENT_SETUP_ROUTE = '/signup/student/setup';
export const TEACHER_JOIN_ORG_ROUTE = '/signup/teacher/join-org';
export const ADMIN_ORG_WIZARD_ROUTE = '/signup/admin/org-wizard';
export const ROLE_PICKER_ROUTE = '/signup';

// Legacy alias retained while pages still import it. New code should
// prefer `STUDENT_SETUP_ROUTE`.
export const LEARNER_SETUP_ROUTE = STUDENT_SETUP_ROUTE;

function activeRoles(user: User): Set<SchoolRole> {
  const fromMemberships = (user.memberships ?? [])
    .filter((m) => (m.status ?? 'active') === 'active')
    .flatMap((m) => m.roles ?? []);
  return new Set<SchoolRole>([...(user.activeRoles ?? []), ...fromMemberships]);
}

/**
 * Returns the route a privileged user should land on after sign-in.
 * Kept for callers that have not yet migrated to `getOnboardingDestination`.
 */
export function getPrivilegedHomeRoute(user: User | null | undefined): string | null {
  if (!user) return null;
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;

  const roles = activeRoles(user);
  if (roles.has('school_admin') || roles.has('teacher')) {
    return TEACHER_HOME_ROUTE;
  }
  return null;
}

/**
 * Single source of truth for "where should this user land after auth?".
 * Returns null when the user is not authenticated.
 *
 * Order matters. Membership-derived destinations win over `intendedRole`
 * because a returning user with a real membership should never be sent
 * back through the signup wizard.
 *
 * Until Plan 6 ships the legacy modal, `requiresLegacyRolePick` users
 * fall back to the existing student setup flow so legacy learners stay
 * functional.
 */
export function getOnboardingDestination(user: User | null | undefined): string | null {
  if (!user) return null;

  // 1) Lingual admin
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;

  // 2) Active memberships
  const roles = activeRoles(user);
  if (roles.has('school_admin') || roles.has('teacher')) {
    return TEACHER_HOME_ROUTE;
  }
  if (roles.has('student')) {
    return LEARNER_HOME_ROUTE;
  }

  // 3) Completed onboarding (legacy learners marked `complete` by Plan 1
  //    backfill or by finishing student setup).
  if (user.onboardingState === 'complete') {
    return LEARNER_HOME_ROUTE;
  }

  // 4) Resume in-flight signup based on intendedRole + onboardingState.
  if (user.intendedRole === 'student') return STUDENT_SETUP_ROUTE;
  if (user.intendedRole === 'teacher') return TEACHER_JOIN_ORG_ROUTE;
  if (user.intendedRole === 'admin') return ADMIN_ORG_WIZARD_ROUTE;

  // 5) Legacy users without intendedRole. Plan 6 will replace this with
  //    a blocking modal; until then, fall back to the existing student
  //    setup so learners keep working.
  if (user.requiresLegacyRolePick) return STUDENT_SETUP_ROUTE;

  // 6) Brand-new signup that somehow has no signals — force role pick.
  return ROLE_PICKER_ROUTE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/lib/homeRoutes.test.ts`
Expected: PASS (all 12 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/homeRoutes.ts frontend/src/lib/homeRoutes.test.ts
git commit -m "feat(routing): add getOnboardingDestination dispatcher with onboarding_state matrix"
```

---

## Task 3: Create the `RolePicker` component

**Files:**
- Create: `frontend/src/components/signup/RolePicker.tsx`
- Create: `frontend/src/components/signup/RolePicker.test.tsx`
- Create: `frontend/src/components/signup/index.ts`

**Why:** Step 1 of the signup state machine. A controlled presentational component — emits `onChange(role)` and renders the three cards specified in spec §2. Keeping it pure makes it testable without React Router or contexts.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/signup/RolePicker.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { RolePicker } from './RolePicker';

describe('RolePicker', () => {
  it('renders all three role cards', () => {
    render(<RolePicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /student/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /teacher/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /school administrator/i })).toBeInTheDocument();
  });

  it('marks the selected role as checked', () => {
    render(<RolePicker value="teacher" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /teacher/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /student/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /school administrator/i })).not.toBeChecked();
  });

  it('calls onChange with the picked role', () => {
    const onChange = vi.fn();
    render(<RolePicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /school administrator/i }));
    expect(onChange).toHaveBeenCalledWith('admin');
  });

  it('disables interaction when disabled prop is true', () => {
    const onChange = vi.fn();
    render(<RolePicker value="student" onChange={onChange} disabled />);
    const teacher = screen.getByRole('radio', { name: /teacher/i });
    expect(teacher).toBeDisabled();
    fireEvent.click(teacher);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/signup/RolePicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/signup/RolePicker.tsx`:

```tsx
import { GraduationCap, Briefcase, Building2 } from 'lucide-react';
import { Card } from '@/components/ui';

export type SignupRole = 'student' | 'teacher' | 'admin';

interface RoleOption {
  value: SignupRole;
  title: string;
  subtitle: string;
  Icon: typeof GraduationCap;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: 'student',
    title: 'Student',
    subtitle: "Practice speaking. Join your teacher's class.",
    Icon: GraduationCap,
  },
  {
    value: 'teacher',
    title: 'Teacher',
    subtitle: 'Manage classes and assignments. Join your school.',
    Icon: Briefcase,
  },
  {
    value: 'admin',
    title: 'School Administrator',
    subtitle: 'Register your school. Manage teachers and compliance.',
    Icon: Building2,
  },
];

export interface RolePickerProps {
  value: SignupRole | null;
  onChange: (role: SignupRole) => void;
  disabled?: boolean;
}

export function RolePicker({ value, onChange, disabled }: RolePickerProps) {
  return (
    <div role="radiogroup" aria-label="Choose your role" className="grid gap-4 md:grid-cols-3">
      {ROLE_OPTIONS.map(({ value: optionValue, title, subtitle, Icon }) => {
        const checked = value === optionValue;
        return (
          <label
            key={optionValue}
            className={`group cursor-pointer ${disabled ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              type="radio"
              name="signup-role"
              value={optionValue}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(optionValue)}
              className="sr-only"
              aria-label={title}
            />
            <Card
              className={`p-6 transition-all ${
                checked
                  ? 'border-primary ring-2 ring-primary/40 shadow-stamp-sm'
                  : 'hover:border-primary/60'
              }`}
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border-2 border-foreground bg-primary/10">
                <Icon size={24} strokeWidth={2} />
              </div>
              <p className="font-display text-lg font-bold">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            </Card>
          </label>
        );
      })}
    </div>
  );
}
```

Create `frontend/src/components/signup/index.ts`:

```ts
export { RolePicker, type SignupRole, type RolePickerProps } from './RolePicker';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/components/signup/RolePicker.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/signup/RolePicker.tsx frontend/src/components/signup/RolePicker.test.tsx frontend/src/components/signup/index.ts
git commit -m "feat(signup): add RolePicker component"
```

---

## Task 4: Create the `AccountCreator` component

**Files:**
- Create: `frontend/src/components/signup/AccountCreator.tsx`
- Create: `frontend/src/components/signup/AccountCreator.test.tsx`
- Modify: `frontend/src/components/signup/index.ts`

**Why:** Step 2 of signup — Firebase account creation. Takes the role chosen in Step 1 as a prop and forwards it through `signUpWithEmail` / `signInWithGoogle`. Splitting it from `SignupPage` keeps the page focused on state-machine transitions and lets us test the form interactions in isolation.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/signup/AccountCreator.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountCreator } from './AccountCreator';

const signUpMock = vi.fn();
const googleMock = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signUpWithEmail: (...args: unknown[]) => signUpMock(...args),
    signInWithGoogle: (...args: unknown[]) => googleMock(...args),
    error: null,
    clearError: vi.fn(),
  }),
}));

describe('AccountCreator', () => {
  beforeEach(() => {
    signUpMock.mockReset();
    signUpMock.mockResolvedValue(undefined);
    googleMock.mockReset();
    googleMock.mockResolvedValue(undefined);
  });

  it('forwards role and credentials on email submit', async () => {
    render(<AccountCreator intendedRole="teacher" onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith('a@b.test', 'hunter22', { intendedRole: 'teacher' });
    });
  });

  it('forwards role on Google signup', async () => {
    render(<AccountCreator intendedRole="admin" onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => {
      expect(googleMock).toHaveBeenCalledWith({ intendedRole: 'admin' });
    });
  });

  it('invokes onSuccess after a successful signup', async () => {
    const onSuccess = vi.fn();
    render(<AccountCreator intendedRole="student" onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call onSuccess when the auth call throws', async () => {
    signUpMock.mockRejectedValueOnce(new Error('boom'));
    const onSuccess = vi.fn();
    render(<AccountCreator intendedRole="student" onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/signup/AccountCreator.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/signup/AccountCreator.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { Button, Input, Alert, AlertDescription } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import type { SignupRole } from './RolePicker';

export interface AccountCreatorProps {
  intendedRole: SignupRole;
  onSuccess: () => void;
}

export function AccountCreator({ intendedRole, onSuccess }: AccountCreatorProps) {
  const { signUpWithEmail, signInWithGoogle, error, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await signUpWithEmail(email, password, { intendedRole });
      onSuccess();
    } catch {
      // error surfaced via context
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    clearError();
    setSubmitting(true);
    try {
      await signInWithGoogle({ intendedRole });
      onSuccess();
    } catch {
      // error surfaced via context
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleEmailSubmit} className="space-y-5">
        <Input
          type="email"
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@school.edu"
          required
          autoComplete="email"
        />
        <Input
          type="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          required
          minLength={6}
          autoComplete="new-password"
        />
        <Button type="submit" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>

      <div className="my-6 flex items-center gap-4">
        <div className="flex-1 border-t-2 border-border" />
        <span className="text-sm font-medium text-muted-foreground">or</span>
        <div className="flex-1 border-t-2 border-border" />
      </div>

      <Button
        type="button"
        variant="google"
        onClick={handleGoogle}
        disabled={submitting}
        className="w-full"
      >
        Continue with Google
      </Button>
    </div>
  );
}
```

Update `frontend/src/components/signup/index.ts`:

```ts
export { RolePicker, type SignupRole, type RolePickerProps } from './RolePicker';
export { AccountCreator, type AccountCreatorProps } from './AccountCreator';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/components/signup/AccountCreator.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/signup/AccountCreator.tsx frontend/src/components/signup/AccountCreator.test.tsx frontend/src/components/signup/index.ts
git commit -m "feat(signup): add AccountCreator component that forwards intendedRole"
```

---

## Task 5: Build the `LoginPage`

**Files:**
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/LoginPage.test.tsx`

**Why:** Replaces the sign-in half of `AuthPage`. Login does not need to know about `intendedRole` — returning users have memberships, and the dispatcher routes them based on those. Includes password reset, since spec §1 keeps reset on the login page.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/LoginPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';

const navigateMock = vi.fn();
const signInWithEmailMock = vi.fn();
const signInWithGoogleMock = vi.fn();
const sendPasswordResetMock = vi.fn();
const clearErrorMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ state: null }),
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
      <a href={typeof to === 'string' ? to : '#'} {...rest}>{children}</a>
    ),
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    error: null,
    signInWithEmail: (...args: unknown[]) => signInWithEmailMock(...args),
    signInWithGoogle: (...args: unknown[]) => signInWithGoogleMock(...args),
    sendPasswordReset: (...args: unknown[]) => sendPasswordResetMock(...args),
    clearError: clearErrorMock,
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    signInWithEmailMock.mockReset().mockResolvedValue(undefined);
    signInWithGoogleMock.mockReset().mockResolvedValue(undefined);
    sendPasswordResetMock.mockReset().mockResolvedValue(undefined);
    clearErrorMock.mockReset();
  });

  it('signs in with email and password', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(signInWithEmailMock).toHaveBeenCalledWith('a@b.test', 'hunter22');
    });
  });

  it('opens the password reset view and sends a reset link', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => {
      expect(sendPasswordResetMock).toHaveBeenCalledWith('a@b.test');
    });
    expect(await screen.findByText(/password reset link has been sent/i)).toBeInTheDocument();
  });

  it('renders a link to /signup for users without an account', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /sign up/i });
    expect(link).toHaveAttribute('href', '/signup');
  });

  it('signs in with Google when the Google button is clicked', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => {
      expect(signInWithGoogleMock).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/pages/LoginPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Create `frontend/src/pages/LoginPage.tsx`. The page is structurally similar to `AuthPage` but without the signup toggle — keep the existing layout and styling for visual continuity.

```tsx
import { useState, FormEvent, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Loader2, Languages, CheckCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button, Input, Card, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { getOnboardingDestination, LEARNER_HOME_ROUTE } from '@/lib/homeRoutes';

type Mode = 'signin' | 'reset';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    loading,
    error,
    signInWithEmail,
    sendPasswordReset,
    signInWithGoogle,
    clearError,
  } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const intendedFrom = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  useEffect(() => {
    if (user && !loading) {
      if (intendedFrom) {
        navigate(intendedFrom, { replace: true });
        return;
      }
      navigate(getOnboardingDestination(user) ?? LEARNER_HOME_ROUTE, { replace: true });
    }
  }, [user, loading, navigate, intendedFrom]);

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } catch {
      // surfaced via context
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setResetError(null);
    setResetSent(false);
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setResetSent(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    clearError();
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch {
      // surfaced via context
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-10 w-10 text-primary" strokeWidth={3} />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="relative min-h-screen bg-background flex items-center justify-center p-6">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="absolute left-6 top-6 z-10 inline-flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        aria-label="Back to landing page"
      >
        <ArrowLeft size={16} strokeWidth={2.5} />
        <span>Back</span>
      </button>

      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="hidden lg:block"
        >
          <Card className="p-10 bg-primary text-primary-foreground border-foreground relative overflow-hidden">
            <div className="absolute -top-8 -right-8 w-32 h-32 bg-accent/30 rounded-full" />
            <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-background/10 rounded-full" />
            <div className="relative">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 rounded-xl bg-background/20 border-2 border-background/30 flex items-center justify-center">
                  <Languages size={28} />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-wider text-background/70 font-semibold">
                    Lingual
                  </p>
                  <p className="text-2xl font-display font-bold">Welcome back</p>
                </div>
              </div>
              <p className="text-xl text-background/90 mb-10 leading-relaxed">
                Pick up where you left off.
              </p>
              <div className="space-y-5">
                {[
                  'Practice with AI scenario partners',
                  'Hear feedback on pronunciation in real time',
                  'Track progress your teacher can see',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg bg-background/20 flex items-center justify-center flex-shrink-0">
                      <CheckCircle size={18} strokeWidth={2.5} />
                    </div>
                    <span className="text-background/90 font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <Card className="p-8 max-w-md w-full mx-auto">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm">
                <Languages size={24} strokeWidth={2.5} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles size={14} className="text-accent" />
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Welcome
                  </p>
                </div>
                <p className="text-xl font-display font-bold">
                  {mode === 'reset' ? 'Reset your password' : 'Sign in'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {mode === 'reset'
                    ? 'Enter your account email and we will send a reset link.'
                    : 'Use your existing Lingual account.'}
                </p>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {(mode === 'reset' ? resetError : error) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6"
                >
                  <Alert variant="destructive">
                    <AlertDescription>{mode === 'reset' ? resetError : error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            {mode === 'reset' ? (
              <motion.form
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                onSubmit={handleReset}
                className="space-y-5"
              >
                <motion.div variants={staggerItem}>
                  <Input
                    type="email"
                    label="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    required
                  />
                </motion.div>
                {resetSent && (
                  <motion.div variants={staggerItem}>
                    <Alert variant="success">
                      <AlertDescription>
                        If that email is registered, a password reset link has been sent.
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}
                <motion.div variants={staggerItem}>
                  <Button type="submit" loading={submitting} className="w-full">
                    Send reset link
                  </Button>
                </motion.div>
                <motion.div variants={staggerItem}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setMode('signin');
                      setResetSent(false);
                      setResetError(null);
                      clearError();
                    }}
                    disabled={submitting}
                    className="w-full"
                  >
                    Back to sign in
                  </Button>
                </motion.div>
              </motion.form>
            ) : (
              <motion.form
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                onSubmit={handleSignIn}
                className="space-y-5"
              >
                <motion.div variants={staggerItem}>
                  <Input
                    type="email"
                    label="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    required
                  />
                </motion.div>
                <motion.div variants={staggerItem}>
                  <Input
                    type="password"
                    label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </motion.div>
                <motion.div variants={staggerItem} className="-mt-2 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setResetSent(false);
                      setResetError(null);
                      setPassword('');
                      clearError();
                    }}
                    className="text-sm font-semibold text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
                  >
                    Forgot password?
                  </button>
                </motion.div>
                <motion.div variants={staggerItem}>
                  <Button type="submit" loading={submitting} className="w-full">
                    Sign in
                  </Button>
                </motion.div>
              </motion.form>
            )}

            {mode === 'signin' && (
              <>
                <div className="my-8 flex items-center gap-4">
                  <div className="flex-1 border-t-2 border-border" />
                  <span className="text-muted-foreground text-sm font-medium">or</span>
                  <div className="flex-1 border-t-2 border-border" />
                </div>
                <Button
                  type="button"
                  variant="google"
                  onClick={handleGoogle}
                  disabled={submitting}
                  className="w-full"
                >
                  Continue with Google
                </Button>
                <p className="mt-8 text-center text-muted-foreground">
                  Don't have an account?{' '}
                  <Link
                    to="/signup"
                    className="text-primary hover:text-primary/80 font-semibold underline underline-offset-4"
                  >
                    Sign up
                  </Link>
                </p>
              </>
            )}
          </Card>
        </motion.div>
      </div>
    </AnimatedPage>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/pages/LoginPage.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "feat(auth): add LoginPage for existing-account sign-in"
```

---

## Task 6: Build the `SignupPage` shell

**Files:**
- Create: `frontend/src/pages/SignupPage.tsx`
- Create: `frontend/src/pages/SignupPage.test.tsx`

**Why:** The two-step state machine for new accounts. Step 1 reads `?role=` from the URL to pre-select; Step 2 mounts `AccountCreator` with the chosen role and dispatches on success. After Firebase returns the user payload, navigation is delegated to `getOnboardingDestination` — Plan 3 and Plan 4 will replace the placeholder pages but the dispatch logic does not change.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/SignupPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SignupPage } from './SignupPage';

const navigateMock = vi.fn();
const signUpMock = vi.fn();
const googleMock = vi.fn();
let mockUser: unknown = null;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    error: null,
    signUpWithEmail: (...args: unknown[]) => signUpMock(...args),
    signInWithGoogle: (...args: unknown[]) => googleMock(...args),
    clearError: vi.fn(),
  }),
}));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SignupPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    signUpMock.mockReset().mockResolvedValue(undefined);
    googleMock.mockReset().mockResolvedValue(undefined);
    mockUser = null;
  });

  it('starts at Step 1 (role picker) when no role query param', () => {
    renderAt('/signup');
    expect(screen.getByRole('radio', { name: /student/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });

  it('pre-selects role from ?role= and lets user continue to Step 2', () => {
    renderAt('/signup?role=teacher');
    expect(screen.getByRole('radio', { name: /teacher/i })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('disables Continue until a role is picked', () => {
    renderAt('/signup');
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /student/i }));
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('navigates back to Step 1 from Step 2 via the change-role link', () => {
    renderAt('/signup?role=student');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(screen.getByRole('button', { name: /change role/i }));
    expect(screen.getByRole('radio', { name: /student/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });

  it('on signup success navigates to the dispatcher destination', async () => {
    renderAt('/signup?role=student');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    // Simulate AuthContext updating user after signup so the page navigates.
    signUpMock.mockImplementation(async () => {
      mockUser = { uid: 'u1', email: 'a@b.test', name: 'A', intendedRole: 'student' };
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/signup/student/setup', { replace: true });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/pages/SignupPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Create `frontend/src/pages/SignupPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Loader2, Languages, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button, Card } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { RolePicker, AccountCreator, type SignupRole } from '@/components/signup';
import { getOnboardingDestination, ROLE_PICKER_ROUTE } from '@/lib/homeRoutes';

type Step = 1 | 2;

function parseRoleParam(raw: string | null): SignupRole | null {
  return raw === 'student' || raw === 'teacher' || raw === 'admin' ? raw : null;
}

export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();

  const initialRole = useMemo(() => parseRoleParam(searchParams.get('role')), [searchParams]);
  const [role, setRole] = useState<SignupRole | null>(initialRole);
  const [step, setStep] = useState<Step>(1);

  // Returning users land here only by accident — bounce them through the dispatcher.
  useEffect(() => {
    if (user && !loading) {
      const dest = getOnboardingDestination(user);
      if (dest && dest !== ROLE_PICKER_ROUTE) {
        navigate(dest, { replace: true });
      }
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-10 w-10 text-primary" strokeWidth={3} />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="relative min-h-screen bg-background flex items-center justify-center p-6">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="absolute left-6 top-6 z-10 inline-flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
      >
        <ArrowLeft size={16} strokeWidth={2.5} />
        <span>Back</span>
      </button>

      <Card className="p-8 w-full max-w-3xl">
        <div className="mb-8 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm">
            <Languages size={24} strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} className="text-accent" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Step {step} of 2
              </p>
            </div>
            <p className="text-xl font-display font-bold">
              {step === 1 ? 'How are you using Lingual?' : 'Create your account'}
            </p>
            <p className="text-sm text-muted-foreground">
              {step === 1
                ? 'Pick the option that matches you best.'
                : 'Use Google or sign up with your email.'}
            </p>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-8">
            <RolePicker value={role} onChange={setRole} />
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => setStep(2)}
                disabled={!role}
              >
                Continue
              </Button>
            </div>
            <p className="text-center text-muted-foreground">
              Already have an account?{' '}
              <Link
                to="/login"
                className="text-primary hover:text-primary/80 font-semibold underline underline-offset-4"
              >
                Log in
              </Link>
            </p>
          </div>
        )}

        {step === 2 && role && (
          <div className="space-y-6">
            <AccountCreator
              intendedRole={role}
              onSuccess={() => {
                // After Firebase + /api/auth/verify settle, AuthContext updates
                // `user`. The effect at the top will see the new payload and
                // navigate. We also kick navigation here in case the user is
                // already present (e.g., dev-mode E2E bypass).
                const dest = getOnboardingDestination(user);
                if (dest) navigate(dest, { replace: true });
              }}
            />
            <button
              type="button"
              onClick={() => setStep(1)}
              className="block w-full text-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
            >
              ← Change role
            </button>
          </div>
        )}
      </Card>
    </AnimatedPage>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/pages/SignupPage.test.tsx`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SignupPage.tsx frontend/src/pages/SignupPage.test.tsx
git commit -m "feat(signup): add SignupPage two-step shell"
```

---

## Task 7: Build placeholder pages for teacher and admin Step 3

**Files:**
- Create: `frontend/src/pages/TeacherJoinOrgPlaceholderPage.tsx`
- Create: `frontend/src/pages/AdminOrgWizardPlaceholderPage.tsx`
- Create: `frontend/src/pages/SignupPlaceholders.test.tsx`

**Why:** Plans 3 and 4 will replace these with the real wizard and join flow. Until then, the dispatcher needs a coherent terminal route for `intendedRole='teacher'` and `intendedRole='admin'` users so they don't 404 or get bounced back to `/signup`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/SignupPlaceholders.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeacherJoinOrgPlaceholderPage } from './TeacherJoinOrgPlaceholderPage';
import { AdminOrgWizardPlaceholderPage } from './AdminOrgWizardPlaceholderPage';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.test', name: 'A', intendedRole: 'teacher' },
    logout: vi.fn(),
  }),
}));

describe('Teacher join placeholder', () => {
  it('renders a coming-soon message and a link back to the landing page', () => {
    render(
      <MemoryRouter>
        <TeacherJoinOrgPlaceholderPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /almost there/i })).toBeInTheDocument();
    expect(screen.getByText(/teacher join flow/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});

describe('Admin org wizard placeholder', () => {
  it('renders a coming-soon message and a link back to the landing page', () => {
    render(
      <MemoryRouter>
        <AdminOrgWizardPlaceholderPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /almost there/i })).toBeInTheDocument();
    expect(screen.getByText(/school registration/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/pages/SignupPlaceholders.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement: shared placeholder pattern**

Create `frontend/src/pages/TeacherJoinOrgPlaceholderPage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { useAuth } from '@/hooks/useAuth';

export function TeacherJoinOrgPlaceholderPage() {
  const { logout } = useAuth();
  return (
    <AnimatedPage className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="p-10 max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 border-2 border-foreground flex items-center justify-center">
          <Clock size={32} strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold">Almost there</h1>
          <p className="mt-2 text-muted-foreground">
            The teacher join flow is launching in the next release. We've saved
            your account — you'll be able to find or join your school soon.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg border-2 border-foreground bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-stamp-sm hover:bg-primary/90"
          >
            Back to home
          </Link>
          <Button type="button" variant="ghost" onClick={() => logout()}>
            Sign out
          </Button>
        </div>
      </Card>
    </AnimatedPage>
  );
}
```

Create `frontend/src/pages/AdminOrgWizardPlaceholderPage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { useAuth } from '@/hooks/useAuth';

export function AdminOrgWizardPlaceholderPage() {
  const { logout } = useAuth();
  return (
    <AnimatedPage className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="p-10 max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 border-2 border-foreground flex items-center justify-center">
          <Clock size={32} strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold">Almost there</h1>
          <p className="mt-2 text-muted-foreground">
            School registration is launching in the next release. We've saved
            your account — once the wizard is live, you'll be able to register
            your school for Lingual approval.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg border-2 border-foreground bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-stamp-sm hover:bg-primary/90"
          >
            Back to home
          </Link>
          <Button type="button" variant="ghost" onClick={() => logout()}>
            Sign out
          </Button>
        </div>
      </Card>
    </AnimatedPage>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/pages/SignupPlaceholders.test.tsx`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TeacherJoinOrgPlaceholderPage.tsx frontend/src/pages/AdminOrgWizardPlaceholderPage.tsx frontend/src/pages/SignupPlaceholders.test.tsx
git commit -m "feat(signup): add Teacher and Admin Step 3 placeholders"
```

---

## Task 8: Wire new routes and legacy redirects in `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`

**Why:** This is where the new routing surfaces become reachable. Adding `/login`, `/signup`, and the Step 3 routes; redirecting `/auth` → `/login` and `/school/setup` → `/signup/admin/org-wizard`; pointing `AppIndexRedirect` at the new dispatcher.

- [ ] **Step 1: Modify `App.tsx`**

Replace the lazy import line for `AuthPage`:

```tsx
const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })));
```

with the new pages:

```tsx
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then((module) => ({ default: module.SignupPage })));
const TeacherJoinOrgPlaceholderPage = lazy(() => import('./pages/TeacherJoinOrgPlaceholderPage').then((module) => ({ default: module.TeacherJoinOrgPlaceholderPage })));
const AdminOrgWizardPlaceholderPage = lazy(() => import('./pages/AdminOrgWizardPlaceholderPage').then((module) => ({ default: module.AdminOrgWizardPlaceholderPage })));
```

Update the `homeRoutes` import:

```tsx
import { getOnboardingDestination, LEARNER_HOME_ROUTE } from './lib/homeRoutes';
```

Rewrite `AppIndexRedirect`:

```tsx
function AppIndexRedirect() {
  const { user } = useAuth();
  return <Navigate to={getOnboardingDestination(user) ?? LEARNER_HOME_ROUTE} replace />;
}
```

In the `<Routes>` block, replace the public `/auth` route:

```tsx
<Route path="/auth" element={withRouteSuspense(<AuthPage />)} />
```

with the new public routes:

```tsx
<Route path="/login" element={withRouteSuspense(<LoginPage />)} />
<Route path="/signup" element={withRouteSuspense(<SignupPage />)} />
<Route path="/auth" element={<Navigate to="/login" replace />} />
```

Inside the existing `ProtectedRoute` block, add the new Step 3 routes alongside `GeneralPage`, and add the `/school/setup` redirect:

```tsx
<Route element={<ProtectedRoute />}>
  <Route path="/general" element={withRouteSuspense(<GeneralPage />)} />
  <Route path="/signup/student/setup" element={withRouteSuspense(<GeneralPage />)} />
  <Route path="/signup/teacher/join-org" element={withRouteSuspense(<TeacherJoinOrgPlaceholderPage />)} />
  <Route path="/signup/admin/org-wizard" element={withRouteSuspense(<AdminOrgWizardPlaceholderPage />)} />
  <Route path="/onboarding" element={withRouteSuspense(<InitialOnboardingPage />)} />
  <Route path="/school/setup" element={<Navigate to="/signup/admin/org-wizard" replace />} />
  <Route path="/assessment" element={withRouteSuspense(<AssessmentPage />)} />
  <Route path="/categories" element={withRouteSuspense(<CategoriesPage />)} />
  <Route path="/chat" element={<Navigate to="/app/chat" replace />} />
  <Route path="/profile" element={withRouteSuspense(<ProfilePage />)} />
</Route>
```

- [ ] **Step 2: Manually verify the dev server**

Run from a separate terminal:

```bash
cd frontend && npm run dev
```

In a browser:
- Visit `/auth` — should redirect to `/login`.
- Visit `/login` — `LoginPage` should render.
- Visit `/signup` — Step 1 of `SignupPage` should render.
- Visit `/signup?role=teacher` — Step 1 shows the Teacher card pre-selected.
- Visit `/school/setup` while signed in — should redirect to `/signup/admin/org-wizard` and show the placeholder.
- Visit `/signup/student/setup` while signed in as a learner with no profile — should render the existing 4-step `GeneralPage`.

Stop the dev server before continuing.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npm run test -- --run`
Expected: all tests pass. (One known failure: `frontend/src/pages/AuthPage.test.tsx` may still pass for now because the file still exists — that's removed in Task 12.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(routing): wire /login, /signup, Step 3 routes, and legacy redirects"
```

---

## Task 9: Update `ProtectedRoute` to redirect to `/login`

**Files:**
- Modify: `frontend/src/components/layout/ProtectedRoute.tsx`
- Create: `frontend/src/components/layout/ProtectedRoute.test.tsx`

**Why:** `ProtectedRoute` still sends unauth'd users to the legacy `/auth` path. Although `/auth` now redirects to `/login`, that's a double hop. Direct redirect keeps URLs clean and avoids a flash of the legacy URL in history. The `from` location state is preserved so `LoginPage` can bounce back after success.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/layout/ProtectedRoute.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';

const useAuthMock = vi.fn();

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

// LegacyAppLayout pulls in many providers; stub it for routing-only tests.
vi.mock('./LegacyAppLayout', () => ({
  LegacyAppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(
      <MemoryRouter initialEntries={['/general']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/general" element={<div>protected</div>} />
          </Route>
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders the outlet when authenticated', () => {
    useAuthMock.mockReturnValue({
      user: { uid: 'u1', email: 'a@b.test', name: 'A' },
      loading: false,
    });
    render(
      <MemoryRouter initialEntries={['/general']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/general" element={<div>protected</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('protected')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/layout/ProtectedRoute.test.tsx`
Expected: FAIL — first case fails because `ProtectedRoute` still redirects to `/auth`, so the route renders nothing for `/login`.

- [ ] **Step 3: Implement the change**

Modify `frontend/src/components/layout/ProtectedRoute.tsx` — change the `Navigate` `to` value:

```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../common';
import { LegacyAppLayout } from './LegacyAppLayout';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <LegacyAppLayout>
      <Outlet />
    </LegacyAppLayout>
  );
}
```

Also check `AppProtectedRoute` and `TeacherRoute`. If either of them redirects to `/auth`, change to `/login` for consistency. Read the files:

Run: `cd frontend && grep -n "/auth" src/components/layout/*.tsx`

For each match, change `'/auth'` → `'/login'`. Keep the `state={{ from: location }}` clauses intact.

- [ ] **Step 4: Run tests to verify**

Run: `cd frontend && npm run test -- --run src/components/layout/ProtectedRoute.test.tsx`
Expected: PASS (2 cases).

Then run the full layout test suite to catch any other auth-redirect tests:

Run: `cd frontend && npm run test -- --run src/components/layout`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/ProtectedRoute.tsx frontend/src/components/layout/ProtectedRoute.test.tsx
git add -u frontend/src/components/layout
git commit -m "feat(routing): redirect unauthenticated users to /login instead of /auth"
```

---

## Task 10: Update `LandingPage` with role-aware CTAs

**Files:**
- Modify: `frontend/src/pages/LandingPage.tsx`

**Why:** Spec §1 calls for three CTAs ("I'm a Student" / "I'm a Teacher" / "I'm a School Admin"). Each navigates to `/signup?role=…` so the role picker is pre-selected. The existing "Login" affordance now points at `/login`.

- [ ] **Step 1: Read the existing hero section**

Open `frontend/src/pages/LandingPage.tsx` and locate the `handleGetStarted` and `handleLogin` functions and the hero CTA block. They're near the top of the file (lines 38-89 based on the current revision).

- [ ] **Step 2: Replace `handleLogin` to navigate to `/login`**

Replace the body of `handleLogin`:

```tsx
const handleLogin = () => {
  if (!user) {
    navigate('/login');
    return;
  }
  navigate(getOnboardingDestination(user) ?? LEARNER_HOME_ROUTE);
};
```

Add the new import (replace the existing `getPrivilegedHomeRoute` import line):

```tsx
import { getOnboardingDestination, LEARNER_HOME_ROUTE, LEARNER_SETUP_ROUTE } from '@/lib/homeRoutes';
```

- [ ] **Step 3: Add `handleStartAsRole` and replace `handleGetStarted`**

Replace the `handleGetStarted` function with three role-specific entry points. Add this above the existing function:

```tsx
type LandingRole = 'student' | 'teacher' | 'admin';

const handleStartAsRole = async (role: LandingRole) => {
  if (user) {
    // Already signed in — route through the dispatcher and ignore the role
    // because their memberships are the source of truth.
    const dest = getOnboardingDestination(user);
    if (dest) {
      navigate(dest);
      return;
    }
  }
  navigate(`/signup?role=${role}`);
};
```

Then delete the old `handleGetStarted` body and its `checkingProfile`/`getUserProfile` machinery. Replace any in-file references to `handleGetStarted` (in the hero CTA blocks) with `handleStartAsRole('student')` etc. as described below.

- [ ] **Step 4: Update hero CTA buttons**

Locate the hero section's CTA cluster (a `<Button onClick={handleGetStarted}>` near the top of the rendered JSX). Replace that single button with three role buttons. Match the existing visual style (Warm Brutalism — bordered cards with shadow). Use the `Button` component already imported:

```tsx
<div className="grid gap-3 sm:grid-cols-3">
  <Button onClick={() => handleStartAsRole('student')} className="w-full justify-center">
    I'm a Student
  </Button>
  <Button onClick={() => handleStartAsRole('teacher')} variant="secondary" className="w-full justify-center">
    I'm a Teacher
  </Button>
  <Button onClick={() => handleStartAsRole('admin')} variant="outline" className="w-full justify-center">
    I'm a School Admin
  </Button>
</div>
```

If the existing layout has a single "Get Started" button with an arrow icon and `loading={checkingProfile}`, replace it with the cluster above. Remove the now-unused `checkingProfile` state, `setCheckingProfile`, and the `getUserProfile` import if no other code in the file references them. Run `grep` after editing to confirm:

Run: `cd frontend && grep -n 'checkingProfile\|getUserProfile' src/pages/LandingPage.tsx`
Expected: no output (both are fully removed) — or if `getUserProfile` is still used elsewhere on the page, leave that import alone.

- [ ] **Step 5: Update the "Register Your School" CTA**

Locate the "For Schools" section. It currently routes to `/school/setup`. Update the click handler / `to` prop to `/signup?role=admin` so signed-out admins go straight to the role-aware signup, and signed-in users still hit the dispatcher (which routes them to the placeholder or the eventual wizard).

Example: if the Schools button is currently:

```tsx
<Button onClick={() => navigate('/school/setup')}>Register Your School</Button>
```

change it to:

```tsx
<Button onClick={() => handleStartAsRole('admin')}>Register Your School</Button>
```

- [ ] **Step 6: Manual smoke test**

Run: `cd frontend && npm run dev`

In a browser (signed out):
- Click "I'm a Student" → URL becomes `/signup?role=student`, Student card pre-selected.
- Click back, then "I'm a Teacher" → URL becomes `/signup?role=teacher`, Teacher card pre-selected.
- Click back, then "I'm a School Admin" → URL becomes `/signup?role=admin`, Admin card pre-selected.
- Click "Register Your School" → URL becomes `/signup?role=admin`.
- Click "Login" in top-nav → URL becomes `/login`.

Sign in as a learner and click "I'm a Student" again — should bypass `/signup` and land on `LEARNER_HOME_ROUTE` (or student setup if profile incomplete).

Stop the dev server.

- [ ] **Step 7: Run the test suite**

Run: `cd frontend && npm run test -- --run`
Expected: all tests pass except any pre-existing failure unrelated to this work. If a `LandingPage.test.tsx` exists, it may need updates — if so, update its expectations to match the new buttons.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/LandingPage.tsx
git commit -m "feat(landing): split Get Started into three role-aware CTAs"
```

---

## Task 11: Migrate remaining `getPrivilegedHomeRoute` callers to the new dispatcher

**Files:**
- Modify: `frontend/src/pages/GeneralPage.tsx`
- Modify: `frontend/src/pages/InitialOnboardingPage.tsx`

**Why:** Both pages use `getPrivilegedHomeRoute` to bounce teachers/admins out of the learner setup flow. They should call `getOnboardingDestination` instead, so a teacher who somehow lands on `/signup/student/setup` (e.g., shared link) gets routed correctly. `getPrivilegedHomeRoute` stays exported for any callers we haven't migrated.

- [ ] **Step 1: Update `GeneralPage.tsx`**

In `frontend/src/pages/GeneralPage.tsx`, find the import line for `getPrivilegedHomeRoute`. Replace:

```tsx
import { getPrivilegedHomeRoute, LEARNER_HOME_ROUTE } from '@/lib/homeRoutes';
```

with:

```tsx
import { getOnboardingDestination, LEARNER_HOME_ROUTE, STUDENT_SETUP_ROUTE } from '@/lib/homeRoutes';
```

Then find every `getPrivilegedHomeRoute(user)` call. Each one is followed by code like:

```tsx
const privilegedHomeRoute = getPrivilegedHomeRoute(user);
if (privilegedHomeRoute && !isEditMode) {
  navigate(privilegedHomeRoute, { replace: true });
```

Change the call to:

```tsx
const onboardingDestination = getOnboardingDestination(user);
if (onboardingDestination && onboardingDestination !== STUDENT_SETUP_ROUTE && !isEditMode) {
  navigate(onboardingDestination, { replace: true });
```

The guard `onboardingDestination !== STUDENT_SETUP_ROUTE` prevents an infinite redirect when a student lands on `GeneralPage` (which is the destination for `STUDENT_SETUP_ROUTE`).

Save the file.

- [ ] **Step 2: Update `InitialOnboardingPage.tsx`**

Same pattern. Replace:

```tsx
import { getPrivilegedHomeRoute, LEARNER_HOME_ROUTE, LEARNER_SETUP_ROUTE } from '@/lib/homeRoutes';
```

with:

```tsx
import { getOnboardingDestination, LEARNER_HOME_ROUTE, LEARNER_SETUP_ROUTE } from '@/lib/homeRoutes';
```

And replace the `getPrivilegedHomeRoute(user)` call. The function exits early when this is non-null, so the simple rename is fine — when `user` has a teacher/admin membership, `getOnboardingDestination` returns `TEACHER_HOME_ROUTE`, which is the same outcome as before.

```tsx
const onboardingDestination = getOnboardingDestination(user);
if (onboardingDestination && onboardingDestination !== LEARNER_SETUP_ROUTE) {
  navigate(onboardingDestination, { replace: true });
  return;
}
```

Save the file.

- [ ] **Step 3: Run the suite**

Run: `cd frontend && npm run test -- --run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/GeneralPage.tsx frontend/src/pages/InitialOnboardingPage.tsx
git commit -m "refactor(routing): use getOnboardingDestination in learner setup pages"
```

---

## Task 12: Remove the legacy `AuthPage`

**Files:**
- Delete: `frontend/src/pages/AuthPage.tsx`
- Delete: `frontend/src/pages/AuthPage.test.tsx`

**Why:** `AuthPage` is no longer imported (Task 8 swapped the lazy import). The `/auth` route is now a `Navigate` element, not a page render. Deleting the file prevents code rot and makes the new pages the only auth surface a reader sees.

- [ ] **Step 1: Confirm no remaining references**

Run: `cd frontend && grep -rn "AuthPage" src --include="*.ts" --include="*.tsx"`
Expected: no output. If any file still imports `AuthPage`, fix that file before continuing.

- [ ] **Step 2: Delete the files**

```bash
rm frontend/src/pages/AuthPage.tsx
rm frontend/src/pages/AuthPage.test.tsx
```

- [ ] **Step 3: Run typecheck and tests**

Run: `cd frontend && npm run build`
Expected: succeeds. `npm run build` runs `tsc -b` first, which will fail if any stale reference remains.

Then: `cd frontend && npm run test -- --run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -u frontend/src/pages
git commit -m "chore(auth): remove legacy AuthPage in favor of LoginPage and SignupPage"
```

---

## Task 13: End-to-end smoke check on dev server

**Files:** none modified — this is a manual verification gate.

**Why:** Vitest covers components in isolation but doesn't catch routing wiring bugs. A quick manual pass through the four happy paths confirms the user journey actually works in the browser before handing off.

- [ ] **Step 1: Start the dev server and backend**

In one terminal:

```bash
PORT=5001 FLASK_ENV=development python main.py
```

In another:

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: Verify the legacy `/auth` redirect**

In a private browser window, visit `http://localhost:5173/auth`. URL should change to `/login`. The new sign-in form should render.

- [ ] **Step 3: Sign in as an existing learner**

Use a known test learner account (no school memberships). After sign-in, the URL should be `/app/learn` (or `/signup/student/setup` if their profile is incomplete — either is acceptable). The dispatcher chose this.

Sign out.

- [ ] **Step 4: Sign up a brand-new student**

From `/`, click "I'm a Student". URL is `/signup?role=student`, Student card pre-selected.

Click "Continue". Step 2 renders. Enter a fresh email + password and click "Create account". After Firebase + backend verify, the page should navigate to `/signup/student/setup` and render the existing `GeneralPage` 4-step profile flow.

- [ ] **Step 5: Sign up a brand-new teacher**

Sign out. From `/`, click "I'm a Teacher". Continue to Step 2. Sign up with a fresh email. Page should navigate to `/signup/teacher/join-org` and render the placeholder ("Almost there — teacher join flow is launching in the next release").

- [ ] **Step 6: Sign up a brand-new admin**

Sign out. From `/`, click "I'm a School Admin". Continue to Step 2. Sign up. Page should navigate to `/signup/admin/org-wizard` and render the placeholder ("Almost there — school registration is launching in the next release").

- [ ] **Step 7: Verify `/school/setup` redirect**

While signed in as the admin from Step 6, visit `http://localhost:5173/school/setup`. URL should change to `/signup/admin/org-wizard` and render the placeholder.

- [ ] **Step 8: Stop the servers and record findings**

If any step fails, file the failure mode in a follow-up comment on this plan. Otherwise, Plan 2 is complete.

---

## Self-Review

**Spec coverage** (sections of `docs/superpowers/specs/2026-05-18-teacher-school-onboarding-design.md`):

| Spec requirement | Plan task |
|---|---|
| §1 `/login`, `/signup`, `/signup/student/setup`, `/signup/teacher/join-org`, `/signup/admin/org-wizard` routes | Tasks 5, 6, 7, 8 |
| §1 `/auth` → `/login` permanent redirect | Task 8 |
| §1 `/school/setup` → `/signup/admin/org-wizard` permanent redirect | Task 8 |
| §1 role-aware dispatcher driven by memberships + `onboarding_state` + `intended_role` | Task 2 |
| §1 Landing page hero with three role-aware CTAs | Task 10 |
| §1 `ProtectedRoute` redirects unauth users to `/login` not `/auth` | Task 9 |
| §2 Step 1 role picker pre-selects from `?role=` | Tasks 3, 6 |
| §2 Step 2 account creation (Google + email/password) forwards `intendedRole` | Tasks 1, 4, 6 |
| §2 Edge case: change role mid-flow | Task 6 (`Change role` button) |
| §2 Edge case: returning user with existing memberships bypasses signup | Tasks 2, 6 (effect bounces through dispatcher) |
| §2 Edge case: Google account already linked to existing role → existing memberships win | Task 2 (membership precedes `intendedRole` in dispatcher) |
| §7 Legacy users without `intendedRole` fall back to existing student flow | Task 2 (`requiresLegacyRolePick` → `STUDENT_SETUP_ROUTE` until Plan 6) |

**Placeholder scan:** the `TeacherJoinOrgPlaceholderPage` and `AdminOrgWizardPlaceholderPage` files are *intentional* placeholders, called out as such in the file structure table and the spec rollout plan. They satisfy spec §2's "dispatcher must always land somewhere coherent" requirement while Plans 3 and 4 build the real surfaces. No "TODO" or "fill in" strings appear in any committed code or test.

**Type consistency:** `SignupRole` (`'student' | 'teacher' | 'admin'`) used by `RolePicker`, `AccountCreator`, and `SignupPage` matches the `IntendedRole` exported from `frontend/src/api/auth.ts:4` and the `User.intendedRole` field in `frontend/src/types/index.ts:13`. Route constants (`STUDENT_SETUP_ROUTE`, `TEACHER_JOIN_ORG_ROUTE`, `ADMIN_ORG_WIZARD_ROUTE`, `ROLE_PICKER_ROUTE`, `LINGUAL_ADMIN_HOME_ROUTE`) are defined exactly once in `homeRoutes.ts` (Task 2) and imported by everything downstream.

**Scope check:** twelve implementation tasks plus a manual smoke check, all touching a single layer (frontend routing + signup UX). Plan 1 already shipped the backend contract this depends on. Plans 3-6 replace the placeholders and add the modal without revisiting any file this plan touches.
