import { useEffect, useReducer } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, Mic, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, Badge, Button, Card } from '@/components/ui';
import { getStudentCompliance, submitVoiceConsent } from '@/api/voiceConsent';
import type { StudentComplianceRecord, RetentionPolicySummary } from '@/types/school';

type ConsentStatus = 'granted' | 'revoked' | 'unknown' | 'pending' | string;

function statusBadgeVariant(status: ConsentStatus): 'success' | 'destructive' | 'outline' {
  if (status === 'granted') return 'success';
  if (status === 'revoked') return 'destructive';
  return 'outline';
}

function retentionSummaryText(policy: RetentionPolicySummary | undefined): string {
  if (!policy) return 'Standard school retention policy applies.';
  const parts: string[] = [];
  if (policy.rawAudioStorageAllowed) {
    const days = policy.rawAudioRetentionDays ?? 0;
    parts.push(`Raw audio is kept for ${days} day${days === 1 ? '' : 's'}, then deleted`);
  } else {
    parts.push('Raw audio is not stored - only transcripts');
  }
  if (policy.transcriptRetentionDays) {
    parts.push(`transcripts are kept for ${policy.transcriptRetentionDays} day${policy.transcriptRetentionDays === 1 ? '' : 's'}`);
  }
  return parts.join('; ') + '.';
}

type VoiceConsentState = {
  compliance: StudentComplianceRecord | null;
  loading: boolean;
  submitting: 'granted' | 'revoked' | null;
  error: string | null;
  successFlash: boolean;
};

type VoiceConsentAction =
  | { type: 'load-success'; compliance: StudentComplianceRecord }
  | { type: 'load-error'; error: string }
  | { type: 'set-success-flash'; value: boolean }
  | { type: 'submit-start'; decision: 'granted' | 'revoked' }
  | { type: 'submit-success'; compliance: StudentComplianceRecord }
  | { type: 'submit-error'; error: string };

const initialVoiceConsentState: VoiceConsentState = {
  compliance: null,
  loading: true,
  submitting: null,
  error: null,
  successFlash: false,
};

function voiceConsentReducer(state: VoiceConsentState, action: VoiceConsentAction): VoiceConsentState {
  switch (action.type) {
    case 'load-success':
      return { ...state, compliance: action.compliance, loading: false };
    case 'load-error':
      return { ...state, error: action.error, loading: false };
    case 'set-success-flash':
      return { ...state, successFlash: action.value };
    case 'submit-start':
      return { ...state, submitting: action.decision, error: null };
    case 'submit-success':
      return { ...state, compliance: action.compliance, submitting: null, successFlash: true };
    case 'submit-error':
      return { ...state, error: action.error, submitting: null };
    default:
      return state;
  }
}

export function VoiceConsentPage() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(voiceConsentReducer, initialVoiceConsentState);
  const { compliance, loading, submitting, error, successFlash } = state;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const record = await getStudentCompliance();
        if (active) dispatch({ type: 'load-success', compliance: record });
      } catch (err) {
        if (active) {
          dispatch({
            type: 'load-error',
            error: err instanceof Error ? err.message : 'Could not load your compliance record.',
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!successFlash) return;
    const timer = window.setTimeout(() => dispatch({ type: 'set-success-flash', value: false }), 2500);
    return () => window.clearTimeout(timer);
  }, [successFlash]);

  const handleSubmit = async (decision: 'granted' | 'revoked') => {
    dispatch({ type: 'submit-start', decision });
    try {
      const next = await submitVoiceConsent(decision);
      dispatch({ type: 'submit-success', compliance: next });
    } catch (err) {
      dispatch({
        type: 'submit-error',
        error: err instanceof Error ? err.message : 'Could not update your voice consent.',
      });
    }
  };

  const currentStatus: ConsentStatus = compliance?.voiceConsentStatus || 'unknown';
  const guardianRevoked = compliance?.guardianConsentStatus === 'revoked';
  const retentionPolicy = compliance?.retentionPolicy;
  const retentionLabel = retentionPolicy?.label || 'Standard school retention';

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-display font-bold text-foreground">Voice practice consent</h1>
      </div>

      <Card className="border-3 border-foreground p-6 shadow-stamp">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
            <Mic size={24} strokeWidth={2.5} />
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Voice practice lets you speak with the AI tutor in real time. Your audio is sent to
              OpenAI to transcribe what you say and generate the tutor's response. OpenAI does not
              use this data to train its models.
            </p>
            <p className="text-sm text-muted-foreground">
              If you don't consent, you can still complete assignments via text practice - typing
              with the AI tutor instead of speaking.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Your status
              </span>
              {loading ? (
                <Badge variant="outline">loading…</Badge>
              ) : (
                <Badge variant={statusBadgeVariant(currentStatus)}>{String(currentStatus)}</Badge>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-3 border-foreground p-6 shadow-stamp">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Retention policy
            </h2>
            <Badge variant="outline">{retentionLabel}</Badge>
          </div>
          <p className="text-sm text-foreground/80">
            {loading ? 'Loading retention details…' : retentionSummaryText(retentionPolicy)}
          </p>
          <p className="text-xs text-muted-foreground">
            <Link to="/compliance" className="underline">
              See Lingual's full data policy
            </Link>{' '}
            for details on what is collected, how it's used, and how to request deletion.
          </p>
        </div>
      </Card>

      {guardianRevoked ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
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
          <CheckCircle2 className="size-4" />
          <AlertDescription>Your voice consent choice was saved.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          size="lg"
          disabled={submitting !== null || loading || currentStatus === 'granted'}
          onClick={() => handleSubmit('granted')}
        >
          {submitting === 'granted' ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          I consent to voice practice
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          size="lg"
          disabled={submitting !== null || loading || currentStatus !== 'granted'}
          onClick={() => handleSubmit('revoked')}
        >
          {submitting === 'revoked' ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Withdraw consent
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">You can change this choice at any time.</p>
    </div>
  );
}
