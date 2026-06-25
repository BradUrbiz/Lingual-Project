import { useCallback, useEffect, useReducer, useRef } from 'react';
import { Button, Card, Input } from '@/components/ui';
import {
    listPendingTeacherRequests,
    approveTeacherJoinRequest,
    declineTeacherJoinRequest,
} from '@/api/teacherRequests';
import type { PendingTeacherRequestRow } from '@/types/teacherJoin';
import { useLanguage } from '@/contexts/LanguageContext';

type PendingRequestsState = {
    rows: PendingTeacherRequestRow[];
    loading: boolean;
    declineFor: PendingTeacherRequestRow | null;
    reason: string;
    submitting: boolean;
    error: string | null;
};

type PendingRequestsAction =
    | { type: 'patch'; payload: Partial<PendingRequestsState> }
    | { type: 'start-load' }
    | { type: 'load-success'; rows: PendingTeacherRequestRow[] }
    | { type: 'load-error'; error: string }
    | { type: 'close-decline' };

const initialPendingRequestsState: PendingRequestsState = {
    rows: [],
    loading: false,
    declineFor: null,
    reason: '',
    submitting: false,
    error: null,
};

function pendingRequestsReducer(
    state: PendingRequestsState,
    action: PendingRequestsAction
): PendingRequestsState {
    switch (action.type) {
        case 'patch':
            return { ...state, ...action.payload };
        case 'start-load':
            return { ...state, loading: true };
        case 'load-success':
            return { ...state, rows: action.rows, loading: false };
        case 'load-error':
            return { ...state, error: action.error, loading: false };
        case 'close-decline':
            return { ...state, declineFor: null, reason: '' };
        default:
            return state;
    }
}

export function PendingTeacherRequestsSection() {
    const { t } = useLanguage();
    const tRef = useRef(t);
    tRef.current = t;
    const [state, dispatch] = useReducer(pendingRequestsReducer, initialPendingRequestsState);
    const { rows, loading, declineFor, reason, submitting, error } = state;

    const refresh = useCallback(async () => {
        dispatch({ type: 'start-load' });
        try {
            const out = await listPendingTeacherRequests();
            dispatch({ type: 'load-success', rows: out });
        } catch (e) {
            dispatch({ type: 'load-error', error: e instanceof Error ? e.message : tRef.current('teacher.dashboard.pending.loadError') });
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    async function onApprove(row: PendingTeacherRequestRow) {
        dispatch({ type: 'patch', payload: { submitting: true } });
        try {
            await approveTeacherJoinRequest(row.requestId);
            await refresh();
        } catch (e) {
            dispatch({ type: 'patch', payload: { error: e instanceof Error ? e.message : t('teacher.dashboard.pending.approveError') } });
        } finally {
            dispatch({ type: 'patch', payload: { submitting: false } });
        }
    }

    async function onDeclineSubmit() {
        if (!declineFor || !reason.trim()) return;
        dispatch({ type: 'patch', payload: { submitting: true } });
        try {
            await declineTeacherJoinRequest(declineFor.requestId, reason.trim());
            dispatch({ type: 'close-decline' });
            await refresh();
        } catch (e) {
            dispatch({ type: 'patch', payload: { error: e instanceof Error ? e.message : t('teacher.dashboard.pending.declineError') } });
        } finally {
            dispatch({ type: 'patch', payload: { submitting: false } });
        }
    }

    if (!loading && rows.length === 0 && !error) {
        return null;
    }

    return (
        <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                    {t('teacher.dashboard.pending.title')} {rows.length > 0 ? `(${rows.length})` : ''}
                </h2>
            </div>
            {error && (
                <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="space-y-2">
                {rows.map((row) => (
                    <div key={row.requestId} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <div className="font-medium">{row.name || t('teacher.dashboard.pending.unnamed')}</div>
                            <div className="text-xs text-muted-foreground">
                                <span>{row.email}</span>
                                {t('teacher.dashboard.pending.via')}
                                {row.source === 'invite_code' ? t('teacher.dashboard.pending.viaInviteCode') : t('teacher.dashboard.pending.viaSchoolSearch')}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => onApprove(row)} disabled={submitting}>
                                {t('teacher.dashboard.pending.approve')}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => dispatch({ type: 'patch', payload: { declineFor: row } })}
                                disabled={submitting}
                            >
                                {t('teacher.dashboard.pending.decline')}
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            {declineFor && (
                <Card className="p-4 space-y-3">
                    <p className="text-sm">
                        {t('teacher.dashboard.pending.declineFrom')} <strong>{declineFor.name || declineFor.email}</strong>?
                    </p>
                    <div className="block text-sm">
                        <span className="block mb-1">{t('teacher.dashboard.pending.reason')}</span>
                        <Input
                            aria-label={t('teacher.dashboard.pending.declineReasonAriaLabel')}
                            value={reason}
                            onChange={(e) => dispatch({ type: 'patch', payload: { reason: e.target.value } })}
                            placeholder={t('teacher.dashboard.pending.declineReasonPlaceholder')}
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={onDeclineSubmit} disabled={submitting || !reason.trim()}>
                            {t('teacher.dashboard.pending.declineRequest')}
                        </Button>
                        <Button variant="ghost" onClick={() => dispatch({ type: 'close-decline' })}>
                            {t('teacher.dashboard.pending.cancel')}
                        </Button>
                    </div>
                </Card>
            )}
        </Card>
    );
}
