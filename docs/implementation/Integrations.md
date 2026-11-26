# Integrations

**Date:** 2026-11-26  **Status:** Nothing external is live: the project is not deployed.

The running site calls **no third-party service**. The browser may talk only to its own origin
(Content-Security-Policy `connect-src 'self'`, set in `server/index.mjs`). The integrations below are build, CI and
deploy tools, plus outbound links.

## Inventory

| Integration | Type | Purpose | Where | State |
|---|---|---|---|---|
| Profile links | outbound links | the owner's public profile and mail links | content document, `index.html` | in content |
| schema.org | structured data vocabulary | page metadata | `index.html` | in use, no calls |
| Web fonts | self-hosted files | fonts served by the app itself | `public/fonts/` | in use |
| simple-icons | npm package, build time | brand icon paths | `shared/icon-slugs.ts`, `src/data/icon-paths.ts` | build only |
| npm registry | package source | locked dependencies | `scripts/ci.sh` gate 1, `Dockerfile` | used by builds |
| PostgreSQL 17 | container image, pinned by digest | database | `deploy/compose.yaml`, `scripts/ci.sh` | CI and deploy files |
| Trivy | scanner | image vulnerability and secret scan | `scripts/ci.sh` gate 7 | CI |
| gitleaks | scanner | secret scan | `scripts/ci.sh` gate 7 | CI |
| GitHub Actions, CodeQL, Dependabot | source host features | checks and updates | `.github/` | running on the published copy |
| Jenkins | CI/CD | release stages | `Jenkinsfile` | written, **not active** |
| GitHub Container Registry (ghcr.io) | container registry | image push at release (stage 9) | `Jenkinsfile`, `scripts/ci.sh` | nothing pushed |
| Traefik with Let's Encrypt | reverse proxy and TLS | routing, TLS, sign-in rate limit | labels in `deploy/compose.yaml` | written; UNVERIFIED on a live server |
| Virtual server | host | runs the Docker stack | [ADR 0004](../adr/0004-deploy-hostinger-vps.md) | target; not checked, not deployed |

## Notes

### Container images

All images are pinned by digest. Gate 4 and gate 7 never pull: pull the pinned images first. The database image
carries scanner findings that the owner accepted for a limited time
(`deploy/postgres-accepted.trivyignore.yaml`, [ADR 0005](../adr/0005-database-storage-and-backups.md)). The image
scan fails once that acceptance expires.

### Registry and deploy credentials

Credentials are referenced by name in the `Jenkinsfile`. No value is in the repository. Server secrets stay in the
server's `.env` file ([deploy guide](../../deploy/README.md)).

### npm

Installs use the lockfile and run no package scripts (`npm ci --ignore-scripts`). An offline image build uses a
cache made by `deploy/offline-npm-cache.mjs`.

## How integrations are checked

| Integration | Check |
|---|---|
| PostgreSQL | the test suite on a throwaway PostgreSQL (`scripts/ci.sh` gate 4) |
| Image and scans | gates 6 to 8; `deploy/check-pipeline.sh` |
| Deploy and rollback | `deploy/check-scripts.sh` (stand-ins), `deploy/rehearse.sh` and `deploy/rehearse-shared.sh` (throwaway stacks) |
| Traefik rate limit | manual test after the first deploy; UNVERIFIED |

## Failure behaviour

| Dependency | Failure | Behaviour |
|---|---|---|
| Database | connection lost | `/api/ready` answers 503; visitors still get content from memory; saving fails |
| Backup job | dump fails | logged and the container turns unhealthy; no message is sent anywhere |
| Deploy | new image fails its checks | the previous image is started again |
| Edge (proxy, DNS, TLS) | fault | rollback is checked inside the stack only, so check the public address separately |
