# Testing Requirements

All new code must include tests. No feature or bug fix is considered complete without corresponding test coverage.

## When Tests Are Required

| Change Type | Required Tests |
|---|---|
| New service method | Unit test for the method |
| New API endpoint | E2E test + controller unit test if controller has logic |
| New utility/lib function | Unit test |
| New interactive component | Component test with @testing-library/react |
| Bug fix | Regression test proving the fix |
| Refactor | Existing tests must pass; add tests if coverage gaps found |

## When Tests Are NOT Required

- Static/presentational components with no state or event handlers (e.g., `CategoryBadge`, `EmptyState`)
- Thin page shells that only compose already-tested components
- Config files, type definitions, DTOs with only class-validator decorators

## Backend Conventions (Jest 30)

### Unit tests

- Co-locate with source: `*.spec.ts` next to the file under test
- Use `@nestjs/testing` `Test.createTestingModule()` with mock providers:
  ```typescript
  { provide: ServiceName, useValue: { method: jest.fn() } }
  ```
- Mock Mongoose models using chainable `jest.fn()` pattern:
  ```typescript
  const mockModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
  ```
- Mock `bcryptjs` at module level: `jest.mock('bcryptjs')`
- Controllers with only thin delegation to services do not need unit tests
- Controllers with business logic (e.g., admin safeguards) need unit tests

### E2E tests

- Located in `backend/test/*.e2e-spec.ts`
- Use shared helper `backend/test/helpers/test-app.ts` which provides:
  - `createTestApp()` — spins up a NestJS app against the in-memory MongoDB,
    on its own uniquely-named database for isolation
  - `closeTestApp(app)` — closes the app (the MongoDB server itself is shared,
    see below)
- Use `supertest` for HTTP assertions
- New API endpoints or significant behavior changes require E2E tests

#### In-memory MongoDB: one shared server (VEG-433)

A **single** `mongodb-memory-server` is started once per run by Jest
`globalSetup` (`test/helpers/global-setup.ts`), published via `E2E_MONGO_URI`,
and stopped in `globalTeardown`. Each `createTestApp()` connects to its own
fresh database (`e2e_<uuid>`) on that one server, so specs stay isolated without
each spawning their own mongod.

This replaced the old model where every spec started and stopped its own server
(~13 spawn/stop cycles per run), which intermittently **hung the whole suite**.
Two distinct hangs were diagnosed and fixed:

1. **Startup race** — `MongoMemoryServer` occasionally wedges at 0% CPU during
   startup (a timing race in the library, masked by `MONGOMS_DEBUG`). Collapsing
   ~13 starts to 1 shrinks the exposure; `startInMemoryMongo()`
   (`test/helpers/mongo-server.ts`) additionally bounds startup with a 20s
   timeout and retries (3×), turning a multi-minute hang into a fast self-heal.
2. **Exit hang** — after all tests pass, a lingering post-test handle (a mongo
   driver socket left mid-close across the many app lifecycles; not attributable
   even by `--detectOpenHandles`) kept the Node process alive ("Jest did not
   exit…"). `test:e2e` runs with `--forceExit` so the runner exits promptly once
   the suite is green. This is safe: all tests pass and `globalTeardown` owns the
   server shutdown — it is not masking a failure.

Do **not** reintroduce per-spec `MongoMemoryServer.create()` in specs; always go
through `createTestApp()`.

### Run commands

```bash
cd backend && npm test          # Unit tests
cd backend && npm run test:e2e  # E2E tests
```

## Frontend Conventions (Vitest + Testing Library)

### Unit tests

- Utility/lib functions: `src/lib/__tests__/*.test.ts`
- Component tests: `src/components/__tests__/*.test.tsx`
- Use `vi.mock()` for module mocking
- Global `fetch` mock pattern: `vi.stubGlobal('fetch', vi.fn())`
- Custom `localStorage` mock is provided in `vitest.setup.ts` (required due to Node.js 22+ built-in localStorage conflict with jsdom)
- Next.js modules (`next/navigation`, `next/link`, `next/image`) are mocked in `vitest.setup.ts`

### Component tests

- Use `@testing-library/react` — `render`, `screen`, `waitFor`
- Use `@testing-library/user-event` for interactions — `userEvent.setup()` then `user.click()`, `user.type()`, etc.
- Test behavior, not implementation: assert on visible text, roles, and user-observable outcomes
- When testing components that call APIs, mock `apiFetch` from `@/lib/api`

### Run command

```bash
cd frontend && npm test
```

## End-to-End Tests (Playwright)

E2E tests live in `frontend/e2e/*.spec.ts` and run a real browser (Chromium)
against a running dev environment. They are the only layer that exercises full
user journeys across pages, the auth token lifecycle, and middleware redirects.

### When to add an E2E test vs. a component test

| Use a **component test** (Vitest) when… | Use an **E2E test** (Playwright) when… |
|---|---|
| Testing one component's logic, rendering, or event handling in isolation | Testing a multi-page flow (e.g. login → create → dashboard → logout) |
| You can mock `apiFetch` and assert on local behavior | The behavior depends on the real backend, persisted data, or JWT/cookie state |
| Verifying validation messages, conditional rendering, formatting | Verifying middleware redirects, role-based route access, or storageState reuse |
| The fast inner-loop suite is the right place for it | A regression would only surface when the pieces are wired together |

Default to a component test — it's faster and more focused. Reach for E2E only
for genuinely cross-cutting flows. E2E is **not** a substitute for unit/component
coverage of new code; add both where each applies.

### Conventions

- One spec per flow (`auth`, `subscriptions`, `trial`, `cost-splitting`,
  `csv-export`, `admin`). Shared UI steps live in `e2e/actions.ts`.
- Auth is seeded once in `e2e/global.setup.ts`, which registers a regular user
  and an admin (promoted directly in Mongo) and saves each `storageState`.
  Authenticated specs reuse that state via the `chromium` / `chromium-admin`
  projects; logged-out flows override it with `test.use({ storageState: … })`.
- Tests create uniquely-named data and locate it via the dashboard search box,
  so they are independent of pagination and leftover data.
- Select by role/label/visible text — never add `data-testid` hooks unless a flow
  is otherwise unreachable.

### Isolation — never touch dev data

The suite runs against its **own stack**: a dedicated backend (`:3101`) and
frontend (`:3100`) backed by a throwaway **`subscriptions_e2e`** database,
separate from the dev `subscriptions` DB. Locally, Playwright's `webServer`
config starts those servers (the dev backend is never used for E2E); in CI the
workflow boots them and sets `E2E_BASE_URL` / `E2E_API_URL`. The E2E database is
dropped in `e2e/global.teardown.ts` after every run, so nothing is left behind.

### Run command

E2E only needs MongoDB running — Playwright starts the backend and frontend:

```bash
docker compose up -d mongo   # from the repo root
cd frontend && npm run test:e2e
```

## Verification

Before considering any work complete, run the relevant test suites:
- Backend changes → `cd backend && npm test && npm run test:e2e`
- Frontend changes → `cd frontend && npm test`
- Both → run all three commands

CI runs these automatically on push and PR to `master` via `.github/workflows/ci.yml`.
The Playwright E2E suite runs on PRs to `master` via `.github/workflows/e2e.yml`.
