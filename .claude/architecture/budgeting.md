# Budgeting Platform Architecture

This document defines the architecture for expanding the app from single-user
subscription tracking into comprehensive **family budgeting software** (in the
spirit of EveryDollar / YNAB / the former Mint). It is **mandatory**: all plans
and implementations for budgeting features must follow the rules and data model
below.

The guiding principle: **a subscription is just one kind of recurring expense.**
We are generalizing the existing app, not replacing it. Existing subscription
functionality must keep working through every phase.

---

## Product decisions (locked)

These were decided up front and constrain the design:

- **Budgeting methodology: hybrid.** Phase 3 ships *category spending limits*
  (set a monthly limit per category, track actual vs. limit). The schema is
  designed so *zero-based / envelope* budgeting ("give every dollar a job")
  can layer on later **without a migration** — see [Budget model](#budget).
- **Data entry: manual + CSV import.** No bank-sync/aggregator (Plaid) in the
  core roadmap. Manual entry first, CSV/OFX import as a Phase 2 ticket. Bank
  sync is an explicitly optional, later phase if ever.
- **Family scope: shared household data.** All adult members of a household see
  and edit the same shared accounts, transactions, and budget. The `role` field
  exists on membership from day one, but enforcement starts simple
  (owner vs. member). Richer per-member permissions (teen/viewer, per-category
  visibility, allowances) are deferred.

---

## Money handling (non-negotiable)

**All monetary values are stored as integer minor units (cents), never floats.**

- Schema fields: `amountCents: number` (integer), not `amount: number`.
- Currency is per-household (`Household.currency`, default `"USD"`); no
  multi-currency math within a household in the initial design.
- Convert to/from display strings only at the UI boundary.
- Sums, budget-vs-actual, and balances are all integer arithmetic.

Rationale: floating-point rounding errors are a classic, hard-to-debug budgeting
bug. Integers eliminate the entire class.

---

## The keystone: household-scoped data

Today every record is scoped to a single `userId`. Family budgeting requires a
**shared dataset** owned by a household that multiple users can read and write.
This is the foundational change and **must land first (Phase 1)** — retrofitting
it later would mean re-migrating every collection.

### Ownership model

```
Household       { name, ownerId (User), currency: "USD" }
HouseholdMember { householdId, userId, role: owner | adult | teen | viewer,
                  status: active | invited, joinedAt }
Invitation      { householdId, email, tokenHash, role, status, expiresAt }
```

### Scoping rules

- **All budgeting data is scoped by `householdId`, not `userId`.** This includes
  accounts, categories, transactions, budgets, goals, and (after Phase 1)
  subscriptions.
- **Attribution is preserved via `memberId`** on transactions ("who spent it"),
  but visibility/ownership is the household.
- A new **`HouseholdGuard`** resolves the caller's active household and asserts
  membership, analogous to the existing user-scoping pattern. Services filter by
  `householdId` the way they currently filter by `userId`.
- The existing global `UserRole.ADMIN` / `UserRole.USER` continues to govern
  **app administration** (the `/admin` module) and is unrelated to household
  roles, which govern **within-household permissions**.

### Active household resolution

A user may eventually belong to multiple households. For now each user has
exactly one (their own). Resolve the active household server-side from
membership; do not trust a client-supplied `householdId` without verifying
membership in `HouseholdGuard`.

---

## Data model

New collections (Mongoose schemas), all with `timestamps: true` and a
`householdId` index:

### Account
```
Account { householdId, name,
          type: checking | savings | credit | cash | investment | loan,
          balanceCents, isArchived }
```
Balances are derived from transactions but cached on the account for fast reads;
recompute on transaction write. Credit/loan accounts carry negative balances.

### Category
```
CategoryGroup { householdId, name, sortOrder }
Category      { householdId, groupId, name, isIncome, sortOrder, isArchived }
```
Replaces the hardcoded `CATEGORIES` array in `frontend/src/lib/types.ts`. Seed a
sensible default set per household at creation. `isIncome` distinguishes income
categories (paychecks) from expense categories.

### Transaction
```
Transaction { householdId, accountId, categoryId, memberId,
              type: income | expense | transfer,
              amountCents, date, payee, notes, tags[],
              cleared, recurringId? (ref), transferAccountId? }
```
- The atomic ledger unit. One-off **and** the materialized output of recurring
  schedules.
- `type: transfer` links two accounts via `transferAccountId` (no category, net
  zero to the budget).
- `recurringId` links transactions auto-generated by a recurring schedule.

### RecurringTransaction (generalizes Subscription)
```
RecurringTransaction { householdId, accountId, categoryId,
                       type, amountCents, payee, notes, tags[],
                       cadence: weekly | monthly | yearly,
                       nextDate, reminderDaysBefore, endDate?,
                       isSubscription, sharedWith? }
```
- `Subscription` becomes a **specialized recurring transaction** with
  `isSubscription: true`. The "Subscriptions" page is a filtered view, not a
  separate silo.
- The existing date-advancement cron generalizes into a **scheduler** that
  advances `nextDate` and materializes a `Transaction` when due.
- Reminder notifications reuse the existing `notifications` module.

### Budget
```
Budget         { householdId, month: "YYYY-MM" }
BudgetCategory { budgetId, categoryId, plannedCents }
```
- One `Budget` per household per month; `BudgetCategory` holds the planned
  allocation per category. **Actual** is computed from transactions in that
  month — never stored.
- **Hybrid design:** `plannedCents` *is* the category limit for the
  category-limits model. To enable zero-based budgeting later, add a derived
  "to be budgeted" = (month income) − Σ(plannedCents) computed on read, plus an
  optional `rolloverCents` field on `BudgetCategory` for envelope carry-over.
  **No schema migration is required to turn this on** — it is additive.

### Goal
```
Goal { householdId, name, targetCents, currentCents, targetDate?, categoryId? }
```
Savings / debt-payoff / sinking-fund tracking. Phase 5.

---

## Migration strategy (Phase 1)

A one-time, idempotent migration script (runnable on startup or via an admin
command), fully covered by tests:

1. For each existing `User`, create a personal `Household` (`ownerId = user._id`,
   `name` = e.g. `"<displayName>'s Household"`, `currency: "USD"`).
2. Create an `active` `HouseholdMember` with `role: owner`.
3. Stamp every existing `Subscription` (and `Notification`) with the new
   `householdId`.
4. Seed default `CategoryGroup`/`Category` records per household.

The migration must be **idempotent** (safe to re-run) and **reversible in test**
(E2E suites build households fresh, so this only runs against existing data).

---

## Phased roadmap

Each phase is a shippable Linear **epic**. Earlier phases must not break later
ones; subscriptions keep working throughout.

| Phase | Epic | Delivers |
|-------|------|----------|
| **1** | Households & membership | Household/member/invitation entities, `HouseholdGuard`, household-scoped subscriptions, data migration. Foundation — no new end-user budgeting yet. |
| **2** | Accounts & transaction ledger | Accounts, manual income/expense/transfer entry, balances, categorization, **CSV import**. |
| **3** | Categories & budgeting | Per-household categories, monthly limits, budget-vs-actual (hybrid model). |
| **4** | Recurring & bills unification | Fold subscriptions into recurring transactions, scheduled income (paychecks), auto-generation, bill reminders. |
| **5** | Reports & goals | Cash flow, net worth over time, spending trends, savings/debt goals. |
| **6** | Optional power features | OFX import, bank sync (Plaid), PWA/mobile. Only if desired. |

---

## Engineering rules

- **Follow existing patterns.** New modules mirror the auth/users/subscriptions
  structure: module → controller → service → schema/DTO. DTOs use
  `class-validator`; the global `ValidationPipe` with `whitelist: true` stays.
- **Mongoose filter casting** applies to all new queries — see
  [`backend-patterns.md`](./backend-patterns.md). Verify the dev server compiles
  cleanly (`Found 0 errors`).
- **Testing is mandatory** per [`testing.md`](./testing.md): unit tests for every
  service method, E2E tests for every new endpoint, Vitest for new components,
  Playwright for new flows. Household-scoping needs explicit
  cross-household-isolation tests (member of household A must never read/write
  household B's data).
- **Money is always cents.** Lint/review should reject `amount` float fields in
  new money schemas.
- **Subscriptions must not regress.** Existing subscription E2E and unit suites
  must stay green through every phase.
