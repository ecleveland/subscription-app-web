# Railway Deployment Setup

Guide for deploying the subscription-app monorepo (Next.js frontend + NestJS backend) to Railway.

## Prerequisites

- Railway account
- GitHub repo with `RAILWAY_TOKEN` secret
- External MongoDB instance (connection string ready)

---

## Step 1: Create Railway Project & Services

1. Go to [railway.app/dashboard](https://railway.app/dashboard) → **New Project → Empty Project**
2. Name it `subscription-app`
3. Add two services:
   - **New → Empty Service** → name it **`backend`**
   - **New → Empty Service** → name it **`frontend`**

> Service names must match the `--service` flags in `.github/workflows/deploy.yml`.

---

## Step 2: Generate Public Domains

For each service:
1. Click the service → **Settings → Networking → Generate Domain**
2. Note the `*.up.railway.app` URLs — you'll need them for environment variables

---

## Step 3: Configure Environment Variables

### Backend service

| Variable | Value |
|----------|-------|
| `PORT` | `3001` |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Your MongoDB connection string (see [MongoDB / Atlas security](#mongodb--atlas-security)) |
| `JWT_SECRET` | A strong random secret (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | `24h` |
| `FRONTEND_URL` | Frontend's Railway URL (e.g., `https://frontend-xxx.up.railway.app`) |
| `MAIL_DRIVER` | `smtp` (defaults to `smtp` when `NODE_ENV=production`; the console stub is refused in prod) |
| `SMTP_HOST` | SMTP relay host (e.g., `smtp.sendgrid.net`) |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (set `SMTP_SECURE=true`) |
| `SMTP_SECURE` | `true` only for implicit TLS on port 465 |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials (use a provider API key, store as Railway secrets) |
| `MAIL_FROM` | From address, e.g. `Subscription App <no-reply@yourdomain.com>` |

> **Email is required in production.** Password reset and household invitations
> send real email. With `NODE_ENV=production` the app boots with the SMTP driver
> and **fails fast at startup** — it verifies the SMTP connection on boot, so a
> missing `SMTP_HOST` or an unreachable/misauthenticated relay halts the deploy
> rather than booting and silently dropping every email. It will not fall back to
> the console stub (which would log reset tokens and send nothing).

### Frontend service

| Variable | Value |
|----------|-------|
| `PORT` | `3000` |
| `NEXT_PUBLIC_API_URL` | Backend's Railway URL + `/api` (e.g., `https://backend-xxx.up.railway.app/api`) |

---

## MongoDB / Atlas security

The backend connects to an external MongoDB (MongoDB Atlas recommended). Harden
network access rather than opening the database to the world:

- **Never use `0.0.0.0/0` in the Atlas IP access list.** It exposes the database
  to the entire internet, relying on credentials alone. Prefer one of:
  - **Private networking / VPC peering** between Railway and Atlas so the
    database has no public ingress, or
  - an **allow-list of Railway's egress IPs** if private networking isn't
    available on your tier.
- **Always require authentication.** Use a dedicated database user scoped to this
  app's database (not an Atlas project owner), and put the credentials in the
  `MONGODB_URI` (`mongodb+srv://user:pass@cluster/db?...`). Store the URI as a
  Railway secret — never commit it.
- **Enable TLS** (Atlas `mongodb+srv://` URIs use TLS by default — keep it).
- **Turn on automated backups** (Atlas continuous/cloud backups) and verify the
  restore path; this app has no other copy of household financial data.

> The local dev database (`docker-compose.yml`) binds Mongo to `127.0.0.1` so it
> isn't reachable off-host. That is a dev convenience, not a production posture —
> production must use an authenticated, network-restricted Atlas cluster as above.

---

## Step 4: Generate a Deploy Token

1. Railway dashboard → your project → **Settings → Tokens**
2. Click **Create Token** and copy it

---

## Step 5: Add the Token to GitHub

1. GitHub repo → **Settings → Secrets and variables → Actions**
2. **New repository secret**: Name = `RAILWAY_TOKEN`, Value = the token from Step 4
3. Also create a **`production`** environment (Settings → Environments → New environment) and add the secret there, since the deploy workflow uses `environment: production`

---

## Step 6: Deploy

1. Push a commit to `master` (or merge a PR)
2. Watch the **Deploy** workflow in GitHub Actions
3. Check Railway dashboard for build logs

---

## Verification

- `https://<backend-domain>/api` — should return a response
- `https://<frontend-domain>` — should load the app
- Test login/registration to verify backend connectivity and MongoDB connection

---

## Related Files

| File | Purpose |
|------|---------|
| `backend/railway.toml` | Backend build + deploy config (healthcheck on `/api/health`) |
| `frontend/railway.toml` | Frontend build + deploy config (healthcheck on `/login`) |
| `.github/workflows/deploy.yml` | GitHub Actions workflow that deploys both services |
