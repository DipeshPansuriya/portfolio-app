# portfolio

An interactive portfolio you can **read** or **drive**: a 3D circuit that opens one chapter per gate, a plain
reading mode with the same content, and an `/admin` editor that publishes changes without a rebuild.

**Status:** release 1 is built and tested locally. It is **not deployed**: there is no live site, no published image
and no active release pipeline.

## Features

| Area | What you get |
|---|---|
| Reading mode | hero, chapters, principles, contact and footer, with chapter navigation and a skip link |
| Drive circuit | timed lap, one gate per chapter (five in the seed content), best time kept in the browser, keyboard and touch controls, pause; loaded only when opened |
| Fallbacks | without WebGL, with reduced motion, or if a lazy 3D or game file fails, the content stays readable ([limits](docs/PRD.md#fr-003-limits)) |
| Content editor | one owner at `/admin`: edit, validate, publish, restore earlier revisions, change password |
| Search and sharing | the production server fills page title, share title, structured data and the no-script note from the live content; two optional description fields |
| Fast first paint | the server renders the hero into `/`; long-lived compressed assets; no 3D library in the first load |
| Theme | follows the system until the visitor chooses |
| Operations | one container image, health and readiness endpoints, audit log, deploy with rollback, nightly database dump and an on-demand restore test |

Small interface text (buttons, hints, menu labels) stays in code. The portfolio content is stored in the database
and edited at `/admin`.

## Stack

| Layer | Choice |
|---|---|
| Web | React 19, TypeScript 5.9, Vite 8, Tailwind CSS 4, framer-motion, lenis |
| 3D | three, react-three-fiber, drei |
| Server | Node.js (`node:http`, no web framework); the only runtime package is `pg` |
| Database | PostgreSQL 17 in production, built-in SQLite for local work and tests |
| Tests | `node:test` |
| Delivery | Docker, Docker Compose, Traefik, Jenkins (written, not active), GitHub Actions |

```text
 browser ──> reverse proxy (TLS) ──> app: static files, hero render, API ──> PostgreSQL
                                          └── live content held in memory       └── nightly dump
```

More: [Architecture](docs/ARCHITECTURE.md), [runtime diagram](docs/diagrams/runtime-architecture.html),
[deployment diagram](docs/diagrams/deployment.html) (download and open the HTML files in a browser).

## Run it locally

Needs Node.js 22.18 or newer (developed on Node 26), npm and git.

```bash
git clone https://github.com/DipeshPansuriya/portfolio-app.git
cd portfolio-app
./scripts/install_hooks.sh      # if you will commit: once, and again after hook or scanner changes (needs Python 3)
npm ci --ignore-scripts
npm run dev:full                # web http://127.0.0.1:4318, API http://127.0.0.1:4319
```

Nothing needs to be configured: a local SQLite database is created in `data/`.

**Sign in to `/admin`:** the first development start creates one owner account (`owner@local`, or `ADMIN_EMAIL`)
and writes a generated password to `data/admin-credentials.txt`, readable only by you. Change the password, then
delete the file. Lost it: `npm run admin:reset-password [email]`.

**Optional settings:** `cp .env.example .env`, then edit. The example file sets a sample `ADMIN_EMAIL` and
`ADMIN_NAME`.

**Local production preview:** set `TRUST_PROXY=0`, `PUBLIC_ORIGIN=http://127.0.0.1:4319`,
`DSH_DB_FILE=./data/portfolio.db` and, on an empty database, `ADMIN_PASSWORD` in `.env`, then:

```bash
npm run build
npm start                       # http://127.0.0.1:4319
```

## Environment variables

Names only. Secrets live in `.env` (git-ignored) or on the server, never in git or in an image.

| Name | Secret | Needed | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | production | PostgreSQL connection; unset means SQLite |
| `PG_POOL_MAX` | no | no | database pool size (default 10; the server stack sets 5) |
| `DSH_DB_FILE` | no | no | SQLite file path; in production it must be named to use SQLite |
| `ADMIN_EMAIL`, `ADMIN_NAME` | no | server stack: email | owner account, first start only |
| `ADMIN_PASSWORD` | yes | first production start | first owner password; remove it afterwards |
| `CREDENTIALS_DIR` | no | no | folder for the generated or reset password file (default `data/`) |
| `PORT`, `HOST` | no | no | defaults `4319` and `127.0.0.1` (the image sets `0.0.0.0`) |
| `TRUST_PROXY` | no | production | number of reverse proxies in front; `0` for none |
| `TRUSTED_PROXY_IPS` | no | no | addresses allowed to set the client address |
| `PUBLIC_ORIGIN` | no | production | the public address, scheme included |
| `ADMIN_ORIGIN`, `VITE_PORT` | no | no | development: API address for the web server, web port |
| `TEST_DATABASE_URL` | yes | no | run the tests on a **disposable** PostgreSQL |

Server stack only: `PORTFOLIO_HOST`, `DB_PASSWORD`, `POSTGRES_PASSWORD`, `BACKUP_DB_PASSWORD`, `TRAEFIK_NETWORK`,
`APP_IMAGE`. Pipeline and scripts: [deploy guide](deploy/README.md#variables).

## Tests and checks

```bash
npm run typecheck
npm test                                      # SQLite
npm run build && node scripts/check-bundle.mjs  # first load: JavaScript 160 kB, CSS 15 kB (gzip)
python3 scripts/check_secrets.py
python3 scripts/check_docs.py
./scripts/security_audit.sh                   # includes npm audit (network); --quick skips it
sh scripts/ci.sh                              # all eight gates; needs Docker and the pinned images
```

`TEST_DATABASE_URL=...` runs the tests on PostgreSQL. They create and drop their own databases, so point it only at
a server you can throw away. Results and gaps: [Testing, QA and debugging](docs/implementation/Testing-QA-Debugging.md).

## Deploy

One image runs behind a reverse proxy with PostgreSQL. Commands, variables, backups and rollback are in the
[deploy guide](deploy/README.md); decisions in [ADR 0004](docs/adr/0004-deploy-hostinger-vps.md) and
[ADR 0005](docs/adr/0005-database-storage-and-backups.md). The storage choice is provisional and the live server
has not been checked.

## Security

- scrypt password hashing, hashed session tokens, CSRF token, Host, Origin and content type checks, sign-in limits,
  strict Content-Security-Policy, field validation, audit log.
- Non-root, read-only container; no published database port.
- Secret scanning in git hooks and CI; a repeatable [security audit](scripts/security_audit.sh).
- GitHub settings (branch protection, secret scanning, CodeQL and more) are **to be applied at publish**:
  [GitHub policy](docs/GITHUB-POLICY.md).

Details and limits: [Authentication and security](docs/implementation/Authentication-Security.md). Report a problem
privately: [SECURITY.md](SECURITY.md).

## Known limits

- Not deployed. Behaviour on a real server, proxy, TLS and other processor architectures is UNVERIFIED.
- Browser checks were run in Chrome only. Safari, Firefox, real phones and screen readers are UNVERIFIED.
- One owner account, no multi-factor sign-in, one application instance.
- During a sustained flood of sign-in attempts, a new browser (one that has not signed in before) may get 503 and
  be unable to sign in while the flood lasts.
- Without JavaScript only the hero and a short note are shown.

## Repository layout

| Path | What |
|---|---|
| `src/` | web app: components, content, drive game, 3D, admin, server-rendered hero |
| `server/` | API, sign-in, request checks, content store, static files, database drivers |
| `shared/` | code used by both sides |
| `content/` | seed content, used only for an empty database |
| `tests/` | test suites |
| `scripts/` | CI gates, secret scan, audit, hooks, password reset |
| `deploy/` | server stack, backup and restore, deploy and rollback |
| `docs/` | documentation |

## Documentation

| Document | Contents |
|---|---|
| [PRD](docs/PRD.md) | requirements and acceptance |
| [Design](docs/DESIGN.md) | behaviour, controls, look |
| [Architecture](docs/ARCHITECTURE.md) | components, request paths, budgets |
| [Database](docs/DATABASE.md) | tables, content document, backups |
| [API](docs/API.md) | endpoints and errors |
| [Contributor and agent guide](docs/AGENTS.md) | roles and rules |
| [Setup](docs/implementation/Setup-Initialisation.md), [Features](docs/implementation/Feature-Development.md), [Authentication and security](docs/implementation/Authentication-Security.md) | implementation |
| [Integrations](docs/implementation/Integrations.md), [MCP](docs/implementation/MCP-Connection.md), [Testing](docs/implementation/Testing-QA-Debugging.md), [Implementation status](docs/implementation/Project-Implementation.md) | implementation |
| [Project summary](docs/Project_Summary.md), [AI prompts](docs/AI-PROMPTS.md) | analysis |
| [GitHub](docs/GITHUB-POLICY.md), [push](docs/PUSH-POLICY.md) and [branch](docs/BRANCH-POLICY.md) policy, [hardening checklist](docs/REPO-HARDENING-CHECKLIST.md) | repository safety |
| [Decisions](docs/adr/), [build plan](docs/plan/BUILD-PLAN.md), [changelog](CHANGELOG.md) | history |

[Contributing](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md) apply to every contribution.

## Licence

Code, scripts, configuration and technical documentation: [MIT](LICENSE).

**Not covered:** the name Dipesh Pansuriya, his biography, photos and the portfolio content (including
`content/site.json` and every copy of that text). All rights reserved. Replace them with your own before publishing
a copy. Fonts ([licence texts](public/fonts/)) and packages keep their own licences.
