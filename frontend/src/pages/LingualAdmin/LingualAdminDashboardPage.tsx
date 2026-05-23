import { useEffect, useState } from 'react';
import { fetchOverview } from '@/api/lingualAdmin';
import type { OverviewResponse } from '@/types/lingualAdmin';

const TILES = [
  { key: 'pendingRequests', label: 'Pending requests' },
  { key: 'activeOrgs', label: 'Active organizations' },
  { key: 'suspendedOrgs', label: 'Suspended organizations' },
  { key: 'newRequestsLast7d', label: 'New requests (last 7d)' },
] as const;

export function LingualAdminDashboardPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOverview()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message || 'unknown'); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="text-red-600">Failed to load: {error}</div>;
  if (!data) return <div className="text-neutral-500">Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Lingual-side operational overview.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map(t => (
          <div key={t.key} className="rounded-lg border border-neutral-200 bg-white p-5">
            <div className="text-3xl font-semibold">{data.tiles[t.key]}</div>
            <div className="mt-1 text-sm text-neutral-600">{t.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent activity</h2>
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {data.recentActivity.length === 0 && (
            <li className="px-4 py-6 text-sm text-neutral-500">No recent activity.</li>
          )}
          {data.recentActivity.map(a => (
            <li key={a.id} className="px-4 py-3 text-sm">
              <span className="font-mono text-xs text-neutral-500">{a.actorUid}</span>{' '}
              <span className="font-medium">{a.action}</span>{' '}
              <span className="text-neutral-500">
                → {a.target.type}/{a.target.id}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default LingualAdminDashboardPage;
