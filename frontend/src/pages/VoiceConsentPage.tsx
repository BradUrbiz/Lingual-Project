import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, Mic, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, Badge, Button, Card } from '@/components/ui';
import { submitVoiceConsent } from '@/api/voiceConsent';
import type { StudentComplianceRecord } from '@/types/school';

type ConsentStatus = 'granted' | 'revoked' | 'unknown' | 'pending' | string;

function statusBadgeVariant(status: ConsentStatus): 'success' | 'destructive' | 'outline' {
  if (status === 'granted') return 'success';
  if (status === 'revoked') return 'destructive';
  return 'outline';
}

export function VoiceConsentPage() {
  const navigate = useNavigate();
  const [compliance, setCompliance] = useState<StudentComplianceRecord | null>(null);
  const [submitting, setSubmitting] = useState<'granted' | 'revoked' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);

  useEffect(() => {
    if (!successFlash) return;
    const timer = window.setTimeout(() => setSuccessFlash(false), 2500);
    return () => window.clearTimeout(timer);
  }, [successFlash]);

  const handleSubmit = async (decision: 'granted' | 'revoked') => {
    setSubmitting(decision);
    setError(null);
    try {
      const next = await submitVoiceConsent(decision);
      setCompliance(next);
      setSuccessFlash(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your voice consent.');
    } finally {
      setSubmitting(null);
    }
  };

  const currentStatus: ConsentStatus = compliance?.voiceConsentStatus || 'unknown';
  const guardianRevoked = compliance?.guardianConsentStatus === 'revoked';

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-display font-bold text-foreground">Voice practice consent</h1>
      </div>

      <Card className="border-3 border-foreground p-6 shadow-stamp">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
            <Mic size={24} strokeWidth={2.5} />
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Voice practice lets you speak with the AI tutor in real time. Your audio is sent to
              our speech-AI provider to transcribe what you say and generate the tutor's response.
              Transcripts are stored under your school's retention policy.
            </p>
            <p className="text-sm text-muted-foreground">
              If you don't consent, you can still complete assignments via text practice — typing
              with the AI tutor instead of speaking.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Your status
              </span>
              <Badge variant={statusBadgeVariant(currentStatus)}>{String(currentStatus)}</Badge>
            </div>
          </div>
        </div>
      </Card>

      {guardianRevoked ? (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            Your guardian has revoked voice consent for your account. Voice practice is
            unavailable even if you grant consent. Contact your teacher if you think this is a
            mistake.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {successFlash ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>Your voice consent choice was saved.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          size="lg"
          disabled={submitting !== null || currentStatus === 'granted'}
          onClick={() => handleSubmit('granted')}
        >
          {submitting === 'granted' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          I consent to voice practice
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          size="lg"
          disabled={submitting !== null || currentStatus === 'revoked' || currentStatus === 'unknown'}
          onClick={() => handleSubmit('revoked')}
        >
          {submitting === 'revoked' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Withdraw consent
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        You can change this choice at any time.{' '}
        <Link to="/compliance" className="underline">
          Read more about how Lingual handles student data.
        </Link>
      </p>
    </div>
  );
}
