import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrgs } from '@/api/lingualAdmin';
import type { OrgSummary, OrgStatus } from '@/types/lingualAdmin';

export function LingualOrgsListPage() {
  const [items, setItems] = useState<OrgSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<{ nameLower: string; id: string } | null>(null);
  const [status, setStatus] = useState<'' | OrgStatus>('');
  const [schoolType, setSchoolType] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    try {
      const result = await fetchOrgs({
        status: status || undefined,
        schoolType: schoolType || undefined,
        country: country || undefined,
        cursor: reset ? undefined : nextCursor || undefined,
      });
      setItems(prev => reset ? result.items : [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (e: any) {
      setError(e.message || 'unknown');
    }
  }

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [status, schoolType, country]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Organizations</h1>

      <div className="mt-4 flex gap-3 text-sm">
        <label className="flex items-center gap-2">
          Status
          <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as any)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Type
          <select value={schoolType} onChange={e => setSchoolType(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All</option>
            <option value="elementary">Elementary</option>
            <option value="middle">Middle</option>
            <option value="high">High</option>
            <option value="k12">K-12</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Country
          <input value={country} onChange={e => setCountry(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1" placeholder="US" />
        </label>
      </div>

      {error && <p className="mt-4 text-red-600">Failed: {error}</p>}

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-2">Name</th><th>Status</th><th>Type</th><th>Country</th><th>Members</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {items.map(o => (
            <tr key={o.id}>
              <td className="py-2 font-medium">
                <Link to={`/lingual-admin/organizations/${o.id}`} className="hover:underline">
                  {o.name}
                </Link>
              </td>
              <td>{o.status}</td>
              <td>{o.schoolType || '—'}</td>
              <td>{o.country || '—'}</td>
              <td>{o.memberCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {nextCursor && (
        <button onClick={() => load(false)} className="mt-4 rounded-md border border-neutral-300 px-3 py-1 text-sm">
          Load more
        </button>
      )}
    </div>
  );
}

export default LingualOrgsListPage;
