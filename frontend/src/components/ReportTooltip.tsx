'use client';

import { formatCents } from '@/lib/utils';

interface TooltipEntry {
  name?: string | number;
  value?: number | string | null;
  color?: string;
}

// Shared recharts tooltip for the report charts. Values are integer cents.
export default function ReportTooltip({
  active,
  payload,
  label,
  formatLabel,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatLabel?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const title =
    label === undefined
      ? ''
      : formatLabel
        ? formatLabel(String(label))
        : String(label);
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-md">
      {title && (
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {title}
        </p>
      )}
      {payload
        .filter((p) => typeof p.value === 'number')
        .map((p) => (
          <p
            key={String(p.name)}
            className="text-sm text-gray-600 dark:text-gray-400"
          >
            <span style={{ color: p.color }}>{p.name}</span>:{' '}
            {formatCents(p.value as number)}
          </p>
        ))}
    </div>
  );
}
