# Setup and initialisation

**Date:** 2026-11-26  **Status:** Current for local work. Production is not deployed.
**Related:** [Testing](Testing-QA-Debugging.md), [Authentication and security](Authentication-Security.md),
[deploy guide](../../deploy/README.md)

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22.18 or newer (`package.json`); developed on 26 | everything. The 22.18 lower bound is UNVERIFIED |
| npm | comes with Node; not pinned | install |
| git | any recent | clone, hooks |
| Python 3 | any recent 3 | git hooks, secret scan, link check, audit |
| Docker | any recent | only `scripts/ci.sh` gates 4 and 6 to 8, and the deploy rehearsal |
| Trivy vulnerability database | downloaded on first scan | gate 7 |

## Fresh clone

```bash
git clone https://github.com/DipeshPansuriya/portfolio-app.git
cd portfolio-app
./scripts/install_hooks.sh      # if you will commit: once per clone, and again after the hooks or scanner change
npm ci --ignore-scripts
npm run dev:full                # web http://127.0.0.1:4318, API :4319
```

`dev:full` starts the API, waits for `/api/health`, then starts the web server. `Ctrl+C` stops both. Nothing needs
to be configured.

Optional: `cp .env.example .env` and edit it. The example sets a sample `ADMIN_EMAIL` and `ADMIN_NAME`; without a
`.env` the owner is `owner@local`.

## First start: the owner account

- With no `ADMIN_PASSWORD`, development writes a generated password to `data/admin-credentials.txt` (owner-only
  mode, git-ignored). Change it after signing in, then delete the file.
- Lost password: `npm run admin:reset-password [email]`. Without an email it uses `ADMIN_EMAIL`, else the only user.
  It changes only that user's password and ends their sessions; the new password goes to the same file.
- If `ADMIN_PASSWORD` is set, it must meet the password rules ([API](../API.md#4-conventions)).
- Set the real contact email: the seed content holds the placeholder `hello@example.com`. Sign in at `/admin`, open
  the Profile tab, change the **Email** field and the `Email` social link (handle, and address as `mailto:`), then
  save. Until then a new database shows the placeholder.

## Local production preview

In `.env`:

| Name | Value |
|---|---|
| `TRUST_PROXY` | `0` |
| `PUBLIC_ORIGIN` | `http://127.0.0.1:4319` |
| `DSH_DB_FILE` | `./data/portfolio.db` |
| `ADMIN_PASSWORD` | only on an empty database |

```bash
npm run build
npm start
```

The server-rendered hero and the head tags filled from content appear only in this mode and in the container.

## Database

| Environment | Database |
|---|---|
| Local, default | SQLite `data/portfolio.db` |
| Local, PostgreSQL | set `DATABASE_URL`; check with `npm run db:check` |
| Tests | SQLite; PostgreSQL with `TEST_DATABASE_URL` (disposable server only) |
| Server stack | PostgreSQL 17 image pinned by digest; roles made on first start |

Tables are created at start. [Database](../DATABASE.md).

## Variables

Full list: [README](../../README.md#environment-variables). Production refuses to start without a database,
`TRUST_PROXY`, `PUBLIC_ORIGIN` and, on an empty database, `ADMIN_PASSWORD`.

## Container and server

```bash
CI_OFFLINE=1 sh scripts/ci.sh 5 6   # web files, then the image; needs the pinned base image and a filled npm cache
```

Without `CI_OFFLINE=1` the image builds the web files inside Docker, a path that is UNVERIFIED. The full gates, server bootstrap, first deploy, rollback and backups are in the
[deploy guide](../../deploy/README.md). Each outward step (image push, DNS, deploy) needs the owner's yes.

## Project scripts

| Command | Does |
|---|---|
| `npm run dev:full` | API and web server |
| `npm run dev` / `npm run admin` | web server only / API only |
| `npm run build` | type check, web build, server render bundle |
| `npm start` | production server |
| `npm run typecheck`, `npm test` | checks |
| `npm run db:check` | database smoke test (writes and removes one probe row) |
| `npm run admin:reset-password` | password recovery |
| `npm run icons:slugs` | regenerate the icon list |

## Troubleshooting

[Testing, QA and debugging](Testing-QA-Debugging.md#common-issues).
