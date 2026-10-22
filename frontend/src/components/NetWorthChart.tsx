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
          <p className="text-xs uppercase tracking-wide text-muted">
            Net worth
          </p>
          <p
            data-testid="net-worth-headline"
            className={`text-2xl font-semibold ${
              latest.netWorthCents < 0
                ? 'text-danger'
                : 'text-ink'
            }`}
          >
            {formatCents(latest.netWorthCents)}
          </p>
          <p className="text-xs text-muted">
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
            className="text-muted"
          />
          <YAxis
            tickFormatter={formatAxisDollars}
            width={80}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            className="text-muted"
          />
          <Tooltip content={<ReportTooltip formatLabel={formatShortMonth} />} />
          <Legend />
          <Area
            type="monotone"
            dataKey="assetsCents"
            name="Assets"
            stroke="#1f6b47"
            fill="#1f6b47"
            fillOpacity={0.2}
          />
          <Area
            type="monotone"
            dataKey="liabilitiesCents"
            name="Liabilities"
            stroke="#b2433a"
            fill="#b2433a"
            fillOpacity={0.2}
          />
          <Line
            type="monotone"
            dataKey="netWorthCents"
            name="Net worth"
            stroke="#2e5f8a"
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
