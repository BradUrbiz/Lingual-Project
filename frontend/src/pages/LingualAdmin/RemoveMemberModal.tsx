import { useState } from 'react';
import type { MemberRow } from '@/types/lingualAdmin';

export interface RemoveMemberModalProps {
  member: MemberRow;
  onCancel(): void;
  onConfirm(reason: string): Promise<void>;
}

export function RemoveMemberModal({ member, onCancel, onConfirm }: RemoveMemberModalProps) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0;
  return (
    <dialog open aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Remove member</h3>
        <p className="mt-2 text-sm text-neutral-600">
          You are about to remove <strong>{member.email}</strong> ({member.roles.join(', ')}).
          Their data is preserved; the membership is soft-deleted.
        </p>

        <label htmlFor="remove-member-reason" className="mt-4 block text-xs uppercase tracking-wide text-neutral-500">Reason</label>
        <textarea
          id="remove-member-reason"
          aria-label="Reason"
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          maxLength={500}
        />

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button type="button"
            disabled={!valid}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm remove
          </button>
        </div>
      </div>
    </dialog>
  );
}
