import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Search, Ticket } from 'lucide-react';
import { motion } from 'motion/react';
import { AnimatedPage } from '@/components/layout';
import { Alert, AlertDescription, Button, Card, Input } from '@/components/ui';
import {
    submitTeacherJoinRequest,
    searchOrganizations,
} from '@/api/teacherRequests';
import type { OrgSearchResult } from '@/types/teacherJoin';

type Pane = 'entry' | 'code' | 'search';

export function TeacherJoinOrgPage() {
    const navigate = useNavigate();
    const [pane, setPane] = useState<Pane>('entry');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Pane B state
    const [code, setCode] = useState('');

    // Pane C state
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<OrgSearchResult[]>([]);
    const [confirmTarget, setConfirmTarget] = useState<OrgSearchResult | null>(null);

    useEffect(() => {
        if (pane !== 'search') return;
        const q = query.trim();
        if (!q) {
            setResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const out = await searchOrganizations(q);
                setResults(out);
            } catch {
                setResults([]);
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [pane, query]);

    function reset() {
        setError(null);
        setSubmitting(false);
    }

    async function submitCode() {
        const upper = code.trim().toUpperCase();
        if (upper.length !== 6) {
            setError('Please enter a 6-character invite code.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await submitTeacherJoinRequest({ inviteCode: upper });
            navigate('/signup/teacher/pending', { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit code.');
        } finally {
            setSubmitting(false);
        }
    }

    async function submitOrg(orgId: string) {
        setSubmitting(true);
        setError(null);
        try {
            await submitTeacherJoinRequest({ orgId });
            navigate('/signup/teacher/pending', { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit request.');
            setConfirmTarget(null);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <AnimatedPage>
            <div className="min-h-screen flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-md"
                >
                    <Card className="p-8 space-y-6">
                        {pane !== 'entry' && (
                            <button
                                type="button"
                                className="flex items-center text-sm text-muted-foreground"
                                onClick={() => { reset(); setPane('entry'); }}
                            >
                                <ArrowLeft className="h-4 w-4 mr-1" /> Change role
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
                                    <h1 className="text-2xl font-bold">Find your school</h1>
                                    <p className="text-muted-foreground text-sm">
                                        Do you have an invite code from your school?
                                    </p>
                                </div>
                                <div className="flex flex-col gap-3">
                                    <Button onClick={() => { reset(); setPane('code'); }}>
                                        <Ticket className="mr-2 h-4 w-4" />
                                        Yes, I have an invite code
                                    </Button>
                                    <Button variant="outline" onClick={() => { reset(); setPane('search'); }}>
                                        <Search className="mr-2 h-4 w-4" />
                                        No, find my school
                                    </Button>
                                </div>
                            </>
                        )}

                        {pane === 'code' && (
                            <>
                                <div className="space-y-1">
                                    <h2 className="text-xl font-semibold">Enter your invite code</h2>
                                    <p className="text-sm text-muted-foreground">
                                        Six characters, shared by your school admin.
                                    </p>
                                </div>
                                <Input
                                    placeholder="ABC123"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                                    className="text-center text-2xl tracking-[0.3em] font-mono"
                                    maxLength={6}
                                    autoFocus
                                    onKeyDown={(e) => { if (e.key === 'Enter') submitCode(); }}
                                />
                                <Button onClick={submitCode} disabled={submitting || code.length !== 6} className="w-full">
                                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Submit code
                                </Button>
                            </>
                        )}

                        {pane === 'search' && (
                            <>
                                <div className="space-y-1">
                                    <h2 className="text-xl font-semibold">Find your school</h2>
                                    <p className="text-sm text-muted-foreground">
                                        Type your school's name.
                                    </p>
                                </div>
                                <Input
                                    placeholder="School name"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    autoFocus
                                />
                                <div className="space-y-2">
                                    {results.map((r) => (
                                        <button
                                            key={r.id}
                                            type="button"
                                            className="w-full text-left rounded-md border p-3 hover:bg-accent"
                                            onClick={() => setConfirmTarget(r)}
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
                                            Request to join <strong>{confirmTarget.name}</strong>?
                                        </p>
                                        <div className="flex gap-2">
                                            <Button onClick={() => submitOrg(confirmTarget.id)} disabled={submitting}>
                                                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                                Confirm
                                            </Button>
                                            <Button variant="ghost" onClick={() => setConfirmTarget(null)}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </Card>
                                )}
                                <details className="text-xs text-muted-foreground">
                                    <summary className="cursor-pointer">Can't find my school?</summary>
                                    <div className="mt-2 space-y-2">
                                        <button
                                            type="button"
                                            className="text-primary underline"
                                            onClick={() => navigate('/signup/admin/org-wizard')}
                                        >
                                            I'm actually an administrator — register my school
                                        </button>
                                        <p>Or try a different spelling above.</p>
                                    </div>
                                </details>
                                <p className="text-right text-sm">
                                    <a href="mailto:support@lingual.app" className="text-primary underline">
                                        Contact support
                                    </a>
                                </p>
                            </>
                        )}
                    </Card>
                </motion.div>
            </div>
        </AnimatedPage>
    );
}

export default TeacherJoinOrgPage;
