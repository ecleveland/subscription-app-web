'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
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
  cost: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: CategoryData }> }) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{data.name}</p>
      <p className="text-sm text-gray-600 dark:text-gray-400">{formatCurrency(data.cost)}/mo</p>
    </div>
  );
}

export default function SpendingByCategoryChart({ subscriptions }: { subscriptions: Subscription[] }) {
  const data = useMemo<CategoryData[]>(() => {
    const active = subscriptions.filter((s) => s.isActive !== false);
    const byCategory: Record<string, number> = {};
    for (const sub of active) {
      const monthly = getMonthlyCost(sub.cost, sub.billingCycle);
      byCategory[sub.category] = (byCategory[sub.category] || 0) + monthly;
    }
    return Object.entries(byCategory)
      .map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 }))
      .sort((a, b) => b.cost - a.cost);
  }, [subscriptions]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No active subscriptions to display.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 50)}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
        <XAxis
          type="number"
          tickFormatter={(v: number) => formatCurrency(v)}
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
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || CATEGORY_COLORS.Other} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
