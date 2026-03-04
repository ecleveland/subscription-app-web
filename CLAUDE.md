# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Monorepo with two services:
- **`/frontend`** — Next.js 16 (App Router, TypeScript, Tailwind CSS v4) — UI for managing subscriptions
- **`/backend`** — NestJS 11 (TypeScript, Mongoose, Passport JWT) — REST API at `/api`
- **MongoDB** — database, runs as a Docker container

Auth is handled entirely by the NestJS backend. It supports multi-user registration and login with role-based access control (`user` and `admin` roles). Users are stored in MongoDB via the `User` schema. JWTs are issued on login/register and include `sub`, `username`, and `role` claims. The frontend stores the token in localStorage and sends it as a Bearer header on all API requests.

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
npm test               # Vitest unit tests
npm run test:watch     # Vitest in watch mode
npm run test:cov       # Vitest with coverage
```

### Docker (from repo root)
```bash
docker compose up --build      # Start all 3 containers (frontend, backend, mongo)
docker compose down            # Stop all containers
docker compose down -v         # Stop and remove volumes (deletes data)
```

## API Routes

All backend routes are prefixed with `/api`. Auth routes are public; subscription and user routes require a JWT Bearer token; admin routes require the `admin` role.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | No | `{ username, password }` → `{ access_token }` |
| POST | `/api/auth/register` | No | `{ username, password, displayName?, email? }` → `{ access_token }` |
| GET | `/api/users/me` | Yes | Get current user profile |
| PATCH | `/api/users/me` | Yes | Update current user profile |
| POST | `/api/users/me/change-password` | Yes | Change password (returns 204) |
| GET | `/api/subscriptions` | Yes | List user's subscriptions (query: `category`, `sortBy`, `sortOrder`) |
| POST | `/api/subscriptions` | Yes | Create subscription for current user |
| GET | `/api/subscriptions/:id` | Yes | Get one (user-scoped) |
| PATCH | `/api/subscriptions/:id` | Yes | Update (partial, user-scoped) |
| DELETE | `/api/subscriptions/:id` | Yes | Delete (returns 204, user-scoped) |
| GET | `/api/admin/users` | Admin | List all users |
| POST | `/api/admin/users` | Admin | Create a user |
| GET | `/api/admin/users/:id` | Admin | Get a user |
| PATCH | `/api/admin/users/:id` | Admin | Update a user (role, etc.) |
| DELETE | `/api/admin/users/:id` | Admin | Delete a user (returns 204) |

## Key Patterns

- **NestJS modules**: each feature (auth, users, subscriptions, admin) is a self-contained module with controller → service → schema/DTO structure
- **DTOs use class-validator** decorators; global `ValidationPipe` with `whitelist: true` strips unknown fields
- **`UpdateSubscriptionDto`** extends `PartialType(CreateSubscriptionDto)` — all fields optional, validation preserved
- **`JwtAuthGuard`** applied at controller class level on `SubscriptionsController`, `UsersController`, and `AdminController`
- **Role-based access control**: `RolesGuard` + `@Roles()` decorator restrict admin routes to users with `UserRole.ADMIN`
- **Subscriptions are user-scoped**: all subscription operations filter by `req.user.userId`
- **Frontend uses client components** for all interactive pages (forms, dashboard) with `apiFetch` wrapper from `src/lib/api.ts`
- **Middleware** uses a lightweight `auth-flag` cookie to redirect unauthenticated users to `/login` or `/register` (the actual JWT lives in localStorage)
- **Tailwind v4** uses CSS-first config (`@import "tailwindcss"` in globals.css), not `tailwind.config.js`

## Architecture Documents

Project architecture decisions and development requirements are documented in `.claude/architecture/`. These documents are **mandatory** — all plans and implementations must follow them. In particular:
- **`testing.md`** — Every plan must include a testing step. All new code requires tests per the rules in this file. Run the relevant test suite before considering work complete.
- **`backend-patterns.md`** — Mongoose filter type casting rules and `tsc` vs `ts-jest` compatibility notes.

## Linear Workflow

This project tracks work in Linear (workspace: **Vega Apps**, project: **Subscription App**).

### Starting a ticket

When the user asks to start or work on a Linear ticket (e.g., "let's start VEG-50"):

1. **Fetch the issue** — Use Linear MCP tools to read the issue details (title, description, acceptance criteria)
2. **Create a feature branch** — `git checkout -b veg-{number}-{slug}` from `master` (e.g., `veg-50-add-dark-mode-toggle`)
3. **Enter plan mode** — Explore the codebase, design the implementation, and get user approval before writing code
4. **Implement** — Write code and tests per the architecture docs in `.claude/architecture/`
5. **Verify** — Run the relevant test suites and linter before considering work complete
6. **Commit** — Stage changes and commit with the issue identifier prefix: `VEG-{number}: {description}`
7. **Push & create PR** — Push the branch and create a PR via `gh pr create` with:
   - Title prefixed with the issue identifier (e.g., `VEG-50: Add dark mode toggle`)
   - Body containing `Closes VEG-{number}` to auto-transition the issue to **Done** when the PR merges
8. **Update Linear status** — Set the issue to **In Progress** using Linear MCP tools. The issue will auto-transition to **Done** when the PR merges (via the `Closes` keyword — no manual update needed at that point).

## Environment Variables

Backend (`.env` in `/backend`):
- `MONGODB_URI`, `JWT_SECRET` (required), `JWT_EXPIRES_IN`, `FRONTEND_URL` (CORS)

Frontend (`.env.local` in `/frontend`):
- `NEXT_PUBLIC_API_URL` — backend URL (default: `http://localhost:3001/api`)

To create an initial user, register via `POST /api/auth/register` or the registration page. Admins can then be promoted via the admin panel or database.
