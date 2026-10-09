'use client';

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  formatAxisDollars,
  formatShortMonth,
  type NetWorthMonth,
} from '@/lib/reports';
import { formatCents } from '@/lib/utils';
import ReportTooltip from './ReportTooltip';

export default function NetWorthChart({ months }: { months: NetWorthMonth[] }) {
  const latest = months[months.length - 1];

  return (
    <div>
      {latest && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Net worth
          </p>
          <p
            data-testid="net-worth-headline"
            className={`text-2xl font-semibold ${
              latest.netWorthCents < 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {formatCents(latest.netWorthCents)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            as of {formatShortMonth(latest.month)}
          </p>
        </div>
      )}
      {/* ComposedChart rather than AreaChart so the net worth Line can sit on
          top of the two areas. Liabilities are negative, so their area
          fills below zero. */}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={months}
          margin={{ left: 10, right: 10, top: 5, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
          <XAxis
            dataKey="month"
            tickFormatter={formatShortMonth}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            className="text-gray-500 dark:text-gray-400"
          />
          <YAxis
            tickFormatter={formatAxisDollars}
            width={80}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            className="text-gray-500 dark:text-gray-400"
          />
          <Tooltip content={<ReportTooltip formatLabel={formatShortMonth} />} />
          <Legend />
          <Area
            type="monotone"
            dataKey="assetsCents"
            name="Assets"
            stroke="#22c55e"
            fill="#22c55e"
            fillOpacity={0.2}
          />
          <Area
            type="monotone"
            dataKey="liabilitiesCents"
            name="Liabilities"
            stroke="#ef4444"
            fill="#ef4444"
            fillOpacity={0.2}
          />
          <Line
            type="monotone"
            dataKey="netWorthCents"
            name="Net worth"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {/* The SVG chart is not readable by screen readers; this table is. */}
      <table className="sr-only">
        <caption>Net worth by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Assets</th>
            <th scope="col">Liabilities</th>
            <th scope="col">Net worth</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{formatShortMonth(m.month)}</th>
              <td>{formatCents(m.assetsCents)}</td>
              <td>{formatCents(m.liabilitiesCents)}</td>
              <td>{formatCents(m.netWorthCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
