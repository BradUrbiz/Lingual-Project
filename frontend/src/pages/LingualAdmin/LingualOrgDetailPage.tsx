import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { fetchOrgDetail, suspendOrg, restoreOrg } from '@/api/lingualAdmin';
import type { OrgDetail } from '@/types/lingualAdmin';
import { OrgOverviewTab } from './OrgOverviewTab';
import { OrgMembersTab } from './OrgMembersTab';
import { OrgClassesTab } from './OrgClassesTab';
import { OrgAuditTab } from './OrgAuditTab';
import { SuspendOrgModal } from './SuspendOrgModal';

const TABS = [
  { hash: '#overview', label: 'Overview' },
  { hash: '#members', label: 'Members' },
  { hash: '#classes', label: 'Classes' },
  { hash: '#audit', label: 'Audit' },
] as const;

export function LingualOrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSuspend, setShowSuspend] = useState(false);

  const activeHash = hash || '#overview';

  async function reload() {
    if (!orgId) return;
    try {
      setOrg(await fetchOrgDetail(orgId));
    } catch (e: any) {
      setError(e.message || 'unknown');
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!org) return <p className="text-neutral-500">Loading…</p>;

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">Status: {org.status}</p>
        </div>
        <div>
          {org.status === 'active' && (
            <button type="button" onClick={() => setShowSuspend(true)} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white">
              Suspend
            </button>
          )}
          {org.status === 'suspended' && (
            <button type="button"
              onClick={async () => {
                if (!orgId) return;
                if (!confirm('Restore this organization?')) return;
                await restoreOrg(orgId);
                reload();
              }}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Restore
            </button>
          )}
        </div>
      </div>

      <nav className="mt-6 flex gap-4 border-b border-neutral-200 text-sm">
        {TABS.map(t => (
          <button type="button"
            key={t.hash}
            onClick={() => navigate({ hash: t.hash }, { replace: true })}
            aria-current={activeHash === t.hash ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${
              activeHash === t.hash
                ? 'border-neutral-900 font-medium'
                : 'border-transparent text-neutral-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {activeHash === '#overview' && <OrgOverviewTab org={org} />}
        {activeHash === '#members' && <OrgMembersTab orgId={orgId!} />}
        {activeHash === '#classes' && <OrgClassesTab orgId={orgId!} />}
        {activeHash === '#audit' && <OrgAuditTab orgId={orgId!} />}
      </div>

      {showSuspend && (
        <SuspendOrgModal
          onCancel={() => setShowSuspend(false)}
          onConfirm={async (reason, until) => {
            if (!orgId) return;
            await suspendOrg(orgId, { reason, suspendedUntil: until });
            setShowSuspend(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

export default LingualOrgDetailPage;
