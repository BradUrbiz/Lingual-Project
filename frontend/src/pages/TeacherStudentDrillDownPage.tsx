import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquareText,
  MailCheck,
  Scale,
  Target,
  Users,
} from 'lucide-react';
import {
  cancelStudentGuardianConsentPacket,
  getStudentCompliance,
  getStudentDrillDown,
  getStudentGuardianConsentPacket,
  issueStudentGuardianConsentPacket,
  resendStudentGuardianConsentPacket,
  updateStudentCompliance,
} from '@/api/teacher';
import { Alert, AlertDescription, Badge, Button, Card, Input } from '@/components/ui';
import type {
  ConsentStatus,
  GuardianConsentContactChannel,
  GuardianConsentDeliveryMethod,
  GuardianConsentPacket,
  StudentComplianceRecord,
  StudentDrillDownData,
} from '@/types';

const CONSENT_OPTIONS: Array<{ value: ConsentStatus; label: string }> = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'granted', label: 'Granted' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'not_required', label: 'Not required' },
];

const RETENTION_OPTIONS = [
  { value: 'standard_school', label: 'Standard school retention' },
  { value: 'no_raw_audio', label: 'No raw audio retention' },
];

const DELIVERY_OPTIONS: Array<{ value: GuardianConsentDeliveryMethod; label: string }> = [
  { value: 'secure_link', label: 'Secure link' },
  { value: 'downloadable_notice', label: 'Downloadable notice' },
];

const CONTACT_CHANNEL_OPTIONS: Array<{ value: GuardianConsentContactChannel; label: string }> = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'paper', label: 'Paper' },
  { value: 'other', label: 'Other' },
];

const DEFAULT_GUARDIAN_NOTICE_VERSION = 'guardian_beta_v1';

function buildGuardianConsentLink(token: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const route = `${base || ''}/guardian/consent/${token}`;
  return `${window.location.origin}${route.startsWith('/') ? route : `/${route}`}`;
}

function formatGuardianTimestamp(value?: string | null) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function TeacherStudentDrillDownPage() {
  const { classId, studentUid } = useParams<{ classId: string; studentUid: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<StudentDrillDownData | null>(null);
  const [compliance, setCompliance] = useState<StudentComplianceRecord | null>(null);
  const [guardianPacket, setGuardianPacket] = useState<GuardianConsentPacket | null>(null);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [guardianPacketError, setGuardianPacketError] = useState<string | null>(null);
  const [guardianPacketStatus, setGuardianPacketStatus] = useState<string | null>(null);
  const [isSavingCompliance, setIsSavingCompliance] = useState(false);
  const [isIssuingGuardianPacket, setIsIssuingGuardianPacket] = useState(false);
  const [isResendingGuardianPacket, setIsResendingGuardianPacket] = useState(false);
  const [isCancelingGuardianPacket, setIsCancelingGuardianPacket] = useState(false);
  const [guardianDeliveryLink, setGuardianDeliveryLink] = useState<string | null>(null);
  const [complianceDraft, setComplianceDraft] = useState({
    isMinor: true,
    guardianConsentStatus: 'unknown' as ConsentStatus,
    voiceConsentStatus: 'unknown' as ConsentStatus,
    textAllowed: true,
    retentionPolicyId: 'standard_school',
  });
  const [guardianPacketDraft, setGuardianPacketDraft] = useState({
    deliveryMethod: 'secure_link' as GuardianConsentDeliveryMethod,
    contactChannel: 'email' as GuardianConsentContactChannel,
    contactDestinationHint: '',
    noticeVersion: DEFAULT_GUARDIAN_NOTICE_VERSION,
  });

  useEffect(() => {
    let isActive = true;

    if (!classId || !studentUid) {
      setLoading(false);
      setError('Class id and student id are required.');
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const [data, complianceRecord, guardianPacketRecord] = await Promise.all([
          getStudentDrillDown(classId, studentUid),
          getStudentCompliance(classId, studentUid),
          getStudentGuardianConsentPacket(classId, studentUid),
        ]);
        if (!isActive) return;
        setAnalytics(data);
        setCompliance(complianceRecord);
        setGuardianPacket(guardianPacketRecord);
        setGuardianDeliveryLink(null);
        setComplianceDraft({
          isMinor: complianceRecord.isMinor,
          guardianConsentStatus: complianceRecord.guardianConsentStatus as ConsentStatus,
          voiceConsentStatus: complianceRecord.voiceConsentStatus as ConsentStatus,
          textAllowed: complianceRecord.textAllowed,
          retentionPolicyId: complianceRecord.retentionPolicyId,
        });
        setComplianceError(null);
        setError(null);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to load student analytics.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [classId, studentUid]);

  const handleComplianceSave = async () => {
    if (!classId || !studentUid) return;
    setComplianceError(null);
    setIsSavingCompliance(true);
    try {
      const updated = await updateStudentCompliance(classId, studentUid, complianceDraft);
      setCompliance(updated);
      setComplianceDraft({
        isMinor: updated.isMinor,
        guardianConsentStatus: updated.guardianConsentStatus as ConsentStatus,
        voiceConsentStatus: updated.voiceConsentStatus as ConsentStatus,
        textAllowed: updated.textAllowed,
        retentionPolicyId: updated.retentionPolicyId,
      });
    } catch (err) {
      setComplianceError(err instanceof Error ? err.message : 'Failed to update consent state.');
    } finally {
      setIsSavingCompliance(false);
    }
  };

  const handleIssueGuardianPacket = async () => {
    if (!classId || !studentUid || !compliance?.isMinor) return;
    setGuardianPacketError(null);
    setGuardianPacketStatus(null);
    setIsIssuingGuardianPacket(true);
    try {
      const result = await issueStudentGuardianConsentPacket(classId, studentUid, guardianPacketDraft);
      setGuardianPacket(result.guardianPacket);
      setGuardianDeliveryLink(result.deliveryToken ? buildGuardianConsentLink(result.deliveryToken) : null);
      setGuardianPacketStatus(
        result.deliveryToken
          ? 'Guardian packet issued. Copy and send the secure link to the guardian.'
          : 'Guardian packet issued for staff-managed notice delivery. Update consent manually after the guardian responds offline.',
      );
    } catch (err) {
      setGuardianPacketError(err instanceof Error ? err.message : 'Failed to issue guardian packet.');
    } finally {
      setIsIssuingGuardianPacket(false);
    }
  };

  const handleResendGuardianPacket = async () => {
    if (!classId || !studentUid || !guardianPacket?.id) return;
    setGuardianPacketError(null);
    setGuardianPacketStatus(null);
    setIsResendingGuardianPacket(true);
    try {
      const result = await resendStudentGuardianConsentPacket(classId, studentUid, guardianPacket.id);
      setGuardianPacket(result.guardianPacket);
      setGuardianDeliveryLink(result.deliveryToken ? buildGuardianConsentLink(result.deliveryToken) : null);
      setGuardianPacketStatus(
        result.deliveryToken
          ? 'Guardian packet resent. Use the new secure link.'
          : 'Guardian packet resent for staff-managed notice delivery.',
      );
    } catch (err) {
      setGuardianPacketError(err instanceof Error ? err.message : 'Failed to resend guardian packet.');
    } finally {
      setIsResendingGuardianPacket(false);
    }
  };

  const handleCancelGuardianPacket = async () => {
    if (!classId || !studentUid || !guardianPacket?.id) return;
    setGuardianPacketError(null);
    setGuardianPacketStatus(null);
    setIsCancelingGuardianPacket(true);
    try {
      const updated = await cancelStudentGuardianConsentPacket(classId, studentUid, guardianPacket.id);
      setGuardianPacket(updated);
      setGuardianDeliveryLink(null);
      setGuardianPacketStatus('Guardian packet canceled.');
    } catch (err) {
      setGuardianPacketError(err instanceof Error ? err.message : 'Failed to cancel guardian packet.');
    } finally {
      setIsCancelingGuardianPacket(false);
    }
  };

  const handleCopyGuardianLink = async () => {
    if (!guardianDeliveryLink) return;
    setGuardianPacketError(null);
    try {
      await navigator.clipboard.writeText(guardianDeliveryLink);
      setGuardianPacketStatus('Guardian link copied.');
    } catch {
      setGuardianPacketStatus('Copy failed. You can still copy the link from the field below.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error || 'Student analytics are unavailable.'}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => navigate(classId ? `/app/teacher/classes/${classId}/analytics` : '/app/teacher')}
        >
          Back to class
        </Button>
      </div>
    );
  }

  const stats = [
    { label: 'Sessions', value: analytics.summary.sessionCount, icon: BarChart3, accent: 'bg-primary/10 text-primary' },
    { label: 'Student turns', value: analytics.summary.totalStudentTurns, icon: Users, accent: 'bg-success/15 text-success' },
    { label: 'Speaking minutes', value: Math.round(analytics.summary.estimatedSpeakingTimeSeconds / 60), icon: MessageSquareText, accent: 'bg-accent/20 text-accent-foreground' },
    { label: 'Words / turn', value: analytics.summary.averageStudentWordsPerTurn > 0 ? analytics.summary.averageStudentWordsPerTurn.toFixed(1) : '0', icon: Target, accent: 'bg-secondary text-foreground' },
    { label: 'Self-corrections', value: analytics.summary.selfCorrectionCount, icon: CheckCircle2, accent: 'bg-primary/5 text-foreground' },
    { label: 'Repeated errors', value: analytics.summary.repeatedErrorCount, icon: AlertTriangle, accent: 'bg-destructive/10 text-destructive' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="outline"
          size="sm"
          className="mb-4"
          onClick={() => navigate(`/app/teacher/classes/${classId}/analytics`)}
        >
          <ArrowLeft size={16} className="mr-2" />
          Back to class
        </Button>
        <h1 className="text-3xl font-display font-bold text-foreground">{analytics.student.displayName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {analytics.class.name} · {analytics.class.subject || 'Language practice'} · {analytics.class.term || 'Current term'}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {analytics.limitations.map((message) => (
        <Alert key={message}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}

      {/* Summary stats */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-3 border-foreground p-5 shadow-stamp">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-foreground ${stat.accent}`}>
                <stat.icon size={22} strokeWidth={2.5} />
              </div>
            </div>
            <p className="text-3xl font-display font-bold text-foreground">{stat.value}</p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{stat.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          {/* Per-assignment breakdown */}
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
                <ClipboardList size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Assignment breakdown</h2>
                <p className="text-sm text-muted-foreground">Practice activity per assignment</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {analytics.assignments.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                  No assignment sessions recorded for this student yet.
                </div>
              ) : (
                analytics.assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="cursor-pointer rounded-2xl border-2 border-border bg-secondary/40 p-4 transition-colors hover:border-foreground/30"
                    onClick={() => navigate(`/app/teacher/classes/${classId}/assignments/${assignment.id}/analytics`)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{assignment.title}</p>
                      <Badge variant={assignment.status === 'published' ? 'success' : 'outline'} size="sm">
                        {assignment.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span>{assignment.sessionCount} sessions</span>
                      <span>{Math.round(assignment.estimatedSpeakingTimeSeconds / 60)} min</span>
                      <span>{assignment.totalStudentTurns} turns</span>
                      <span>{assignment.selfCorrectionCount} self-corrections</span>
                    </div>

                    {/* Target expressions */}
                    {assignment.targetExpressionTotalHits > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Object.entries(assignment.targetExpressionHits).map(([expr, count]) => (
                          <Badge key={expr} variant="outline" size="sm">
                            {expr}: {count}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Rubric scores */}
                    {assignment.rubricDimensionScores.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Scale size={14} className="text-muted-foreground" />
                        {assignment.rubricDimensionScores.map((dim) => (
                          <Badge key={dim.id} variant="secondary" size="sm">
                            {dim.id}: {dim.score.toFixed(2)}
                          </Badge>
                        ))}
                        {typeof assignment.rubricAverageScore === 'number' && (
                          <Badge variant="accent" size="sm">
                            avg {assignment.rubricAverageScore.toFixed(2)}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-accent/20 text-accent-foreground">
                <CheckCircle2 size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Consent and modality</h2>
                <p className="text-sm text-muted-foreground">Voice launch eligibility for this student.</p>
              </div>
            </div>

            {compliance ? (
              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={compliance.voiceAllowed ? 'success' : 'outline'} size="sm">
                    Voice {compliance.voiceAllowed ? 'allowed' : 'blocked'}
                  </Badge>
                  <Badge variant={compliance.textAllowed ? 'accent' : 'outline'} size="sm">
                    Text {compliance.textAllowed ? 'allowed' : 'blocked'}
                  </Badge>
                  <Badge variant="secondary" size="sm">
                    {compliance.retentionPolicy.label}
                  </Badge>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium text-foreground">
                    <span>Student status</span>
                    <select
                      value={complianceDraft.isMinor ? 'minor' : 'adult'}
                      onChange={(event) => setComplianceDraft((current) => ({
                        ...current,
                        isMinor: event.target.value === 'minor',
                        guardianConsentStatus: event.target.value === 'minor'
                          ? current.guardianConsentStatus
                          : 'not_required',
                      }))}
                      className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
                    >
                      <option value="minor">Minor</option>
                      <option value="adult">Adult</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm font-medium text-foreground">
                    <span>Voice consent</span>
                    <select
                      value={complianceDraft.voiceConsentStatus}
                      onChange={(event) => setComplianceDraft((current) => ({
                        ...current,
                        voiceConsentStatus: event.target.value as ConsentStatus,
                      }))}
                      className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
                    >
                      {CONSENT_OPTIONS.filter((option) => option.value !== 'not_required').map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm font-medium text-foreground">
                    <span>Guardian consent</span>
                    <select
                      value={complianceDraft.isMinor ? complianceDraft.guardianConsentStatus : 'not_required'}
                      onChange={(event) => setComplianceDraft((current) => ({
                        ...current,
                        guardianConsentStatus: event.target.value as ConsentStatus,
                      }))}
                      disabled={!complianceDraft.isMinor}
                      className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {CONSENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm font-medium text-foreground">
                    <span>Retention policy</span>
                    <select
                      value={complianceDraft.retentionPolicyId}
                      onChange={(event) => setComplianceDraft((current) => ({
                        ...current,
                        retentionPolicyId: event.target.value,
                      }))}
                      className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
                    >
                      {RETENTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 px-4 py-3 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={complianceDraft.textAllowed}
                    onChange={(event) => setComplianceDraft((current) => ({
                      ...current,
                      textAllowed: event.target.checked,
                    }))}
                    className="h-4 w-4 rounded border-border"
                  />
                  Text launch allowed for this student
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => void handleComplianceSave()} loading={isSavingCompliance}>
                    Save consent state
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Last verified: {compliance.lastVerifiedAt || 'not recorded'}
                  </p>
                </div>

                <div className="border-t-2 border-border/70 pt-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
                      <MailCheck size={18} strokeWidth={2.5} />
                    </div>
                    <div>
                      <h3 className="text-lg font-display font-bold text-foreground">Guardian packet</h3>
                      <p className="text-sm text-muted-foreground">
                        Secure guardian notice flow for minor students without a separate guardian account.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant={guardianPacket ? 'secondary' : 'outline'} size="sm">
                      {guardianPacket ? `Packet ${guardianPacket.status}` : 'No packet issued'}
                    </Badge>
                    {guardianPacket ? (
                      <Badge variant="outline" size="sm">
                        {guardianPacket.deliveryMethod.replaceAll('_', ' ')}
                      </Badge>
                    ) : null}
                    {guardianPacket?.noticeVersion ? (
                      <Badge variant="outline" size="sm">
                        {guardianPacket.noticeVersion}
                      </Badge>
                    ) : null}
                    {guardianPacket?.expiresAt ? (
                      <Badge variant="secondary" size="sm">
                        expires {guardianPacket.expiresAt}
                      </Badge>
                    ) : null}
                  </div>

                  {!compliance.isMinor ? (
                    <div className="mt-4 rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                      This student is currently marked as an adult, so guardian packet issuance is disabled.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {guardianPacket ? (
                        <div className="grid gap-3 rounded-2xl border-2 border-border bg-secondary/30 p-4 text-sm text-muted-foreground sm:grid-cols-2">
                          <p>
                            Last sent: <span className="font-medium text-foreground">{formatGuardianTimestamp(guardianPacket.lastSentAt)}</span>
                          </p>
                          <p>
                            Expires: <span className="font-medium text-foreground">{formatGuardianTimestamp(guardianPacket.expiresAt)}</span>
                          </p>
                          <p>
                            Acted: <span className="font-medium text-foreground">{formatGuardianTimestamp(guardianPacket.actedAt)}</span>
                          </p>
                          <p>
                            Reminders: <span className="font-medium text-foreground">{guardianPacket.reminderCount}</span>
                          </p>
                        </div>
                      ) : null}

                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2 text-sm font-medium text-foreground">
                          <span>Delivery method</span>
                          <select
                            value={guardianPacketDraft.deliveryMethod}
                            onChange={(event) => setGuardianPacketDraft((current) => ({
                              ...current,
                              deliveryMethod: event.target.value as GuardianConsentDeliveryMethod,
                            }))}
                            className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
                          >
                            {DELIVERY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-2 text-sm font-medium text-foreground">
                          <span>Contact channel</span>
                          <select
                            value={guardianPacketDraft.contactChannel}
                            onChange={(event) => setGuardianPacketDraft((current) => ({
                              ...current,
                              contactChannel: event.target.value as GuardianConsentContactChannel,
                            }))}
                            className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
                          >
                            {CONTACT_CHANNEL_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-2 text-sm font-medium text-foreground sm:col-span-2">
                          <span>Contact destination hint</span>
                          <Input
                            value={guardianPacketDraft.contactDestinationHint}
                            onChange={(event) => setGuardianPacketDraft((current) => ({
                              ...current,
                              contactDestinationHint: event.target.value,
                            }))}
                            placeholder="parent@example.org, counselor handoff, paper packet..."
                          />
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Button
                          onClick={() => void handleIssueGuardianPacket()}
                          loading={isIssuingGuardianPacket}
                          disabled={Boolean(guardianPacket && !guardianPacket.isTerminal)}
                        >
                          Issue guardian packet
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void handleResendGuardianPacket()}
                          loading={isResendingGuardianPacket}
                          disabled={!guardianPacket?.canResend}
                        >
                          Resend packet
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void handleCancelGuardianPacket()}
                          loading={isCancelingGuardianPacket}
                          disabled={!guardianPacket?.canCancel}
                        >
                          Cancel packet
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void handleCopyGuardianLink()}
                          disabled={!guardianDeliveryLink || guardianPacket?.deliveryMethod !== 'secure_link'}
                        >
                          Copy latest link
                        </Button>
                      </div>

                      {guardianPacket?.deliveryMethod === 'secure_link' && guardianDeliveryLink ? (
                        <label className="space-y-2 text-sm font-medium text-foreground">
                          <span>Latest secure link</span>
                          <Input readOnly value={guardianDeliveryLink} />
                        </label>
                      ) : null}

                      {guardianPacket?.deliveryMethod === 'secure_link' && !guardianDeliveryLink && guardianPacket ? (
                        <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                          For security, previously issued guardian links cannot be retrieved. Resend the packet to generate a fresh link.
                        </div>
                      ) : null}

                      {guardianPacket?.deliveryMethod === 'downloadable_notice' ? (
                        <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                          Downloadable notice mode is staff-managed in beta. Record the paper or offline response by updating the student consent state from this page.
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                Consent state is unavailable for this student.
              </div>
            )}

            {complianceError ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{complianceError}</AlertDescription>
              </Alert>
            ) : null}

            {guardianPacketError ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{guardianPacketError}</AlertDescription>
              </Alert>
            ) : null}

            {guardianPacketStatus ? (
              <Alert className="mt-4">
                <AlertDescription>{guardianPacketStatus}</AlertDescription>
              </Alert>
            ) : null}
          </Card>

          {/* Repeated errors */}
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-destructive/80 text-destructive-foreground">
                <AlertTriangle size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Repeated errors</h2>
                <p className="text-sm text-muted-foreground">Error patterns across all assignments</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {analytics.repeatedErrors.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                  No repeated error patterns detected yet.
                </div>
              ) : (
                analytics.repeatedErrors.map((err) => (
                  <div key={err.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{err.label}</p>
                      <Badge variant="outline" size="sm">{err.category}</Badge>
                      <Badge variant="secondary" size="sm">count {err.count}</Badge>
                    </div>
                    {err.rubricDimensionIds.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Rubric: {err.rubricDimensionIds.join(', ')}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Recent sessions */}
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <h2 className="text-xl font-display font-bold text-foreground">Recent sessions</h2>
            <div className="mt-5 space-y-3">
              {analytics.recentSessions.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                  No practice sessions recorded yet.
                </div>
              ) : (
                analytics.recentSessions.map((session) => (
                  <div key={session.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" size="sm">{session.status}</Badge>
                      <Badge variant="secondary" size="sm">Turns {session.sessionSummary.studentTurnCount}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-foreground">
                      Speaking {session.sessionSummary.estimatedSpeakingTimeSeconds}s · Self-corrections{' '}
                      {session.sessionSummary.selfCorrectionCount} · Task completions {session.sessionSummary.taskCompletionCount}
                    </p>
                    {session.sessionSummary.endedReason ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Ended: {session.sessionSummary.endedReason}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
