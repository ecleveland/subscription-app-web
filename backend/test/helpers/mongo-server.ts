import { MongoMemoryServer } from 'mongodb-memory-server';

const STARTUP_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Start an in-memory MongoDB, bounding startup with a timeout and retrying on a
 * wedged attempt (VEG-433).
 *
 * `MongoMemoryServer.start()` intermittently hangs at 0% CPU during startup — a
 * timing race in the library's readiness detection that, unbounded, freezes the
 * whole e2e run indefinitely (observed ~20 min). A normal start takes well under
 * a second, so a 20s ceiling only ever trips on the wedge: we force-stop the
 * stuck instance (best-effort) and retry with a fresh one. Three attempts make a
 * successful start overwhelmingly likely; if all fail we throw a clear error
 * instead of hanging.
 */
export async function startInMemoryMongo(): Promise<MongoMemoryServer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const server = new MongoMemoryServer();
    try {
      await withTimeout(
        server.start(),
        STARTUP_TIMEOUT_MS,
        `MongoMemoryServer.start (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      return server;
    } catch (error) {
      lastError = error;
      // Reap the half-started / wedged instance so a retry gets a clean slate
      // and we don't leak a mongod child. Bounded + swallowed: a stuck start can
      // make stop() hang too, and the library's process-exit cleanup is the
      // final backstop.
      await withTimeout(
        server.stop({ doCleanup: true, force: true }),
        5_000,
        'MongoMemoryServer.stop',
      ).catch(() => undefined);
    }
  }
  throw new Error(
    `Failed to start in-memory MongoDB after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`,
  );
}
