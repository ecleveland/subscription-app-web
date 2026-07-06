import type { Connection } from 'mongoose';
import { buildAllIndexes } from './build-all-indexes';

function fakeConnection(models: Record<string, unknown>): Connection {
  return { models } as unknown as Connection;
}

describe('buildAllIndexes', () => {
  it('awaits init() on every registered model', async () => {
    const a = { modelName: 'A', init: jest.fn().mockResolvedValue(undefined) };
    const b = { modelName: 'B', init: jest.fn().mockResolvedValue(undefined) };

    await buildAllIndexes(fakeConnection({ A: a, B: b }));

    expect(a.init).toHaveBeenCalledTimes(1);
    expect(b.init).toHaveBeenCalledTimes(1);
  });

  it('rejects naming the model whose index build failed', async () => {
    const ok = {
      modelName: 'Fine',
      init: jest.fn().mockResolvedValue(undefined),
    };
    const bad = {
      modelName: 'HouseholdMember',
      init: jest.fn().mockRejectedValue(new Error('E11000 duplicate key')),
    };

    await expect(
      buildAllIndexes(fakeConnection({ Fine: ok, HouseholdMember: bad })),
    ).rejects.toThrow(
      /Index build failed for HouseholdMember.*E11000 duplicate key/,
    );
  });
});
