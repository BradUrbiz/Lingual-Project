import { FormEvent, useState } from 'react';
import { Button, Input, Alert, AlertDescription } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SignupRole } from './RolePicker';

export interface AccountCreatorProps {
  intendedRole: SignupRole;
  onSuccess: () => void;
}

export function AccountCreator({ intendedRole, onSuccess }: AccountCreatorProps) {
  const { signUpWithEmail, signInWithGoogle, error, clearError } = useAuth();
  const { t } = useLanguage();
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
          label={t('auth.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.signup.emailPlaceholder')}
          required
          autoComplete="email"
        />
        <Input
          type="password"
          label={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.signup.passwordPlaceholder')}
          required
          minLength={6}
          autoComplete="new-password"
        />
        <Button type="submit" loading={submitting} className="w-full">
          {t('auth.signup.createAccount')}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-4">
        <div className="flex-1 border-t-2 border-border" />
        <span className="text-sm font-medium text-muted-foreground">{t('auth.or')}</span>
        <div className="flex-1 border-t-2 border-border" />
      </div>

      <Button
        type="button"
        variant="google"
        onClick={handleGoogle}
        disabled={submitting}
        className="w-full"
      >
        {t('auth.continueWithGoogle')}
      </Button>
    </div>
  );
}
