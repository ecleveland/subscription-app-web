# Users & Administration — Bugfixes

## Problem

After implementing a full multi-user authentication system (users, profiles, registration, admin panel, per-user subscription scoping), the app was making excessive repeated backend API calls when rendering pages, leading to failure. The issue manifested in `app.router.tsx` during page rendering.

## Root Cause

A **redirect loop** between the frontend's `apiFetch` 401 handler and the Next.js middleware:

1. `apiFetch` gets a 401 → removes JWT from `localStorage` → redirects to `/login`
2. But the `auth-flag` cookie (used by middleware) was **not cleared**
3. Middleware at `/login` sees the cookie → redirects back to `/`
4. Page loads, fires API call with no token → 401 again → infinite loop

Each cycle was a full page reload + API call, flooding the backend.

## Fixes Applied (3 files)

### 1. `frontend/src/lib/api.ts` — Clear cookie in 401 handler

The 401 handler now clears the `auth-flag` cookie and `user` from localStorage alongside the token, breaking the redirect loop.

### 2. `frontend/src/app/page.tsx` — Gate fetch behind authentication

The dashboard now checks `isAuthenticated` from `useAuth()` before fetching subscriptions, preventing unauthenticated API calls entirely.

### 3. `frontend/src/lib/auth-context.tsx` — Memoize context value

The context value is wrapped in `useMemo` to prevent unnecessary re-renders of all `useAuth()` consumers (Header, pages). Also cleaned up unused eslint-disable comments.

## Verification

- ESLint: passes with zero warnings/errors
- Next.js build: compiles and generates all pages successfully
