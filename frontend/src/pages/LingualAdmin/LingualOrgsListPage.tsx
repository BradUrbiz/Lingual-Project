import { useEffect, useReducer } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrgs } from '@/api/lingualAdmin';
import type { OrgSummary, OrgStatus } from '@/types/lingualAdmin';

type OrgsListState = {
  items: OrgSummary[];
  nextCursor: { nameLower: string; id: string } | null;
  status: '' | OrgStatus;
  schoolType: string;
  country: string;
  error: string | null;
};

type OrgsListAction =
  | { type: 'setStatus'; status: '' | OrgStatus }
  | { type: 'setSchoolType'; schoolType: string }
  | { type: 'setCountry'; country: string }
  | {
      type: 'loaded';
      reset: boolean;
      items: OrgSummary[];
      nextCursor: { nameLower: string; id: string } | null;
    }
  | { type: 'failed'; error: string };

const INITIAL_ORGS_LIST_STATE: OrgsListState = {
  items: [],
  nextCursor: null,
  status: '',
  schoolType: '',
  country: '',
  error: null,
};

function orgsListReducer(state: OrgsListState, action: OrgsListAction): OrgsListState {
  switch (action.type) {
    case 'setStatus':
      return { ...state, status: action.status };
    case 'setSchoolType':
      return { ...state, schoolType: action.schoolType };
    case 'setCountry':
      return { ...state, country: action.country };
    case 'loaded':
      return {
        ...state,
        items: action.reset ? action.items : [...state.items, ...action.items],
        nextCursor: action.nextCursor,
        error: null,
      };
    case 'failed':
      return { ...state, error: action.error };
    default:
      return state;
  }
}

export function LingualOrgsListPage() {
  const [state, dispatch] = useReducer(orgsListReducer, INITIAL_ORGS_LIST_STATE);
  const { items, nextCursor, status, schoolType, country, error } = state;

  async function load(reset: boolean) {
    try {
      const result = await fetchOrgs({
        status: status || undefined,
        schoolType: schoolType || undefined,
        country: country || undefined,
        cursor: reset ? undefined : nextCursor || undefined,
      });
      dispatch({
        type: 'loaded',
        reset,
        items: result.items,
        nextCursor: result.nextCursor,
      });
    } catch (e: any) {
      dispatch({ type: 'failed', error: e.message || 'unknown' });
    }
  }

  useEffect(() => { void load(true); /* eslint-disable-next-line */ }, [status, schoolType, country]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Organizations</h1>

      <div className="mt-4 flex gap-3 text-sm">
        <label className="flex items-center gap-2">
          Status
          <select aria-label="Status" value={status} onChange={e => dispatch({ type: 'setStatus', status: e.target.value as '' | OrgStatus })} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Type
          <select value={schoolType} onChange={e => dispatch({ type: 'setSchoolType', schoolType: e.target.value })} className="rounded-md border border-neutral-300 px-2 py-1">
            <option value="">All</option>
            <option value="elementary">Elementary</option>
            <option value="middle">Middle</option>
            <option value="high">High</option>
            <option value="k12">K-12</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Country
          <input value={country} onChange={e => dispatch({ type: 'setCountry', country: e.target.value })} className="rounded-md border border-neutral-300 px-2 py-1" placeholder="US" />
        </label>
      </div>

      {error && <p className="mt-4 text-red-600">Failed: {error}</p>}

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-2">Name</th><th>Status</th><th>Type</th><th>County / District</th><th>Members</th>
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
              <td>{o.schoolType || '-'}</td>
              <td>{o.county || '-'}</td>
              <td>{o.memberCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {nextCursor && (
        <button type="button" onClick={() => load(false)} className="mt-4 rounded-md border border-neutral-300 px-3 py-1 text-sm">
          Load more
        </button>
      )}
    </div>
  );
}

export default LingualOrgsListPage;
