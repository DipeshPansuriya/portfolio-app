# Deploy: portfolio on the Hostinger VPS

Date: 2026-11-26. Design: [ADR 0004](../docs/adr/0004-deploy-hostinger-vps.md),
[ADR 0005](../docs/adr/0005-database-storage-and-backups.md).

**Status: tested on one Mac only. The pipeline is not active. No image is pushed and nothing is deployed.**
**Storage: ADR 0005 option B (own PostgreSQL and volumes), PROVISIONAL until a check of the target server.**

## Pipeline

```
 git commit
   |
   v
 1 install > 2 typecheck > 3 SQLite tests > 4 PostgreSQL tests > 5 build + budget
                                                                      |  dist/, dist-server/
   v
 6 image build ----------> 7 scans (gitleaks, Trivy) ----------> 8 read-only run check
   APP_IMAGE=<ns>/portfolio:<sha>     fail on a secret or HIGH/CRITICAL      throwaway database
                                      (app image: no exceptions; database
                                      image: only the accepted list)
   |
   v   main + RELEASE ticked + a person approves        secrets used
 9 push the image                                       docker-hub-creds, docker-hub-namespace
 10 back up and deploy (deploy.sh over the Docker socket)   server .env (stays on the server)
 11 post-deploy checks, public URL; failure = rollback      none

 Only main is built: this agent holds the Docker socket.
```

| Stage | Where it is | Output |
|---|---|---|
| 1-8 | `scripts/ci.sh <n>`, same names in `Jenkinsfile` (`sh deploy/check-pipeline.sh`) | image in the local Docker |
| 9 | `Jenkinsfile` | one public image, tag = commit |
| 10 | `deploy/deploy.sh` | dump in `portfolio-pg-backups`, `release.env`, `releases.log` |
| 11 | `deploy/post-deploy-check.sh` | pass or rollback |

`prepare` refuses any branch but `main` and every pull request, then runs `check-pipeline.sh` and
`check-scripts.sh`. **That guard is only a second lock**: a branch can edit the Jenkinsfile. Set the job up so
other code never reaches this agent:

- one "Pipeline script from SCM" job, branch `*/main`; no multibranch or organisation job, no pull request or
  fork discovery, no webhook that builds other refs;
- GitHub: protect `main` (changes by pull request, no force push; see [GitHub policy](../docs/GITHUB-POLICY.md));
- branches are checked locally with `sh scripts/ci.sh`, or later on a separate agent without the socket.

No package install runs scripts (`npm ci --ignore-scripts` in gate 1 and the Dockerfile). Repository code
(tests, build) still runs on the agent, which is why only trusted code may reach it.

## Files

| File | Use |
|---|---|
| `compose.yaml` | server stack: `app`, `postgres`, `pg-backup`, `pg-restore-test`; Traefik labels |
| `env.example` | variable names |
| `bootstrap-env.sh` | writes the server `.env` once, random secrets, mode 600 |
| `postgres-init/10-app-role.sh` | roles `portfolio_app` (owner) and `portfolio_backup` (read only), database `portfolio`; first start, safe to rerun |
| `postgres-accepted.trivyignore.yaml` | the accepted findings of the PostgreSQL image, with expiry date (below) |
| `backup/backup.sh`, `backup/check.sh`, `backup/restore-test.sh` | dump, dump health, restore check |
| `deploy.sh`, `post-deploy-check.sh`, `checks/probe.mjs` | deploy, rollback, checks |
| `check-pipeline.sh`, `check-scripts.sh` | static and stand-in checks (no Docker); also in Jenkins `prepare` |
| `rehearse.sh`, `compose.local.yaml`, `offline-npm-cache.mjs` | local only |

## Variables

| Name | Secret | Where | Note |
|---|---|---|---|
| `APP_IMAGE` | no | pipeline; server `release.env` | the one place the image is named |
| `PORTFOLIO_HOST` | no | server `.env` | also gives `PUBLIC_ORIGIN` |
| `TRUST_PROXY` | no | server `.env` | 1 = Traefik alone, 2 = CDN then Traefik |
| `TRUSTED_PROXY_IPS` | no | server `.env` | optional: Traefik's address or subnet on the `web` network; empty trusts any private peer |
| `ADMIN_EMAIL`, `ADMIN_NAME` | no | server `.env` | owner account, first start |
| `ADMIN_PASSWORD` | yes | server `.env` | first start only, then dropped |
| `POSTGRES_PASSWORD`, `DB_PASSWORD`, `DATABASE_URL` | yes | server `.env` | |
| `BACKUP_DB_PASSWORD` | yes | server `.env` | read-only role used by the dump and restore-test jobs |
| `TRAEFIK_NETWORK` | no | server `.env` | default `web` |
| `DEPLOY_CLI_IMAGE` | no | Jenkins | `docker:cli` pinned `name@sha256:` |
| `CI_OFFLINE`, `TRIVY_DB_UPDATE`, `TRIVY_CACHE_DIR`, `SOURCE_URL` | no | `ci.sh` | optional |

## Run it locally

```bash
CI_OFFLINE=1 TRIVY_DB_UPDATE=1 sh scripts/ci.sh          # gates 1-8; first scan downloads the Trivy database
CI_OFFLINE=1 sh scripts/ci.sh 6                          # image only (gate 5 first)
sh deploy/rehearse.sh <image A> <image B>                # stack, backups, deploy failures, rollback; cleans up
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
cat releases.log                   # what ran, when, image id, volumes
```

A rollback changes the app image only. It does not restore the database or an older `compose.yaml`
(for that, deploy the older commit through the pipeline).

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

1. If a database volume exists: start `postgres` and dump it. After a successful release the running (or
   stopped) database is **not recreated** for this, so new database settings apply only after the dump. If it
   cannot become healthy, nothing is deployed and it must be repaired by hand.
2. Start `app` (and what it depends on), check it, record it. On failure the current image comes back.
3. Recreate `pg-backup`; its health never rolls the app back.

A first deploy that failed before the app made its tables can simply be run again: with no release recorded and
no tables there is nothing to dump.

### The first-start script failed

The image never retries it: the next start logs `Skipping initialization` and a role is missing (the database
never turns healthy, or the dump fails to sign in). Fix the cause, then run it by hand and deploy again. After
a failed first deploy there is no `release.env`, so name the image in the command (`$C` cannot be used):

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
4 weekly kept) needs the owner's yes and a change to that line. So dumps pile up on the VPS disk: check
`$C exec pg-backup du -sh /var/lib/postgresql/dumps` and free disk space monthly.

| When | What happens |
|---|---|
| start with no dump from the last 24 h | dumps at once |
| every night 02:00 UTC | dump; Sunday also a weekly copy |
| a dump is cut off, partial or cannot be saved | removed; `ALERT` in the log, line in `dumps/failures.log`, `dumps/LAST_FAILURE`; retried after 15 min |
| last run failed, or no dump for 26 h | container is `unhealthy` (checked every 5 min) |
| database over 80 MB | `WARNING` in the log: the restore test may run out of space |

- A job stopped during a dump can leave a `*.part` file. The next runs log `WARNING: unfinished dump files`;
  nothing deletes them, so remove them by hand.
- **No message is sent anywhere.** Someone or a monitor must look at the health state or run `check.sh`
  (alert channel: not chosen).
- Restore test: before go-live, then monthly. It builds the throwaway database in memory (192 MB; the one-shot
  container may use 320 MB while it runs).
- Dumps are on the same disk as the database: a Hostinger VPS backup is still needed (UNVERIFIED).
- Data checksums are on for a volume created from now on; an existing volume would need `pg_checksums` offline.

### Restore over the live database

Changes real data: **the owner decides.** `rehearse.sh` runs these steps on a throwaway stack (not the safety
dump line, and never on a server). The dump jobs sign in read-only, so the restore passes the app role's password
by name; it never appears in a command line.

```bash
$C run --rm -T --no-deps --entrypoint ls pg-backup -l /var/lib/postgresql/dumps   # pick F (full path) first
$C run --rm -T pg-restore-test "$F"          # DIFF is expected for an older dump; it must restore
(set -e                                      # one block: the first failure stops the rest
 $C stop app pg-backup
 $C run --rm -T -e RUN_ONCE=1 pg-backup      # safety dump
 PGPASSWORD="$(sed -n 's/^DB_PASSWORD=//p' .env)"
 export PGPASSWORD
 $C run --rm -T -e PGUSER=portfolio_app -e PGPASSWORD --entrypoint pg_restore pg-backup \
   --clean --if-exists --single-transaction --no-owner -d portfolio "$F"
 $C exec -T postgres psql -U postgres -d portfolio -v ON_ERROR_STOP=1 -c 'DELETE FROM sessions'   # no old sign-in comes back
 $C start app pg-backup
)
```

If the block stops, `app` and `pg-backup` stay stopped (`$C start app pg-backup` brings them back). If the
safety dump fails because the database is gone or partial, restoring without it is **the owner's decision**:
remove that line and run the block again. The owner password becomes the one in the dump.

## Database passwords

Changing one revokes the old credential: **the owner decides.** The `postgres` health check is readiness only
(the image trusts connections from `127.0.0.1`), so it does not prove a password: check the app and the dump.
UNVERIFIED as a sequence (only the `ALTER ROLE` form was run, in a database review).

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

Renewing or changing the list needs a new owner decision.

## Before the first deploy (each outward step needs the owner's yes)

1. VPS read-only check: memory, disk, Traefik mode and network, a shared PostgreSQL, backup setting.
   Host-network Traefik means the `web` network and labels in `compose.yaml` must change.
2. **Go-live item:** scan every architecture of the pinned digest that will run, and look for a newer official
   digest (both need a pull). Review the accepted findings (above) before go-live.
3. Jenkins job on the repository; Node 26 on the agent; pinned images pulled there; `DEPLOY_CLI_IMAGE`.
4. Stage 4 publishes the test database on the host's loopback. A Jenkins that runs inside Docker cannot
   reach that: check on the first run.
5. Decide who watches the nightly dump's health, and set up a copy off this disk.
6. DNS; `sh bootstrap-env.sh <host> <admin email>`; set `TRUSTED_PROXY_IPS` to Traefik's address or subnet; first
   `deploy.sh <full image name>`.
7. Sign in, change the password, `sh bootstrap-env.sh --drop-admin-password`, `deploy.sh <current tag>`; test the rate limit (above).
   In `/admin`, set the real contact email: the seed content holds the placeholder `hello@example.com`. On the
   Profile tab change the **Email** field and the `Email` social link (handle, and address as `mailto:`), then save.

## Docker standard: known exceptions

| Rule | Here |
|---|---|
| One shared volume, never another | two own volumes (ADR 0005 B, provisional) |
| One common image | this app has its own image (ADR 0004) |
| Rolling update, no downtime | one replica, a few seconds per deploy (ADR 0004) |
| Autoscaling, namespace quota | not available in compose |
| Image published to a public registry | not pushed yet |
