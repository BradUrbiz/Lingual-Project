import { useEffect, useState } from 'react';
import { fetchRequests, fetchRequestDetail, approveRequest, declineRequest } from '@/api/lingualAdmin';
import type { SchoolRequestRow, SchoolRequestDetail, DeclineCategory } from '@/types/lingualAdmin';
import { RequestDetailPanel } from './RequestDetailPanel';

export function LingualRequestsPage() {
  const [items, setItems] = useState<SchoolRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SchoolRequestDetail | null>(null);
  const [status, setStatus] = useState('');
  const [schoolType, setSchoolType] = useState('');
  const [sort, setSort] = useState<'requested_at_desc' | 'requested_at_asc' | 'name'>('requested_at_desc');

  async function reload() {
    try {
      const result = await fetchRequests({
        status: status || undefined,
        schoolType: schoolType || undefined,
        sort,
      });
      setItems(result.items);
    } catch (e: any) {
      setError(e.message || 'unknown');
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [status, schoolType, sort]);

  async function openDetail(id: string) {
    const d = await fetchRequestDetail(id);
    setSelected(d);
  }

  async function handleApprove(internalNote?: string) {
    if (!selected) return;
    await approveRequest(selected.id, { internalNote });
    setSelected(null);
    reload();
  }

  async function handleDecline(reason: string, category: DeclineCategory | string) {
    if (!selected) return;
    await declineRequest(selected.id, { reason, category: category as DeclineCategory });
    setSelected(null);
    reload();
  }

  return (
    <div className="flex gap-6">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold">School requests</h1>

        <div className="mt-4 flex gap-3 text-sm">
          <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Declined</option>
          </select>
          <select value={schoolType} onChange={e => setSchoolType(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All types</option>
            <option value="elementary">Elementary</option>
            <option value="middle">Middle</option>
            <option value="high">High</option>
            <option value="k12">K-12</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as any)} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="requested_at_desc">Newest first</option>
            <option value="requested_at_asc">Oldest first</option>
            <option value="name">Name</option>
          </select>
        </div>

        {error && <p className="mt-4 text-red-600">Failed: {error}</p>}

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-2">School</th>
              <th>Status</th>
              <th>Requester</th>
              <th>Country</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {items.map(r => (
              <tr key={r.id} onClick={() => openDetail(r.id)} className="cursor-pointer hover:bg-neutral-100">
                <td className="py-2 font-medium">{r.schoolName}</td>
                <td>{r.status}</td>
                <td className="text-neutral-600">{r.requesterEmail}</td>
                <td className="text-neutral-600">{r.country}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <RequestDetailPanel
          request={selected}
          onApprove={handleApprove}
          onDecline={handleDecline}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export default LingualRequestsPage;
