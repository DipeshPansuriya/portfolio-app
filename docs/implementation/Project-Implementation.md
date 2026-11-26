# Implementation status

**Date:** 2026-11-26  **Status:** Release 1 built and tested locally. Not deployed.
**Related:** [Build plan](../plan/BUILD-PLAN.md), [Architecture](../ARCHITECTURE.md)

## Status

| Area | State |
|---|---|
| Web app, API, content in database | built |
| Production guards, server-rendered hero | built |
| Tests on SQLite and PostgreSQL | built; results in [Testing](Testing-QA-Debugging.md) |
| Container image, server stack, backups, deploy and rollback | built; tried locally only |
| Jenkins pipeline | written, **not active** |
| GitHub workflows and settings | files and script in the repository; to be applied at publish; never run on GitHub (UNVERIFIED) |
| Independent QA, security, database and code reviews | run before the latest fixes |
| Go-live | not started |

## Approach

The approved prototype was imported and made production-ready in ordered tasks, keeping its look and behaviour
([build plan](../plan/BUILD-PLAN.md), [ADR 0001](../adr/0001-stack-and-repo-layout.md)).

## Code organisation

[README, repository layout](../../README.md#repository-layout) and
[Architecture, server modules](../ARCHITECTURE.md#33-server-modules-server).

## Key decisions

| ADR | Decision |
|---|---|
| [0001](../adr/0001-stack-and-repo-layout.md) | keep the prototype stack, one package, add `shared/` |
| [0002](../adr/0002-content-in-database.md) | live content lives in the database |
| [0003](../adr/0003-prerendered-hero-shell.md) | server-rendered hero for mobile first paint |
| [0004](../adr/0004-deploy-hostinger-vps.md) | one image on a virtual server, Jenkins pipeline |
| [0005](../adr/0005-database-storage-and-backups.md) | PostgreSQL storage (provisional) and backups |

Also: the only runtime package is `pg`; no content is hard-coded as a default account; small interface text stays in
code.

## Open work before go-live

- Read-only server check, storage choice, host name.
- Image scan on every architecture that will run; review of the database image acceptance by 2026-12-26.
- Backup monitoring and a copy off the server disk; finish server secret handling.
- Proxy rate limit test, TLS and headers check on the real host.
- Safari, Firefox, real devices and screen reader checks.

## Known technical debt

| Item | Impact |
|---|---|
| No lint or formatter | style drift |
| No browser tests in CI | layout checks are partly by hand |
| One replica only (in-memory state) | no zero-downtime deploy |
| Revisions are never pruned | slow growth of the database |

## Capacity

Personal-site traffic. Memory limits in the server stack: application 256 MB, database 256 MB, backup 64 MB, restore
test 320 MB while it runs. Peak request rate, latency percentiles and data growth are not measured (UNVERIFIED).
