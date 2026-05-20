import { useState } from 'react';
import type { SchoolRequestDetail } from '@/types/lingualAdmin';
import { DeclineRequestModal } from './DeclineRequestModal';

export interface RequestDetailPanelProps {
  request: SchoolRequestDetail;
  onApprove(internalNote?: string): Promise<void>;
  onDecline(reason: string, category: SchoolRequestDetail['rejectionCategory'] | string): Promise<void>;
  onClose(): void;
}

export function RequestDetailPanel(props: RequestDetailPanelProps) {
  const { request, onApprove, onDecline, onClose } = props;
  const [note, setNote] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <aside className="w-[420px] shrink-0 border-l border-neutral-200 bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{request.schoolName}</h2>
          <p className="text-sm text-neutral-500">{request.status}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-900">×</button>
      </div>

      <dl className="mt-6 space-y-3 text-sm">
        <div><dt className="text-neutral-500">Requester</dt><dd>{request.requesterName} &lt;{request.requesterEmail}&gt;</dd></div>
        <div><dt className="text-neutral-500">Website</dt><dd>{request.websiteUrl || '—'}</dd></div>
        <div>
          <dt className="text-neutral-500">Location</dt>
          <dd>
            {[
              request.location?.county,
              request.location?.state,
              request.location?.country,
            ].filter(Boolean).join(', ') || '—'}
          </dd>
        </div>
        <div><dt className="text-neutral-500">Org type</dt><dd>{request.orgType} / {request.schoolType}</dd></div>
        <div>
          <dt className="text-neutral-500">Pre-invited teachers</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {request.preInvitedTeachers.length === 0 && <span className="text-neutral-400">—</span>}
            {request.preInvitedTeachers.map(t => (
              <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{t}</span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Attestation</dt>
          <dd className="font-mono text-xs">
            ip_hash={request.adminIdentity?.authorizationAttestation?.ipHash || '—'}{' '}
            ua={request.adminIdentity?.authorizationAttestation?.userAgent?.slice(0, 40) || '—'}
          </dd>
        </div>
      </dl>

      {request.status === 'pending' && (
        <div className="mt-8 space-y-3">
          <label className="block text-xs uppercase tracking-wide text-neutral-500">
            Internal note (optional)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            maxLength={2000}
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await onApprove(note || undefined); } finally { setBusy(false); }
              }}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => setShowDecline(true)}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {showDecline && (
        <DeclineRequestModal
          onCancel={() => setShowDecline(false)}
          onConfirm={async (reason, category) => {
            setBusy(true);
            try { await onDecline(reason, category); } finally { setBusy(false); setShowDecline(false); }
          }}
        />
      )}
    </aside>
  );
}
