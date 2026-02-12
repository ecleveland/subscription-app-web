# Dark Mode Theme + Toggle

**Date**: 2026-02-11
**Commit**: `2df6393` on `master`

## What changed

Added a proper dark mode theme with a manual light/dark/system toggle, replacing the broken dark mode that showed white components on a near-black background.

### Theme Toggle System (2 new files)
- **`frontend/src/lib/theme-context.tsx`** — ThemeProvider context managing `light | dark | system` state, persisted to localStorage, applies `.dark` class to `<html>`, listens for OS preference changes when set to `system`
- **`frontend/src/components/ThemeToggle.tsx`** — Button with sun/moon/monitor icons that cycles light → dark → system

### Infrastructure changes
- **`globals.css`** — Switched from `@media (prefers-color-scheme: dark)` to class-based `@custom-variant dark (&:where(.dark, .dark *))` so the toggle controls the theme. Softened dark background from `#0a0a0a` to `#111827` (gray-900)
- **`layout.tsx`** — Wrapped app in ThemeProvider, added inline `<script>` to apply `.dark` class before React hydrates (prevents flash of wrong theme), added `suppressHydrationWarning` to `<html>`

### Dark mode classes added to 11 existing files
- Components: Header, DashboardSummary, SubscriptionCard, CategoryBadge, SubscriptionForm, LoginForm, EmptyState
- Pages: dashboard, login, new subscription, edit subscription

## Dark mode palette

| Role | Light | Dark |
|------|-------|------|
| Page background | `bg-gray-50` | `dark:bg-gray-900` |
| Card/surface | `bg-white` | `dark:bg-gray-800` |
| Primary text | `text-gray-900` | `dark:text-gray-100` |
| Secondary text | `text-gray-700` | `dark:text-gray-300` |
| Muted text | `text-gray-500` | `dark:text-gray-400` |
| Card border | `border-gray-200` | `dark:border-gray-700` |
| Input border | `border-gray-300` | `dark:border-gray-600` |
| Input background | `bg-white` | `dark:bg-gray-700` |
| Category badges | `bg-{color}-100 text-{color}-700` | `dark:bg-{color}-900/30 dark:text-{color}-300` |

Blue buttons and red error text are unchanged — sufficient contrast in both modes.

## Key decisions
- **Class-based dark mode** over `prefers-color-scheme` — enables manual toggle while still supporting system preference as default
- **Three-state toggle** (light/dark/system) — respects user choice while allowing OS-level default
- **No new dependencies** — icons are inline SVGs, state management uses React context
- **Flash prevention** — inline script in `<head>` reads localStorage before paint
- **SubscriptionForm** extracted repeated input/label classes into shared `inputClasses`/`labelClasses` variables to reduce duplication
