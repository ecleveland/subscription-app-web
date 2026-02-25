# Subscription Tracker

A full-stack web app for tracking and managing recurring subscriptions.

## Features

- Track subscriptions with cost, billing cycle (weekly/monthly/yearly), and next billing date
- Dashboard with daily, weekly, monthly, and yearly cost analytics
- Categorize subscriptions (Streaming, Software, Gaming, etc.)
- Toggle subscriptions active/inactive
- Sort by name, cost, or next billing date
- Dark mode / light mode
- User registration and JWT authentication
- User profile management with avatar and password change
- Admin panel for user management (role-based access)
- Fully responsive (mobile-first)
- Dockerized for one-command deployment

## Tech Stack

| Layer | Technology |
|----------|----------------------------------------------|
| Frontend | Next.js 16, React 19, Tailwind CSS v4, TypeScript |
| Backend | NestJS 11, Mongoose, Passport JWT, TypeScript |
| Database | MongoDB 7 |
| Testing | Jest 30 (backend), Vitest (frontend), Testing Library |
| CI/CD | GitHub Actions |

## Getting Started

### Prerequisites

- Node.js 22+
- Docker (for MongoDB, or full containerized setup)

### Quick Start (Docker)

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) and register a new account to get started.

### Local Development

1. **Start MongoDB:**

   ```bash
   docker compose up mongo -d
   ```

2. **Backend:**

   ```bash
   cd backend
   npm install
   cp ../.env.example .env   # JWT_SECRET is required — see Environment Variables below
   npm run start:dev          # runs on port 3001
   ```

3. **Frontend:**

   ```bash
   cd frontend
   npm install
   npm run dev             # runs on port 3000
   ```

4. **Or use the convenience script** (starts MongoDB, backend, and frontend together):

   ```bash
   ./dev.sh
   ```

## Environment Variables

Copy `.env.example` at the repo root and fill in the values.

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/subscriptions` |
| `JWT_SECRET` | **Required.** Secret key for signing JWTs | *(generate one)* |
| `JWT_EXPIRES_IN` | Token expiry duration | `24h` |
| `FRONTEND_URL` | Frontend origin for CORS | `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` | Backend API URL used by the frontend | `http://localhost:3001/api` |

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Users register via `POST /api/auth/register` or the registration page in the UI.

## API Overview

All routes are prefixed with `/api`. Subscription and admin routes require a JWT Bearer token.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | No | Login — returns `{ access_token }` |
| POST | `/api/auth/register` | No | Register a new user |
| GET | `/api/subscriptions` | Yes | List all (query: `category`, `sortBy`, `sortOrder`) |
| POST | `/api/subscriptions` | Yes | Create a subscription |
| GET | `/api/subscriptions/:id` | Yes | Get one subscription |
| PATCH | `/api/subscriptions/:id` | Yes | Update (partial) |
| DELETE | `/api/subscriptions/:id` | Yes | Delete (returns 204) |

## Project Structure

```
subscription-app-web/
├── backend/
│   └── src/
│       ├── admin/            # Admin module (user management)
│       ├── auth/             # Auth module (login, JWT, guards)
│       ├── config/           # App configuration
│       ├── subscriptions/    # Subscriptions CRUD module
│       └── users/            # Users module (profiles, registration)
├── frontend/
│   └── src/
│       ├── app/              # Next.js App Router pages
│       │   ├── admin/        # Admin panel
│       │   ├── login/        # Login page
│       │   ├── profile/      # User profile page
│       │   ├── register/     # Registration page
│       │   └── subscriptions/# Subscription management
│       ├── components/       # Shared React components
│       └── lib/              # API client, utilities
├── .github/workflows/        # CI pipeline
├── docker-compose.yml        # Docker orchestration
├── dev.sh                    # Local dev convenience script
└── .env.example              # Environment variable template
```

## Testing

**Backend:**

```bash
cd backend
npm test              # unit tests
npm run test:e2e      # end-to-end tests
npm run test:cov      # coverage report
```

**Frontend:**

```bash
cd frontend
npm test              # unit tests
npm run test:cov      # coverage report
```

CI runs lint and tests for both backend and frontend on every push and pull request via GitHub Actions.

## License

This project is currently unlicensed (private use).
