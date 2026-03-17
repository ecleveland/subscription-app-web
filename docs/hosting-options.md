# Production Deployment Guide — Subscription App

## Context

The app is a 3-service stack: **Next.js frontend**, **NestJS backend**, **MongoDB**. Everything is already Dockerized with multi-stage builds, standalone Next.js output, and non-root users. The goal is to identify the cheapest viable production hosting options beyond Azure.

---

## What You Need Regardless of Platform

1. **Managed MongoDB** — Don't self-host Mongo in production
   - **MongoDB Atlas** (free tier: 512MB, shared cluster) — best option for starting out, scales to dedicated clusters
   - Handles backups, monitoring, replica sets, and security patches

2. **Secrets management** — `JWT_SECRET` and `MONGODB_URI` must come from environment/secrets, never committed
3. **Custom domain + SSL** — Most platforms provide free SSL via Let's Encrypt
4. **CI/CD** — You already have GitHub Actions running lint + tests; add a deploy step
5. **Health checks** — Add a `/api/health` endpoint to the backend (currently missing)

---

## Hosting Options (Cheapest → Most Flexible)

### Tier 1: Cheapest (~$0–7/mo) — PaaS / Serverless

| Platform | Frontend | Backend | MongoDB | Est. Cost |
|----------|----------|---------|---------|-----------|
| **Railway** | Docker container | Docker container | Atlas free tier | ~$5/mo (usage-based, $5 credit) |
| **Render** | Web service (free tier) | Web service (free tier) | Atlas free tier | $0–7/mo |
| **Fly.io** | Docker container | Docker container | Atlas free tier | ~$3–5/mo (3 shared VMs) |

**Railway** (recommended for your stack):
- Deploy directly from GitHub, auto-detects Dockerfiles
- Supports monorepos — deploy frontend and backend as separate services
- Built-in environment variable management, logs, metrics
- Usage-based pricing: you pay for CPU/RAM/bandwidth actually consumed
- Closest to "Azure App Service" experience but much simpler

**Render**:
- Free tier gives you 750 hours/mo of web services (enough for 1 always-on service)
- Free tier services spin down after 15 min inactivity (cold starts ~30s)
- Paid tier ($7/mo per service) keeps them always-on
- Very simple GitHub integration, auto-deploy on push

**Fly.io**:
- Runs Docker containers on lightweight VMs (Firecracker)
- 3 free shared-cpu VMs included
- Great for globally distributed apps (edge deployment)
- Slightly more complex setup (uses `fly.toml` config + CLI)

### Tier 2: Low-Cost VPS (~$5–12/mo) — Full Control

| Platform | What You Get | Est. Cost |
|----------|-------------|-----------|
| **Hetzner** | 2 vCPU, 4GB RAM, 40GB SSD (Falkenstein/Helsinki) | €4.50/mo (~$5) |
| **DigitalOcean** | 1 vCPU, 1GB RAM, 25GB SSD | $6/mo |
| **Vultr** | 1 vCPU, 1GB RAM, 25GB SSD | $6/mo |

**Hetzner** (best value):
- European data centers, incredible price/performance ratio
- Run your entire `docker-compose.yml` on a single VPS
- You manage everything: OS updates, Docker, Nginx/Caddy reverse proxy, SSL, backups
- Use **Caddy** as reverse proxy (auto-SSL, zero config) instead of Nginx

**VPS deployment pattern:**
```
VPS (Hetzner/DO)
├── Caddy (reverse proxy, auto-SSL)
├── Frontend container (port 3000)
├── Backend container (port 3001)
└── MongoDB Atlas (external, managed)
```

You'd still use Atlas for MongoDB rather than running it on the VPS — one less thing to manage and backup.

### Tier 3: Hybrid / Platform-Specific (~$0–20/mo)

| Approach | Frontend | Backend | Est. Cost |
|----------|----------|---------|-----------|
| **Vercel + Railway** | Vercel (free tier, optimized for Next.js) | Railway ($5/mo) | ~$5/mo |
| **Coolify (self-hosted PaaS)** | Docker on VPS | Docker on VPS | ~$5/mo (VPS only) |

**Vercel + Railway**:
- Vercel is purpose-built for Next.js — zero-config deploys, edge caching, preview deployments
- Free tier: 100GB bandwidth, serverless functions
- Put the backend on Railway as a Docker service
- Best DX of all options, but splits your infra across two platforms

**Coolify** (self-hosted alternative to Railway/Render):
- Open-source PaaS you install on a Hetzner/DO VPS
- Gives you a nice UI for deploying Docker apps, managing env vars, SSL, etc.
- One-time setup, then it works like Railway but you own the server
- Great if you want PaaS ergonomics at VPS prices

---

## Comparison to Azure

| Concern | Azure | Recommended Alternative |
|---------|-------|------------------------|
| Container hosting | App Service ($13+/mo) or ACI | Railway ($5/mo) or Hetzner VPS ($5/mo) |
| MongoDB | Cosmos DB ($25+/mo) | Atlas free tier → $9/mo dedicated |
| CI/CD | Azure DevOps | GitHub Actions (already set up) |
| SSL | App Gateway / Front Door | Caddy (free) or platform-provided |
| Monitoring | Application Insights | Platform logs + Pino (already configured) |
| **Total** | **~$40–80/mo minimum** | **~$5–15/mo** |

---

## My Recommendation for This Project

**Start with Railway + MongoDB Atlas:**

1. **MongoDB Atlas free tier** — 512MB is plenty for starting out
2. **Railway** — deploy both frontend and backend as separate services from your monorepo
3. **GitHub Actions** — you already have CI; add a deploy-on-merge step
4. Total cost: **~$5/mo** to start, scales smoothly as you grow

**When you outgrow that** → move to a Hetzner VPS with Coolify for ~$5/mo with much more resources.

---

## Production Readiness Checklist (Code Changes Needed)

These are things to address in your codebase before any production deploy:

- [ ] Add `/api/health` endpoint to backend (for platform health checks)
- [ ] Add rate limiting configuration for production (already have `@nestjs/throttler` installed)
- [ ] Ensure `helmet` is configured in `main.ts` (already imported)
- [ ] Set `JWT_EXPIRES_IN` to something shorter than 24h for production, or implement refresh token expiry
- [ ] Add `NODE_ENV=production` to Docker build args
- [ ] Consider adding a CDN (Cloudflare free tier) in front of the frontend for caching
