import { useCallback, useEffect, useState } from 'react';
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

const STATUS_CONFIG: Record<DeletionRequestStatus, { label: string; color: string }> = {
  requested: { label: 'Pending Review', color: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', color: 'bg-blue-100 text-blue-800' },
  rejected: { label: 'Rejected', color: 'bg-gray-100 text-gray-800' },
  in_progress: { label: 'In Progress', color: 'bg-indigo-100 text-indigo-800' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-800' },
  partially_completed: { label: 'Partial', color: 'bg-orange-100 text-orange-800' },
};

const SCOPE_LABELS: Record<DeletionScopeType, string> = {
  student: 'Student Data',
  class: 'Class Data',
  org: 'Organization Data',
};

function formatTimestamp(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function StatusBadge({ status }: { status: DeletionRequestStatus }) {
  const config = STATUS_CONFIG[status] || { label: status, color: 'bg-gray-100 text-gray-800' };
  return <Badge className={config.color}>{config.label}</Badge>;
}

function StatusIcon({ status }: { status: DeletionRequestStatus }) {
  switch (status) {
    case 'requested': return <Clock className="w-4 h-4 text-amber-500" />;
    case 'approved': return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
    case 'rejected': return <XCircle className="w-4 h-4 text-gray-400" />;
    case 'in_progress': return <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />;
    case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'failed': return <AlertTriangle className="w-4 h-4 text-red-500" />;
    case 'partially_completed': return <AlertTriangle className="w-4 h-4 text-orange-500" />;
  }
}

export function AdminDeletionRequestsPage() {
  const navigate = useNavigate();
  const { hasRole } = useMembership();
  const isAdmin = hasRole('school_admin');

  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // New request form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newScopeType, setNewScopeType] = useState<DeletionScopeType>('student');
  const [newScopeId, setNewScopeId] = useState('');
  const [newReason, setNewReason] = useState('');
  const [creating, setCreating] = useState(false);

  // Review notes
  const [reviewNotes, setReviewNotes] = useState('');

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listDeletionRequests();
      setRequests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deletion requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleCreate = async () => {
    if (!newScopeId.trim()) return;
    try {
      setCreating(true);
      setError(null);
      const payload: CreateDeletionRequestPayload = {
        scopeType: newScopeType,
        scopeId: newScopeId.trim(),
        requestReason: newReason.trim() || undefined,
      };
      await createDeletionRequest(payload);
      setShowNewForm(false);
      setNewScopeId('');
      setNewReason('');
      setStatusMessage('Deletion request created successfully.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create request.');
    } finally {
      setCreating(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      setActionLoading(requestId);
      await approveDeletionRequest(requestId, reviewNotes);
      setReviewNotes('');
      setStatusMessage('Request approved.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      setActionLoading(requestId);
      await rejectDeletionRequest(requestId, reviewNotes);
      setReviewNotes('');
      setStatusMessage('Request rejected.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecute = async (requestId: string) => {
    try {
      setActionLoading(requestId);
      await executeDeletionRequest(requestId);
      setStatusMessage('Deletion executed.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = async (requestId: string) => {
    try {
      setActionLoading(requestId);
      await retryDeletionRequest(requestId);
      setStatusMessage('Retry executed.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setActionLoading(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Alert>
          <AlertDescription>
            Only school administrators can access deletion requests.
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
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" />
            Data Deletion Requests
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage student and class data deletion requests for your organization.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadRequests} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
        <Button size="sm" onClick={() => setShowNewForm(!showNewForm)}>
          <Trash2 className="w-4 h-4 mr-1" /> New Request
        </Button>
      </div>

      {/* Status messages */}
      {statusMessage && (
        <Alert>
          <CheckCircle2 className="w-4 h-4" />
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* New request form */}
      {showNewForm && (
        <Card className="p-4 space-y-3 border-dashed">
          <h3 className="text-sm font-medium">Create Deletion Request</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Scope Type</label>
              <select
                className="w-full mt-1 px-3 py-2 rounded-md border text-sm bg-background"
                value={newScopeType}
                onChange={(e) => setNewScopeType(e.target.value as DeletionScopeType)}
              >
                <option value="student">Student</option>
                <option value="class">Class</option>
                <option value="org">Organization</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {newScopeType === 'student' ? 'Student UID' : newScopeType === 'class' ? 'Class ID' : 'Organization ID'}
              </label>
              <Input
                className="mt-1"
                placeholder={`Enter ${newScopeType} ID`}
                value={newScopeId}
                onChange={(e) => setNewScopeId(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Reason (optional)</label>
            <Input
              className="mt-1"
              placeholder="e.g., Parent deletion request under COPPA"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={creating || !newScopeId.trim()}>
              {creating && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              Submit Request
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowNewForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Request list */}
      {loading && requests.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No deletion requests found.
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <Card key={req.id} className="p-4">
              <div className="flex items-start gap-3">
                <StatusIcon status={req.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={req.status} />
                    <Badge variant="outline">{SCOPE_LABELS[req.scopeType]}</Badge>
                    <span className="text-xs text-muted-foreground font-mono truncate">
                      {req.scopeId}
                    </span>
                  </div>
                  {req.requestReason && (
                    <p className="text-sm text-muted-foreground mt-1">{req.requestReason}</p>
                  )}
                  {req.reviewNotes && (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      Review: {req.reviewNotes}
                    </p>
                  )}
                  <div className="text-xs text-muted-foreground mt-2 flex gap-4">
                    <span>Created: {formatTimestamp(req.createdAt)}</span>
                    {req.completedAt && <span>Completed: {formatTimestamp(req.completedAt)}</span>}
                  </div>

                  {/* Execution summary */}
                  {req.executionSummary && typeof req.executionSummary === 'object' && 'firestoreCounts' in req.executionSummary && (
                    <div className="text-xs mt-2 p-2 bg-muted/50 rounded">
                      {(() => {
                        const counts = req.executionSummary as Record<string, unknown>;
                        const fc = counts.firestoreCounts as Record<string, number> | undefined;
                        return fc ? (
                          <span>
                            Firestore: {fc.deleted ?? 0} deleted / {fc.targeted ?? 0} targeted
                            {fc.failed ? ` / ${fc.failed} failed` : ''}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1 shrink-0">
                  {req.status === 'requested' && (
                    <>
                      <Input
                        placeholder="Review notes"
                        className="text-xs h-7 w-40"
                        value={actionLoading === req.id ? reviewNotes : ''}
                        onChange={(e) => {
                          setActionLoading(req.id);
                          setReviewNotes(e.target.value);
                        }}
                        onFocus={() => setActionLoading(req.id)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        disabled={actionLoading === req.id && creating}
                        onClick={() => handleApprove(req.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7"
                        disabled={actionLoading === req.id && creating}
                        onClick={() => handleReject(req.id)}
                      >
                        <XCircle className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    </>
                  )}
                  {req.status === 'approved' && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs h-7"
                      disabled={actionLoading === req.id}
                      onClick={() => handleExecute(req.id)}
                    >
                      {actionLoading === req.id
                        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        : <Play className="w-3 h-3 mr-1" />}
                      Execute
                    </Button>
                  )}
                  {(req.status === 'failed' || req.status === 'partially_completed') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      disabled={actionLoading === req.id}
                      onClick={() => handleRetry(req.id)}
                    >
                      {actionLoading === req.id
                        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        : <RefreshCw className="w-3 h-3 mr-1" />}
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
