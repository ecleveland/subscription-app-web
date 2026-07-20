import { TransactionSchema } from './transaction.schema';

describe('TransactionSchema indexes', () => {
  // schema.indexes() → [[keys, options], ...]
  const indexes = TransactionSchema.indexes();
  const keyList = indexes.map(([keys]) => keys);

  it('indexes the account and household ledger reads, newest first', () => {
    expect(keyList).toContainEqual({ householdId: 1, date: -1 });
    expect(keyList).toContainEqual({ accountId: 1, date: -1 });
  });

  describe('the recurring-occurrence dedupe index (VEG-467)', () => {
    const entry = indexes.find(
      ([keys]) => keys.recurringId === 1 && keys.date === 1,
    );

    it('is unique, so a retried materialization cannot double-post', () => {
      expect(entry).toBeDefined();
      expect(entry?.[1]).toMatchObject({ unique: true });
    });

    it('is partial on $type objectId, never $exists', () => {
      // $exists: true would ALSO match a document with an explicit
      // `recurringId: null` — every such manual transaction would then collide
      // with every other on the key (null, date), turning ordinary transaction
      // creation into an E11000 for users. Matching on the BSON type admits
      // only real schedule links.
      expect(entry?.[1].partialFilterExpression).toEqual({
        recurringId: { $type: 'objectId' },
      });
      expect(JSON.stringify(entry?.[1].partialFilterExpression)).not.toContain(
        '$exists',
      );
    });

    it('carries an explicit name (VEG-450: auto-names can collide silently)', () => {
      expect(entry?.[1].name).toBe('recurring_occurrence_unique');
    });
  });
});
