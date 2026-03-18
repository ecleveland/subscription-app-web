# Subscription Tracker

A full-stack web app for tracking and managing recurring subscriptions.

## Features

- Track subscriptions with cost, billing cycle (weekly/monthly/yearly), and next billing date
- Dashboard with daily, weekly, monthly, and yearly cost analytics
- Calendar view for upcoming billing dates
- Categorize subscriptions (Streaming, Software, Gaming, etc.)
- Custom tags for flexible organization
- Trial tracking with end-date countdown and badges
- Toggle subscriptions active/inactive
- Sort by name, cost, or next billing date
- Export subscriptions as CSV
- Bulk operations (activate, deactivate, delete)
- In-app notification system
- Dark mode / light mode
- User registration and JWT authentication with refresh tokens
- Password reset via email (forgot password flow)
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
| POST | `/api/auth/login` | No | Login — returns access and refresh tokens |
| POST | `/api/auth/register` | No | Register a new user |
| POST | `/api/auth/refresh` | No | Refresh access token |
| POST | `/api/auth/logout` | Yes | Revoke refresh token (returns 204) |
| POST | `/api/auth/forgot-password` | No | Request a password reset email |
| POST | `/api/auth/reset-password` | No | Reset password with token |
| GET | `/api/users/me` | Yes | Get current user profile |
| PATCH | `/api/users/me` | Yes | Update current user profile |
| POST | `/api/users/me/change-password` | Yes | Change password (returns 204) |
| GET | `/api/subscriptions` | Yes | List all (query: `category`, `sortBy`, `sortOrder`) |
| POST | `/api/subscriptions` | Yes | Create a subscription |
| GET | `/api/subscriptions/export` | Yes | Export subscriptions as CSV |
| POST | `/api/subscriptions/bulk` | Yes | Bulk operations (activate, deactivate, delete) |
| GET | `/api/subscriptions/:id` | Yes | Get one subscription |
| PATCH | `/api/subscriptions/:id` | Yes | Update (partial) |
| DELETE | `/api/subscriptions/:id` | Yes | Delete (returns 204) |
| GET | `/api/notifications` | Yes | List notifications |
| GET | `/api/notifications/unread-count` | Yes | Get unread notification count |
| PATCH | `/api/notifications/:id/read` | Yes | Mark notification as read |
| POST | `/api/notifications/mark-all-read` | Yes | Mark all as read (returns 204) |
| DELETE | `/api/notifications/:id` | Yes | Delete a notification (returns 204) |
| GET | `/api/admin/users` | Admin | List all users |
| POST | `/api/admin/users` | Admin | Create a user |
| GET | `/api/admin/users/:id` | Admin | Get a user |
| PATCH | `/api/admin/users/:id` | Admin | Update a user (role, etc.) |
| DELETE | `/api/admin/users/:id` | Admin | Delete a user (returns 204) |

## Project Structure

```
subscription-app-web/
├── backend/
│   └── src/
│       ├── admin/            # Admin module (user management)
│       ├── auth/             # Auth module (login, JWT, guards, password reset)
│       ├── config/           # App configuration
│       ├── health/           # Health check endpoint
│       ├── mail/             # Email service (password reset emails)
│       ├── notifications/    # Notifications module
│       ├── subscriptions/    # Subscriptions CRUD module
│       └── users/            # Users module (profiles, registration)
├── frontend/
│   └── src/
│       ├── app/              # Next.js App Router pages
│       │   ├── admin/        # Admin panel
│       │   ├── analytics/    # Cost analytics dashboard
│       │   ├── calendar/     # Billing calendar view
│       │   ├── forgot-password/ # Forgot password page
│       │   ├── login/        # Login page
│       │   ├── profile/      # User profile page
│       │   ├── register/     # Registration page
│       │   ├── reset-password/  # Reset password page
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
