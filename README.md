# Headcount HQ

Self-hosted, single-tenant (extension-ready) tool for building a living headcount
model across departments and the C-suite. It connects current roster and
compensation to structured hiring requests, reconciled against budget and runway,
with role-based access and compensation confidentiality enforced on the server.

> **Status: M0 — foundation.** The app boots, runs database migrations on start,
> serves a home page, and ships a passing test suite. Sign-in, accounts, roster
> import, hiring requests, dashboards, and the planning engine arrive in later
> milestones. See [`docs/ARCHITECTURE_PLAN.md`](docs/ARCHITECTURE_PLAN.md).

## What makes this easy to host

**Zero runtime dependencies.** The app uses only Node.js built-in modules
(`node:http`, `node:sqlite`, `node:crypto`). There is **no `npm install`, no build
step, and no native compilation** — a host only needs Node 22.5+ to run it.

## Deploy from GitHub (no local setup required)

1. **Push this folder to a GitHub repository.**
2. **Pick a host and connect the repo.** Any host that runs a Dockerfile works
   (Render, Railway, Fly.io, etc.). The included `Dockerfile` is all they need.
3. **Set one required environment variable:** `SESSION_SECRET` — a long random
   string. Some hosts can generate it for you (the included `render.yaml` does).
4. **Give it a persistent disk** mounted where `DATABASE_PATH` points
   (default `/data/headcount.sqlite`) so data survives redeploys.

### One-click path: Render

This repo includes `render.yaml`. In Render choose **New → Blueprint**, connect the
repo, and Render provisions the web service, generates `SESSION_SECRET`, and mounts
a persistent disk at `/data` automatically. (The persistent disk requires a paid
Render plan.)

### Generic path: any Docker host

The host builds the `Dockerfile` and runs it. Provide these environment variables:

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | **yes** | Long random string; signs session cookies |
| `DATABASE_PATH` | recommended | Point at a persistent volume, e.g. `/data/headcount.sqlite` |
| `COOKIE_SECURE` | recommended | `true` when served over HTTPS (it should be) |
| `PORT` | no | Defaults to 3000; many hosts set this for you |

A health check endpoint is available at `/health`.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example) for the
full list with explanations. Generate a secret with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Running the tests

If you ever want to run the suite (optional — not needed to deploy):

```
npm test
```

This uses Node's built-in test runner; no dependencies are installed.

## Project layout

```
src/
  config.js        # validated environment configuration (single source)
  app.js           # builds the HTTP server (security headers, static, routes)
  server.js        # boot: config -> db -> migrate -> listen
  router.js        # tiny explicit router
  html.js          # safe server-side HTML rendering (auto-escaping)
  routes.js        # thin HTTP handlers
  db/              # database open, migrations, runner
public/            # static assets (CSS)
tests/             # node:test unit + integration tests
docs/              # ARCHITECTURE_PLAN.md
```

## Security notes

Compensation is sensitive. Visibility will be enforced server-side in a single
authorization module (M1), so exact salaries are never serialized to a role that
may not see them. Passwords are hashed with scrypt. Never commit a real `.env`; set
`SESSION_SECRET` to a long random value in production and serve over HTTPS.

## A note on the storage engine

Persistence uses Node's built-in `node:sqlite`, which is currently marked
*experimental* (hence the `--experimental-sqlite` flag in the start command). It is
isolated behind `src/db/database.js` so it can be swapped without touching the rest
of the app if needed.
