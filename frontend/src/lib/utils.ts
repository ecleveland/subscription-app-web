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
  billingCycle: 'monthly' | 'yearly',
): number {
  return billingCycle === 'yearly' ? cost / 12 : cost;
}

export function getYearlyCost(
  cost: number,
  billingCycle: 'monthly' | 'yearly',
): number {
  return billingCycle === 'monthly' ? cost * 12 : cost;
}

export function daysUntil(date: Date | string): number {
  const now = new Date();
  const target = new Date(date);
  const diffTime = target.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
