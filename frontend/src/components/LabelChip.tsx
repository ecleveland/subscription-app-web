import type { Label } from '@/lib/types';

// A pill with the label's color as a dot. Personal records pass no label and
// get no chip. Archived labels render the same, so history rows keep them.
export default function LabelChip({ label }: { label: Label | undefined | null }) {
  if (!label) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-2">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: label.color }}
        aria-hidden="true"
      />
      {label.name}
    </span>
  );
}
