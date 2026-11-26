# Testing, QA and debugging

**Date:** 2026-11-26  **Status:** Results are from local runs on one Mac. GitHub workflows and a live server are
untested (UNVERIFIED).

## 1. Gates

`sh scripts/ci.sh` runs eight gates; `sh scripts/ci.sh --list` names them.

| Gate | Name | What it checks |
|---|---|---|
| 1 | install from the lockfile | `npm ci --ignore-scripts` |
| 2 | typecheck | `tsc -b` |
| 3 | tests on SQLite | `npm test` |
| 4 | tests on a throwaway PostgreSQL | the same tests on a pinned PostgreSQL image: generated password, resource limits, in memory, removed after |
| 5 | build and bundle budget | build; first-load JavaScript at most 160 kB, CSS at most 15 kB (gzip) |
| 6 | image build | `Dockerfile` |
| 7 | secret and vulnerability scan | gitleaks and Trivy; fails on High or Critical; the database image uses its acceptance list |
| 8 | read-only run check | the image runs hardened and read-only, becomes healthy, passes a probe and a password reset |

Gates 4 and 6 to 8 need Docker with the pinned images already pulled. `CI_OFFLINE=1` runs without downloads
([deploy guide](../../deploy/README.md#run-it-locally)). Gate 7 fails on purpose after the database image acceptance
expires.

## 2. Test suite

`npm test` runs `node --test tests/*.test.mjs`.

| File | Area |
|---|---|
| `content.test.mjs` | content storage, revisions, restore |
| `dynamic.test.mjs` | content reaching the page head and screens |
| `game.test.mjs` | drive logic |
| `guards.test.mjs` | production start-up rules |
| `hardening.test.mjs` | hardening rules |
| `hash-cap.test.mjs` | password hash cap |
| `layout.test.mjs` | repository layout rules |
| `owner-defaults.test.mjs` | first start and reset defaults |
| `packaging.test.mjs` | runtime packages, budgets, CI gates |
| `repo-guards.test.mjs` | secret scanner, git hooks, tag ruleset and settings check, review workflow |
| `security.test.mjs` | lockout, proxy trust, request guard, recovery |
| `server.test.mjs` | API behaviour |
| `shell.test.mjs` | server-rendered page |
| `smallscreen.test.mjs` | small-screen controls, damaged revision restore |
| `ui.test.mjs` | component markup |
| `harness.mjs` | shared helper, not a test |

`TEST_DATABASE_URL=postgres://...` runs the suite on a PostgreSQL you choose. The tests create and drop databases
there: use a disposable server. No coverage tool is configured.

Static checks without Docker: `sh deploy/check-pipeline.sh`, `sh deploy/check-scripts.sh`,
`python3 scripts/check_docs.py`, `./scripts/security_audit.sh --quick`.

## 3. Recorded results (2026-11-26)

Sections 3.1 to 3.3 are developer runs, not an independent pass. Newest first.

### 3.1 Latest code: repository protection

Secret scanner, git hooks, tag ruleset, settings check and review workflow.

| Check | Result |
|---|---|
| Tests on SQLite | 153 of 153 passed, 0 skipped |
| Tests on SQLite, in the clean copy prepared for publishing (it holds two tests fewer) | 151 of 151 passed, 0 skipped |
| Typecheck, build | passed |
| First-load JavaScript, CSS (gzip) | 139,306 B of 160,000; 10,365 B of 15,000 |
| Secret scanner: tree, all history, committed HEAD tree | no blocking findings, no warnings |
| Security audit, quick mode | 41 passed, 0 failed (dependency scan not included) |
| Documentation links, `deploy/check-pipeline.sh`, `deploy/check-scripts.sh` | passed |
| Tests on PostgreSQL | not run in these checks |
| Docker gates (4, 6 to 8) | not run in these checks |

### 3.2 Last recorded PostgreSQL run: application fixes before 3.1

Blank descriptions, stored null handles and the gate notice announcement (`sh scripts/ci.sh 2 3 4 5`).

| Check | Result |
|---|---|
| Tests on SQLite and on PostgreSQL | 138 of 138 passed on each, 0 skipped |
| Security audit, full | 42 passed, 0 warnings, 0 failed |

No later run of the Docker gates is recorded here.

### 3.3 Earlier run of all eight gates

Page head from content, navigation breakpoints, small-screen admin, length limits and History. The gates ran on a
fresh clone of the committed code, before the later changes.

| Check | Result |
|---|---|
| Gates 1 to 8 (`CI_OFFLINE=1 sh scripts/ci.sh`) | passed |
| Tests on SQLite and on PostgreSQL | 135 of 135 passed on each, 0 skipped |
| First-load JavaScript, CSS (gzip) | 139,301 B of 160,000; 10,365 B of 15,000 |
| Security audit, quick mode | 41 passed, 0 failed (dependency scan not included) |
| Browser checks, Google Chrome headless, widths 320 to 1440 px | 129 page checks passed, no page or CSP errors |
| Secret scan, documentation links, `deploy/check-scripts.sh` (separate run, without Docker) | passed |
| Safari, Firefox, real phones, screen readers | not tested (UNVERIFIED) |

### 3.4 Independent QA pass, on earlier code

Container build, Google Chrome, headless.

| Check | Result |
|---|---|
| Gates 1 to 6 and 8 | passed; tests 114 of 114 on SQLite and on PostgreSQL |
| FR-001, FR-002, FR-003, FR-004, FR-006, FR-007, FR-008 | passed in the sizes and cases tried |
| FR-005 | passed on one tab; the other tabs were not saved again in the browser |
| LCP, NFR-001 profile, local server, median of 3 | 1704 ms, CLS 0 |
| First-load JavaScript, gzip | 139,042 B of 160,000 |
| Lighthouse mobile and desktop | accessibility 100, best practices 100, SEO 100 (performance score UNVERIFIED) |
| Sign-in under a parallel flood | the page stayed responsive and a known browser could sign in |

Gate 7 was not part of that pass.

### 3.5 Repository safety checks, before 3.1

| Check | Result |
|---|---|
| Secret scanner, tree and history | no findings |
| Security audit, quick mode | 41 passed, 0 failed; planted faults were caught |
| `npm audit` on the lockfile | 0 known vulnerabilities on that day |
| Hooks on a scratch clone | blocked every planted case ([Push policy](../PUSH-POLICY.md#8-what-was-checked)) |

## 4. Not verified

- PostgreSQL tests and Docker gates on the latest code: no result is recorded here (3.1).
- Real phones, Safari, Firefox, screen readers, 200% zoom, foldable devices, screens wider than 1440 px.
- Full lap by touch.
- GitHub workflows, Linux runners, Jenkins.
- A live server: proxy rate limit, TLS, deploy, rollback, nightly backup over several days, restore.
- Processor architectures other than the one scanned locally.
- The full in-container web build (stage `webbuild`).
- Node 22.18 as the lower bound.

## 5. QA checklist before a merge

- [ ] Commands in [CONTRIBUTING](../../CONTRIBUTING.md) pass
- [ ] Changed behaviour has a test
- [ ] Screen changes tried at a narrow and a wide size, light and dark
- [ ] Documents updated
- [ ] Evidence recorded: command and output, or `file:line`

## 6. Debugging

### 6.1 Local

| Tool | Use |
|---|---|
| `npm run dev:full` | web on 4318, API on 4319, logs in one terminal |
| `GET /api/health`, `GET /api/ready` | process up; database reachable |
| `data/admin-credentials.txt` | generated or reset password |
| `npm run db:check` | database connection and row counts |

### 6.2 On a server

| Question | Where |
|---|---|
| Is it up | `/api/health`, `/api/ready`, container health |
| What happened | container logs (rotated) |
| Who signed in, what changed | `audit_log` table |
| Are backups healthy | `check.sh` in the backup container ([deploy guide](../../deploy/README.md#backup-and-restore)) |
| What was released | `releases.log` |

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| App refuses to start | missing `TRUST_PROXY`, `PUBLIC_ORIGIN`, database, or `ADMIN_PASSWORD` on an empty database; or no valid content revision | set the variable; restore the database |
| "Too many attempts" (429) | sign-in or password change limit | wait the number of seconds in `Retry-After` |
| "The server is busy" (503) | password checks queued to the limit | retry after a few seconds; if it lasts, check logs. A new browser may keep getting it during a sustained flood ([limits](Authentication-Security.md#sign-in-limits)) |
| Save returns 409 | another save came first | discard and reload, then edit again |
| Save returns 422 | a rule or length limit | fix the marked fields |
| Save or sign-in returns 403 | Host or Origin not allowed, or stale CSRF token | set `PUBLIC_ORIGIN`; reload the page |
| Request returns 415 | not sent as JSON | set `Content-Type: application/json` |
| Head tags show old text | page build failed, or development server | check logs for `[shell]`; use the production server |
| Database never healthy after first deploy | first-start script failed | [deploy guide](../../deploy/README.md#the-first-start-script-failed) |
| Backup container unhealthy | dump failed or is old | read `failures.log`, dump again |
| Gate 7 fails on the database image | new finding, changed pin, or expired acceptance | owner decision ([ADR 0005](../adr/0005-database-storage-and-backups.md)) |
| Bad release | | `sh deploy.sh --rollback` (application image only) |

Restoring over a live database changes real data: the owner decides
([steps](../../deploy/README.md#restore-over-the-live-database)).
