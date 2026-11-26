# Deploy: portfolio on the Hostinger VPS

Date: 2026-11-26. Design: [ADR 0004](../docs/adr/0004-deploy-hostinger-vps.md),
[ADR 0005](../docs/adr/0005-database-storage-and-backups.md).

**Status: tested on one Mac only. The pipeline is not active. No image is pushed and nothing is deployed.**
A second way to publish the image, without Jenkins: [Release image from GitHub Actions](#release-image-from-github-actions-nothing-is-built-on-the-server).
**Storage: one volume (an existing shared one if the server has it). Shared PostgreSQL if the server has one,
else the own database of `compose.yaml`; which applies is PROVISIONAL until a check of the target server.**

## Pipeline

```
 git commit
   |
   v
 1 install > 2 typecheck > 3 SQLite tests > 4 PostgreSQL tests > 5 build + budget
                                            (a skipped or todo test fails 3 and 4)  |  dist/, dist-server/
   v
 6 image build ----------> 7 scans (gitleaks, Trivy) ----------> 8 read-only run check
   ghcr.io/dipeshpansuriya/       fail on a secret or HIGH/CRITICAL      throwaway database; then older
   portfolio-app:<version>-<sha>  (app image: no exceptions; database    local tags of this app are removed
                                  image: only the accepted list)
   |
   v   main + RELEASE ticked + a person approves        secrets used
 9 push the image (ghcr.io)                             ghcr-creds
 10 back up and deploy (deploy.sh over the Docker socket)   server .env (stays on the server)
 11 post-deploy checks, public URL; failure = rollback;     none
    then old local tags on the deploy host

 1-8 on agent portfolio-build (no production socket); 9-11 on agent portfolio-deploy, after approval by
 DEPLOY_APPROVER. Between 8 and 9: the image file, and its ID held by the controller.
```

| Stage | Where it is | Output |
|---|---|---|
| 1-8 | `scripts/ci.sh <n>`, same names in `Jenkinsfile` (`sh deploy/check-pipeline.sh`) | image in the local Docker |
| 9 | `Jenkinsfile` | one public image, tag = version and commit |
| 10 | `deploy/deploy.sh` | dump in the volume, `release.env`, `releases.log` |
| 11 | `deploy/post-deploy-check.sh` | pass or rollback |

## Public host and www

The site is served on `PORTFOLIO_HOST`, set to the owner's main domain (owner, 2026-11-26); no host name is
written in these files. `www.<host>` gets a permanent redirect to `https://<host>`, path kept (Traefik router
`portfolio-www`). Before the first deploy: DNS records for both names to the server, and check that no other
router there already answers them. `post-deploy-check.sh` fails without the redirect label; with
`PUBLIC_CHECK=1` it warns when the public redirect does not answer. UNVERIFIED against a live Traefik.

The app sends `Strict-Transport-Security: max-age=31536000` for this host only (`server/index.mjs`):
browsers that visited insist on HTTPS for this host for a year. Other subdomains are not affected.

## Two agents and the Docker socket

The Docker socket of the production host is root on that host. So the repository's code (gates 1-8, npm packages
included) runs on `portfolio-build`, which has its own Docker daemon, and only `portfolio-deploy` holds the
socket. That agent checks nothing out and builds nothing: it receives the deploy files, stashed straight after
the checkout and before any repository code ran, and the image saved after gate 8. `prepare` refuses any branch
but `main` and every pull request; **that guard is only a second lock**, because a branch can edit the
Jenkinsfile. Pull request checks run on GitHub-hosted runners (`.github/workflows`), never on these agents.

**The image file is not trusted.** `docker load` sets whatever names a file carries, so stage 9 runs
`load-release.sh`: it refuses the file unless it holds exactly `$APP_IMAGE` (a release tag of the repository in
`scripts/ci.sh`) with the image ID that gate 8 ran and the Jenkins controller kept. It hands Docker a new archive
made of the checked files only, then compares the loaded ID again; on a difference the name is set back and the
release stops.

Remaining risks, not solved:

- The app image itself comes from the build agent. A package that takes over the build can still change what is
  inside it; it then runs as the app, with the app's limits.
- The deploy files are stashed on the build agent. Straight after a checkout they are as committed, but a process
  or file left behind there by an **earlier** bad build could change them, and `deploy.sh` runs next to the
  socket. A build agent that is thrown away after each build, or deploy files fetched from git by the controller
  or deploy side, would close this.

**A released tag is not replaced.** If the server already holds `$APP_IMAGE` with another ID (a second run of
one commit), stage 9 refuses before loading; release a new commit. A tag that exists only in the registry, not on
the server, is not checked.

No package install runs scripts (`npm ci --ignore-scripts` in gate 1 and the Dockerfile).

## Jenkins server settings

Set all of these before the job exists. None is set or verified yet; the repository cannot enforce them.

**Warning: the first two rows below would stop another project's releases.** At the last read-only check
(2026-11-26) this Jenkins had one node, and another project's job used `agent any` and the controller's
Docker socket. First move that job to its own labelled agent (a task of that project, **the owner decides**)
and see one good release of it there. Only then set executors to `0` and remove the mounts.

| Where | Setting |
|---|---|
| Built-in node | number of executors `0` |
| Jenkins controller container | remove the mounts of `/var/run/docker.sock` and `/docker/portfolio` |
| Node `portfolio-build` | **linux/amd64**, like the server, and not on the production server (see "Build agent: processor and memory"); label `portfolio-build`; only jobs matching the label. The agent runs as a **non-root** user (gate 7 hands its files to the scanners with that owner). Its **own** Docker daemon: another machine or VM, or rootless Docker of a separate unprivileged user. Never the production socket, never a privileged docker-in-docker on the production host, no `/docker/portfolio`. Node 26 on `PATH`, `git`, `python3`, the pinned images pulled |
| Node `portfolio-deploy` | label `portfolio-deploy`; only jobs matching the label; 1 executor; Docker CLI, `/var/run/docker.sock`, `/docker/portfolio`; the pinned `docker:cli` pulled |
| Node `portfolio-deploy`, environment | `DEPLOY_CLI_IMAGE` (`docker:cli` as `name@sha256:`); `DEPLOY_USER` = `uid:gid` in numbers, both above 0: the uid owns `/docker/portfolio`, the gid is the socket's group (the helper containers get no other group) |
| Both Docker daemons | containerd image store (`docker info -f '{{.DriverStatus}}'` shows `io.containerd.snapshotter.v1`); stage 9 refuses otherwise. Switching an existing daemon hides its present images: **the owner decides** |
| Global property (Manage Jenkins, System) | environment variable `DEPLOY_APPROVER`: the owner's user ID. Not a node or job setting. Jenkins administrators can approve regardless |
| Server folder | `/docker/portfolio` and its files owned by `DEPLOY_USER` |
| Credential `ghcr-creds` | in the folder of this job only |
| Job | one "Pipeline script from SCM" job, branch `*/main`; no multibranch or organisation job, no pull request or fork discovery, no trigger for other refs |
| Other jobs | none may use the label `portfolio-deploy` (Jenkins does not enforce this by itself) |
| Access | only the owner may configure, build and approve; no anonymous access |
| GitHub | `main` protected: pull requests only, no force push, no auto-merge; a person reads and merges each one (see [GitHub policy](../docs/GITHUB-POLICY.md)) |

`DEPLOY_USER` is not root, but access to the socket still equals root on the host.

## Build agent: processor and memory

**Processor: linux/amd64.** The image is built and published for the build agent's processor, and the server is
amd64. An arm64 machine (an Apple-silicon Mac) passes gates 1-8 but cannot make a release: stage 9
(`load-release.sh`) refuses an image for another platform before the push, and `deploy.sh` refuses it before it
touches the stack.

**Memory.** The server has 7.75 GiB shared with other projects and no swap; 3.2 GiB were available on
2026-11-18 (read it again before deciding). A release build can take:

| Part | Limit |
|---|---|
| gate 4, throwaway PostgreSQL | 1 GiB, while the Node tests run beside it (not measured, no limit) |
| gate 6, `docker build` (web build) | **no limit**, not measured |
| gate 7, scanners, one at a time | 2 GiB each |
| gate 8, application and database | 256 MiB each |
| the Jenkins agent process | not measured |

- **Recommended: another amd64 machine or VM.** The server's memory is then not at risk.
- Rootless Docker on the production server is not covered by this budget: a build could make the kernel kill
  running services. Only with **the owner's decision**, a fresh memory reading and a hard memory cap on the whole
  build user (its daemon, containers and agent), below what is free, so that the build fails and not the server.
  Nothing in this repository sets or checks such a cap. UNVERIFIED.

## Release image from GitHub Actions (nothing is built on the server)

For a release without Jenkins: the server has too little free memory to build.
Workflow `.github/workflows/publish-image.yml`, **UNVERIFIED: it has not run yet**.

```
 started by hand on main (workflow_dispatch)
   |
   v   job build (ubuntu-24.04, x86_64; contents: read)
 scripts/ci.sh 1 5 6 7 8 --> docker save --> artifact release-image (kept 1 day)
   |                                          + image ID and checksum as job outputs
   v   job push (contents: read, packages: write; secret: the automatic GITHUB_TOKEN)
 scripts/publish-image.sh: checksum, image ID, amd64, tag free? --> push <version>-<commit>
   |
   v   artifact image-digest and the run summary: <name>:<tag>@sha256:<digest>
 server: docker pull that exact line, verify, deploy.sh
```

- **Start:** Actions, "Publish image", "Run workflow", branch `main`. Over the API the token needs "Actions: write".
  A tag does not start it: `v*` tags cannot be moved or deleted here, so a failed run would use up a version.
- Gates 2-4 (types, tests) are not repeated: the `Quality` checks of the same commit must be green.
- A tag that exists is refused, and so is any registry answer other than "not found". Release a new commit.
  `latest` is never pushed. The Jenkins stage 9 has no such check: use **one** publisher per commit.
- The first push makes the package. Make it **public** once (package settings), else the server cannot pull it.

On the server, as root, with the line from the run summary:

```sh
IMG='<name>:<version>-<commit>@sha256:<digest>'
name="${IMG%@*}"
docker pull "$IMG" &&
  docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$IMG" | grep -qxF "${name%:*}@${IMG##*@}" &&
  [ "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$IMG")" = linux/amd64 ] &&
  echo verified
```

Only after `verified`: `sh deploy.sh "$IMG"`. `release.env` then holds the name with its digest, and a rollback
uses the same form. Compare the digest, not the image ID: a server with the containerd image store shows another ID.

**Memory to pull and run** (limits of `compose.yaml`): app 256 MiB, database 256 MiB, nightly dump job 64 MiB
(576 MiB steady); the restore test adds 320 MiB and a one-off dump 64 MiB (960 MiB at most). Pulling needs no
build memory; its own use is not measured. Go limit: 1.5 GiB available.

## Go-live blockers

| Blocker | Cleared when |
|---|---|
| Gates 1-8 must not run on an agent with the production Docker socket | the "Jenkins server settings" above are in place (the Jenkinsfile is ready for them) |
| Pull requests, Dependabot's npm, Docker and Actions ones first of all, must never merge by themselves | auto-merge is off (`scripts/github_settings.py`, checked by `check`), and each one is read and merged by hand |
| The registry package must be public (the server pulls without credentials) | the package's visibility is set to public after the first push |
| Own database on one volume | a copy of the dumps off that volume and disk exists |

## Files

| File | Use |
|---|---|
| `compose.yaml` | server stack: `app`, `postgres`, `pg-backup`, `pg-restore-test`; one volume; Traefik labels |
| `compose.shared-db.yaml` | added for a shared PostgreSQL: no `postgres` service |
| `compose.shared-volume.yaml` | added to use an existing volume (`DATA_VOLUME`) instead of creating one |
| `env.example` | variable names |
| `bootstrap-env.sh` | writes the server `.env` once, random secrets, mode 600 |
| `postgres-init/10-app-role.sh` | database `portfolio` owned by `portfolio_owner` (cannot sign in), roles `portfolio_app` and `portfolio_backup` (read only), with checks; first start, safe to rerun |
| `postgres-accepted.trivyignore.yaml` | the accepted findings of the PostgreSQL image, with expiry date (below) |
| `backup/backup.sh`, `backup/check.sh`, `backup/restore-test.sh` | dump, dump health, restore check |
| `../scripts/publish-image.sh` | publish workflow: checks the saved image, pushes it once, records the digest |
| `load-release.sh` | pipeline stage 9: checks the image archive, then loads it (deploy agent; not copied to the server folder) |
| `deploy.sh`, `post-deploy-check.sh`, `checks/probe.mjs` | deploy, rollback, checks |
| `check-pipeline.sh`, `check-scripts.sh` | static and stand-in checks (no Docker); also in Jenkins `prepare` |
| `rehearse.sh`, `rehearse-shared.sh`, `compose.local.yaml`, `offline-npm-cache.mjs` | local only |

## Variables

| Name | Secret | Where | Note |
|---|---|---|---|
| `APP_IMAGE` | no | pipeline; server `release.env` | named in `scripts/ci.sh` only; the server records what it runs |
| `PORTFOLIO_HOST` | no | server `.env` | the public host without `www` (here the main domain); also gives `PUBLIC_ORIGIN`; `www.<host>` redirects to it |
| `TRUST_PROXY` | no | server `.env` | 1 = Traefik alone, 2 = CDN then Traefik |
| `TRUSTED_PROXY_IPS` | no | server `.env` | required: Traefik's address or subnet on the `web` network (below) |
| `ADMIN_EMAIL`, `ADMIN_NAME` | no | server `.env` | owner account, first start |
| `ADMIN_PASSWORD` | yes | server `.env` | first start only, then dropped |
| `DB_PASSWORD`, `DATABASE_URL` | yes | server `.env` | app role |
| `BACKUP_DB_PASSWORD` | yes | server `.env` | read-only role used by the dump and restore-test jobs |
| `POSTGRES_PASSWORD` | yes | server `.env` | own database only: superuser |
| `COMPOSE_FILE` | no | server `.env` | `compose.yaml`, then `:compose.shared-volume.yaml` and `:compose.shared-db.yaml` as they apply, in this order |
| `DATA_VOLUME` | no | server `.env` | existing shared volume only: its name; refused without `compose.shared-volume.yaml` in `COMPOSE_FILE` |
| `DATA_MOVED_TO` | no | typed before `deploy.sh`, once | the volume the own database was copied to ("Moving the database to another volume") |
| `PUBLIC_WAIT_SECONDS` | no | `post-deploy-check.sh` | how long the public URL may take to answer, default 60 |
| `SHARED_ACCEPT_PUBLIC` | no | role script | `1` only with the shared server owner's yes (below) |
| `DB_HOST`, `DB_NETWORK`, `DB_PORT` | no | server `.env` | shared database only; port default 5432; `DATABASE_URL` must name the same host and port (`deploy.sh` refuses otherwise) |
| `TRAEFIK_NETWORK` | no | server `.env` | default `web` |
| `DEPLOY_CLI_IMAGE` | no | Jenkins | `docker:cli` pinned `name@sha256:` |
| `DEPLOY_USER` | no | Jenkins | `uid:gid` of the helper containers: two numbers, both above 0 |
| `DEPLOY_APPROVER` | no | Jenkins, global | user IDs that may approve a release, commas, no spaces; unset = no release |
| `IMAGE_ID_FILE` | no | set by `Jenkinsfile` | where gate 8 writes the ID of the image it ran |
| `GHCR_USER`, `GHCR_TOKEN` | token: yes | publish workflow | the run's actor and automatic `GITHUB_TOKEN`; nothing is stored |
| `ghcr-creds` | yes | Jenkins credential | GitHub user and a token that may write packages |
| `KEEP_IMAGES`, `IMAGE_KEEP_OLDER` | no | `ci.sh` | clean-up of local tags (below); stage 11 sets the first |
| `CI_OFFLINE`, `TRIVY_DB_UPDATE`, `TRIVY_CACHE_DIR`, `SOURCE_URL` | no | `ci.sh` | optional |

## The proxy address

The app believes `X-Forwarded-For` only from the peers in `TRUSTED_PROXY_IPS`. An empty list would mean every
private peer, so `compose.yaml` and `deploy.sh` refuse it. Values: addresses or subnets, commas between, no
quotes; a subnet is `/16` (IPv6 `/64`) or narrower.

- Best: Traefik's own address, if Traefik has a fixed one on the `web` network. If its address changes, the app
  sees every visitor as Traefik, and the per-address limits then count all visitors together.
- Else the subnet of that network: `docker network inspect web -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}'`.
  Every container on that network is then trusted.

Read it on the server at go-live; nothing here guesses it. `bootstrap-env.sh` writes the name, with the value
given in front of the command, else empty.

## Storage: one volume

`portfolio-data`, mounted under `/var/lib/postgresql/data` (the database image's own volume path, so no
unnamed volume appears). Everything is in `portfolio/` (user 70:70, folders mode 700, dumps mode 600); the volume
root is never re-owned or re-moded. The one-shot `pg-folders` service makes the folders (`deploy.sh` runs it).

**An existing shared volume is used instead of a new one:** add `compose.shared-volume.yaml` to `COMPOSE_FILE`
and set `DATA_VOLUME`. The volume is then external (never created or removed by this stack). Once, its
administrator makes the folder `portfolio` owned by 70:70 (or lets user 70 write to the root). `postgres` mounts
`portfolio/` only, the dump jobs `portfolio/backups` only; `pg-folders` sees the whole volume and only makes the
two folders. `rehearse.sh` (`SHARED_VOLUME=1`) and `rehearse-shared.sh` run this with a stand-in volume;
UNVERIFIED on the server.

| Folder in the volume | Own database (`compose.yaml`) | Shared database |
|---|---|---|
| `portfolio/pgdata` | database files; `postgres` only | does not exist |
| `portfolio/backups` | dumps; `pg-backup` writes, `pg-restore-test` reads only | the same |

The app container mounts nothing: dumps hold the password hash and visitor addresses.

**Limits of the own-database path (owner exception, 2026-11-26: only if the server has no shared PostgreSQL):**

- It breaks the Docker standard's "no database files on a shared volume". Only the shared path meets it.
- Database and backups share one volume: removing or damaging it loses both. `docker compose down -v` or
  `docker volume rm portfolio-data` destroys the dumps too. **Never run either on the server.**
- The `postgres` container can now read and change the dumps (it mounts the whole volume). The dump jobs still
  cannot reach the database files.
- A copy off this volume and off this disk is therefore required before go-live.
- Both paths need Docker Engine 26 and Compose 2.26 or newer (a folder of a volume is mounted). The Compose
  minimum is UNVERIFIED (tested with 5.7.1 only); an older one fails the `config` check before anything changes.

### Moving the database to another volume

Own database only. Moves real data: **the owner decides.** NOT rehearsed on a server. `deploy.sh` starts the own
database only on the volume of the last release (`releases.log`) and only if the database is in it: a changed
`DATA_VOLUME` or `COMPOSE_FILE` is refused with nothing changed, because it would start an empty database.
`$C` as under "Backup and restore"; run from `/docker/portfolio`.

1. `$C run --rm -T -e RUN_ONCE=1 pg-backup` (a dump first).
2. `$C stop app pg-backup postgres`, and keep a copy of `.env`.
3. Copy the folder. The new volume must hold no database, and its `portfolio` folder must exist owned by 70:70
   (or user 70 may make it):

```bash
docker run --rm --pull never --network none --user 70:70 --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 256m --cpus 0.5 \
  -v <old volume>:/from:ro -v <new volume>:/var/lib/postgresql/data \
  "$(sed -n 's/^ *image: \(postgres:[^ ]*\)$/\1/p' compose.yaml)" sh -euc '
    to=/var/lib/postgresql/data/portfolio
    test ! -e "$to/pgdata"
    mkdir -p "$to"
    cp -a /from/portfolio/. "$to/"'
```

4. In `.env`: `compose.shared-volume.yaml` in `COMPOSE_FILE` and `DATA_VOLUME=<new volume>` (going to the own
   volume: remove both).
5. `DATA_MOVED_TO=<new volume> sh deploy.sh <current image>`. It starts the database on the new volume and dumps
   it strictly (an empty or unreadable copy stops here) before the app starts.

Back, when step 5 failed: restore the old `.env`, then `sh deploy.sh <current image>`. Back after it succeeded:
what was written since is only in the new volume; copy it back the same way (or give it up: the owner decides) and
use `DATA_MOVED_TO=<old volume>`. The old volume is never removed by these steps.

## Shared PostgreSQL

Use it when the server already runs one (**UNVERIFIED: the server has not been checked**). It must be
PostgreSQL 15, 16 or 17 (`pg_dump` 17), reachable on a private Docker network. Compose as above.

1. `sh bootstrap-env.sh --shared-db <db host> <db network> <public host> <admin email>` (`DB_PORT=<port>` in
   front when it is not 5432)
2. Once, by the server's administrator (it creates roles on a shared server: **the owner decides**). Put the
   administrator's password in `PGPASSWORD` without typing it into a command line; add
   `-e POSTGRES_USER=<name>` if the administrator is not `postgres`:

```bash
export DB_PASSWORD="$(sed -n 's/^DB_PASSWORD=//p' .env)"
export BACKUP_DB_PASSWORD="$(sed -n 's/^BACKUP_DB_PASSWORD=//p' .env)"
docker run --rm -i --network <db network> --user 70:70 --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 64m --cpus 0.25 --tmpfs /var/lib/postgresql/data \
  -e PGHOST=<db host> -e PGPASSWORD -e DB_PASSWORD -e BACKUP_DB_PASSWORD -e SHARED_SERVER=1 \
  "$(sed -n 's/^ *image: \(postgres:[^ ]*\)$/\1/p' compose.yaml)" sh -s <postgres-init/10-app-role.sh
unset PGPASSWORD DB_PASSWORD BACKUP_DB_PASSWORD
```

3. `sh deploy.sh <full image name>`. It dumps the database first (an empty one is skipped on the first deploy).

With `SHARED_SERVER=1` the script changes only the `portfolio` database and its three roles. It changes nothing
and stops when a check fails. What needs the **shared server's owner** (this project never does it):

| The script reports | The server owner |
|---|---|
| not PostgreSQL 15 to 17 | offers a supported server |
| `PUBLIC` may connect to another database | runs the printed `REVOKE CONNECT, TEMPORARY ... FROM PUBLIC`, first granting those rights to that app's own roles; **or** accepts it (`-e SHARED_ACCEPT_PUBLIC=1`) |
| `PUBLIC` may create in a schema | runs the printed `REVOKE CREATE ON SCHEMA ... FROM PUBLIC` in that database, or accepts it |
| a database `portfolio` or a `portfolio_*` role that is not ours | decides what it is; this app does not take it over |
| running the script at all | runs it as superuser (it makes roles and a database) |

`postgres` and `template1` keep PostgreSQL's default (any role may connect); the script only notes it. Names of
databases and roles stay visible to every role.

`portfolio_owner` owns the database and cannot sign in, so `portfolio_app` cannot drop it; `portfolio_app` is
limited to 10 connections. The backup role gets `SELECT` in `portfolio`, never `pg_read_all_data`; that it only
reads rests on these grants (`default_transaction_read_only` is a default it can turn off). The dumps stay in
this project's volume; the server's own backup is separate. Rehearsed with a stand-in server
(`rehearse-shared.sh`).

Open: the app joins the database network, so another container on it can reach port 4319 directly. Its forwarded
addresses are not believed unless `TRUSTED_PROXY_IPS` covers it; still confirm the network is dedicated or use
TLS to the server.

### From an own database to a shared one

Moves real data: **the owner decides.** NOT rehearsed. `deploy.sh` refuses the shared files while the own
`postgres` container exists, so nothing is half switched. `$C` as under "Backup and restore".

1. `$C run --rm -T -e RUN_ONCE=1 pg-backup`; note the new dump's full path `F`.
2. The server owner runs the role script above with the `DB_PASSWORD` and `BACKUP_DB_PASSWORD` of `.env`.
3. `$C stop app pg-backup postgres` and `$C rm -f postgres`. The volume and its `pgdata` stay.
4. In `.env` (keep a copy of the old file): add `compose.shared-db.yaml` to `COMPOSE_FILE`; set `DB_HOST`,
   `DB_NETWORK`, `DB_PORT`; point `DATABASE_URL` at them.
5. Restore `F` as `portfolio_app`: from "Restore over the live database" run the `PGPASSWORD=...` and
   `export PGPASSWORD` lines, then its `pg_restore` and `DELETE FROM sessions` commands; then `unset PGPASSWORD`.
6. `sh deploy.sh <current image>`.

Back: restore the old `.env`; the own database is as it was at step 3. If step 6 had succeeded, use
`DATA_MOVED_TO=<the own volume> sh deploy.sh <current image>` (the own volume: `DATA_VOLUME`, else
`portfolio-data`); what was written to the shared database since is not in it. Else plain
`sh deploy.sh <current image>`.

## Image name and local clean-up

`ghcr.io/dipeshpansuriya/portfolio-app:<package version>-<8-character commit>` (`sh scripts/ci.sh --image`).

After gate 8 passes, `ci.sh` removes older local tags of this name only. It keeps the image just built, newer
ones, any a container uses, those in `KEEP_IMAGES` (Jenkins passes the server's current and previous image) and
one more older tag for a rollback (`IMAGE_KEEP_OLDER`). It never prunes, never forces, never touches another name
or tags it did not write. In the pipeline (`CI_KEEP_REQUIRED=1`) it removes nothing without `KEEP_IMAGES`; stage 11 passes the list from the
server's `release.env` and `previous.env`, and the build agent removes only the image it built. Registry
retention is not set up.

## Run it locally

```bash
CI_OFFLINE=1 TRIVY_DB_UPDATE=1 sh scripts/ci.sh          # gates 1-8; first scan downloads the Trivy database
CI_OFFLINE=1 sh scripts/ci.sh 6                          # image only (gate 5 first)
sh deploy/rehearse.sh <image A> <image B>                # stack, backups, deploy failures, rollback; cleans up
SHARED_VOLUME=1 sh deploy/rehearse.sh <image A> <image B> # the same, in a stand-in existing volume
sh deploy/rehearse-shared.sh <image A> <image B>         # shared database and shared volume, stand-ins; cleans up
sh deploy/check-pipeline.sh
sh deploy/check-scripts.sh                               # seconds, no Docker
```

`CI_OFFLINE=1` builds without network: the web files from gate 5 replace the Dockerfile's `web` stage and
`pg` comes from the npm cache. **The full in-Docker web build (stage `webbuild`) is UNVERIFIED**: it needs
Linux builds of rolldown, oxide and lightningcss from the npm registry.

## Rollback (on the server, in `/docker/portfolio`)

On the server `sh` and `docker compose` run inside the `docker:cli` helper, as in stage 10.

```bash
sh deploy.sh --rollback            # back to the image in previous.env (run again to go forward)
sh deploy.sh <tag>                 # any earlier tag of the same image
sh deploy.sh <name:tag>            # any image by full name
cat releases.log                   # what ran, when, image id, registry digest, volume, database, project
```

A rollback changes the app image only. It does not restore the database or an older `compose.yaml`
(for that, deploy the older commit through the pipeline). An image that is no longer on the server is pulled again.

A rollback (manual, automatic or from stage 11) is checked inside the stack only, never through the public
address: if DNS or TLS is what fails, the older image would "fail" too. So after a failed stage 11, check the
public address; the image may be fine.

Stage 11 runs `deploy.sh --undo <image>`: it goes back only if the deploy of that build changed the release
(`switched.env`). A redeploy of the image that already ran stays, because `previous.env` may then hold a
rejected one. A failed undo can be run again; it stays available until a deploy or rollback starts or the undo
succeeds.

If the old and the new image both fail on a `database network` line, the cause is on the server (for example a
foreign container on that network), not in the image.

### Rollback when the dump fails

`--rollback` stops with "nothing was deployed" when the database is unhealthy or cannot be dumped (full disk,
missing table). Repair that first if possible. To switch the app image alone, with **no new dump**:

```bash
OLD="$(sed -n 's/^APP_IMAGE=//p' previous.env)"
[ -n "$OLD" ]
APP_IMAGE="$OLD" docker compose --env-file .env up -d --no-deps --no-build --wait --wait-timeout 90 app
cp release.env previous.env
echo "APP_IMAGE=$OLD" >release.env
rm -f switched.env
APP_IMAGE="$OLD" sh post-deploy-check.sh "$OLD"
```

Paste it line by line and stop at the first error. The last check reports the database too, so it can fail for
the same reason as the dump.

## Deploy order and first deploy

0. Own database with a release recorded: the volume must be the one of the last release and hold
   `portfolio/pgdata`, else nothing is started.
1. Dump first. Own database: if the volume exists, start `postgres` and dump it. After a successful release the
   running (or stopped) database is **not recreated** for this, so new database settings apply only after the
   dump. Shared database: always dump. If the dump cannot be made, nothing is deployed and the database must be
   repaired by hand.
2. Start `app` (and what it depends on), check it, record it. On failure the current image comes back.
3. Recreate `pg-backup`; its health never rolls the app back.

### First release through the pipeline

Stage 10 copies the deploy files to `/docker/portfolio` and then stops with `no .env here`. That is expected once.
Do not run the same commit again (its tag is now held on the server). On the server, as `DEPLOY_USER` (as root the
file would be mode 600 for root, and the deploy could not read it):

```bash
docker run --rm --pull never --user <uid:gid> --network none --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges --memory 64m --cpus 0.25 -e TRUSTED_PROXY_IPS=<address or subnet> \
  -v /docker/portfolio:/docker/portfolio <DEPLOY_CLI_IMAGE> \
  sh /docker/portfolio/bootstrap-env.sh <public host> <admin email>
```

Then deploy the image stage 9 loaded, the way stage 10 does, with the public check:

```bash
docker run --rm --pull never --user <uid:gid> --read-only --tmpfs /tmp -e HOME=/tmp -e PUBLIC_CHECK=1 \
  --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 0.5 \
  -v /docker/portfolio:/docker/portfolio -v /var/run/docker.sock:/var/run/docker.sock <DEPLOY_CLI_IMAGE> \
  sh /docker/portfolio/deploy.sh <full image name>
```

The public check waits `PUBLIC_WAIT_SECONDS` (60) for DNS and the first certificate. If it still fails on a first
deploy there is no older image: the app is stopped; fix DNS or Traefik and run the same command again. With a
shared database, do the role script ("Shared PostgreSQL", step 2) before the deploy. UNVERIFIED on a server.

A first deploy that failed before the app made its tables can simply be run again: with no release recorded and
no tables there is nothing to dump.

### The first-start script failed

Own database only. The image never retries it: the next start logs `Skipping initialization` and a role is
missing (the database never turns healthy, or the dump fails to sign in). Fix the cause, then run it by hand and
deploy again. After a failed first deploy there is no `release.env`, so name the image in the command (`$C`
cannot be used):

```bash
APP_IMAGE='<name:tag you deploy>' docker compose --env-file .env exec -T postgres sh /docker-entrypoint-initdb.d/10-app-role.sh
```

Then `sh deploy.sh <name:tag>`. The script creates only what is missing and never changes an existing password
(rehearsed on a healthy database with one grant removed). A volume made before the backup role existed also
needs this, after `postgres` has been recreated with `BACKUP_DB_PASSWORD` in `.env`.

## Sign-in rate limit (Traefik labels in `compose.yaml`)

Applies to `/api/auth/*` and to every POST (the app also accepts `/x/../api/auth/login`, which a path rule
alone can miss). Over the limit Traefik answers 429.

| Bucket | Limit |
|---|---|
| per client address as Traefik sees it | 30 a minute, burst 15 |
| all clients together | 3 a second, burst 30 |

- Under heavy traffic the shared limit applies to everyone.
- With a CDN in front (`TRUST_PROXY=2`) all visitors share the CDN's address: add
  `...ratelimit.sourcecriterion.ipstrategy.depth: "1"` to `portfolio-auth-source` first.
- **UNVERIFIED: no Traefik has read these labels.** After the first deploy: 40 quick
  `POST /api/auth/logout` requests must end in 429, also with `curl --path-as-is .../x/../api/auth/logout`.

## Backup and restore

```bash
C='docker compose --env-file .env --env-file release.env'
$C run --rm -T -e RUN_ONCE=1 pg-backup                          # dump now
$C run --rm -T pg-restore-test                                  # newest dump, restored and compared with live
$C run --rm -T --no-deps -e RESTORE_COMPARE=0 pg-restore-test   # restore only: database down, or older dump
$C exec pg-backup sh /scripts/check.sh                          # is the nightly job healthy
$C logs --since 48h pg-backup
```

**Nightly dump: on** (owner decision, 2026-11-26). Every deploy starts it; no setting is needed.
**Nothing is deleted automatically**: `compose.yaml` fixes `BACKUP_PRUNE` to `0`. Turning pruning on (7 daily and
4 weekly kept) needs the owner's yes and a change to that line. So dumps pile up on the VPS disk, in the same
volume as the own database: check `$C exec pg-backup du -sh /var/lib/postgresql/data/portfolio/backups` and free
disk space monthly.

| When | What happens |
|---|---|
| start with no dump from the last 24 h | dumps at once |
| every night 02:00 UTC | dump; Sunday also a weekly copy |
| a dump is cut off, partial or cannot be saved | removed; `ALERT` in the log, line in `backups/failures.log`, `backups/LAST_FAILURE`; retried after 15 min |
| last run failed, or no dump for 26 h | container is `unhealthy` (checked every 5 min) |
| database over 80 MB | `WARNING` in the log: the restore test may run out of space |

- A job stopped during a dump can leave a `*.part` file. The next runs log `WARNING: unfinished dump files`;
  nothing deletes them, so remove them by hand.
- **No message is sent anywhere.** Someone or a monitor must look at the health state or run `check.sh`
  (alert channel: not chosen).
- Restore test: before go-live, then monthly. It builds the throwaway database in memory (192 MB; the one-shot
  container may use 320 MB while it runs).
- Dumps are on the same disk as the database: a copy off this disk or a Hostinger VPS backup is still needed
  (UNVERIFIED).
- Data checksums are on for an own database created from now on; an existing one would need `pg_checksums` offline.

### Restore over the live database

Changes real data: **the owner decides.** `rehearse.sh` runs these steps on a throwaway stack (not the safety
dump line, and never on a server). The dump jobs sign in read-only, so the restore passes the app role's password
by name; it never appears in a command line.

```bash
$C run --rm -T --no-deps --entrypoint ls pg-backup -l /var/lib/postgresql/data/portfolio/backups   # pick F (full path) first
$C run --rm -T pg-restore-test "$F"          # DIFF is expected for an older dump; it must restore
(set -e                                      # one block: the first failure stops the rest
 $C stop app pg-backup
 $C run --rm -T -e RUN_ONCE=1 pg-backup      # safety dump
 PGPASSWORD="$(sed -n 's/^DB_PASSWORD=//p' .env)"
 export PGPASSWORD
 $C run --rm -T -e PGUSER=portfolio_app -e PGPASSWORD --entrypoint pg_restore pg-backup \
   --clean --if-exists --single-transaction --no-owner -d portfolio "$F"
 # no old sign-in comes back
 $C run --rm -T -e PGUSER=portfolio_app -e PGPASSWORD --entrypoint psql pg-backup -d portfolio -v ON_ERROR_STOP=1 -c 'DELETE FROM sessions'
 $C start app pg-backup
)
```

If the block stops, `app` and `pg-backup` stay stopped (`$C start app pg-backup` brings them back). If the
safety dump fails because the database is gone or partial, restoring without it is **the owner's decision**:
remove that line and run the block again. The owner password becomes the one in the dump. The same block works
on a shared server: the restored tables keep the backup role's `SELECT` (`rehearse-shared.sh`).

## Database passwords

Changing one revokes the old credential: **the owner decides.** The `postgres` health check is readiness only
(the image trusts connections from `127.0.0.1`), so it does not prove a password: check the app and the dump.
UNVERIFIED as a sequence (only the `ALTER ROLE` form was run, in a database review). On a shared server the
administrator sets the role's password; steps 2 and 3 below are for the own database.

1. New value in `.env`: `DB_PASSWORD` and `DATABASE_URL` together, or `BACKUP_DB_PASSWORD`.
2. `$C up -d --wait postgres` (gives the database container the new value).
3. Set it on the role (`portfolio_app` with `DB_PASSWORD`, or `portfolio_backup` with `BACKUP_DB_PASSWORD`):
   `printf '%s\n' '\getenv p DB_PASSWORD' "ALTER ROLE portfolio_app PASSWORD :'p';" | $C exec -T postgres psql -U postgres -v ON_ERROR_STOP=1`
4. `sh deploy.sh <current tag>`, which recreates `app` and `pg-backup`; then `$C exec pg-backup sh /scripts/check.sh`
   after a `dump now`.

The superuser password (`POSTGRES_PASSWORD`) is read on the first start only; changing `.env` later changes
nothing in the database. Treat Docker access on the server as access to these values, and limit it.

## Accepted findings of the PostgreSQL image

| Item | Value |
|---|---|
| Decision | owner, 2026-11-26: findings accepted by name, for a limited time, after a security review |
| Scope | the pinned digest only, each id tied to its package version. The app image has no exceptions |
| Review | **by 2026-12-26 or before go-live, whichever is first** |
| Expiry | gate 7 fails from 2026-12-27 00:00 UTC. "Before go-live" is not enforced by the gate: step 2 below |
| Also fails on | any finding not on the list, or a changed pin (`check-pipeline.sh`) |
| Conditions | database network internal, 5432 never published (`post-deploy-check.sh`); database containers as user 70:70 (`compose.yaml`, `ci.sh`); a reachable pre-login finding reopens the decision |

Renewing or changing the list needs a new owner decision. With a shared server the pinned image still runs the
dump and restore-test jobs; the server's own image is its owner's.

## Before the first deploy (each outward step needs the owner's yes)

1. VPS read-only check: memory, disk, Docker and Compose versions, Traefik mode and network, **a shared
   PostgreSQL** (version, network, host name), a shared volume, backup setting. Host-network Traefik means the
   `web` network and labels in `compose.yaml` must change.
2. **Go-live item:** scan every architecture of the pinned digest that will run, and look for a newer official
   digest (both need a pull). Review the accepted findings (above) before go-live.
3. Clear the go-live blockers (above).
4. The "Jenkins server settings" above: two agents, then the job and the `ghcr-creds` credential.
5. Stage 4 publishes the test database on the loopback of the build agent's Docker host. An agent that runs
   inside a container cannot reach that: check on the first run. Gate 7 runs the scanners as the agent's user.
6. Decide who watches the nightly dump's health, and set up a copy off this disk.
7. DNS for the host and `www.<host>`; the proxy address ("The proxy address"); then the first release,
   `bootstrap-env.sh` and first deploy ("First release through the pipeline").
8. Sign in, change the password, `sh bootstrap-env.sh --drop-admin-password`, `deploy.sh <current tag>`; test the
   rate limit (above). In `/admin`, set the real contact email: the seed content holds the placeholder
   `hello@example.com`. On the Profile tab change the **Email** field and the `Email` social link (handle, and
   address as `mailto:`), then save.

## Docker standard: exceptions and points not met

Approved by the owner on 2026-11-26 (recorded in
[ADR 0005](../docs/adr/0005-database-storage-and-backups.md)):

| Exception | Scope |
|---|---|
| Own image | no common image exists; this app keeps one image of its own |
| Database and dumps on the one volume | only if the server has no shared PostgreSQL; a copy off the disk is required |
| Autoscaling, namespace quota, rolling update | not applicable to single-server Compose; short downtime on update |

Only these three are approved. Everything below is undecided.

Still not met, no exception recorded:

| Rule | Here |
|---|---|
| Reuse the shared volume | the setting exists; whether the server has one is unchecked |
| One mount path in every container | the app mounts nothing; the dump jobs mount only the dumps folder |
| Temporary files in the app's folder | kept in memory (tmpfs): the app's credentials file must not be on a volume |
| Retention rule for old files | written, off (`BACKUP_PRUNE=0`) until the owner allows deleting |
| Separate live and ready probes | the app serves `/api/health` and `/api/ready`; Docker has one health check, on ready |
| No root | the application, database, scanners and helpers are not root; access to the Docker socket still equals root |
| Fail on High/Critical | the 46 accepted PostgreSQL findings (above) |
| Image published to a public registry, one push, deploy | not pushed, not deployed |
| Registry retention | none |
| Staging, then the same digest in production | no staging target |
| Live usage within limits | nothing is deployed |
