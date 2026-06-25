import { useCallback, useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  approveDeletionRequest,
  createDeletionRequest,
  executeDeletionRequest,
  listDeletionRequests,
  rejectDeletionRequest,
  retryDeletionRequest,
} from '@/api/admin';
import { Alert, AlertDescription, Badge, Button, Card, Input } from '@/components/ui';
import type {
  CreateDeletionRequestPayload,
  DeletionRequest,
  DeletionRequestStatus,
  DeletionScopeType,
} from '@/types';
import { useMembership } from '@/contexts/MembershipContext';
import { useLanguage } from '@/contexts/LanguageContext';

const STATUS_COLOR: Record<DeletionRequestStatus, string> = {
  requested: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-gray-100 text-gray-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  partially_completed: 'bg-orange-100 text-orange-800',
};

function formatTimestamp(value?: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function StatusBadge({ status }: { status: DeletionRequestStatus }) {
  const { t } = useLanguage();
  const statusKeyMap: Record<DeletionRequestStatus, string> = {
    requested: 'admin.deletionRequests.status.requested',
    approved: 'admin.deletionRequests.status.approved',
    rejected: 'admin.deletionRequests.status.rejected',
    in_progress: 'admin.deletionRequests.status.inProgress',
    completed: 'admin.deletionRequests.status.completed',
    failed: 'admin.deletionRequests.status.failed',
    partially_completed: 'admin.deletionRequests.status.partiallyCompleted',
  };
  const color = STATUS_COLOR[status] || 'bg-gray-100 text-gray-800';
  const label = statusKeyMap[status] ? t(statusKeyMap[status]) : status;
  return <Badge className={color}>{label}</Badge>;
}

function StatusIcon({ status }: { status: DeletionRequestStatus }) {
  switch (status) {
    case 'requested': return <Clock className="size-4 text-amber-500" />;
    case 'approved': return <CheckCircle2 className="size-4 text-blue-500" />;
    case 'rejected': return <XCircle className="size-4 text-gray-400" />;
    case 'in_progress': return <Loader2 className="size-4 text-indigo-500 animate-spin" />;
    case 'completed': return <CheckCircle2 className="size-4 text-green-500" />;
    case 'failed': return <AlertTriangle className="size-4 text-red-500" />;
    case 'partially_completed': return <AlertTriangle className="size-4 text-orange-500" />;
  }
}

type AdminDeletionState = {
  requests: DeletionRequest[];
  loading: boolean;
  error: string | null;
  actionLoading: string | null;
  statusMessage: string | null;
  showNewForm: boolean;
  newScopeType: DeletionScopeType;
  newScopeId: string;
  newReason: string;
  creating: boolean;
  reviewNotes: string;
};

type AdminDeletionAction =
  | { type: 'load-start' }
  | { type: 'load-success'; requests: DeletionRequest[] }
  | { type: 'load-error'; error: string }
  | { type: 'set-action-loading'; requestId: string | null }
  | { type: 'set-error'; error: string | null }
  | { type: 'set-status-message'; statusMessage: string | null }
  | { type: 'toggle-new-form' }
  | { type: 'set-new-form-field'; field: 'newScopeId' | 'newReason'; value: string }
  | { type: 'set-new-scope-type'; value: DeletionScopeType }
  | { type: 'create-start' }
  | { type: 'create-success' }
  | { type: 'create-finished' }
  | { type: 'set-review-notes'; reviewNotes: string };

const initialAdminDeletionState: AdminDeletionState = {
  requests: [],
  loading: true,
  error: null,
  actionLoading: null,
  statusMessage: null,
  showNewForm: false,
  newScopeType: 'student',
  newScopeId: '',
  newReason: '',
  creating: false,
  reviewNotes: '',
};

function adminDeletionReducer(
  state: AdminDeletionState,
  action: AdminDeletionAction
): AdminDeletionState {
  switch (action.type) {
    case 'load-start':
      return { ...state, loading: true, error: null };
    case 'load-success':
      return { ...state, requests: action.requests, loading: false };
    case 'load-error':
      return { ...state, error: action.error, loading: false };
    case 'set-action-loading':
      return { ...state, actionLoading: action.requestId };
    case 'set-error':
      return { ...state, error: action.error };
    case 'set-status-message':
      return { ...state, statusMessage: action.statusMessage };
    case 'toggle-new-form':
      return { ...state, showNewForm: !state.showNewForm };
    case 'set-new-form-field':
      return { ...state, [action.field]: action.value };
    case 'set-new-scope-type':
      return { ...state, newScopeType: action.value };
    case 'create-start':
      return { ...state, creating: true, error: null };
    case 'create-success':
      return {
        ...state,
        showNewForm: false,
        newScopeId: '',
        newReason: '',
      };
    case 'create-finished':
      return { ...state, creating: false };
    case 'set-review-notes':
      return { ...state, reviewNotes: action.reviewNotes };
    default:
      return state;
  }
}

type NewDeletionRequestFormProps = {
  scopeType: DeletionScopeType;
  scopeId: string;
  reason: string;
  creating: boolean;
  onScopeTypeChange: (value: DeletionScopeType) => void;
  onScopeIdChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onCreate: () => void;
  onCancel: () => void;
};

function NewDeletionRequestForm({
  scopeType,
  scopeId,
  reason,
  creating,
  onScopeTypeChange,
  onScopeIdChange,
  onReasonChange,
  onCreate,
  onCancel,
}: NewDeletionRequestFormProps) {
  const { t } = useLanguage();
  const scopeIdLabel =
    scopeType === 'student'
      ? t('admin.deletionRequests.form.scopeIdLabelStudent')
      : scopeType === 'class'
      ? t('admin.deletionRequests.form.scopeIdLabelClass')
      : t('admin.deletionRequests.form.scopeIdLabelOrg');
  const scopeTypeName =
    scopeType === 'student'
      ? t('admin.deletionRequests.form.scopeStudent')
      : scopeType === 'class'
      ? t('admin.deletionRequests.form.scopeClass')
      : t('admin.deletionRequests.form.scopeOrg');
  return (
    <Card className="p-4 space-y-3 border-dashed">
      <h3 className="text-sm font-medium">{t('admin.deletionRequests.form.title')}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="deletion-scope-type" className="text-xs text-muted-foreground">{t('admin.deletionRequests.form.scopeTypeLabel')}</label>
          <select
            id="deletion-scope-type"
            className="w-full mt-1 px-3 py-2 rounded-md border text-sm bg-background"
            value={scopeType}
            onChange={(e) => onScopeTypeChange(e.target.value as DeletionScopeType)}
          >
            <option value="student">{t('admin.deletionRequests.form.scopeStudent')}</option>
            <option value="class">{t('admin.deletionRequests.form.scopeClass')}</option>
            <option value="org">{t('admin.deletionRequests.form.scopeOrg')}</option>
          </select>
        </div>
        <div>
          <label htmlFor="deletion-scope-id" className="text-xs text-muted-foreground">
            {scopeIdLabel}
          </label>
          <Input
            id="deletion-scope-id"
            className="mt-1"
            placeholder={t('admin.deletionRequests.form.scopeIdPlaceholder').replace('{scopeType}', scopeTypeName)}
            value={scopeId}
            onChange={(e) => onScopeIdChange(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label htmlFor="deletion-reason" className="text-xs text-muted-foreground">{t('admin.deletionRequests.form.reasonLabel')}</label>
        <Input
          id="deletion-reason"
          className="mt-1"
          placeholder={t('admin.deletionRequests.form.reasonPlaceholder')}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onCreate} disabled={creating || !scopeId.trim()}>
          {creating && <Loader2 className="size-3 mr-1 animate-spin" />}
          {t('admin.deletionRequests.form.submit')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('admin.deletionRequests.form.cancel')}
        </Button>
      </div>
    </Card>
  );
}

type DeletionRequestListProps = {
  requests: DeletionRequest[];
  loading: boolean;
  creating: boolean;
  actionLoading: string | null;
  reviewNotes: string;
  onReviewNotesChange: (requestId: string, value: string) => void;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onExecute: (requestId: string) => void;
  onRetry: (requestId: string) => void;
};

function DeletionRequestList({
  requests,
  loading,
  creating,
  actionLoading,
  reviewNotes,
  onReviewNotesChange,
  onApprove,
  onReject,
  onExecute,
  onRetry,
}: DeletionRequestListProps) {
  const { t } = useLanguage();
  const scopeLabelMap: Record<DeletionScopeType, string> = {
    student: t('admin.deletionRequests.scope.student'),
    class: t('admin.deletionRequests.scope.class'),
    org: t('admin.deletionRequests.scope.org'),
  };

  if (loading && requests.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        {t('admin.deletionRequests.empty')}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <Card key={req.id} className="p-4">
          <div className="flex items-start gap-3">
            <StatusIcon status={req.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={req.status} />
                <Badge variant="outline">{scopeLabelMap[req.scopeType]}</Badge>
                <span className="text-xs text-muted-foreground font-mono truncate">
                  {req.scopeId}
                </span>
              </div>
              {req.requestReason && (
                <p className="text-sm text-muted-foreground mt-1">{req.requestReason}</p>
              )}
              {req.reviewNotes && (
                <p className="text-xs text-muted-foreground mt-1 italic">
                  {t('admin.deletionRequests.detail.review')} {req.reviewNotes}
                </p>
              )}
              <div className="text-xs text-muted-foreground mt-2 flex gap-4">
                <span>{t('admin.deletionRequests.detail.created')} {formatTimestamp(req.createdAt)}</span>
                {req.completedAt && <span>{t('admin.deletionRequests.detail.completed')} {formatTimestamp(req.completedAt)}</span>}
              </div>

              {req.executionSummary && typeof req.executionSummary === 'object' && 'firestoreCounts' in req.executionSummary && (
                <div className="text-xs mt-2 p-2 bg-muted/50 rounded">
                  {(() => {
                    const counts = req.executionSummary as Record<string, unknown>;
                    const fc = counts.firestoreCounts as Record<string, number> | undefined;
                    return fc ? (
                      <span>
                        {fc.failed
                          ? t('admin.deletionRequests.detail.firestoreCountsFailed')
                              .replace('{deleted}', String(fc.deleted ?? 0))
                              .replace('{targeted}', String(fc.targeted ?? 0))
                              .replace('{failed}', String(fc.failed))
                          : t('admin.deletionRequests.detail.firestoreCounts')
                              .replace('{deleted}', String(fc.deleted ?? 0))
                              .replace('{targeted}', String(fc.targeted ?? 0))}
                      </span>
                    ) : null;
                  })()}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1 shrink-0">
              {req.status === 'requested' && (
                <>
                  <Input
                    placeholder={t('admin.deletionRequests.action.reviewNotesPlaceholder')}
                    className="text-xs h-7 w-40"
                    value={actionLoading === req.id ? reviewNotes : ''}
                    onChange={(e) => onReviewNotesChange(req.id, e.target.value)}
                    onFocus={() => onReviewNotesChange(req.id, reviewNotes)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    disabled={actionLoading === req.id && creating}
                    onClick={() => onApprove(req.id)}
                  >
                    <CheckCircle2 className="size-3 mr-1" /> {t('admin.deletionRequests.action.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7"
                    disabled={actionLoading === req.id && creating}
                    onClick={() => onReject(req.id)}
                  >
                    <XCircle className="size-3 mr-1" /> {t('admin.deletionRequests.action.reject')}
                  </Button>
                </>
              )}
              {req.status === 'approved' && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-xs h-7"
                  disabled={actionLoading === req.id}
                  onClick={() => onExecute(req.id)}
                >
                  {actionLoading === req.id
                    ? <Loader2 className="size-3 mr-1 animate-spin" />
                    : <Play className="size-3 mr-1" />}
                  {t('admin.deletionRequests.action.execute')}
                </Button>
              )}
              {(req.status === 'failed' || req.status === 'partially_completed') && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  disabled={actionLoading === req.id}
                  onClick={() => onRetry(req.id)}
                >
                  {actionLoading === req.id
                    ? <Loader2 className="size-3 mr-1 animate-spin" />
                    : <RefreshCw className="size-3 mr-1" />}
                  {t('admin.deletionRequests.action.retry')}
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function AdminDeletionRequestsPage() {
  const navigate = useNavigate();
  const { hasRole } = useMembership();
  const { t } = useLanguage();
  const isAdmin = hasRole('school_admin');
  const [state, dispatch] = useReducer(adminDeletionReducer, initialAdminDeletionState);
  const {
    requests,
    loading,
    error,
    actionLoading,
    statusMessage,
    showNewForm,
    newScopeType,
    newScopeId,
    newReason,
    creating,
    reviewNotes,
  } = state;

  const loadRequests = useCallback(async () => {
    try {
      dispatch({ type: 'load-start' });
      const data = await listDeletionRequests();
      dispatch({ type: 'load-success', requests: data });
    } catch (err) {
      dispatch({
        type: 'load-error',
        error: err instanceof Error ? err.message : t('admin.deletionRequests.err.loadFailed'),
      });
    }
  }, [t]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleCreate = async () => {
    if (!newScopeId.trim()) return;
    try {
      dispatch({ type: 'create-start' });
      const payload: CreateDeletionRequestPayload = {
        scopeType: newScopeType,
        scopeId: newScopeId.trim(),
        requestReason: newReason.trim() || undefined,
      };
      await createDeletionRequest(payload);
      dispatch({ type: 'create-success' });
      dispatch({ type: 'set-status-message', statusMessage: t('admin.deletionRequests.msg.created') });
      await loadRequests();
    } catch (err) {
      dispatch({ type: 'set-error', error: err instanceof Error ? err.message : t('admin.deletionRequests.err.createFailed') });
    } finally {
      dispatch({ type: 'create-finished' });
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      dispatch({ type: 'set-action-loading', requestId });
      await approveDeletionRequest(requestId, reviewNotes);
      dispatch({ type: 'set-review-notes', reviewNotes: '' });
      dispatch({ type: 'set-status-message', statusMessage: t('admin.deletionRequests.msg.approved') });
      await loadRequests();
    } catch (err) {
      dispatch({ type: 'set-error', error: err instanceof Error ? err.message : t('admin.deletionRequests.err.approveFailed') });
    } finally {
      dispatch({ type: 'set-action-loading', requestId: null });
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      dispatch({ type: 'set-action-loading', requestId });
      await rejectDeletionRequest(requestId, reviewNotes);
      dispatch({ type: 'set-review-notes', reviewNotes: '' });
      dispatch({ type: 'set-status-message', statusMessage: t('admin.deletionRequests.msg.rejected') });
      await loadRequests();
    } catch (err) {
      dispatch({ type: 'set-error', error: err instanceof Error ? err.message : t('admin.deletionRequests.err.rejectFailed') });
    } finally {
      dispatch({ type: 'set-action-loading', requestId: null });
    }
  };

  const handleExecute = async (requestId: string) => {
    try {
      dispatch({ type: 'set-action-loading', requestId });
      await executeDeletionRequest(requestId);
      dispatch({ type: 'set-status-message', statusMessage: t('admin.deletionRequests.msg.executed') });
      await loadRequests();
    } catch (err) {
      dispatch({ type: 'set-error', error: err instanceof Error ? err.message : t('admin.deletionRequests.err.executeFailed') });
    } finally {
      dispatch({ type: 'set-action-loading', requestId: null });
    }
  };

  const handleRetry = async (requestId: string) => {
    try {
      dispatch({ type: 'set-action-loading', requestId });
      await retryDeletionRequest(requestId);
      dispatch({ type: 'set-status-message', statusMessage: t('admin.deletionRequests.msg.retried') });
      await loadRequests();
    } catch (err) {
      dispatch({ type: 'set-error', error: err instanceof Error ? err.message : t('admin.deletionRequests.err.retryFailed') });
    } finally {
      dispatch({ type: 'set-action-loading', requestId: null });
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Alert>
          <AlertDescription>
            {t('admin.deletionRequests.accessDenied')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/teacher')}>
          <ArrowLeft className="size-4 mr-1" /> {t('admin.deletionRequests.back')}
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShieldAlert className="size-5" />
            {t('admin.deletionRequests.pageTitle')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('admin.deletionRequests.pageSubtitle')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadRequests} disabled={loading}>
          <RefreshCw className={`size-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> {t('admin.deletionRequests.refresh')}
        </Button>
        <Button size="sm" onClick={() => dispatch({ type: 'toggle-new-form' })}>
          <Trash2 className="size-4 mr-1" /> {t('admin.deletionRequests.newRequest')}
        </Button>
      </div>

      {/* Status messages */}
      {statusMessage && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* New request form */}
      {showNewForm && (
        <NewDeletionRequestForm
          scopeType={newScopeType}
          scopeId={newScopeId}
          reason={newReason}
          creating={creating}
          onScopeTypeChange={(value) => dispatch({ type: 'set-new-scope-type', value })}
          onScopeIdChange={(value) => dispatch({ type: 'set-new-form-field', field: 'newScopeId', value })}
          onReasonChange={(value) => dispatch({ type: 'set-new-form-field', field: 'newReason', value })}
          onCreate={handleCreate}
          onCancel={() => dispatch({ type: 'toggle-new-form' })}
        />
      )}

      <DeletionRequestList
        requests={requests}
        loading={loading}
        creating={creating}
        actionLoading={actionLoading}
        reviewNotes={reviewNotes}
        onReviewNotesChange={(requestId, value) => {
          dispatch({ type: 'set-action-loading', requestId });
          dispatch({ type: 'set-review-notes', reviewNotes: value });
        }}
        onApprove={(requestId) => void handleApprove(requestId)}
        onReject={(requestId) => void handleReject(requestId)}
        onExecute={(requestId) => void handleExecute(requestId)}
        onRetry={(requestId) => void handleRetry(requestId)}
      />
    </div>
  );
}
