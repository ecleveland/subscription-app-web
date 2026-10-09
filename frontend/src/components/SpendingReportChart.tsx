'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatAxisDollars, type SpendingReport } from '@/lib/reports';
import { formatCents } from '@/lib/utils';
import ReportTooltip from './ReportTooltip';

interface Row {
  key: string;
  name: string;
  actualCents: number;
  // undefined, not null, so recharts draws no planned bar for the row.
  plannedCents?: number;
}

export default function SpendingReportChart({
  report,
}: {
  report: SpendingReport;
}) {
  // Keep the backend's order (actual descending). Uncategorized goes last
  // because it is a catch-all, not a category the user can budget for.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = report.categories.map((c) => ({
      key: c.categoryId,
      name: c.categoryName,
      actualCents: c.actualCents,
      plannedCents: c.plannedCents ?? undefined,
    }));
    if (report.uncategorizedCents > 0) {
      out.push({
        key: 'uncategorized',
        name: 'Uncategorized',
        actualCents: report.uncategorizedCents,
      });
    }
    return out;
  }, [report]);

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 50)}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 20, right: 20, top: 5, bottom: 5 }}
          barGap={2}
        >
          <XAxis
            type="number"
            tickFormatter={formatAxisDollars}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            className="text-gray-500 dark:text-gray-400"
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            className="text-gray-500 dark:text-gray-400"
          />
          <Tooltip content={<ReportTooltip />} />
          <Legend />
          <Bar dataKey="actualCents" name="Spent" fill="#3b82f6" barSize={18} radius={[0, 4, 4, 0]} />
          {/* Planned is a second thin bar under the actual one, not a
              reference marker. Recharts has no per-row marker for a
              categorical axis, and a thin bar still reads as "how far
              spend got against plan" at a glance. Rows with no budget
              (plannedCents null) get no planned bar. */}
          <Bar dataKey="plannedCents" name="Planned" fill="#9ca3af" barSize={6} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
        Total spent: {formatCents(report.totalCents)}
      </p>
      {/* The SVG chart is not readable by screen readers; this table is. */}
      <table className="sr-only">
        <caption>Spending by category</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Spent</th>
            <th scope="col">Planned</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.name}</th>
              <td>{formatCents(r.actualCents)}</td>
              <td>
                {r.plannedCents === undefined
                  ? 'No budget'
                  : formatCents(r.plannedCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
