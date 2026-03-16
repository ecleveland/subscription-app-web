'use client';

import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Subscription } from '@/lib/types';
import { getMonthlyCost, formatCurrency } from '@/lib/utils';

const CATEGORY_COLORS: Record<string, string> = {
  Streaming: '#a855f7',
  Software: '#3b82f6',
  Gaming: '#22c55e',
  'Cloud Storage': '#06b6d4',
  'News & Media': '#f97316',
  'Health & Fitness': '#ef4444',
  Education: '#eab308',
  Utilities: '#6b7280',
  Other: '#64748b',
};

interface CategoryData {
  name: string;
  value: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{payload[0].name}</p>
      <p className="text-sm text-gray-600 dark:text-gray-400">{formatCurrency(payload[0].value)}/mo</p>
    </div>
  );
}

export default function CategoryBreakdownChart({ subscriptions }: { subscriptions: Subscription[] }) {
  const data = useMemo<CategoryData[]>(() => {
    const active = subscriptions.filter((s) => s.isActive !== false);
    const byCategory: Record<string, number> = {};
    for (const sub of active) {
      const monthly = getMonthlyCost(sub.cost, sub.billingCycle);
      byCategory[sub.category] = (byCategory[sub.category] || 0) + monthly;
    }
    return Object.entries(byCategory)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);
  }, [subscriptions]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No active subscriptions to display.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          outerRadius={100}
          dataKey="value"
          nameKey="name"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || CATEGORY_COLORS.Other} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
