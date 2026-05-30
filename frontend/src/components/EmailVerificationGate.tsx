import { FormEvent, useCallback, useEffect, useState } from 'react';
import { confirmEmailVerification, resendEmailVerification } from '@/api/auth';

export interface EmailVerificationGateProps {
  email: string;
  onVerified: () => Promise<void> | void;
  onSignOut: () => void;
}

const ERROR_COPY: Record<string, string> = {
  invalid_code: "That code isn't right. Check it and try again.",
  expired: 'That code expired. Request a new one.',
  too_many_attempts: 'Too many attempts. Request a new code.',
};

// Blocking modal — intentionally NO close button / escape / click-outside.
// New accounts MUST verify before using the app. Mirrors LegacyRoleMigrationModal.
export function EmailVerificationGate({ email, onVerified, onSignOut }: EmailVerificationGateProps) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleVerify = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await confirmEmailVerification(code.trim());
      if (result.success) {
        await onVerified();
        return;
      }
      setError(ERROR_COPY[result.error ?? ''] ?? 'Verification failed. Please try again.');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [code, onVerified]);

  const handleResend = useCallback(async () => {
    setError(null);
    try {
      const result = await resendEmailVerification();
      setCooldown(result.cooldownSeconds ?? 60);
    } catch {
      setError('Could not resend the code. Please try again.');
    }
  }, []);

  return (
    <dialog open aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-2xl">
        <h2 className="text-xl font-semibold text-neutral-900">Verify your email</h2>
        <p className="mt-2 text-sm text-neutral-700">
          We sent a 6-digit code to <strong>{email}</strong>. Enter it below to finish setting up your account.
        </p>

        <form onSubmit={handleVerify} className="mt-5 space-y-4">
          <div>
            <label htmlFor="ev-code" className="block text-sm font-medium text-neutral-900">
              Verification code
            </label>
            <input
              id="ev-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-lg tracking-widest"
              placeholder="123456"
            />
          </div>

          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || code.trim().length < 6}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0}
            className="text-neutral-700 underline disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
          </button>
          <button type="button" onClick={onSignOut} className="text-neutral-500 underline">
            Wrong email? Sign out
          </button>
        </div>
      </div>
    </dialog>
  );
}
