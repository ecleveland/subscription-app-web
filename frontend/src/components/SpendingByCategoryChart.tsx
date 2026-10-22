'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
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
  cost: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: CategoryData }> }) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-surface border border-line rounded-md px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-ink">{data.name}</p>
      <p className="text-sm text-ink-2">{formatCurrency(data.cost)}/mo</p>
    </div>
  );
}

export default function SpendingByCategoryChart({ subscriptions }: { subscriptions: Subscription[] }) {
  const data = useMemo<CategoryData[]>(() => {
    const active = subscriptions.filter((s) => s.isActive !== false);
    const byCategory: Record<string, number> = {};
    for (const sub of active) {
      const monthly = getMonthlyCost(getPersonalShare(sub.cost, sub.sharedWith), sub.billingCycle);
      byCategory[sub.category] = (byCategory[sub.category] || 0) + monthly;
    }
    return Object.entries(byCategory)
      .map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 }))
      .sort((a, b) => b.cost - a.cost);
  }, [subscriptions]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
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
          className="text-muted"
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fill: 'currentColor', fontSize: 12 }}
          className="text-muted"
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
