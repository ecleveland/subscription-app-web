# Active/Inactive Subscription Status

**Date**: 2026-02-13
**Commit**: `a4b852e` on `master`

## What changed

Added an `isActive` boolean field to subscriptions so users can mark them as active or inactive. Dashboard cost totals (monthly/yearly) now only include active subscriptions.

### Backend (2 modified files)
- **`backend/src/subscriptions/schemas/subscription.schema.ts`** — Added `isActive` boolean field with `default: true` to Mongoose schema (no migration needed)
- **`backend/src/subscriptions/dto/create-subscription.dto.ts`** — Added `@IsBoolean() @IsOptional() isActive?: boolean` field; `UpdateSubscriptionDto` inherits via `PartialType` automatically

### Frontend components (4 modified files)
- **`frontend/src/components/SubscriptionCard.tsx`** — Added toggle switch with optimistic PATCH updates; inactive cards show reduced opacity and "Inactive" badge; converted to client component
- **`frontend/src/components/DashboardSummary.tsx`** — Filters to active subscriptions before computing monthly/yearly totals and active count
- **`frontend/src/components/SubscriptionForm.tsx`** — Added `isActive` state and "Active subscription" checkbox; included in request body
- **`frontend/src/components/SubscriptionList.tsx`** — Passes `onToggleActive` callback through to each card

### Frontend wiring (2 modified files)
- **`frontend/src/app/page.tsx`** — Added `handleToggleActive` handler to update subscriptions state on toggle, triggering immediate dashboard recalculation
- **`frontend/src/lib/types.ts`** — Added `isActive: boolean` to `Subscription` interface

## Key decisions
- **Schema default `true` instead of migration** — Existing documents without `isActive` get `true` at the Mongoose layer, avoiding any database migration
- **Client-side filtering for cost totals** — API still returns all subscriptions; filtering happens in `DashboardSummary` for simplicity
- **Optimistic toggle on cards** — Toggle updates UI immediately and reverts on API failure, avoiding perceived latency
- **`isActive !== false` guard** — Treats `undefined` (legacy docs) as active for backward compatibility
