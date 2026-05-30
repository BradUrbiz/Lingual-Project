import { useState } from 'react';
import type { DeclineCategory } from '@/types/lingualAdmin';

const CATEGORIES: { value: DeclineCategory; label: string }[] = [
  { value: 'info_missing', label: 'Information missing' },
  { value: 'fraud_risk', label: 'Fraud risk' },
  { value: 'out_of_scope', label: 'Out of scope' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Other' },
];

export interface DeclineRequestModalProps {
  onCancel(): void;
  onConfirm(reason: string, category: DeclineCategory): Promise<void>;
}

export function DeclineRequestModal({ onCancel, onConfirm }: DeclineRequestModalProps) {
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<DeclineCategory | ''>('');
  const valid = reason.trim().length > 0 && category !== '';
  return (
    <dialog open aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Decline request</h3>
        <p className="mt-1 text-sm text-neutral-600">Both fields are required and sent in the email to the requester.</p>

        <label htmlFor="decline-request-category" className="mt-4 block text-xs uppercase tracking-wide text-neutral-500">Category</label>
        <select
          id="decline-request-category"
          value={category}
          onChange={e => setCategory(e.target.value as DeclineCategory)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="">Select…</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <label htmlFor="decline-request-reason" className="mt-4 block text-xs uppercase tracking-wide text-neutral-500">Reason</label>
        <textarea
          id="decline-request-reason"
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          maxLength={500}
        />

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button type="button"
            disabled={!valid}
            onClick={() => onConfirm(reason.trim(), category as DeclineCategory)}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm decline
          </button>
        </div>
      </div>
    </dialog>
  );
}
