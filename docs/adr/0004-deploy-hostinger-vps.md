# ADR 0004: One image on the Hostinger VPS, Jenkins pipeline

Date: 2026-11-26. Status: Accepted as design. Nothing deployed.

## Context

- Standard stack for the maintainer's projects: GitHub, Jenkins, Hostinger, with the container rules in the
  maintainer's standard (one image, no `latest`, no root, resource limits, no secrets in images).
- Existing pattern: a virtual server with Docker and Traefik (`websecure`, resolver `letsencrypt`), compose under
  `/docker/<project>`, Jenkins on the same server deploying through the Docker socket, images on Docker Hub (at the time; now ghcr.io, see the image line below).

## Options considered

| Option | Good | Bad |
|---|---|---|
| A. VPS + Docker compose behind Traefik (chosen) | Known pattern; meets the container standard; PostgreSQL fits | We own patching and backups |
| B. Hostinger managed Node.js hosting | Less operations | Does not follow the container standard; PostgreSQL not confirmed there |
| C. Static hosting | Cheapest | No admin, no save |

## Decision

**Image (frontend + backend in one image, the choice the docker standard asks to record).**
- `ghcr.io/dipeshpansuriya/portfolio-app:<version>-<sha8>` (changed 2026-11-26 from Docker Hub; set in `scripts/ci.sh`). No `latest`.
- Multi-stage build. Base `node:26-alpine` pinned to an exact version and digest (26 is what tests ran on).
- Final stage: `server/`, `shared/`, `content/`, `dist/`, `dist-server/`, `scripts/reset-password.mjs`,
  `scripts/db-check.mjs`, `package.json`, production `node_modules` (`pg` only).
- `.dockerignore` is an allow-list. No `.env`, no `data/`, no secrets. The image is public.
- User `node` (non-root). Image env: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=4319`.

**Container.** Read-only root filesystem, `tmpfs` for `/tmp` and `/run/portfolio`, `cap_drop: [ALL]`,
`no-new-privileges`, `mem_limit: 256m`, `cpus: 0.50`, `NODE_OPTIONS=--max-old-space-size=192`,
log rotation 10 MB x 3 (or journald if the host uses it), health check on `/api/ready`
(Node `fetch`, no curl). No published ports. No app volume (ADR 0002). One replica.

**Routing.** Network `web` (external, Traefik) plus internal `portfolio-data` for the database.
Router rule `Host(${PORTFOLIO_HOST})`, `websecure`, `letsencrypt`, service port 4319.
UNVERIFIED: the Traefik network mode and name on the target server. Check the live server (read-only) before the
labels are final.

**Config and secrets.**

| Variable | Secret | Where set |
|---|---|---|
| `APP_IMAGE`, `PORTFOLIO_HOST` | no | pipeline / server `.env` |
| `TRUST_PROXY` | no | compose: `1` for Traefik alone, `2` if another proxy or CDN sits in front |
| `TRUSTED_PROXY_IPS` | no | optional: addresses or subnets allowed to set the client address; empty = any private peer |
| `PUBLIC_ORIGIN` | no | compose: `https://${PORTFOLIO_HOST}` |
| `PG_POOL_MAX` | no | compose: `5` |
| `CREDENTIALS_DIR` (new) | no | compose: `/run/portfolio` |
| `ADMIN_EMAIL`, `ADMIN_NAME` | no | server `.env` |
| `ADMIN_PASSWORD` | yes | first boot only, then removed from the running config |
| `DATABASE_URL`, `DB_PASSWORD`, `POSTGRES_PASSWORD`, `BACKUP_DB_PASSWORD` | yes | server `.env` only (`BACKUP_DB_PASSWORD`: read-only backup role) |

- Server secrets: `/docker/portfolio/.env`, mode 600, owned by the deploy user (`DEPLOY_USER`), made by a bootstrap script.
- Jenkins uses the credential `ghcr-creds` (GitHub Container Registry). Superseded 2026-11-26: the Docker Hub ids above no longer apply.
- Local work needs no secret (SQLite).
- The app refuses to start in production when: `TRUST_PROXY` is unset (already true), `DATABASE_URL`
  is empty (`DSH_DB_FILE`, a SQLite file, also counts as a database: `server/db.mjs`; the server stack never
  sets it), `PUBLIC_ORIGIN` is empty, or the user table is empty and `ADMIN_PASSWORD` is unset.

**Pipeline.** `scripts/ci.sh` holds the gates; `Jenkinsfile` calls it, so they also run locally today.

1. `npm ci` 2. typecheck 3. tests on SQLite 4. tests on a throwaway PostgreSQL 5. build + bundle budget
6. image build 7. secret scan + vulnerability scan, fail on High/Critical 8. run the image read-only,
check ready and one page 9. (main, approved) push one tag 10. backup, then deploy that tag
11. post-deploy checks; on failure redeploy the previous tag.

**Rollback.** `deploy.sh` stores the previous tag; `deploy.sh <tag>` redeploys it. Release notes record
tag, digest, volumes and target. A rollback is checked inside the stack only, not through the public address:
a DNS or TLS fault would otherwise fail the older image too.

**Hardening added 2026-11-26, after review.**
- Traefik rate limit on `/api/auth/*` and every POST: per client address and one shared bucket.
  UNVERIFIED against a live Traefik.
- Two Jenkins agents: `portfolio-build` runs gates 1-8 on `main` with its own Docker daemon, never the production
  socket; `portfolio-deploy` holds the socket and runs stages 9-11 only after an approval by the users named in
  `DEPLOY_APPROVER`. Installs run no package scripts.

## Consequences and gaps

- Jenkins is not active: the local repository has no remote and no Jenkins job exists.
- Each deploy restarts one container: a few seconds of downtime. This misses the standard's
  "rolling update with no downtime" and is accepted because login throttle and content copy are per process.
- Autoscaling and namespace quota lines of the standard do not apply to compose.
- Set `TRUSTED_PROXY_IPS` to the proxy's own address or subnet on the shared network.
- The HSTS header (`server/index.mjs`, `securityHeaders`) is sent in production for this host only, with no
  `includeSubDomains`, so it does not force HTTPS on other subdomains.
- Pushing a public image, DNS and deploy all wait for the owner.
