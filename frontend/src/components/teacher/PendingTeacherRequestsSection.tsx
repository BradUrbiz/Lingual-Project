import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@/components/ui';
import {
    listPendingTeacherRequests,
    approveTeacherJoinRequest,
    declineTeacherJoinRequest,
} from '@/api/teacherRequests';
import type { PendingTeacherRequestRow } from '@/types/teacherJoin';

export function PendingTeacherRequestsSection() {
    const [rows, setRows] = useState<PendingTeacherRequestRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [declineFor, setDeclineFor] = useState<PendingTeacherRequestRow | null>(null);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const out = await listPendingTeacherRequests();
            setRows(out);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load requests.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    async function onApprove(row: PendingTeacherRequestRow) {
        setSubmitting(true);
        try {
            await approveTeacherJoinRequest(row.requestId);
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Approve failed.');
        } finally {
            setSubmitting(false);
        }
    }

    async function onDeclineSubmit() {
        if (!declineFor || !reason.trim()) return;
        setSubmitting(true);
        try {
            await declineTeacherJoinRequest(declineFor.requestId, reason.trim());
            setDeclineFor(null);
            setReason('');
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Decline failed.');
        } finally {
            setSubmitting(false);
        }
    }

    if (!loading && rows.length === 0 && !error) {
        return null;
    }

    return (
        <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                    Pending teacher requests {rows.length > 0 ? `(${rows.length})` : ''}
                </h2>
            </div>
            {error && (
                <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="space-y-2">
                {rows.map((row) => (
                    <div key={row.requestId} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <div className="font-medium">{row.name || '(unnamed)'}</div>
                            <div className="text-xs text-muted-foreground">
                                <span>{row.email}</span>
                                {' · via '}
                                {row.source === 'invite_code' ? 'invite code' : 'school search'}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => onApprove(row)} disabled={submitting}>
                                Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDeclineFor(row)} disabled={submitting}>
                                Decline
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            {declineFor && (
                <Card className="p-4 space-y-3">
                    <p className="text-sm">
                        Decline request from <strong>{declineFor.name || declineFor.email}</strong>?
                    </p>
                    <label className="block text-sm">
                        <span className="block mb-1">Reason</span>
                        <Input
                            aria-label="reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Shared with the requester."
                        />
                    </label>
                    <div className="flex gap-2">
                        <Button onClick={onDeclineSubmit} disabled={submitting || !reason.trim()}>
                            Submit
                        </Button>
                        <Button variant="ghost" onClick={() => { setDeclineFor(null); setReason(''); }}>
                            Cancel
                        </Button>
                    </div>
                </Card>
            )}
        </Card>
    );
}

export default PendingTeacherRequestsSection;
