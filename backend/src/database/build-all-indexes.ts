import type { Connection } from 'mongoose';

/**
 * Await every registered model's index build (Model.init() resolves when its
 * autoIndex build completes, rejects when it fails). Mongoose's default
 * background autoIndex has two failure modes this closes: a write that lands
 * before its unique index exists succeeds instead of conflicting, and a
 * failed build (e.g. pre-existing data violating a unique constraint, or an
 * index-name conflict) dies silently, leaving the invariant unenforced with
 * no operator signal. A failure here rejects with the model named — callers
 * decide whether that aborts a boot (production) or tears down a test app.
 */
export async function buildAllIndexes(connection: Connection): Promise<void> {
  await Promise.all(
    Object.values(connection.models).map(async (model) => {
      try {
        await model.init();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Index build failed for ${model.modelName} — a unique constraint ` +
            `is unenforced until the conflicting data or index is fixed: ` +
            message,
          { cause: error },
        );
      }
    }),
  );
}
