import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getMySchoolRequest,
  cancelMySchoolRequest,
} from '@/api/schoolRequests';
import { useAuth } from '@/hooks/useAuth';
import { SCHOOL_ADMIN_HOME_ROUTE } from '@/lib/homeRoutes';
import type { SchoolRequest } from '@/types/schoolRequest';

const POLL_MS = 30_000;

export function AdminPendingPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [req, setReq] = useState<SchoolRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (initial = false) => {
    try {
      const next = await getMySchoolRequest();
      if (next === null) {
        navigate('/signup/admin/org-wizard', { replace: true });
        return;
      }
      setReq(next);
      if (next.status === 'approved') {
        // Refresh the local session FIRST so AppProtectedRoute and the
        // dispatcher see the new school_admin membership + onboarding_state.
        // Then send the user to the dedicated school-admin home Plan 5 introduced.
        await refreshUser();
        navigate(SCHOOL_ADMIN_HOME_ROUTE, { replace: true });
        return;
      }
      if (next.status === 'cancelled') {
        navigate('/signup/admin/org-wizard', { replace: true });
        return;
      }
    } catch (exc) {
      console.warn('[pending] poll failed', exc);
    } finally {
      if (initial) setLoading(false);
    }
  }, [navigate, refreshUser]);

  useEffect(() => {
    void refresh(true);
    timer.current = setInterval(() => void refresh(), POLL_MS);
    return () => {
      const currentTimer = timer.current;
      if (currentTimer) clearInterval(currentTimer);
    };
  }, [refresh]);

  async function handleCancel() {
    if (!req || req.status !== 'pending') return;
    setCancelling(true);
    try {
      await cancelMySchoolRequest();
      navigate('/signup/admin/org-wizard', { replace: true });
    } catch (exc) {
      console.warn('[pending] cancel failed', exc);
      setCancelling(false);
    }
  }

  if (loading || !req) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  if (req.status === 'rejected') {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-6 py-10">
        <h1 className="text-2xl font-bold">School registration needs more info</h1>
        <p>We weren't able to approve <strong>{req.schoolName}</strong> as submitted.</p>
        {req.rejectionReason && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm">
            <div className="font-semibold">Reviewer notes</div>
            <div className="mt-1">{req.rejectionReason}</div>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => navigate('/signup/admin/org-wizard')}
                  className="rounded-md border-2 border-foreground bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            Edit and resubmit
          </button>
          <a href="mailto:support@l1ngual.com"
             className="rounded-md border px-4 py-2 text-sm">
            Contact support
          </a>
        </div>
      </div>
    );
  }

  // Pending UI
  return (
    <div className="mx-auto max-w-xl space-y-5 px-6 py-10">
      <h1 className="text-2xl font-bold">Awaiting Lingual approval</h1>
      <p><strong>{req.schoolName}</strong> was submitted{req.createdAt ? ` on ${new Date(req.createdAt).toLocaleDateString()}` : ''}.</p>
      <p className="text-sm text-muted-foreground">
        We usually review within 24 hours. We'll email you at <strong>{req.requesterEmail}</strong> when a decision is made.
      </p>
      {(req.preInvitedTeachers && req.preInvitedTeachers.length > 0) && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="mb-1 font-medium">Pre-invited teachers</div>
          <ul className="list-disc pl-5">
            {req.preInvitedTeachers.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Need to change the details? Cancel this request before editing and resubmitting it.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={handleCancel} disabled={cancelling}
                className="rounded-md border px-4 py-2 text-sm disabled:opacity-60">
          {cancelling ? 'Cancelling…' : 'Cancel request'}
        </button>
      </div>
    </div>
  );
}
