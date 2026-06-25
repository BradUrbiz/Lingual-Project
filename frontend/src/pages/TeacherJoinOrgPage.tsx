import { useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Search, Ticket } from 'lucide-react';
import { m } from 'framer-motion';
import { AnimatedPage } from '@/components/layout';
import { Alert, AlertDescription, Button, Card, Input } from '@/components/ui';
import {
    submitTeacherJoinRequest,
    searchOrganizations,
} from '@/api/teacherRequests';
import type { OrgSearchResult } from '@/types/teacherJoin';
import { useLanguage } from '@/contexts/LanguageContext';

type Pane = 'entry' | 'code' | 'search';

type TeacherJoinState = {
    pane: Pane;
    error: string | null;
    submitting: boolean;
    code: string;
    query: string;
    results: OrgSearchResult[];
    confirmTarget: OrgSearchResult | null;
};

type TeacherJoinAction =
    | { type: 'reset' }
    | { type: 'set-pane'; pane: Pane }
    | { type: 'set-error'; error: string | null }
    | { type: 'set-submitting'; submitting: boolean }
    | { type: 'set-code'; code: string }
    | { type: 'set-query'; query: string }
    | { type: 'set-results'; results: OrgSearchResult[] }
    | { type: 'set-confirm-target'; target: OrgSearchResult | null };

const initialTeacherJoinState: TeacherJoinState = {
    pane: 'entry',
    error: null,
    submitting: false,
    code: '',
    query: '',
    results: [],
    confirmTarget: null,
};

function teacherJoinReducer(state: TeacherJoinState, action: TeacherJoinAction): TeacherJoinState {
    switch (action.type) {
        case 'reset':
            return { ...state, error: null, submitting: false };
        case 'set-pane':
            return { ...state, pane: action.pane };
        case 'set-error':
            return { ...state, error: action.error };
        case 'set-submitting':
            return { ...state, submitting: action.submitting };
        case 'set-code':
            return { ...state, code: action.code };
        case 'set-query':
            return { ...state, query: action.query };
        case 'set-results':
            return { ...state, results: action.results };
        case 'set-confirm-target':
            return { ...state, confirmTarget: action.target };
        default:
            return state;
    }
}

export function TeacherJoinOrgPage() {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const [state, dispatch] = useReducer(teacherJoinReducer, initialTeacherJoinState);
    const { pane, error, submitting, code, query, results, confirmTarget } = state;

    useEffect(() => {
        if (pane !== 'search') return;
        const q = query.trim();
        if (!q) {
            dispatch({ type: 'set-results', results: [] });
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const out = await searchOrganizations(q);
                dispatch({ type: 'set-results', results: out });
            } catch {
                dispatch({ type: 'set-results', results: [] });
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [pane, query]);

    function reset() {
        dispatch({ type: 'reset' });
    }

    async function submitCode() {
        const upper = code.trim().toUpperCase();
        if (upper.length !== 6) {
            dispatch({ type: 'set-error', error: t('teacher.joinOrg.code.invalidError') });
            return;
        }
        dispatch({ type: 'set-submitting', submitting: true });
        dispatch({ type: 'set-error', error: null });
        try {
            await submitTeacherJoinRequest({ inviteCode: upper });
            navigate('/signup/teacher/pending', { replace: true });
        } catch (err) {
            dispatch({ type: 'set-error', error: err instanceof Error ? err.message : 'Failed to submit code.' });
        } finally {
            dispatch({ type: 'set-submitting', submitting: false });
        }
    }

    async function submitOrg(orgId: string) {
        dispatch({ type: 'set-submitting', submitting: true });
        dispatch({ type: 'set-error', error: null });
        try {
            await submitTeacherJoinRequest({ orgId });
            navigate('/signup/teacher/pending', { replace: true });
        } catch (err) {
            dispatch({ type: 'set-error', error: err instanceof Error ? err.message : 'Failed to submit request.' });
            dispatch({ type: 'set-confirm-target', target: null });
        } finally {
            dispatch({ type: 'set-submitting', submitting: false });
        }
    }

    return (
        <AnimatedPage>
            <div className="min-h-screen flex items-center justify-center p-4">
                <m.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-md"
                >
                    <Card className="p-8 space-y-6">
                        {pane !== 'entry' && (
                            <button
                                type="button"
                                className="flex items-center text-sm text-muted-foreground"
                                onClick={() => { reset(); dispatch({ type: 'set-pane', pane: 'entry' }); }}
                            >
                                <ArrowLeft className="size-4 mr-1" /> {t('teacher.joinOrg.changeRole')}
                            </button>
                        )}

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        {pane === 'entry' && (
                            <>
                                <div className="text-center space-y-1">
                                    <h1 className="text-2xl font-bold">{t('teacher.joinOrg.entry.title')}</h1>
                                    <p className="text-muted-foreground text-sm">
                                        {t('teacher.joinOrg.entry.subtitle')}
                                    </p>
                                </div>
                                <div className="flex flex-col gap-3">
                                    <Button onClick={() => { reset(); dispatch({ type: 'set-pane', pane: 'code' }); }}>
                                        <Ticket className="mr-2 size-4" />
                                        {t('teacher.joinOrg.entry.hasCode')}
                                    </Button>
                                    <Button variant="outline" onClick={() => { reset(); dispatch({ type: 'set-pane', pane: 'search' }); }}>
                                        <Search className="mr-2 size-4" />
                                        {t('teacher.joinOrg.entry.noCode')}
                                    </Button>
                                </div>
                            </>
                        )}

                        {pane === 'code' && (
                            <>
                                <div className="space-y-1">
                                    <h2 className="text-xl font-semibold">{t('teacher.joinOrg.code.title')}</h2>
                                    <p className="text-sm text-muted-foreground">
                                        {t('teacher.joinOrg.code.subtitle')}
                                    </p>
                                </div>
                                <Input
                                    placeholder="ABC123"
                                    value={code}
                                    onChange={(e) => dispatch({
                                        type: 'set-code',
                                        code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
                                    })}
                                    className="text-center text-2xl tracking-[0.3em] font-mono"
                                    maxLength={6}
                                    autoFocus
                                    onKeyDown={(e) => { if (e.key === 'Enter') submitCode(); }}
                                />
                                <Button onClick={submitCode} disabled={submitting || code.length !== 6} className="w-full">
                                    {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                                    {t('teacher.joinOrg.code.submit')}
                                </Button>
                            </>
                        )}

                        {pane === 'search' && (
                            <>
                                <div className="space-y-1">
                                    <h2 className="text-xl font-semibold">{t('teacher.joinOrg.search.title')}</h2>
                                    <p className="text-sm text-muted-foreground">
                                        {t('teacher.joinOrg.search.subtitle')}
                                    </p>
                                </div>
                                <Input
                                    placeholder={t('teacher.joinOrg.search.placeholder')}
                                    value={query}
                                    onChange={(e) => dispatch({ type: 'set-query', query: e.target.value })}
                                    autoFocus
                                />
                                <div className="space-y-2">
                                    {results.map((r) => (
                                        <button
                                            key={r.id}
                                            type="button"
                                            className="w-full text-left rounded-md border p-3 hover:bg-accent"
                                            onClick={() => dispatch({ type: 'set-confirm-target', target: r })}
                                        >
                                            <div className="font-medium">{r.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {[r.city, r.state, r.school_type].filter(Boolean).join(' · ')}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {confirmTarget && (
                                    <Card className="p-4 space-y-3">
                                        <p className="text-sm">
                                            {t('teacher.joinOrg.search.confirmRequest').replace('{name}', confirmTarget.name)}
                                        </p>
                                        <div className="flex gap-2">
                                            <Button onClick={() => submitOrg(confirmTarget.id)} disabled={submitting}>
                                                {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                                                {t('teacher.joinOrg.search.confirm')}
                                            </Button>
                                            <Button variant="ghost" onClick={() => dispatch({ type: 'set-confirm-target', target: null })}>
                                                {t('teacher.joinOrg.search.cancel')}
                                            </Button>
                                        </div>
                                    </Card>
                                )}
                                <details className="text-xs text-muted-foreground">
                                    <summary className="cursor-pointer">{t('teacher.joinOrg.search.cantFind')}</summary>
                                    <div className="mt-2 space-y-2">
                                        <button
                                            type="button"
                                            className="text-primary underline"
                                            onClick={() => navigate('/signup/admin/org-wizard')}
                                        >
                                            {t('teacher.joinOrg.search.adminPivot')}
                                        </button>
                                        <p>{t('teacher.joinOrg.search.trySpelling')}</p>
                                    </div>
                                </details>
                                <p className="text-right text-sm">
                                    <a href="mailto:support@lingual.app" className="text-primary underline">
                                        {t('teacher.joinOrg.search.contactSupport')}
                                    </a>
                                </p>
                            </>
                        )}
                    </Card>
                </m.div>
            </div>
        </AnimatedPage>
    );
}

export default TeacherJoinOrgPage;
