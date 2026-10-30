# Business labels: design

Date: 2026-10-30
Status: approved in conversation, awaiting written review

## Purpose

Mark any expense, recurring bill, subscription or goal as belonging to a
business, and see business money apart from personal money. Three uses drive
the design, in the order the user named them:

1. A year-end list of business expenses for taxes or an accountant.
2. Month-to-month business spend, watched the way personal budgets are.
3. Reimbursement tracking: which business expenses are still owed back.

Plus a business view in the app itself, not only an export.

## What the user said, and what is assumed

Said:

- One business today. Sub-businesses or further businesses are likely later,
  all rolling up to the household total.
- Personal is the default. It is the absence of a label, not a label.
- Bank accounts and cards are mixed today. Business and personal charges land
  on the same card. Separate accounts may come later but are not promised.
- Labeling has to be easy. That is the condition for moving forward.

Assumed:

- "Rolled up to the account" means the household sees the total across every
  business and each business can be viewed alone. It does not refer to a bank
  account.
- One household per user stays true for now. Businesses do not need their own
  members or currency.
- Budgets stay household-wide. Per-label budgets wait until the user has lived
  with the feature for a month.

## Approaches considered

**Chosen: a Label collection referenced by the things that cost money.**
Transactions, recurring templates and goals each carry an optional `labelId`.
Null means personal. Labeling stays per transaction, which is what a mixed
card needs, and the household still sees everything in one ledger. The
roll-up is a group-by on `labelId`.

**Rejected: a second household per business.** The architecture already
anticipates multi-household and it gives hard isolation for free. It fails on
the mixed card: a transaction belongs to one household, so one statement would
split across two ledgers and account balances would stop matching the bank.
Revisit only if a business ever needs separate members or a separate currency.

**Rejected: a reserved "business" tag.** Tags already exist on transactions
and recurring templates, so this is the cheapest option. It has no place for
reimbursement state, no budget, and no roll-up by business once there are two.

## Data model

### Label (new collection)

Household-scoped like every budgeting record. Guarded by `HouseholdGuard`.

| Field | Type | Notes |
|-------|------|-------|
| `householdId` | ObjectId, required, indexed | Resolved server-side, never from the client |
| `name` | string, required, trimmed | Unique per household, case-insensitive |
| `color` | string, required | A hex color for chips and chart series |
| `isArchived` | boolean, default false | Archived labels stay selectable in filters and exports, not in pickers |
| `parentId` | ObjectId, optional, ref Label | Unused by the UI for now. The business report rolls up over it from day one so sub-businesses need no migration |

### Changes to existing schemas

`Transaction`, `RecurringTransaction` and `Goal` each gain:

| Field | Type | Notes |
|-------|------|-------|
| `labelId` | ObjectId, optional, ref Label, indexed on Transaction | Null means personal |

`Transaction` also gains a `reimbursement` subdocument. Absent means the
expense is not reimbursable.

| Field | Type | Notes |
|-------|------|-------|
| `status` | `owed` or `reimbursed`, required | |
| `reimbursedAt` | Date | Required when status is `reimbursed`, otherwise absent |
| `reimbursedByTransactionId` | ObjectId, optional, ref Transaction | The income transaction that paid it back. Must be type income in the same household. Not required to match the amount |

`RecurringTransaction` never carries a reimbursement block. Reimbursable
recurring bills are marked on the generated transactions.

Transfers cannot carry a label. They are net-zero to the household and would
double-count on the business view.

### Materialization

Where recurring materialization copies `tags` onto a generated transaction
(`backend/src/recurring/recurring.service.ts`), it also copies `labelId`.
Changing a template's label affects future transactions only. Existing ones
are never rewritten.

## API

### New routes

`/api/labels`

- `GET` lists the household's labels. `includeArchived=true` adds archived ones.
- `POST` creates one. Rejects a duplicate name in the household with 409.
- `PATCH /:id` updates name, color, parentId or isArchived.
- `DELETE /:id` hard-deletes when nothing references the label. When any
  transaction, recurring template or goal does, it archives instead and
  returns `{ outcome: 'archived' }`. Same contract as category deletion.

`POST /api/transactions/bulk`

- Body: `{ ids: string[], patch: { labelId?: string | null, reimbursement?: { status: 'owed' } | null } }`.
- Only those two fields are patchable in bulk. Every id must belong to the
  household or the whole request fails with 404 and nothing changes.
- Mirrors the subscriptions bulk route.

`GET /api/reports/business`

- Query: `labelId` (a label id, or omitted for all labels), `from`, `to` as
  months, same range rules as the other reports via `MonthRangeQueryDto`.
- When `labelId` is given, the aggregation includes that label and every
  descendant through `parentId`.
- Response: per month `{ month, expenseCents, incomeCents }`; spend by
  category for the range; `{ owedCents, owedCount, reimbursedCents }` for the
  range; and the list of owed transactions (id, date, payee, amountCents,
  categoryId, labelId) for the reimbursements block.
- One call feeds the whole Business page.

`GET /api/transactions/export.csv`

- Same query parameters as the transaction list (account, category, type,
  label, date range), no pagination.
- Streams CSV with columns: date, payee, category, amount, label,
  reimbursement status, reimbursed date, notes, account. Amount is a decimal
  string in the household currency, expenses negative.
- Plain CSV, no formatting, because every accountant tool imports it.

### Changes to existing routes

- Transaction, recurring and goal create and update DTOs accept `labelId`.
  Transaction create and update also accept `reimbursement`.
- Transaction and recurring list routes accept a `labelId` filter. The special
  value `none` returns personal records only.
- The three existing reports (`cash-flow`, `spending`, `net-worth`) accept an
  optional `labelId` with the same `none` convention. Each aggregation adds one
  match stage.
- CSV import accepts a `labelId` column mapping and a default label applied to
  every imported row.

### Validation (service layer, not DTO alone)

- `labelId` must reference a label in the caller's household. Otherwise 400.
- A label on a transfer is rejected.
- `reimbursement` without `labelId` is rejected.
- Removing the label from a transaction that carries a reimbursement block is
  rejected with a message telling the user to clear the reimbursement first.
- `reimbursedByTransactionId` must be an income transaction in the same
  household.
- `reimbursedAt` is required when status is `reimbursed` and must be absent
  when status is `owed`.

## Reimbursement rules

- Only labeled expenses can be reimbursable.
- Status moves from `owed` to `reimbursed` with a date. Undo is allowed from
  the Business page ("Mark as owed again"), which clears the date and link.
  There is no partial state.
- Deleting a linked income transaction clears `reimbursedByTransactionId` on
  the expenses that point at it. They stay `reimbursed`. The money arrived;
  the pointer is bookkeeping.
- Business spend is reported gross. Reimbursements show beside it, never
  netted out silently. The Business page month chart has a toggle, "Net of
  reimbursements", for the other view.
- Household cash flow is untouched. The expense and the income are both
  already real transactions in the ledger.

## UI

### Label picker

One shared `LabelPicker` component. With a single label it renders as a
segmented control ("Personal | Business"). With two or more it is a dropdown.
Personal is always the first option and is rendered from the absence of a
label, never from a record. It offers "Add a label" inline so the first
business entry does not require leaving the form.

Placement: transaction form directly under category, recurring and
subscription forms in the same spot, goal form.

### Reimbursable toggle

In the transaction form only, visible when a label is chosen and type is
expense. A checkbox, "I'll be reimbursed for this". Saving sets status `owed`.
Marking reimbursed happens from the Business page.

### Transactions list

- A colored label chip per row, hidden when personal.
- A label filter beside account, category and type, with Personal and each
  label as options.
- Row selection and a bulk toolbar, following `SubscriptionList` and
  `BulkActionToolbar`. Toolbar actions: "Set label" dropdown and "Mark
  reimbursable". This is what makes a mixed card bearable: filter to one card,
  check the business rows for the month, one click.

### Recurring and subscriptions

Label picker in the form, chip on the card, and "Set label" in the existing
subscriptions bulk toolbar. Changing a template's label affects future
generated transactions only.

### CSV import

The import wizard gains a Label column mapping and a "label every imported row
as" default.

### Managing labels

A Labels section on the Categories page: name, color, archive. No new nav
item for management.

### Business page

Route `/business`, sidebar item "Business" under Money, shown only when the
household has at least one label. A label selector at the top: "All business"
plus one entry per label. Four blocks, all from `GET /api/reports/business`:

1. **This month.** Spend, income, net, and the change against last month, in
   the dashboard's stat tile style.
2. **Month to month.** Twelve-month bar chart of spend and income, reusing the
   cash flow chart component. Clicking a month opens the transactions list
   filtered to that label and month. Toggle: "Net of reimbursements".
3. **Spend by category.** The existing category breakdown chart,
   label-filtered.
4. **Reimbursements.** Owed items with amount, payee, date and age, a total
   outstanding, and "Mark reimbursed" per row and in bulk. Marking opens a
   dialog for the date and an optional search over recent household income to
   pick the paying transaction. Skipping the link is allowed.

"Export year" with a year picker calls the CSV endpoint with the label and the
year's date range.

### Reports page and dashboard

- The reports page gains a label filter beside the date range, defaulting to
  "Everything". Choosing Personal shows household numbers with business
  stripped out.
- The dashboard gains one tile, "Business this month", with spend and
  outstanding reimbursements, linking to `/business`. Shown only when labels
  exist.

## Out of scope

- Payee rules ("always label Adobe as Business"). Second ticket after the
  core ships, once manual plus bulk has been tried.
- "Label like last time for this payee" suggestions in the form.
- Per-label budgets.
- Partial reimbursement.
- Account-level default label. A one-field addition if a business card
  arrives.
- Sub-business UI. `parentId` exists in the schema and the report so this
  needs no migration later.

## Testing

Per `.claude/architecture/testing.md`: every new unit gets a spec, every new
route is covered by backend e2e.

**Backend unit**

- Label service: archive versus delete decision, duplicate name rejection.
- Household ownership check for `labelId` on transactions, recurring
  templates and goals.
- Every validation and reimbursement rule listed above.
- Recurring materialization copies `labelId`.
- Business report aggregation on a fixed fixture with known totals, including
  the `none` filter and the roll-up over `parentId`.
- Deleting a linked income transaction clears the pointer and keeps the status.

**Backend e2e**

- Label CRUD including the archived outcome.
- Transaction create and bulk patch with labels.
- Reports with label filters, including `none`.
- CSV export body for a known fixture.
- Cross-household rejection: a label from household A on a transaction in
  household B returns 400.

**Frontend unit**

- `LabelPicker` in segmented and dropdown modes, including "Add a label".
- Reimbursable toggle visibility rules.
- Transactions bulk toolbar actions.
- Business page rendering from a fixture response, including the net toggle.
- CSV import mapping with a label default.

**Playwright**

One flow: create a label, add two expenses, label one, mark it reimbursable,
open the Business page, see one owed item and the right monthly spend, mark it
reimbursed, confirm the outstanding total is zero, export the year.

## Delivery order

Each step is one Linear ticket run through `/start-ticket`. Later steps are
blocked by the earlier ones they depend on.

1. Label collection and routes, `labelId` on the three schemas,
   materialization, list filters.
2. Label picker, chips, list filter, Labels section on the Categories page.
3. Transaction row selection, bulk endpoint and toolbar, CSV import mapping.
4. Reimbursement block, rules and form toggle.
5. Business report endpoint, Business page, dashboard tile, reports filter.
6. CSV export.
