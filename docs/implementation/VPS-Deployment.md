# VPS deployment of the app

**Date:** 2026-11-26. **Status:** written and rehearsed on one local machine. **Not deployed.** No server has run it.
Every server step below is **UNVERIFIED** until it runs on the real server.

The full commands, variable list, backup and restore steps are in the [deploy guide](../../deploy/README.md). This
page gives the order and the decisions. Design: [ADR 0004](../adr/0004-deploy-hostinger-vps.md) (server and image) and
[ADR 0005](../adr/0005-database-storage-and-backups.md) (database storage, **provisional**).

## 1. What runs on the server

| Part | What | Where it is described |
|---|---|---|
| Traefik (expected on the server, not part of this app; **UNVERIFIED**) | TLS certificate and routing to the app; sign-in rate limit labels | [compose.yaml](../../deploy/compose.yaml) labels |
| `app` | one image: web files, server-rendered first page, API | [Dockerfile](../../Dockerfile) |
| `postgres` | database (own database), or none when a shared database is used | [compose.yaml](../../deploy/compose.yaml), [compose.shared-db.yaml](../../deploy/compose.shared-db.yaml) |
| `pg-backup` | nightly dump, and a dump before each deploy | [backup scripts](../../deploy/backup/) |
| `pg-restore-test` | on demand: restore the newest dump into a throwaway server | same |
| one volume | database files (own database only) and dumps | [deploy guide, storage](../../deploy/README.md#storage-one-volume) |

## 2. Before the first deploy

1. Check the server read-only: memory, disk, Docker and Compose versions, Traefik network and mode, whether a shared
   PostgreSQL exists. ([deploy guide, before the first deploy](../../deploy/README.md#before-the-first-deploy-each-outward-step-needs-the-owners-yes))
2. Clear the go-live items: scan the pinned image, review the accepted database findings, set the registry package
   to public after the first push, arrange a copy of the dumps off the server disk.
3. Set up the two Jenkins agents and the approvers (`DEPLOY_APPROVER`) as in the [CI checks](../CI-AND-PR-CHECKS.md#1-where-each-check-runs). The build agent is linux/amd64 with its own Docker daemon; the deploy agent holds the production socket.
4. Choose the public host name and point DNS at the server.
5. Name these go-live settings before the first release (each is an owner decision or a server check; none is done):
   - `DEPLOY_APPROVER`, a controller setting: the user IDs that may release;
   - the containerd image store on **both** Docker daemons (build and server); switching hides images already present;
   - the Traefik address for `TRUSTED_PROXY_IPS` (required; at most a /16);
   - a linux/amd64 build machine, not the server (a new install, owner's yes).
6. Build agent memory: gate 4 may use 1 GB and each scanner 2 GB, plus the image build. Measure before the first run; this is not enforced.

## 3. Variables (names only)

Values live in the server's `.env` file (mode 600) or in Jenkins. Never in git, never in the image.

| Name | Secret | Set by |
|---|---|---|
| `PORTFOLIO_HOST`, `TRUST_PROXY`, `TRAEFIK_NETWORK` | no | `bootstrap-env.sh` and by hand |
| `TRUSTED_PROXY_IPS` | no | **required**: the proxy's address or subnet (at most a /16; IPv6 at most a /64); the deploy refuses without it |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | `ADMIN_PASSWORD` yes (first start only) | `bootstrap-env.sh` |
| `DB_PASSWORD`, `BACKUP_DB_PASSWORD`, `POSTGRES_PASSWORD`, `DATABASE_URL` | yes | `bootstrap-env.sh` |
| `COMPOSE_FILE`, `DB_HOST`, `DB_NETWORK`, `DB_PORT` | no | shared database only |
| `APP_IMAGE` | no | written by the deploy script |
| `DEPLOY_CLI_IMAGE`, `DEPLOY_USER`, `DEPLOY_APPROVER` | no | Jenkins (`DEPLOY_USER` is `uid:gid`, not root; `DEPLOY_APPROVER` is a controller setting) |
| `DATA_VOLUME`, `DATA_MOVED_TO` | no | only for an existing shared volume or a volume move; see the deploy guide |
| `ghcr-creds` | yes | Jenkins credential |

Full list: [env.example](../../deploy/env.example) and [deploy guide, variables](../../deploy/README.md#variables).

## 4. First deploy (in order)

1. Run `bootstrap-env.sh` on the server. It writes random secrets into `.env` once.
2. Choose the database path: own database (default), or shared PostgreSQL with `compose.shared-db.yaml`. The shared
   path needs the server administrator to create the roles once ([steps](../../deploy/README.md#shared-postgresql)).
3. Run `sh deploy.sh <full image name>`. The first deploy takes a dump only when a database already holds data. The image must be linux/amd64; the deploy refuses another platform before any change.
4. Sign in, change the owner password, remove `ADMIN_PASSWORD` from `.env` (`bootstrap-env.sh --drop-admin-password`),
   deploy the same tag again.
5. In the admin page, set the real contact email (the seed holds a placeholder).
6. Test the sign-in rate limit: 40 quick sign-out requests must end in HTTP 429 (**UNVERIFIED**; no proxy has read
   these labels yet).

## 5. Update

Normal updates go through the pipeline: a pass on `main`, then the release step. A release tag is never overwritten: stage 9 refuses a tag the server already holds with another image ID. A tag that exists only in the registry is not checked (open). By hand on the server:

```bash
sh deploy.sh <name:tag>    # dump first, start the new image, check it; the old image comes back on failure
cat releases.log           # what ran, and when
```

## 6. Backup and restore

| Item | Value |
|---|---|
| Nightly dump | 02:00 UTC; a weekly copy on Sunday |
| Dump before each deploy | yes |
| Deleting old dumps | **off** (`BACKUP_PRUNE=0`) until the owner decides |
| Health | `check.sh` inside the backup container; the container is marked unhealthy after a failed run or 26 hours without a dump |
| Restore test | `pg-restore-test` (monthly, and before go-live) |
| Restore over live data | owner decision; steps in the [deploy guide](../../deploy/README.md#restore-over-the-live-database) |

No alert is sent by the app. Someone must check the health state or run `check.sh`.

### 6.3 Moving the database to another volume

The own database must stay on the volume of the last successful release. Changing the volume setting alone is refused.
Moving the data needs `DATA_MOVED_TO=<volume>` with the app and database stopped; a dump is then taken from the new
volume. **Not rehearsed on a full stack (UNVERIFIED);** the owner decides before any move.

## 7. Rollback

| Case | Command |
|---|---|
| Back to the previous image | `sh deploy.sh --rollback` (the database is not changed) |
| Any earlier tag | `sh deploy.sh <tag>` |
| Failed post-deploy check | the pipeline runs `deploy.sh --undo` for the image it just switched to |

The rollback changes the app image only. To return the data, restore a dump (owner decision) or deploy an older
commit through the pipeline. Details: [deploy guide, rollback](../../deploy/README.md#rollback-on-the-server-in-dockerportfolio).

## 8. Health checks

| Check | Command or place |
|---|---|
| Container health | the app's built-in `/api/ready` check (container state) |
| Full post-deploy check | `sh post-deploy-check.sh <image>` (limits, read-only root, dropped capabilities, no published ports, database network isolation) |
| Public address | `PUBLIC_CHECK=1 sh post-deploy-check.sh` (needs DNS and TLS; **UNVERIFIED**) |
| Release record | `releases.log` |

## 9. Troubleshooting

| Symptom | Where to look |
|---|---|
| "nothing was deployed" after a dump error | [deploy guide, rollback when the dump fails](../../deploy/README.md#rollback-when-the-dump-fails) |
| Database never healthy after the first deploy | [deploy guide, first-start script](../../deploy/README.md#the-first-start-script-failed) |
| Backup container unhealthy | `failures.log` in the backups folder; run a dump by hand |
| Rate limit not applied | the proxy must read the labels; check the network name (`TRAEFIK_NETWORK`) |
| Both old and new image fail | [deploy guide, rollback](../../deploy/README.md#rollback-on-the-server-in-dockerportfolio) |

## 10. Not done (as of 2026-11-26)

| Item | State |
|---|---|
| Server check, first deploy, DNS, TLS | not done; UNVERIFIED |
| Image pushed to the registry | not done |
| Jenkins job created | not done |
| Off-server copy of the dumps | not set up |
| Shared-database grants on a real server | not checked |
| Check of a release tag that exists only in the registry | open (not checked) |
| Moving an own database to another volume (`DATA_MOVED_TO`) | procedure written; not rehearsed on a full stack (UNVERIFIED) |
| Jenkins stages 8-11 with the two agents, approval and amd64 build | not run (UNVERIFIED) |
| Nightly dump running on a server | UNVERIFIED |
| Restore on a server | UNVERIFIED |
