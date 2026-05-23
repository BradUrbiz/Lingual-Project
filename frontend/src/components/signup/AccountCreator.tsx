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
