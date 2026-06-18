import { SubscriptionSchema } from './subscription.schema';

describe('SubscriptionSchema indexes', () => {
  // schema.indexes() → [[keys, options], ...]
  const keyList = SubscriptionSchema.indexes().map(([keys]) => keys);

  it('indexes household + createdAt for the scoped list and default sort', () => {
    expect(keyList).toContainEqual({ householdId: 1, createdAt: -1 });
  });

  it('indexes isActive + nextBillingDate for the daily renewal cron scan', () => {
    expect(keyList).toContainEqual({ isActive: 1, nextBillingDate: 1 });
  });

  it('drops the now-redundant standalone householdId index', () => {
    // The compound above has householdId as its prefix, so a single-field
    // householdId index would be redundant write overhead.
    expect(keyList).not.toContainEqual({ householdId: 1 });
  });
});
