import { useEffect, useReducer } from 'react';
import { fetchOrgMembers, removeMember } from '@/api/lingualAdmin';
import type { MemberRow, MembersResponse } from '@/types/lingualAdmin';
import { RemoveMemberModal } from './RemoveMemberModal';

type OrgMembersState = {
  data: MembersResponse | null;
  error: string | null;
  pendingRemove: MemberRow | null;
};

type OrgMembersAction =
  | { type: 'loaded'; data: MembersResponse }
  | { type: 'failed'; error: string }
  | { type: 'setPendingRemove'; member: MemberRow | null };

const INITIAL_ORG_MEMBERS_STATE: OrgMembersState = {
  data: null,
  error: null,
  pendingRemove: null,
};

function orgMembersReducer(state: OrgMembersState, action: OrgMembersAction): OrgMembersState {
  switch (action.type) {
    case 'loaded':
      return { ...state, data: action.data, error: null };
    case 'failed':
      return { ...state, error: action.error };
    case 'setPendingRemove':
      return { ...state, pendingRemove: action.member };
    default:
      return state;
  }
}

export function OrgMembersTab({ orgId }: { orgId: string }) {
  const [state, dispatch] = useReducer(orgMembersReducer, INITIAL_ORG_MEMBERS_STATE);
  const { data, error, pendingRemove } = state;

  async function reload() {
    try {
      dispatch({ type: 'loaded', data: await fetchOrgMembers(orgId) });
    } catch (e: any) {
      dispatch({ type: 'failed', error: e.message || 'unknown' });
    }
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!data) return <p className="text-neutral-500">Loading…</p>;

  return (
    <div>
      <p className="text-sm text-neutral-600">
        <strong>{`${data.studentCount} students`}</strong> (count only - student data is never exposed in the Lingual admin panel).
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-2">Name</th><th>Email</th><th>Roles</th><th>Joined</th><th>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {data.members.map(m => (
            <tr key={m.membershipId}>
              <td className="py-2 font-medium">{m.name || '-'}</td>
              <td>{m.email}</td>
              <td>{m.roles.join(', ')}</td>
              <td className="text-neutral-500">{m.joinedAt || '-'}</td>
              <td className="text-right">
                <button type="button"
                  onClick={() => dispatch({ type: 'setPendingRemove', member: m })}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pendingRemove && (
        <RemoveMemberModal
          member={pendingRemove}
          onCancel={() => dispatch({ type: 'setPendingRemove', member: null })}
          onConfirm={async reason => {
            await removeMember(orgId, pendingRemove.membershipId, { reason });
            dispatch({ type: 'setPendingRemove', member: null });
            void reload();
          }}
        />
      )}
    </div>
  );
}
