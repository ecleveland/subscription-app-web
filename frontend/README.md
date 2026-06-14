This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Testing

### Unit & component tests (Vitest)

```bash
npm test            # run once
npm run test:watch  # watch mode
npm run test:cov    # with coverage
```

### End-to-end tests (Playwright)

E2E tests live in `e2e/` and drive a real browser. The suite runs against its
**own isolated stack** — a dedicated backend (`:3101`) and frontend (`:3100`)
backed by a throwaway **`subscriptions_e2e`** database — so it never touches your
dev data. Playwright starts those servers for you; you only need MongoDB running.

```bash
npx playwright install chromium     # once
docker compose up -d mongo          # from the repo root, if Mongo isn't running
cd frontend
npm run test:e2e                    # headless
npm run test:e2e:ui                 # interactive Playwright UI
```

You do **not** need `./dev.sh` for E2E — Playwright boots its own backend and
frontend on ports 3100/3101, so the suite can run alongside your dev session
without colliding with it.

- The first run seeds two accounts (`e2e-user` and `e2e-admin`) via the API and
  saves their login state under `e2e/.auth/` (gitignored), so tests start
  already authenticated. The admin account is promoted directly in MongoDB.
- The `subscriptions_e2e` database is **dropped automatically** after the run
  (see `e2e/global.teardown.ts`), leaving nothing behind.
- Override defaults with `E2E_MONGODB_URI`, `E2E_BASE_URL`, `E2E_API_URL`, or
  `E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT` if needed.

These tests also run automatically on every PR to `master` via the `E2E` GitHub
Actions workflow.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
