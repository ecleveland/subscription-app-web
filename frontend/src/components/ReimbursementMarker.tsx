import type { Reimbursement } from '@/lib/types';

// A pill beside the label chip. Records that are not reimbursable get none.
export default function ReimbursementMarker({
  reimbursement,
}: {
  reimbursement?: Reimbursement | null;
}) {
  if (!reimbursement) return null;

  const reimbursed = reimbursement.status === 'reimbursed';
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium ${
        reimbursed ? 'text-accent' : 'text-warn'
      }`}
    >
      {reimbursed ? 'Reimbursed' : 'Owed'}
    </span>
  );
}
