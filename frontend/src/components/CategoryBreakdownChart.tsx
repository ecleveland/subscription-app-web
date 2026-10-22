'use client';

import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Subscription } from '@/lib/types';
import { getMonthlyCost, getPersonalShare, formatCurrency } from '@/lib/utils';

const CATEGORY_COLORS: Record<string, string> = {
  Streaming: '#6b4f9e',
  Software: '#2e5f8a',
  Gaming: '#1f6b47',
  'Cloud Storage': '#2f8a93',
  'News & Media': '#a4601a',
  'Health & Fitness': '#b2433a',
  Education: '#c29a2a',
  Utilities: '#7c766a',
  Other: '#7c766a',
};

interface CategoryData {
  name: string;
  value: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-line rounded-md px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-ink">{payload[0].name}</p>
      <p className="text-sm text-ink-2">{formatCurrency(payload[0].value)}/mo</p>
    </div>
  );
}

export default function CategoryBreakdownChart({ subscriptions }: { subscriptions: Subscription[] }) {
  const data = useMemo<CategoryData[]>(() => {
    const active = subscriptions.filter((s) => s.isActive !== false);
    const byCategory: Record<string, number> = {};
    for (const sub of active) {
      const monthly = getMonthlyCost(getPersonalShare(sub.cost, sub.sharedWith), sub.billingCycle);
      byCategory[sub.category] = (byCategory[sub.category] || 0) + monthly;
    }
    return Object.entries(byCategory)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);
  }, [subscriptions]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
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
          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
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
