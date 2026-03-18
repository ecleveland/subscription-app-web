export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export function getMonthlyCost(
  cost: number,
  billingCycle: 'weekly' | 'monthly' | 'yearly',
): number {
  if (billingCycle === 'weekly') return cost * 4.33;
  return billingCycle === 'yearly' ? cost / 12 : cost;
}

export function getYearlyCost(
  cost: number,
  billingCycle: 'weekly' | 'monthly' | 'yearly',
): number {
  if (billingCycle === 'weekly') return cost * 52.14;
  return billingCycle === 'monthly' ? cost * 12 : cost;
}

export function getDailyCost(
  cost: number,
  billingCycle: 'weekly' | 'monthly' | 'yearly',
): number {
  if (billingCycle === 'weekly') return cost / 7;
  return billingCycle === 'yearly' ? cost / 365 : cost / (365 / 12);
}

export function getWeeklyCost(
  cost: number,
  billingCycle: 'weekly' | 'monthly' | 'yearly',
): number {
  if (billingCycle === 'weekly') return cost;
  return billingCycle === 'yearly' ? cost / (365 / 7) : cost / (365 / 12 / 7);
}

export function getPersonalShare(
  cost: number,
  sharedWith?: number | null,
): number {
  if (sharedWith != null && sharedWith >= 2) return cost / sharedWith;
  return cost;
}

export function daysUntil(date: Date | string): number {
  const now = new Date();
  const target = new Date(date);
  const diffTime = target.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
