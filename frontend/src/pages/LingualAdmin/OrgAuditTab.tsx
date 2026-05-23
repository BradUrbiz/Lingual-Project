import { useEffect, useState } from 'react';
import { fetchOrgAudit } from '@/api/lingualAdmin';
import type { AuditEntry } from '@/types/lingualAdmin';

export function OrgAuditTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOrgAudit(orgId, 50)
      .then(r => { if (!cancelled) setItems(r.items); })
      .catch(e => { if (!cancelled) setError(e.message || 'unknown'); });
    return () => { cancelled = true; };
  }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!items) return <p className="text-neutral-500">Loading…</p>;
  if (items.length === 0) return <p className="text-neutral-500">No audit entries for this organization.</p>;

  return (
    <ul className="divide-y divide-neutral-200">
      {items.map(a => {
        const metaSnippet = Object.entries(a.metadata || {})
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' · ');
        return (
          <li key={a.id} className="py-3 text-sm">
            <div className="flex items-baseline gap-3">
              <span className="text-neutral-500">{a.createdAt || '—'}</span>
              <span className="font-mono text-xs text-neutral-500">{a.actorUid}</span>
              <span className="font-medium">{a.action}</span>
            </div>
            {metaSnippet && (
              <div className="mt-1 text-xs text-neutral-600">{metaSnippet}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default OrgAuditTab;
