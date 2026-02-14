# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Monorepo with two services:
- **`/frontend`** — Next.js 16 (App Router, TypeScript, Tailwind CSS v4) — UI for managing subscriptions
- **`/backend`** — NestJS 11 (TypeScript, Mongoose, Passport JWT) — REST API at `/api`
- **MongoDB** — database, runs as a Docker container

Auth is handled entirely by the NestJS backend. It issues JWTs on `POST /api/auth/login` (single-user, credentials stored as env vars). The frontend stores the token in localStorage and sends it as a Bearer header on all API requests.

## Commands

### Backend (`/backend`)
```bash
npm run start:dev      # Dev server with watch mode (port 3001)
npm run build          # Compile TypeScript to /dist
npm run start:prod     # Run compiled JS
npm run lint           # ESLint with auto-fix
npm test               # Jest unit tests
npm run test:watch     # Jest in watch mode
npm run test:e2e       # End-to-end tests
```

### Frontend (`/frontend`)
```bash
npm run dev            # Next.js dev server (port 3000)
npm run build          # Production build (standalone output)
npm run lint           # ESLint
```

### Docker (from repo root)
```bash
docker compose up --build      # Start all 3 containers (frontend, backend, mongo)
docker compose down            # Stop all containers
docker compose down -v         # Stop and remove volumes (deletes data)
```

## API Routes

All backend routes are prefixed with `/api`. Subscription routes require a JWT Bearer token.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | No | `{ username, password }` → `{ access_token }` |
| GET | `/api/subscriptions` | Yes | List all (query: `category`, `sortBy`, `sortOrder`) |
| POST | `/api/subscriptions` | Yes | Create |
| GET | `/api/subscriptions/:id` | Yes | Get one |
| PATCH | `/api/subscriptions/:id` | Yes | Update (partial) |
| DELETE | `/api/subscriptions/:id` | Yes | Delete (returns 204) |

## Key Patterns

- **NestJS modules**: each feature (auth, subscriptions) is a self-contained module with controller → service → schema/DTO structure
- **DTOs use class-validator** decorators; global `ValidationPipe` with `whitelist: true` strips unknown fields
- **`UpdateSubscriptionDto`** extends `PartialType(CreateSubscriptionDto)` — all fields optional, validation preserved
- **`JwtAuthGuard`** applied at controller class level on `SubscriptionsController` — all subscription routes are protected
- **Frontend uses client components** for all interactive pages (forms, dashboard) with `apiFetch` wrapper from `src/lib/api.ts`
- **Middleware** uses a lightweight `auth-flag` cookie to redirect unauthenticated users to `/login` (the actual JWT lives in localStorage)
- **Tailwind v4** uses CSS-first config (`@import "tailwindcss"` in globals.css), not `tailwind.config.js`

## Architecture Documents

Project architecture decisions and development requirements are documented in `.claude/architecture/`:
- **`testing.md`** — Test coverage requirements and conventions for new code

## Environment Variables

Backend (`.env` in `/backend`):
- `MONGODB_URI`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` (bcrypt), `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL` (CORS)

Frontend (`.env.local` in `/frontend`):
- `NEXT_PUBLIC_API_URL` — backend URL (default: `http://localhost:3001/api`)

Dev password is `password` (hash in `/backend/.env`). Generate a new hash: `node -e "require('bcryptjs').hash('yourpassword',10).then(console.log)"`
