import type { OrgDetail } from '@/types/lingualAdmin';

export function OrgOverviewTab({ org }: { org: OrgDetail }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Metadata</h3>
        <dl className="mt-2 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-neutral-500">Status</dt><dd>{org.status}</dd></div>
          <div><dt className="text-neutral-500">Type</dt><dd>{org.schoolType || '-'}</dd></div>
          <div><dt className="text-neutral-500">Country / State / County</dt><dd>{[org.country, org.state, org.county].filter(Boolean).join(' / ') || '-'}</dd></div>
          <div><dt className="text-neutral-500">Website</dt><dd>{org.websiteUrl || '-'}</dd></div>
        </dl>
      </section>

      {org.status === 'suspended' && (
        <section className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <strong>Suspended.</strong> Reason: {org.suspendReason || '-'}.
          {org.suspendedUntil && <> Auto-restore at {org.suspendedUntil}.</>}
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-500">School admin contacts</h3>
        <ul className="mt-2 divide-y divide-neutral-200">
          {org.schoolAdminContacts.length === 0 && (
            <li className="py-2 text-sm text-neutral-500">No active school admins.</li>
          )}
          {org.schoolAdminContacts.map(c => (
            <li key={c.membershipId} className="py-2 text-sm">
              <span className="font-medium">{c.name || '-'}</span>{' '}
              <span className="text-neutral-500">&lt;{c.email}&gt;</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
