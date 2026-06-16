# start-ticket — Subscription App project overrides

Project-specific configuration for the global `start-ticket` skill. The skill
reads this file at the start of every run; everything here overrides or fills in
the generic workflow. Monorepo: `/backend` (NestJS 11 + Mongoose, Jest) and
`/frontend` (Next.js 16, Vitest + Playwright). See root `CLAUDE.md` and the
mandatory docs in `.claude/architecture/` (`testing.md`, `backend-patterns.md`,
`budgeting.md`).

## Ticket tracker

- Linear team **Vega Apps**, project **Subscription App**, ticket prefix `VEG-NNN`.
- Branch from Linear's `gitBranchName` (e.g. `syrix/veg-NNN-slug`) — don't invent names.
- Free-tier issue cap: if creating issues hits the limit, the `archive-linear`
  skill bulk-archives closed issues (they stop counting once archived).
- Move the ticket to **In Progress** and assign it to the user at the start;
  the GitHub integration moves it to **In Review** on PR open and **Done** on merge.

## Pre-flight

- Working tree must be clean (skill handles). Architecture docs (`.claude/architecture/`)
  not yet in the tree are fine to carry onto the branch.
- Stale dev servers: ports **3000** (frontend) and **3001** (backend). The
  `/stop-dev` skill stops both, or `lsof -ti:3000,3001 | xargs kill -9 2>/dev/null`.
- MongoDB (Docker): `docker compose up -d mongo` from the repo root. Needed for
  the dev stack and the **frontend** Playwright E2E. The **backend** E2E uses an
  in-memory Mongo (`mongodb-memory-server`) and needs no container.
- Env files: `backend/.env` (`MONGODB_URI`, `JWT_SECRET` required, `JWT_EXPIRES_IN`,
  `FRONTEND_URL`) and `frontend/.env.local` (`NEXT_PUBLIC_API_URL`). Copy from
  the `.env.example`/defaults if missing.
- Confirm `gh auth status` succeeds.

## Fast test runners (TDD inner loop)

- Backend: `cd backend && npx jest <pattern>` (or `npm run test:watch`).
- Frontend: `cd frontend && npm run test:watch -- <pattern>` (Vitest).
- Do **not** run the backend E2E (`test:e2e`) or Playwright in the inner loop —
  they're reserved for the final gate.
- `npx jest`/`vitest` must run from inside the package dir (no root `package.json`).
  The `cd` persists across tool calls — re-`cd` into `backend`/`frontend` if a
  prior command changed it (a "Could not find a config file" error means you're
  at the repo root).

## Frontend test coverage (required for any UI work)

If the ticket adds or modifies a page, component, hook, or client-side helper, a
Vitest spec is **required in the same PR** — never deferred to a follow-up. Co-locate
in `__tests__/` (e.g. `src/components/__tests__/Foo.test.tsx`,
`src/lib/__tests__/foo.test.ts`). Mirror existing specs: `vi.mock` for `@/lib/api`,
`next/navigation`, `sonner`, `@/lib/auth-context`; `vi.stubGlobal('fetch', …)`;
`userEvent.setup()`; role-/label-based queries. The custom `localStorage` mock
lives in `vitest.setup.ts`.

Cover at minimum: rendering (loading / empty / not-found / happy path),
interactions (assert request shape + resulting UI change), auth/role branches in
both allowed and denied cases, and at least one `apiFetch` rejection per write
action asserting the toast.

For genuinely cross-cutting flows (multi-page, JWT/cookie/middleware, role-gated
routes) add a Playwright spec under `e2e/<feature>.spec.ts` — queued for the
final gate, not the inner loop. See `testing.md` for the component-vs-E2E split.

## Verification gate (run before committing — mirrors CI)

There is no `verify.sh`. Run per package; all must pass:

1. **Backend** — `cd backend && npm run lint && npm test && npm run build`
   (production `nest build` catches strict `tsc` errors the dev server tolerates —
   see `backend-patterns.md` on Mongoose filter casting; verify "Found 0 errors").
2. **Frontend** — `cd frontend && npm run lint && npm test && npm run build`.
3. **Backend E2E** — `cd backend && npm run test:e2e` (in-memory Mongo; no deps).
4. **Frontend E2E (Playwright)** — `docker compose up -d mongo`, then
   `cd frontend && npm run test:e2e`. Run only the spec(s) for this ticket.
   - **Stop the frontend dev server first.** Playwright's `webServer` runs
     `npm run dev` in the same `frontend/` dir on port 3100; Next 16's
     per-directory `.next/dev` lock conflicts with a dev server on 3000, and the
     webServer step times out after 120s. Use `/stop-dev`, run E2E, restart.
   - It boots a dedicated backend (`:3101`) + frontend (`:3100`) against the
     throwaway `subscriptions_e2e` DB and drops it on teardown — never touches dev data.
   - **Skip E2E** only when the ticket touches no user-visible behavior
     (backend-only internals with no API contract change, pure refactor, docs) —
     state explicitly that you're skipping and why.

CI (`.github/workflows/ci.yml`) runs backend + frontend lint/unit/build, and
`e2e.yml` runs Playwright — **both only on PRs to `master`** (see stacked-PR note).

## Commit / PR conventions

- Commit message: `VEG-NNN: <summary>`, ending with the
  `Co-Authored-By: Claude …` trailer.
- Stage only files relevant to the change (`git add <paths>`, never `git add -A`);
  respect `.gitignore`.
- PR title `VEG-NNN: <summary>`; body includes `Closes VEG-NNN` (per `CLAUDE.md`;
  `Fixes` also auto-links) so Linear links and transitions the issue.

## Review sizing policy

Classify before running any automated review. Measure against master
(`git diff --shortstat origin/master...HEAD` + changed-file list). Tests, docs,
and generated files don't count toward thresholds — size on production-code
impact. Risk triggers win over size; state the tier and the numbers so the user
can adjust before the review starts.

**Risk triggers** (always at least deep, regardless of diff size): auth / JWT /
cookies / refresh tokens / CSP / CORS / security headers; Mongoose schema, index,
or data-migration changes; RBAC and household-scoping (`RolesGuard`,
`HouseholdGuard`, user-/household-scoped queries); rate limiting (throttler);
money handling (integer-cents fields, per `budgeting.md`).

| Tier | When | Review |
|------|------|--------|
| **skip** | Docs/markdown-only, CI/config tweaks, dependency-pin bumps, or ≤30 changed lines across ≤3 files with no risk trigger and no behavior change | None — CI is the gate |
| **standard** | Anything between skip and deep: typical bug fixes, small UI tweaks, single-component changes | `code-review medium --comment`, max 1 re-review |
| **deep** | Risk trigger hit, OR full feature (new page, endpoint, or data model), OR ≥400 changed lines, OR ≥10 files | `/pr-review-toolkit:review-pr` + `code-review high --comment`, max 3 iterations |

Note: posting review comments to GitHub (`--comment` / `gh api …/comments`) may
be blocked by the permission classifier. If so, present the findings inline for
triage instead (the user can add a `gh api` Bash allow-rule to enable posting).

## Stacked PRs (dependent tickets)

When a ticket depends on another that isn't merged yet (e.g. VEG-387 needed
VEG-386's code), branch off the **dependency's branch**, not `master`, and open
the PR with that branch as its base.

- CI runs only on PRs to `master`, so a stacked PR gets **no CI** until its base
  is `master`. Run the full local gate; CI fires once it's retargeted.
- **Do not `--delete-branch` when merging the base PR if a stacked PR still
  targets it** — deleting the base branch closes the dependent PR, and a closed
  PR whose base no longer exists can't be reopened or retargeted. Recovery:
  recreate it as a new PR against `master` (its diff stays clean because the base
  commits are now in `master`). Prefer: merge the base PR *without* deleting its
  branch, let GitHub auto-retarget the child to `master`, then merge the child
  and clean up.

## Notes

- If a step fails, fix the root cause — never `--no-verify`, never delete tests.
- If the E2E gate can't run (dev servers won't start, Docker down), say so
  explicitly rather than claiming success.
- After merge: run `/cleanup`. Note `gh pr merge --delete-branch` already removes
  the local + remote branch, so `/cleanup` mainly syncs `master`.
