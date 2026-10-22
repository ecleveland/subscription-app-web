import { Subscription } from '@/lib/types';
import {
  formatCurrency,
  getDailyCost,
  getWeeklyCost,
  getMonthlyCost,
  getYearlyCost,
  getPersonalShare,
  daysUntil,
} from '@/lib/utils';

export default function DashboardSummary({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const activeSubscriptions = subscriptions.filter(
    (sub) => sub.isActive !== false,
  );
  const inactiveCount = subscriptions.length - activeSubscriptions.length;

  const totalDaily = activeSubscriptions.reduce(
    (sum, sub) => sum + getDailyCost(getPersonalShare(sub.cost, sub.sharedWith), sub.billingCycle),
    0,
  );
  const totalWeekly = activeSubscriptions.reduce(
    (sum, sub) => sum + getWeeklyCost(getPersonalShare(sub.cost, sub.sharedWith), sub.billingCycle),
    0,
  );
  const totalMonthly = activeSubscriptions.reduce(
    (sum, sub) => sum + getMonthlyCost(getPersonalShare(sub.cost, sub.sharedWith), sub.billingCycle),
    0,
  );
  const totalYearly = activeSubscriptions.reduce(
    (sum, sub) => sum + getYearlyCost(getPersonalShare(sub.cost, sub.sharedWith), sub.billingCycle),
    0,
  );

  const activeTrials = subscriptions.filter(
    (sub) => sub.trialEndDate && daysUntil(sub.trialEndDate) > 0,
  );
  const expiringSoonTrials = activeTrials.filter(
    (sub) => daysUntil(sub.trialEndDate!) <= 3,
  );

  return (
    <section className="card mb-8 grid overflow-hidden lg:grid-cols-[1.4fr_1fr]">
      <div className="border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
        <p className="eyebrow">Monthly</p>
        <p className="num mt-1 font-display text-5xl font-medium tracking-tight text-ink sm:text-6xl">
          {formatCurrency(totalMonthly)}
        </p>
        <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
          <div>
            <dt className="eyebrow">Daily</dt>
            <dd className="num mt-0.5 text-base text-ink">{formatCurrency(totalDaily)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Weekly</dt>
            <dd className="num mt-0.5 text-base text-ink">{formatCurrency(totalWeekly)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Yearly</dt>
            <dd className="num mt-0.5 text-base text-ink">{formatCurrency(totalYearly)}</dd>
          </div>
        </dl>
      </div>
      <div className="grid grid-cols-2 divide-x divide-line lg:grid-cols-1 lg:divide-x-0 lg:divide-y">
        <div className="p-5 sm:p-6">
          <p className="eyebrow">Subscriptions</p>
          <p className="num mt-1 text-3xl font-medium text-ink">
            {activeSubscriptions.length}{' '}
            <span className="font-sans text-sm font-normal text-muted">
              active
            </span>
          </p>
          <p className="mt-1 text-sm text-muted">
            {inactiveCount} inactive
          </p>
        </div>
        <div className="p-5 sm:p-6">
          <p className="eyebrow">Trials</p>
          {activeTrials.length > 0 ? (
            <>
              <p className="num mt-1 text-3xl font-medium text-ink">
                {activeTrials.length}{' '}
                <span className="font-sans text-sm font-normal text-muted">
                  active
                </span>
              </p>
              {expiringSoonTrials.length > 0 ? (
                <p className="mt-1 text-sm font-medium text-warn">
                  {expiringSoonTrials.length} expiring soon
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">none ending this week</p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">No trials running</p>
          )}
        </div>
      </div>
    </section>
  );
}
