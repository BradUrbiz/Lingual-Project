import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Clock } from 'lucide-react';
import { m } from 'framer-motion';
import { AnimatedPage } from '@/components/layout';
import { Button, Card } from '@/components/ui';
import {
    getMyTeacherJoinRequest,
    cancelMyTeacherJoinRequest,
} from '@/api/teacherRequests';
import type { TeacherJoinRequest } from '@/types/teacherJoin';
import { useAuth } from '@/hooks/useAuth';

const POLL_INTERVAL_MS = 30_000;

export function TeacherJoinPendingPage() {
    const navigate = useNavigate();
    const { refreshUser } = useAuth();
    const [req, setReq] = useState<TeacherJoinRequest | null | undefined>(undefined);
    const [cancelling, setCancelling] = useState(false);
    const navigatedRef = useRef(false);

    const fetchStatus = useCallback(async () => {
        try {
            const out = await getMyTeacherJoinRequest();
            if ((!out || out.status === 'approved') && !navigatedRef.current) {
                // Approved requests need a refreshed membership context before entering the dashboard.
                await refreshUser();
                navigatedRef.current = true;
                navigate('/app/teacher', { replace: true });
                return;
            }
            setReq(out);
        } catch {
            // Network blip; next tick will retry.
        }
    }, [navigate, refreshUser]);

    useEffect(() => {
        let cancelled = false;
        const runFetchStatus = () => {
            if (!cancelled) {
                void fetchStatus();
            }
        };
        queueMicrotask(runFetchStatus);
        const timer = setInterval(runFetchStatus, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [fetchStatus]);

    async function handleCancel() {
        setCancelling(true);
        try {
            await cancelMyTeacherJoinRequest();
            navigate('/signup/teacher/join-org', { replace: true });
        } finally {
            setCancelling(false);
        }
    }

    if (req === undefined) {
        return (
            <AnimatedPage>
                <div className="min-h-screen flex items-center justify-center">
                    <Loader2 className="size-6 animate-spin" />
                </div>
            </AnimatedPage>
        );
    }

    if (!req) {
        return null;  // navigation in-flight
    }

    if (req.status === 'declined') {
        return (
            <AnimatedPage>
                <div className="min-h-screen flex items-center justify-center p-4">
                    <Card className="p-8 max-w-md w-full text-center space-y-4">
                        <h1 className="text-xl font-bold">Your request was not approved</h1>
                        {req.declineReason && (
                            <p className="text-sm text-muted-foreground">{req.declineReason}</p>
                        )}
                        <Button onClick={() => navigate('/signup/teacher/join-org', { replace: true })}>
                            Try a different school
                        </Button>
                    </Card>
                </div>
            </AnimatedPage>
        );
    }

    // pending
    return (
        <AnimatedPage>
            <div className="min-h-screen flex items-center justify-center p-4">
                <m.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-md"
                >
                    <Card className="p-8 text-center space-y-6">
                        <div className="mx-auto size-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                            <Clock className="size-8" />
                        </div>
                        <div className="space-y-2">
                            <h1 className="text-2xl font-bold">Awaiting approval</h1>
                            <p className="text-muted-foreground">
                                Your request to join <strong>{req.orgName}</strong> is with the school admin.
                                We'll email you the moment they decide.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleCancel}
                            disabled={cancelling}
                        >
                            {cancelling ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                            Cancel request
                        </Button>
                    </Card>
                </m.div>
            </div>
        </AnimatedPage>
    );
}

export default TeacherJoinPendingPage;
