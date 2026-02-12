# Initial Project Setup Summary

**Date**: 2026-02-11

## What was built

A subscription tracking web app as a monorepo with three Dockerized services.

### Backend (`/backend`) — NestJS 11 REST API
- JWT-based single-user auth (password as bcrypt hash in env vars)
- Full CRUD API for subscriptions at `/api/subscriptions`
- Mongoose schemas with class-validator DTOs
- Global validation pipe, CORS, `/api` prefix

### Frontend (`/frontend`) — Next.js 16 with Tailwind CSS v4
- Login page, dashboard with cost summaries (monthly/yearly/count), add/edit/delete subscription pages
- Auth context with localStorage token + cookie flag for middleware route protection
- `apiFetch` wrapper that attaches Bearer tokens and handles 401 redirects

### Docker — `docker-compose.yml` at repo root
- 3 containers: `frontend` (:3000), `backend` (:3001), `mongo` (:27017)
- Multi-stage Alpine builds for both services
- Persistent MongoDB volume

## Key files
- `backend/src/auth/` — auth module (JWT strategy, guard, credentials provider)
- `backend/src/subscriptions/` — CRUD module (schema, DTOs, service, controller)
- `frontend/src/lib/api.ts` — API fetch wrapper
- `frontend/src/lib/auth-context.tsx` — auth state management
- `frontend/src/components/SubscriptionForm.tsx` — reusable add/edit form
- `docker-compose.yml` — orchestrates all services
- `.env` (gitignored) — secrets; `.env.example` — template

## Decisions made
- **Database**: MongoDB with Mongoose (chosen by user)
- **Styling**: Tailwind CSS v4 with CSS-first config (chosen by user)
- **Auth**: NestJS backend owns auth, issues JWTs; single-user with env var credentials (chosen by user)
- **Repo structure**: Monorepo with `/frontend` and `/backend` directories (chosen by user)
- **Docker images**: `node:22-alpine` and `mongo:7` — all ARM-native, no Rosetta needed

## Current state
- Initial commit `80c15fb` on `master`
- Pushed to https://github.com/ecleveland/subscription-app-web (private)
- Default login: `admin` / `password`
- Plan file preserved at `~/.claude/plans/cosmic-sleeping-meadow.md`
