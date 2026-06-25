import { useEffect, useReducer } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, MailCheck, ShieldAlert } from 'lucide-react';
import { getGuardianConsentPacket, submitGuardianConsentDecision } from '@/api/guardian';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import type { GuardianConsentDecisionResult, GuardianConsentPublicView } from '@/types';

function formatDecisionTimestamp(value: string | null | undefined, notRecorded: string) {
  if (!value) return notRecorded;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

type GuardianConsentState = {
  loading: boolean;
  submittingDecision: 'granted' | 'revoked' | null;
  guardianConsent: GuardianConsentPublicView | null;
  decisionResult: GuardianConsentDecisionResult | null;
  acknowledged: boolean;
  error: string | null;
};

type GuardianConsentAction =
  | { type: 'invalid-token' }
  | { type: 'load-start' }
  | { type: 'load-success'; guardianConsent: GuardianConsentPublicView }
  | { type: 'load-error'; error: string }
  | { type: 'set-acknowledged'; acknowledged: boolean }
  | { type: 'decision-start'; decision: 'granted' | 'revoked' }
  | { type: 'decision-success'; result: GuardianConsentDecisionResult }
  | { type: 'decision-error'; error: string };

const initialGuardianConsentState: GuardianConsentState = {
  loading: true,
  submittingDecision: null,
  guardianConsent: null,
  decisionResult: null,
  acknowledged: false,
  error: null,
};

function guardianConsentReducer(
  state: GuardianConsentState,
  action: GuardianConsentAction
): GuardianConsentState {
  switch (action.type) {
    case 'invalid-token':
      return { ...state, loading: false, error: 'guardian.consent.invalidToken' };
    case 'load-start':
      return { ...state, loading: true };
    case 'load-success':
      return {
        ...state,
        loading: false,
        guardianConsent: action.guardianConsent,
        decisionResult: null,
        error: null,
      };
    case 'load-error':
      return { ...state, loading: false, error: action.error };
    case 'set-acknowledged':
      return { ...state, acknowledged: action.acknowledged };
    case 'decision-start':
      return { ...state, submittingDecision: action.decision, error: null };
    case 'decision-success':
      return {
        ...state,
        submittingDecision: null,
        decisionResult: action.result,
        guardianConsent: action.result.guardianConsent,
      };
    case 'decision-error':
      return { ...state, submittingDecision: null, error: action.error };
    default:
      return state;
  }
}

export function GuardianConsentPage() {
  const { token } = useParams<{ token: string }>();
  const [state, dispatch] = useReducer(guardianConsentReducer, initialGuardianConsentState);
  const { loading, submittingDecision, guardianConsent, decisionResult, acknowledged, error } = state;
  const { t } = useLanguage();

  useEffect(() => {
    let isActive = true;

    if (!token) {
      dispatch({ type: 'invalid-token' });
      return;
    }

    const load = async () => {
      dispatch({ type: 'load-start' });
      try {
        const payload = await getGuardianConsentPacket(token);
        if (!isActive) return;
        dispatch({ type: 'load-success', guardianConsent: payload });
      } catch (err) {
        if (!isActive) return;
        dispatch({
          type: 'load-error',
          error: err instanceof Error ? err.message : t('guardian.consent.loadError'),
        });
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [token]);

  const handleDecision = async (decision: 'granted' | 'revoked') => {
    if (!token || !acknowledged) return;
    dispatch({ type: 'decision-start', decision });
    try {
      const result = await submitGuardianConsentDecision(token, { decision, acknowledged: true });
      dispatch({ type: 'decision-success', result });
    } catch (err) {
      dispatch({
        type: 'decision-error',
        error: err instanceof Error ? err.message : t('guardian.consent.decisionError'),
      });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!guardianConsent) {
    return (
      <div className="min-h-screen bg-secondary/30 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>{t('guardian.consent.unavailableTitle')}</AlertTitle>
            <AlertDescription>{error ? t(error) : t('guardian.consent.unavailableDefault')}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const activePacket = decisionResult?.guardianPacket || guardianConsent.packet;
  const currentDecision = decisionResult?.guardianPacket.status;
  const notRecorded = t('guardian.consent.notRecorded');

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#fff8df,transparent_50%),linear-gradient(180deg,#fffaf0_0%,#f7f4ed_100%)] px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
            <MailCheck size={20} strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-semibold text-foreground">{t('guardian.consent.header.title')}</p>
            <p>{guardianConsent.class.name || t('guardian.consent.header.classDefault')} · {guardianConsent.class.subject || t('guardian.consent.header.subjectDefault')}</p>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {currentDecision ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>{t('guardian.consent.decisionRecorded.title')}</AlertTitle>
            <AlertDescription>
              {t('guardian.consent.decisionRecorded.desc')
                .replace('{status}', currentDecision)
                .replace('{date}', formatDecisionTimestamp(decisionResult?.guardianPacket.actedAt, notRecorded))}
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
              {t('guardian.consent.notice.appliesTo').replace('{name}', guardianConsent.student.displayName)}
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
                {t('guardian.consent.meta.contactChannel')} <span className="font-medium text-foreground">{activePacket.contactChannel}</span>
              </p>
              <p>
                {t('guardian.consent.meta.expires')} <span className="font-medium text-foreground">{formatDecisionTimestamp(activePacket.expiresAt, notRecorded)}</span>
              </p>
              <p>
                {t('guardian.consent.meta.lastSent')} <span className="font-medium text-foreground">{formatDecisionTimestamp(activePacket.lastSentAt, notRecorded)}</span>
              </p>
              <p>
                {t('guardian.consent.meta.contactHint')} <span className="font-medium text-foreground">{activePacket.contactDestinationHint || t('guardian.consent.meta.notProvided')}</span>
              </p>
            </div>

            {!decisionResult ? (
              <div className="space-y-4">
                <label className="flex items-start gap-3 rounded-2xl border-2 border-border bg-background p-4 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => dispatch({ type: 'set-acknowledged', acknowledged: event.target.checked })}
                    className="mt-1 size-4 rounded border-border"
                  />
                  <span>
                    {t('guardian.consent.ack.label')}
                  </span>
                </label>

                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => void handleDecision('granted')}
                    loading={submittingDecision === 'granted'}
                    disabled={!acknowledged || submittingDecision !== null}
                  >
                    {t('guardian.consent.action.grant')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleDecision('revoked')}
                    loading={submittingDecision === 'revoked'}
                    disabled={!acknowledged || submittingDecision !== null}
                  >
                    {t('guardian.consent.action.deny')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-border bg-background p-4 text-sm text-muted-foreground">
                {t('guardian.consent.afterDecision')}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          {t('guardian.consent.footer.text')}
          <Link to="/" className="ml-1 underline decoration-foreground/40 underline-offset-4">
            {t('guardian.consent.footer.home')}
          </Link>
        </p>
      </div>
    </div>
  );
}
