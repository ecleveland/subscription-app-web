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
  - `createTestApp()` — spins up NestJS app with in-memory MongoDB (`mongodb-memory-server`)
  - `closeTestApp(app)` — tears down app and stops MongoDB
- Use `supertest` for HTTP assertions
- New API endpoints or significant behavior changes require E2E tests

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

## Verification

Before considering any work complete, run the relevant test suites:
- Backend changes → `cd backend && npm test && npm run test:e2e`
- Frontend changes → `cd frontend && npm test`
- Both → run all three commands

CI runs these automatically on push and PR to `master` via `.github/workflows/ci.yml`.
