import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, MailCheck, ShieldAlert } from 'lucide-react';
import { getGuardianConsentPacket, submitGuardianConsentDecision } from '@/api/guardian';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import type { GuardianConsentDecisionResult, GuardianConsentPublicView } from '@/types';

function formatDecisionTimestamp(value?: string | null) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function GuardianConsentPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submittingDecision, setSubmittingDecision] = useState<'granted' | 'revoked' | null>(null);
  const [guardianConsent, setGuardianConsent] = useState<GuardianConsentPublicView | null>(null);
  const [decisionResult, setDecisionResult] = useState<GuardianConsentDecisionResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    if (!token) {
      setLoading(false);
      setError('This guardian consent link is invalid.');
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const payload = await getGuardianConsentPacket(token);
        if (!isActive) return;
        setGuardianConsent(payload);
        setDecisionResult(null);
        setError(null);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to load guardian consent notice.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [token]);

  const handleDecision = async (decision: 'granted' | 'revoked') => {
    if (!token || !acknowledged) return;
    setSubmittingDecision(decision);
    setError(null);
    try {
      const result = await submitGuardianConsentDecision(token, { decision, acknowledged: true });
      setDecisionResult(result);
      setGuardianConsent(result.guardianConsent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record your decision.');
    } finally {
      setSubmittingDecision(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!guardianConsent) {
    return (
      <div className="min-h-screen bg-secondary/30 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Guardian consent unavailable</AlertTitle>
            <AlertDescription>{error || 'This consent packet is no longer available.'}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const activePacket = decisionResult?.guardianPacket || guardianConsent.packet;
  const currentDecision = decisionResult?.guardianPacket.status;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#fff8df,transparent_50%),linear-gradient(180deg,#fffaf0_0%,#f7f4ed_100%)] px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
            <MailCheck size={20} strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-semibold text-foreground">Lingual school voice consent</p>
            <p>{guardianConsent.class.name || 'School class'} · {guardianConsent.class.subject || 'Language practice'}</p>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {currentDecision ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Decision recorded</AlertTitle>
            <AlertDescription>
              Guardian consent was marked as <span className="font-semibold text-foreground">{currentDecision}</span> on{' '}
              {formatDecisionTimestamp(decisionResult?.guardianPacket.actedAt)}.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card className="border-3 border-foreground shadow-stamp">
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" size="sm">
                Packet {activePacket.status}
              </Badge>
              <Badge variant="outline" size="sm">
                {activePacket.deliveryMethod.replaceAll('_', ' ')}
              </Badge>
              <Badge variant="outline" size="sm">
                {activePacket.noticeVersion}
              </Badge>
            </div>
            <CardTitle className="text-2xl font-display text-foreground">
              {guardianConsent.notice.title}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              This notice applies to <span className="font-semibold text-foreground">{guardianConsent.student.displayName}</span>.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-2xl border-2 border-border bg-secondary/30 p-4 text-sm text-foreground">
              {guardianConsent.notice.summary}
            </div>

            <ul className="space-y-3 text-sm text-foreground">
              {guardianConsent.notice.bullets.map((bullet) => (
                <li key={bullet} className="rounded-2xl border-2 border-border bg-background px-4 py-3">
                  {bullet}
                </li>
              ))}
            </ul>

            <div className="grid gap-3 rounded-2xl border-2 border-border bg-secondary/30 p-4 text-sm text-muted-foreground sm:grid-cols-2">
              <p>
                Contact channel: <span className="font-medium text-foreground">{activePacket.contactChannel}</span>
              </p>
              <p>
                Expires: <span className="font-medium text-foreground">{formatDecisionTimestamp(activePacket.expiresAt)}</span>
              </p>
              <p>
                Last sent: <span className="font-medium text-foreground">{formatDecisionTimestamp(activePacket.lastSentAt)}</span>
              </p>
              <p>
                Contact hint: <span className="font-medium text-foreground">{activePacket.contactDestinationHint || 'Not provided'}</span>
              </p>
            </div>

            {!decisionResult ? (
              <div className="space-y-4">
                <label className="flex items-start gap-3 rounded-2xl border-2 border-border bg-background px-4 py-4 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-border"
                  />
                  <span>
                    I have reviewed this notice and I am authorized to respond for this student.
                  </span>
                </label>

                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => void handleDecision('granted')}
                    loading={submittingDecision === 'granted'}
                    disabled={!acknowledged || submittingDecision !== null}
                  >
                    Grant voice consent
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleDecision('revoked')}
                    loading={submittingDecision === 'revoked'}
                    disabled={!acknowledged || submittingDecision !== null}
                  >
                    Do not grant voice consent
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-border bg-background px-4 py-4 text-sm text-muted-foreground">
                The school can now review this updated consent status in the student compliance tools.
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Need to contact the school directly instead? Return this notice to the teacher or school administrator managing the class.
          <Link to="/" className="ml-1 underline decoration-foreground/40 underline-offset-4">
            Lingual home
          </Link>
        </p>
      </div>
    </div>
  );
}
