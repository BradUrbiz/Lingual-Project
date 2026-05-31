import { useEffect, useReducer } from 'react';
import { fetchRequests, fetchRequestDetail, approveRequest, declineRequest } from '@/api/lingualAdmin';
import type { SchoolRequestRow, SchoolRequestDetail, DeclineCategory } from '@/types/lingualAdmin';
import { RequestDetailPanel } from './RequestDetailPanel';

type RequestSort = 'requested_at_desc' | 'requested_at_asc' | 'name';

type RequestsState = {
  items: SchoolRequestRow[];
  error: string | null;
  selected: SchoolRequestDetail | null;
  status: string;
  schoolType: string;
  sort: RequestSort;
};

type RequestsAction =
  | { type: 'setStatus'; status: string }
  | { type: 'setSchoolType'; schoolType: string }
  | { type: 'setSort'; sort: RequestSort }
  | { type: 'loaded'; items: SchoolRequestRow[] }
  | { type: 'failed'; error: string }
  | { type: 'select'; selected: SchoolRequestDetail | null };

const INITIAL_REQUESTS_STATE: RequestsState = {
  items: [],
  error: null,
  selected: null,
  status: '',
  schoolType: '',
  sort: 'requested_at_desc',
};

function requestsReducer(state: RequestsState, action: RequestsAction): RequestsState {
  switch (action.type) {
    case 'setStatus':
      return { ...state, status: action.status };
    case 'setSchoolType':
      return { ...state, schoolType: action.schoolType };
    case 'setSort':
      return { ...state, sort: action.sort };
    case 'loaded':
      return { ...state, items: action.items, error: null };
    case 'failed':
      return { ...state, error: action.error };
    case 'select':
      return { ...state, selected: action.selected };
    default:
      return state;
  }
}

export function LingualRequestsPage() {
  const [state, dispatch] = useReducer(requestsReducer, INITIAL_REQUESTS_STATE);
  const { items, error, selected, status, schoolType, sort } = state;

  async function reload() {
    try {
      const result = await fetchRequests({
        status: status || undefined,
        schoolType: schoolType || undefined,
        sort,
      });
      dispatch({ type: 'loaded', items: result.items });
    } catch (e: any) {
      dispatch({ type: 'failed', error: e.message || 'unknown' });
    }
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [status, schoolType, sort]);

  async function openDetail(id: string) {
    const d = await fetchRequestDetail(id);
    dispatch({ type: 'select', selected: d });
  }

  async function handleApprove(internalNote?: string) {
    if (!selected) return;
    await approveRequest(selected.id, { internalNote });
    dispatch({ type: 'select', selected: null });
    void reload();
  }

  async function handleDecline(reason: string, category: DeclineCategory | string) {
    if (!selected) return;
    await declineRequest(selected.id, { reason, category: category as DeclineCategory });
    dispatch({ type: 'select', selected: null });
    void reload();
  }

  return (
    <div className="flex gap-6">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold">School requests</h1>

        <div className="mt-4 flex gap-3 text-sm">
          <select value={status} onChange={e => dispatch({ type: 'setStatus', status: e.target.value })} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Declined</option>
          </select>
          <select value={schoolType} onChange={e => dispatch({ type: 'setSchoolType', schoolType: e.target.value })} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All types</option>
            <option value="elementary">Elementary</option>
            <option value="middle">Middle</option>
            <option value="high">High</option>
            <option value="k12">K-12</option>
          </select>
          <select value={sort} onChange={e => dispatch({ type: 'setSort', sort: e.target.value as RequestSort })} className="rounded-md border border-neutral-300 px-2 py-1">
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
          onClose={() => dispatch({ type: 'select', selected: null })}
        />
      )}
    </div>
  );
}

export default LingualRequestsPage;
