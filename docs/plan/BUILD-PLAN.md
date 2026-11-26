# Build plan (release 1)

Date: 2026-11-26. Status: T1 to T9 built; independent reviews run; go-live not started.

Release 1 takes an approved prototype and makes it ready for production. This page records the order of work and what
"done" meant for each task.

## Tasks

| # | Task | Done when | State |
|---|---|---|---|
| T1 | Import the prototype as the baseline | build and tests pass; `src/data/` is tracked; no `.env`, data or database file is tracked; a fresh clone builds | built |
| T2 | Add `shared/`, move the seed content to `content/` | `server/` imports nothing from `src/`; build and tests pass | built |
| T3 | Content in the database ([ADR 0002](../adr/0002-content-in-database.md)) | seed on an empty database; an invalid seed stops the start; save then read shows it; survives restart; restore; parallel saves; a save writes no file outside `data/` | built |
| T4 | Production guards | one test per rule: required variables, credentials folder, readiness endpoint, constant-time token compare, protocol-relative links refused | built |
| T5 | Server-rendered hero ([ADR 0003](../adr/0003-prerendered-hero-shell.md)) | hero and data block on `/` only; content cannot break out of the data block; drift test; headline visible with scripts off; local LCP at or under 2500 ms | built |
| T6 | Web libraries to development dependencies; bundle check; CI gates 1 to 5 | gates pass; a production install brings only `pg` and its dependencies; API tests pass on PostgreSQL | built |
| T7 | Hardened image, allow-list build context, gates 6 to 8 | non-root; read-only run; no env or data files in the image; scans pass | built |
| T8 | Server stack, database setup, backup and restore test | stack starts with generated secrets; content survives a recreate; dump restored into a throwaway database | built, local only |
| T9 | Pipeline, deploy with rollback, post-deploy checks | pipeline stages match the gate script; rollback rehearsed locally; pipeline not activated | built, not active |
| T10 | Independent QA on the container | pass or fail per requirement; untested items marked UNVERIFIED | run; see [Testing](../implementation/Testing-QA-Debugging.md) |
| T11 | Security review | no open High or Critical finding in the app; exceptions accepted by name | run; database image exception in [ADR 0005](../adr/0005-database-storage-and-backups.md) |
| T12 | Code review | no open blocking finding | run |

## Rules used while building

- Plan before code. "Done" needs command output or `file:line`.
- No new package or image without the owner's yes.
- Root-anchored ignore rules (`/data/`): a plain `data` rule would also drop `src/data/`.

## Go-live (each outward step needs the owner's yes)

1. Read-only server check: memory, disk, proxy network and mode, an existing shared database, backup options.
2. Owner decides: storage ([ADR 0005](../adr/0005-database-storage-and-backups.md)), host name, image push, deploy.
3. Create the server folder and `.env`, set DNS, first deploy, activate the pipeline.
4. Accept when: HTTPS and headers are correct; sign-in works on the real host; the audit log shows the real client
   address; a forged `X-Forwarded-For` does not change it; a save survives a redeploy; the first dump is restored;
   the rollback command is recorded; `ADMIN_PASSWORD` is removed after the first start; LCP is measured on the live
   host.

## Deferred (not release 1)

Re-login prompt when a session expires, 3D scene cost tuning, `og:image`, canonical link and sitemap (they need the
host name and an image).
