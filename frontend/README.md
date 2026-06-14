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

E2E tests live in `e2e/` and drive a real browser against a running stack
(MongoDB + backend on `:3001` + frontend on `:3000`).

1. Install browsers once: `npx playwright install chromium`
2. Start the full dev environment from the **repo root**: `./dev.sh`
3. Run the suite:

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # interactive Playwright UI
```

> The backend rate-limits auth endpoints. For repeated local runs within a
> minute, start the backend with `THROTTLE_DISABLED=true` (CI sets this
> automatically). Never set it in production.

The first run seeds two accounts (`e2e-user` and `e2e-admin`) via the API and
saves their login state under `e2e/.auth/` (gitignored), so subsequent tests
start already authenticated. The admin account is promoted directly in MongoDB;
override the connection with `E2E_MONGODB_URI` if your DB isn't at the default
`mongodb://localhost:27017/subscriptions`.

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
