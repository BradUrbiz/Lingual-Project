import { useEffect, useState } from 'react';
import { fetchOrgMembers, removeMember } from '@/api/lingualAdmin';
import type { MemberRow, MembersResponse } from '@/types/lingualAdmin';
import { RemoveMemberModal } from './RemoveMemberModal';

export function OrgMembersTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<MemberRow | null>(null);

  async function reload() {
    try {
      setData(await fetchOrgMembers(orgId));
    } catch (e: any) {
      setError(e.message || 'unknown');
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [orgId]);

  if (error) return <p className="text-red-600">Failed: {error}</p>;
  if (!data) return <p className="text-neutral-500">Loading…</p>;

  return (
    <div>
      <p className="text-sm text-neutral-600">
        <strong>{`${data.studentCount} students`}</strong> (count only — student data is never exposed in the Lingual admin panel).
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-2">Name</th><th>Email</th><th>Roles</th><th>Joined</th><th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {data.members.map(m => (
            <tr key={m.membershipId}>
              <td className="py-2 font-medium">{m.name || '—'}</td>
              <td>{m.email}</td>
              <td>{m.roles.join(', ')}</td>
              <td className="text-neutral-500">{m.joinedAt || '—'}</td>
              <td className="text-right">
                <button
                  onClick={() => setPendingRemove(m)}
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
          onCancel={() => setPendingRemove(null)}
          onConfirm={async reason => {
            await removeMember(orgId, pendingRemove.membershipId, { reason });
            setPendingRemove(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

export default OrgMembersTab;
