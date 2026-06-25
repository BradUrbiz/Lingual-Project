import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Link2, Loader2, LogIn } from 'lucide-react';
import { Alert, AlertDescription, Button, Card } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { linkLtiAccount } from '@/api/lti';

export function LtiLinkAccountPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLinkAccount = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await linkLtiAccount();
      navigate(result.redirectTo || '/app/teacher', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('integrations.lti.link.linkError'));
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="border-3 border-foreground p-8 shadow-stamp space-y-6">
          <div className="text-center space-y-3">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
              <Link2 size={28} strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">
              {t('integrations.lti.link.title')}
            </h1>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {user ? (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                {t('integrations.lti.link.matchDesc')}
              </p>
              <div className="rounded-xl border-2 border-border bg-secondary/40 p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {t('integrations.lti.link.signedInAs')}
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {user.email || user.name || 'Lingual user'}
                </p>
              </div>
              <Button onClick={handleLinkAccount} className="w-full" loading={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('integrations.lti.link.linking')}
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 size-4" />
                    {t('integrations.lti.link.linkBtn')}
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                {t('integrations.lti.link.noAccountDesc')}
              </p>
              <Link to="/login" className="block">
                <Button className="w-full">
                  <LogIn className="mr-2 size-4" />
                  {t('integrations.lti.link.signUpBtn')}
                </Button>
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
