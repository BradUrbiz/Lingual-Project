import { useState } from 'react';
import type { IntendedRole } from '@/api/auth';

export interface LegacyRoleMigrationModalProps {
  onPicked(role: IntendedRole): Promise<void>;
}

const ROLES: { value: IntendedRole; label: string; description: string }[] = [
  { value: 'student', label: 'Student', description: 'Continue learning where you left off.' },
  { value: 'teacher', label: 'Teacher', description: 'Join a school and run classes.' },
  { value: 'admin', label: 'School administrator', description: 'Register or manage your school.' },
];

// Spec §628: Blocking modal. Intentionally NO close button, NO escape key
// handler, NO click-outside dismissal. Legacy users MUST pick a role to
// proceed - this is by design, do not add dismissal controls.
export function LegacyRoleMigrationModal({ onPicked }: LegacyRoleMigrationModalProps) {
  const [busy, setBusy] = useState<IntendedRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(role: IntendedRole) {
    setBusy(role);
    setError(null);
    try {
      await onPicked(role);
      // On success, the modal will unmount when AuthProvider re-verifies
      // and `requiresLegacyRolePick` flips to false. We leave `busy` set
      // so the modal looks frozen during the brief network round-trip.
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(message);
      setBusy(null);
    }
  }

  return (
    <dialog
      open
      aria-modal="true"
      // Backdrop has no onClick - see comment above. Spec §628.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-2xl">
        <h2 className="text-xl font-semibold text-neutral-900">Welcome back!</h2>
        <p className="mt-2 text-sm text-neutral-700">
          Lingual now supports classrooms.
        </p>
        <p className="mt-4 text-sm font-medium text-neutral-900">
          How are you using Lingual?
        </p>

        <div className="mt-4 grid gap-2">
          {ROLES.map(r => {
            const descId = `legacy-role-desc-${r.value}`;
            return (
              <button type="button"
                key={r.value}
                onClick={() => pick(r.value)}
                disabled={busy !== null}
                aria-label={r.label}
                aria-describedby={descId}
                className="rounded-md border border-neutral-300 px-4 py-3 text-left transition hover:border-neutral-900 hover:bg-neutral-50 disabled:opacity-50"
              >
                <div className="font-medium">{r.label}</div>
                <div id={descId} className="text-xs text-neutral-600">{r.description}</div>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 text-sm text-rose-600" role="alert">
            {error}
          </p>
        )}

        <p className="mt-6 text-xs text-neutral-500">
          Your existing progress stays with you.
        </p>
      </div>
    </dialog>
  );
}
