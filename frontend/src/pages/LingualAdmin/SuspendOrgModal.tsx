import { useState } from 'react';

export interface SuspendOrgModalProps {
  onCancel(): void;
  onConfirm(reason: string, suspendedUntil: string | null): Promise<void>;
}

export function SuspendOrgModal({ onCancel, onConfirm }: SuspendOrgModalProps) {
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'indefinite' | 'temporary'>('indefinite');
  const [until, setUntil] = useState('');
  const valid = reason.trim().length > 0 && (mode === 'indefinite' || until);
  return (
    <dialog open aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Suspend organization</h3>

        <label htmlFor="suspend-org-reason" className="mt-4 block text-xs uppercase tracking-wide text-neutral-500">Reason</label>
        <textarea
          id="suspend-org-reason"
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          aria-label="Reason"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          maxLength={500}
        />

        <fieldset className="mt-4">
          <legend className="text-xs uppercase tracking-wide text-neutral-500">Duration</legend>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="radio" name="duration" checked={mode === 'indefinite'} onChange={() => setMode('indefinite')} />
            Indefinite
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="radio" name="duration" checked={mode === 'temporary'} onChange={() => setMode('temporary')} />
            Until specific date
          </label>
          {mode === 'temporary' && (
            <input
              aria-label="Suspended until date"
              type="datetime-local"
              value={until}
              onChange={e => setUntil(e.target.value)}
              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          )}
        </fieldset>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button type="button"
            disabled={!valid}
            onClick={async () => {
              const isoUntil = mode === 'temporary' && until
                ? new Date(until).toISOString()
                : null;
              await onConfirm(reason.trim(), isoUntil);
            }}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm suspend
          </button>
        </div>
      </div>
    </dialog>
  );
}
