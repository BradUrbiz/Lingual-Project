import { useState } from 'react';
import type { SchoolRequestDetail } from '@/types/lingualAdmin';
import { DeclineRequestModal } from './DeclineRequestModal';

export interface RequestDetailPanelProps {
  request: SchoolRequestDetail;
  onApprove(internalNote?: string): Promise<void>;
  onDecline(reason: string, category: SchoolRequestDetail['rejectionCategory'] | string): Promise<void>;
  onClose(): void;
}

function textOrDash(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function listOrDash(values?: string[] | null): string {
  const cleaned = (values ?? []).filter(Boolean);
  return cleaned.length ? cleaned.join(', ') : '—';
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="break-words">{value || <span className="text-neutral-400">—</span>}</dd>
    </div>
  );
}

export function RequestDetailPanel(props: RequestDetailPanelProps) {
  const { request, onApprove, onDecline, onClose } = props;
  const [note, setNote] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [busy, setBusy] = useState(false);
  const attestation = request.adminIdentity?.authorizationAttestation;
  const preInvitedTeachers = request.preInvitedTeachers ?? [];
  const requesterLabel = request.requesterName && request.requesterEmail
    ? `${request.requesterName} <${request.requesterEmail}>`
    : textOrDash(request.requesterName || request.requesterEmail);

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
        <DetailRow label="Requester" value={requesterLabel} />
        <DetailRow label="Admin name" value={textOrDash(request.adminIdentity?.fullName)} />
        <DetailRow label="Admin email" value={textOrDash(request.adminIdentity?.schoolEmail)} />
        <DetailRow label="Admin role" value={textOrDash(request.adminIdentity?.roleTitle)} />
        <DetailRow label="Website" value={textOrDash(request.websiteUrl)} />
        <DetailRow
          label="Location"
          value={[
            request.location?.county,
            request.location?.state,
            request.location?.country,
          ].filter(Boolean).join(', ') || '—'}
        />
        <DetailRow label="Org type" value={`${textOrDash(request.orgType)} / ${textOrDash(request.schoolType)}`} />
        <DetailRow label="Public / private" value={textOrDash(request.publicPrivate)} />
        <DetailRow label="Grade size" value={textOrDash(request.gradeSize)} />
        <DetailRow label="Official domains" value={listOrDash(request.officialEmailDomains)} />
        <DetailRow label="Canvas URL" value={textOrDash(request.integration?.canvasUrl)} />
        <DetailRow
          label="Integration types"
          value={listOrDash(request.integration?.canvasIntegrationTypes)}
        />
        <DetailRow
          label="Grade ranges"
          value={listOrDash(request.curriculum?.gradeRanges)}
        />
        <DetailRow
          label="Languages"
          value={listOrDash(request.curriculum?.languagesTaught)}
        />
        <DetailRow
          label="Frameworks"
          value={listOrDash(request.curriculum?.courseFrameworks)}
        />
        <div>
          <dt className="text-neutral-500">Pre-invited teachers</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {preInvitedTeachers.length === 0 && <span className="text-neutral-400">—</span>}
            {preInvitedTeachers.map(t => (
              <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{t}</span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Attestation</dt>
          <dd className="font-mono text-xs">
            confirmed_at={attestation?.confirmedAt || '—'}{' '}
            ip_hash={attestation?.ipHash || '—'}{' '}
            ua={attestation?.userAgent?.slice(0, 40) || '—'}
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
