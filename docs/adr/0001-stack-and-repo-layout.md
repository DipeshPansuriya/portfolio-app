# ADR 0001: Evolve the prototype stack, one package

Date: 2026-11-26. Status: Accepted.

## Context

- Approved prototype: Vite 8, React 19, TypeScript 5.9, three + R3F + drei, framer-motion, Tailwind 4,
  `node:http` API, `pg`, SQLite fallback. Source: prototype `package.json`.
- It worked: at decision time its build passed and 46 of 46 tests passed (the author's own run).
- Release 1 is the approved level only. No new levels or sections.
- Gaps for production: runtime writes into `public/` and `src/`, no git, no container, no CI, slow mobile LCP.
- Code graph pass at decision time: content writes are reached only from `handle()` in `server/index.mjs`, so
  the storage change stays local. One import cycle was found, `server/auth.mjs` <-> `server/db.mjs` (leave it, not a release blocker).

## Options considered

| Option | Good | Bad |
|---|---|---|
| A. Evolve in place, one package (chosen) | Keeps tests and approved look; small diffs; one image | Web and server share one `package.json` |
| B. npm workspaces (`apps/web`, `apps/api`) | Clear walls | Moves every file, no user value at this size |
| C. Rebuild on an SSR framework | SSR built in | Rewrite of admin, API, static layer; new packages; loses black-box tests |

## Decision

Option A. Layout:

```
portfolio/
  content/site.json        seed content (first boot + build-time fallback)
  shared/                  code both sides import (icon-slugs.ts)
  src/                     web app: components, content, admin, game, three, hooks, data, prerender
  server/                  API, auth, guard, throttle, static, db drivers, content store
  public/                  static files only (fonts, favicon, robots.txt, theme-init.js)
  scripts/                 reset-password, db-check, gen-icon-slugs, check-bundle, ci.sh
  tests/                   node:test
  deploy/                  compose.yaml, env.example, deploy.sh, backup/, postgres-init/
  Dockerfile  .dockerignore  Jenkinsfile
  docs/  data/ (local only, git-ignored)
```

Rules:
- `server/` never imports from `src/`. It may import from `shared/`. Today `server/content.mjs:14`
  imports `../src/data/icon-slugs.ts`; that file moves to `shared/`.
- Web libraries move to `devDependencies`; the only runtime dependency is `pg`.
- Ignore rules use `/data/` (root only). The prototype `.gitignore` line `data/` also ignores
  `src/data/`, so a fresh clone would not build (checked with `git check-ignore`).
- SQLite stays for local work and tests. Production requires PostgreSQL.

## Consequences

- No framework change, no new runtime package.
- Postgres is the production database but has no test run yet: CI adds one.
- If a second app or level ever appears, revisit workspaces.
