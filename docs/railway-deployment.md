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
| `MONGODB_URI` | Your MongoDB connection string |
| `JWT_SECRET` | A strong random secret (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | `24h` |
| `FRONTEND_URL` | Frontend's Railway URL (e.g., `https://frontend-xxx.up.railway.app`) |

### Frontend service

| Variable | Value |
|----------|-------|
| `PORT` | `3000` |
| `NEXT_PUBLIC_API_URL` | Backend's Railway URL + `/api` (e.g., `https://backend-xxx.up.railway.app/api`) |

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
