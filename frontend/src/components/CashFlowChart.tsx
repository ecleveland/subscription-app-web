'use client';

import {
  ComposedChart,
  Bar,
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
  type CashFlowMonth,
} from '@/lib/reports';
import { formatCents } from '@/lib/utils';
import ReportTooltip from './ReportTooltip';

export default function CashFlowChart({ months }: { months: CashFlowMonth[] }) {
  return (
    <div>
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
          <Bar dataKey="incomeCents" name="Income" fill="#22c55e" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenseCents" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
          <Line
            type="monotone"
            dataKey="netCents"
            name="Net"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {/* The SVG chart is not readable by screen readers; this table is. */}
      <table className="sr-only">
        <caption>Cash flow by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Income</th>
            <th scope="col">Expenses</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{formatShortMonth(m.month)}</th>
              <td>{formatCents(m.incomeCents)}</td>
              <td>{formatCents(m.expenseCents)}</td>
              <td>{formatCents(m.netCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
