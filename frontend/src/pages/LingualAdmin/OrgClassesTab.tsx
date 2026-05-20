import { useEffect, useState } from 'react';
import { fetchOrgClasses } from '@/api/lingualAdmin';
import type { ClassRow } from '@/types/lingualAdmin';

export function OrgClassesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOrgClasses(orgId)
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!items) return <p className="text-neutral-500">Loading…</p>;
  if (items.length === 0) return <p className="text-neutral-500">No classes.</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-2">Name</th>
          <th>Term</th>
          <th>Subject</th>
          <th>Teachers</th>
          <th>Created</th>
          <th>Last activity</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-200">
        {items.map((c) => (
          <tr key={c.id}>
            <td className="py-2 font-medium">{c.name || '—'}</td>
            <td>{c.term || '—'}</td>
            <td>{c.subject || '—'}</td>
            <td>{c.teacherMembershipIds.length}</td>
            <td className="text-neutral-500">{c.createdAt || '—'}</td>
            <td className="text-neutral-500">{c.lastActivityAt || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default OrgClassesTab;
