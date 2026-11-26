# ADR 0005: PostgreSQL storage and backups

Date: 2026-11-26. Status: **PROVISIONAL.**

Option B is built and tested locally. It stays provisional until a read-only check of the target server (an existing
shared PostgreSQL means A; B also needs 1 GB `MemAvailable` and 5 GB free disk). Nothing is deployed. The owner
decided on 2026-11-26: nightly backup on with no automatic deletion, and the PostgreSQL image findings accepted for
a limited time (both below). Neither settles the storage option.
Files and commands: [`deploy/README.md`](../../deploy/README.md).

## Context

- The stack keeps PostgreSQL (ADR 0001). Four small tables, one writer.
- Container standard: one shared volume, never an additional one; no database files on that shared volume.
  For a database we host ourselves, both lines cannot hold at once.

## Options

| Option | Good | Bad |
|---|---|---|
| A. Use a PostgreSQL that already runs on the server and is meant to be shared **(first choice if it exists)** | No new volume, least RAM | None verified to exist; shared blast radius |
| B. Own `postgres:17` container + volume `portfolio-pg-data` and backup volume, written exception **(recommended if A is not there)** | Isolated | Breaks "one volume"; about 256 MB more RAM |
| C. SQLite file on the shared volume | One container, least RAM; tested path | Breaks "no database files on the shared volume" |

## Recommendation

A if one is found, else B. The app container itself has no volume in every option except C.

## Database setup (A or B)

- Role `portfolio_app`, not a superuser, owns database `portfolio` only. Created by
  `deploy/postgres-init/10-app-role.sh` on first start.
- Role `portfolio_backup`, read only, for the dump and restore-test jobs (secret `BACKUP_DB_PASSWORD`). Same init
  script.
- Image `postgres:17.11-alpine` pinned by digest.
- `mem_limit: 256m`, `shared_buffers=64MB`, `max_connections=20`, internal network only.

## Backups

- Nightly `pg_dump -Fc`. A dump counts only if `pg_restore -l` lists the tables **and** `pg_restore -f /dev/null`
  reads it to the end (the listing alone accepts a cut-off file).
- A failed or missing dump shows in the log, in `failures.log` and as an unhealthy container. Nothing sends a
  message yet.
  Option B runs it as a `pg-backup` sidecar (same postgres image, `mem_limit: 64m`).
- A manual dump runs before every deploy.
- Dumps hold the password hash and visitor IPs: owner-only mode, never on a shared volume, never in an image.
- Restore test into a throwaway database before go-live, then monthly.
- Dumps on the same disk do not survive disk loss: a copy off that disk is needed. None is chosen yet.
- **Decided (owner, 2026-11-26): the nightly job is on and nothing is deleted automatically**
  (`BACKUP_PRUNE=0`). A 7 daily + 4 weekly pruning rule exists in the script and applies only if pruning is approved
  later: removing old dumps deletes data. `BACKUP_PRUNE` is fixed to `0` in `deploy/compose.yaml`, not an `.env`
  switch; turning pruning on needs the owner's yes and a compose change. Current commands:
  [`deploy/README.md`](../../deploy/README.md).
- Cost of that choice: dumps, and the extra Sunday copy, pile up on the disk. Someone must watch free
  space; growth rate and who watches are UNVERIFIED / not chosen.
- Targets: lose at most 24 h of edits; restore within 1 h. Not measured on a server.

## PostgreSQL image findings: accepted for a limited time

Decided by the owner on 2026-11-26, after a security review.
**Review by 2026-12-26 or before go-live, whichever comes first.**

- Scope: the one pinned digest of `postgres:17.11-alpine` named in `deploy/compose.yaml`.
- Findings are accepted one by one, each tied to a package version and an expiry date, in
  `deploy/postgres-accepted.trivyignore.yaml`. Any new finding still fails the gate, and the application image has
  no exceptions.
- Gate 7 scans the PostgreSQL image with that list; `deploy/check-pipeline.sh` guards it.
- Conditions: the database network stays internal and port 5432 is never published; CI runs PostgreSQL as the same
  non-root user as the server; before go-live scan every architecture that will run and look for a newer official
  digest (a pull needs the owner's yes). A new finding that is reachable without signing in reopens the decision.

## Schema changes

`CREATE TABLE IF NOT EXISTS` on boot stays (release 1 changes no table). The first `ALTER` brings in
numbered migration files, with a database review.

## Resource fit

App 256 MB + database 256 MB + backup 64 MB is about 580 MB of limits; the monthly restore test adds up to
320 MB while it runs. Deploy only if the server shows at least 1 GB `MemAvailable` and 5 GB free disk (read-only
check).
