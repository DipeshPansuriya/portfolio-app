# CI and pull request checks

**Date:** 2026-11-26. **Repository:** https://github.com/DipeshPansuriya/portfolio-app

**Status:** the GitHub checks ran green on the published copy (9 workflow runs, 2026-11-26). The Jenkins pipeline is
written but **not active**. Deploy, image push to the registry, the live server and browsers other than Chrome are
**not done or UNVERIFIED** (see section 6).

Each check runs the same command you can run on your own machine. Nothing here needs a server.

## 1. Where each check runs

| Check | Runs on a pull request | Runs on `main` | Runs in Jenkins | Writes anything |
|---|---|---|---|---|
| Secret scan (`security.yml`) | yes | yes | no | no |
| Security audit (`security.yml`) | yes | yes | no | no |
| Hook installer (`security.yml`) | yes | yes | no | no |
| Typecheck, syntax, docs links, tests, build budget (`quality.yml`) | yes | yes | typecheck, tests and build budget (gates 1-5) on `main` | no |
| Image build and scan (`quality.yml`) | yes (not a required check yet) | yes | gates 6-8 | no |
| Automated review (`pr-review.yml`) | yes, not drafts | no | no | one comment on the pull request |
| CodeQL and Dependabot | GitHub managed | GitHub managed | no | alerts and pull requests |
| Pipeline gates 1-8 (build agent) and release 9-11 (deploy agent) | no | yes, when started by hand | yes | stages 9-11 only after an approval by a named user |

Jenkins runs only `main`. This is deliberate: the Jenkins agent holds the Docker socket, so it must not run code from
pull requests. See [Testing, QA and debugging](implementation/Testing-QA-Debugging.md) for the gate list.

## 2. What each check catches

| Check | What it catches | What it does not catch |
|---|---|---|
| Secret scan (tree and full history) | API keys, tokens, private keys, `.env` values, files that must never be committed | a secret written in a non-standard form; a secret already revoked |
| Security audit (`scripts/security_audit.sh`) | unsafe code patterns (`eval`, unsafe HTML), exposed ports, path escapes, request size, TLS checks, secrets in tracked files, ignore rules, file permissions | business logic flaws; a full penetration test |
| Hook installer | the git hooks are present and match the saved copies | a clone that never ran the installer |
| Typecheck | type errors in TypeScript | runtime errors |
| Syntax gates | broken Python, JavaScript, shell scripts and deploy checks | wrong behaviour |
| Documentation links | broken relative links in `docs/`, `deploy/` and root documents | wrong content |
| Tests (SQLite and PostgreSQL) | behaviour of the server, content, sign-in limits, the page, the game and the repository rules | browsers, real devices, live server |
| Build and bundle budget | first-load JavaScript above 160 kB (gzip), CSS above 15 kB, three.js in the first load | visual problems |
| Image build and scan | image build errors, secrets in the image, HIGH or CRITICAL vulnerabilities in the app image, new findings in the database image | findings the owner has accepted (listed in `deploy/postgres-accepted.trivyignore.yaml`) |
| Read-only run check (gate 8) | the image starts hardened, read-only, not as root; the probe and password reset work | the stack behind a proxy |
| Automated review | a typecheck, secret, link and syntax summary with the changed files | correctness: it never approves or blocks by itself |
| CodeQL | code-scanning findings in JavaScript, TypeScript and Python (GitHub managed) | triage is manual; see section 6 |
| Dependabot | outdated or vulnerable dependencies and Actions; weekly version pull requests | the database image (updated by hand) |

## 3. Run it locally

Needs Node 26 (the checks run on 26; `package.json` asks for 22.18 or newer, and 22.18 is **UNVERIFIED**), npm, git and
Python 3. Docker only for gate 4 and gates 6 to 8.

```bash
./scripts/install_hooks.sh                  # once per clone (needs Python 3)
npm ci --ignore-scripts                     # gate 1
npm run typecheck                           # gate 2
npm test                                    # gate 3: SQLite
python3 scripts/check_secrets.py            # secret scan, working tree
python3 scripts/check_secrets.py --all-history
python3 scripts/check_docs.py               # documentation links
./scripts/security_audit.sh --quick         # audit without the network
sh deploy/check-pipeline.sh                 # pipeline names match the gates
sh deploy/check-scripts.sh                  # deploy failure paths, no Docker
npm run build && node scripts/check-bundle.mjs   # gate 5
sh scripts/ci.sh                            # all eight gates; needs Docker and the pinned images
```

Gate 4 (PostgreSQL) and the image gates need pinned images pulled first. `CI_OFFLINE=1 sh scripts/ci.sh` avoids
downloads; the vulnerability database must already be cached, or set `TRIVY_DB_UPDATE=1` once.

Never point `TEST_DATABASE_URL` at a server you care about: the tests create and drop databases.

## 4. Test files and what they cover

Counts are for the working tree on 2026-11-26. **Recheck pending:** the counts and results below are reviewed again
after the open code and test changes land. The per-database totals in section 4.2 are the only numbers to quote.

### 4.1 By file

| File | Tests | Covers |
|---|---|---|
| `tests/content.test.mjs` | 12 | content seed, validation, save, ETag, compression, restore, parallel saves, file isolation |
| `tests/defects.test.mjs` | 13 | fixed defects: character limits, accents, chapter ids, headline rules, narrow screens, gate sign text |
| `tests/dynamic.test.mjs` | 15 | page head and structured data from content, escaping of hostile text, limits, history, contact buttons |
| `tests/game.test.mjs` | 13 | drive controls, win and race again, best time, blocked storage, gate hold, content checks |
| `tests/guards.test.mjs` | 11 | production start-up rules, credentials file, readiness endpoint, CSRF comparison, link rules, `.env.example` |
| `tests/hardening.test.mjs` | 18 | sessions and password change, 409 and 400 handling, proxy trust, database log content, query time limits, boot repair |
| `tests/hash-cap.test.mjs` | 8 | password hash limit, sign-in queue, 503 under flood, audit write cannot block other sign-ins |
| `tests/layout.test.mjs` | 3 | server code does not import `src/`; shared folders stay where they are |
| `tests/owner-defaults.test.mjs` | 3 | first owner account, reset rules |
| `tests/packaging.test.mjs` | 9 | only `pg` at run time, bundle budgets, CI gate order and image name |
| `tests/public-copy.test.mjs` | 2 | private-detail rules for the publishing script (this file is not in the public copy) |
| `tests/repo-guards.test.mjs` | 14 | secret patterns, scanner ranges and history, git hooks, tag rules, workflow permissions |
| `tests/security.test.mjs` | 18 | sign-in limits per address and per email, IPv6 budget, proxy headers, Host and Origin checks, recovery |
| `tests/server.test.mjs` | 14 | save then fetch, chapter ids, throttle, bad input gives 4xx, compression, 404 rules |
| `tests/shell.test.mjs` | 8 | server-rendered page, saves change the ETag, script escape, fallback page |
| `tests/smallscreen.test.mjs` | 3 | drive controls on small screens, mobile menu, restore of a damaged revision |
| `tests/ui.test.mjs` | 6 | intro and win cards stay on screen, gate notice, admin error marks |
| `tests/harness.mjs` | — | shared helper, not a test |

Total at the current head: **170 tests in 17 files** (2026-11-26). The published copy has 16 files; its count is 168
once the public copy is rebuilt (not yet run).

### 4.2 Per database (last recorded results)

| Run | SQLite | PostgreSQL | Skipped or todo | Source |
|---|---|---|---|---|
| Local, commit `0813095` | 170 of 170 | 170 of 170 | 0 | developer run, 2026-11-26; independent re-check pending |
| Local, commit `c270d08` (earlier) | 156 of 156 | 156 of 156 | 0 | developer run, 2026-11-26 |
| Published copy, `main` | 151 of 151 | 151 of 151 | 0 | GitHub job logs of the `Tests` job, `main` and pull request 1, 2026-11-26 |
| **To recheck after code changes** | pending | pending | must be 0 | rerun `sh scripts/ci.sh 1 3 4` |

A skipped or todo test **fails** gates 3 and 4 (`scripts/no-skips-reporter.mjs`).

## 5. Check the pull request, step by step

1. Open a pull request into `main`. Draft pull requests run only the security and quality checks, not the review comment.
2. Wait for the checks listed in `docs/GITHUB-POLICY.md` section 2.2 to pass. The branch must be up to date.
3. Read the **Automated review** comment (it is updated on each push). It is a report, not an approval.
4. Review by hand. Auto-merge is off on purpose; a person merges.
5. Dependabot pull requests get the same review. Nothing merges by itself.

## 6. Not covered, and not done

| Item | State |
|---|---|
| Browser checks in CI | not in CI. Run by hand in Chrome (headless) only |
| Safari, Firefox | **UNVERIFIED**: not tested (Safari automation was refused on the test machine) |
| Real phones, screen readers, foldable devices | **UNVERIFIED** |
| Deploy, live server, Traefik, TLS, rate limit on a proxy | **not done**; UNVERIFIED (`deploy/README.md`) |
| Image pushed to the registry | **not done** (release stage not run) |
| Jenkins pipeline | **not active**; written; no job exists |
| Performance score (Lighthouse) | accessibility, best practices and SEO were recorded earlier; performance **UNVERIFIED** |
| Code scanning alerts (CodeQL) | triage is open; each alert is **UNVERIFIED** until a person reviews it |
| Tests on other processor architectures | **UNVERIFIED** (only the local machine was scanned) |
| Coverage percentage | not measured (no coverage tool) |
| Penetration test | not done |

## 7. Related

- [Jenkins and GitHub policy](GITHUB-POLICY.md) and [push policy](PUSH-POLICY.md)
- [Testing, QA and debugging](implementation/Testing-QA-Debugging.md)
- [VPS deployment of the app](implementation/VPS-Deployment.md)
- [Deploy guide](../deploy/README.md)
