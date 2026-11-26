# GitHub policy: branch protection, review and required checks

**Date:** 2026-11-26  **Status:** Planned. The GitHub settings below are **to be applied at publish**. None of them
is in force until `scripts/github_settings.py check` passes against the public repository.

**Related:** [Branch policy](BRANCH-POLICY.md), [Push policy](PUSH-POLICY.md),
[Hardening checklist](REPO-HARDENING-CHECKLIST.md), [SECURITY.md](../SECURITY.md)

## 1. Rule

`main` is to be protected: no direct push, no force push, no deletion, and merging only through a pull request with
green required checks. This is done with **repository rulesets**, defined in `scripts/github_settings.py`.

## 2. Rulesets

| Ruleset | Target | Bypass | Rules |
|---|---|---|---|
| `main-protection` | default branch | none | `deletion`, `non_fast_forward`, `required_linear_history`, `pull_request`, `required_status_checks` |
| `release-tags` | `refs/tags/v*` | none | `deletion`, `non_fast_forward`, `update` |

### 2.1 Pull request parameters

| Parameter | Value | Why |
|---|---|---|
| `required_approving_review_count` | `0` | one maintainer; GitHub does not let an author approve their own pull request |
| `dismiss_stale_reviews_on_push` | `true` | a new push voids earlier review state |
| `require_code_owner_review` | `false` | `.github/CODEOWNERS` is ready if this is switched on later |
| `require_last_push_approval` | `false` | goes with the approval count |
| `required_review_thread_resolution` | `true` | every review comment must be resolved |
| `allowed_merge_methods` | `squash`, `merge` | no rebase merge; the linear history rule means only squash reaches `main` |

### 2.2 Required status checks

The branch must also be up to date (`strict_required_status_checks_policy: true`).

| Check | Workflow | What it runs |
|---|---|---|
| `Secret scan` | `security.yml` | scanner on the tree and the full history |
| `Security audit` | `security.yml` | `scripts/security_audit.sh` |
| `Hook installer` | `security.yml` | installs the git hooks and verifies them |
| `Typecheck` | `quality.yml` | CI gates 1 and 2 |
| `Syntax gates` | `quality.yml` | Python, JavaScript and shell parse; deploy script checks |
| `Documentation links` | `quality.yml` | `scripts/check_docs.py` |
| `Tests` | `quality.yml` | tests on SQLite and on a throwaway PostgreSQL |
| `Build and bundle budget` | `quality.yml` | build and size budgets |
| `Automated review` | `pr-review.yml` | builds the review report |

`Image build and scan` (`quality.yml`) runs but is **not required** yet: it has never run on GitHub. It is also
built to fail after the review date of the database image acceptance list, until the owner reviews it.

## 3. Repository settings

| Setting | Value |
|---|---|
| Visibility | public |
| Squash merge, merge commit | on |
| Rebase merge | off |
| Delete branch on merge | on |
| Auto merge, update branch button | on |
| Issues, wiki, projects | on |
| Discussions | off |
| Labels for Dependabot | `dependencies`, `github-actions`, `javascript`, `docker` |

Description and topics are also set by the script.

## 4. Actions hardening

| Setting | Value | Effect |
|---|---|---|
| `sha_pinning_required` | `true` | every `uses:` must be a commit hash |
| `allowed_actions` | `all` | any action, but only pinned |
| `default_workflow_permissions` | `read` | a workflow must ask for write |
| `can_approve_pull_request_reviews` | `false` | the workflow token cannot approve |
| Fork pull request approval | `first_time_contributors` | a first-time contributor's run waits for approval |

Already true in the workflow files today:

| Action | Tag | Used in |
|---|---|---|
| `actions/checkout` | v7.0.1 | all three workflows |
| `actions/setup-python` | v7.1.0 | all three workflows |
| `actions/setup-node` | v7.1.0 | all three workflows |
| `actions/github-script` | v9.0.0 | `pr-review.yml` |

Each is pinned to a commit hash. No workflow uses `pull_request_target`. `security.yml` and `quality.yml` ask for
`contents: read` only. `pr-review.yml` is `contents: read` too, except its comment job, the only job with
`pull-requests: write`. That job checks out nothing and runs no code from the pull request.

## 5. Scanning and dependency updates

| Feature | State |
|---|---|
| Secret scanning and push protection | to be applied at publish |
| Dependabot alerts and security updates | to be applied at publish |
| Private vulnerability reporting | to be applied at publish |
| CodeQL default setup, weekly (`actions`, `javascript-typescript`, `python`) | to be applied after the first push |
| Dependabot version updates (`.github/dependabot.yml`: Actions, npm, Docker; weekly) | file present; starts on GitHub |

The database image is updated by hand: its digest appears in `deploy/compose.yaml`, `scripts/ci.sh` and the
acceptance list together, and `deploy/check-pipeline.sh` enforces that they agree.

## 6. Workflows

| Workflow | Trigger | Jobs |
|---|---|---|
| `security.yml` | push to `main`, pull request to `main`, manual | secret scan, audit, hook installer |
| `quality.yml` | the same, plus `v*` tags | typecheck, syntax, docs, tests, build, image |
| `pr-review.yml` | pull request opened, updated, reopened, ready for review | `Automated review` (report, read only), then `Review comment` |

No workflow publishes or uploads a build. No repository secret is needed; only the automatic `GITHUB_TOKEN` is used.

`pr-review.yml` posts one comment, marked `<!-- portfolio-auto-review -->`, with typecheck, secret, link and syntax
results and the changed files, and updates it on later pushes. It never approves. The comment holds at most 60,000
bytes of the report. For a pull request from a fork the comment job is skipped; the report is in the log of the
`Automated review` job. Draft pull requests are skipped. `Review comment` is not a required check.

## 7. Applying and checking

The script reads `GITHUB_PERSONAL_ACCESS_TOKEN` from the environment, sends it only in the request header and never
prints it. It acts on the repository named by its `OWNER` and `REPO` constants. Without `--apply` it only prints what
it would send.

```bash
python3 scripts/github_settings.py create   [--apply]   # new public, empty repository
python3 scripts/github_settings.py settings [--apply]   # before the first push
# push main, wait for green checks
python3 scripts/github_settings.py protect  [--apply]   # CodeQL and both rulesets
python3 scripts/github_settings.py check                # read only
```

`create` refuses an existing repository. `settings` and `protect` refuse a repository that is not public.
`protect` sends the rulesets as written in the script, so make lasting changes there, not only in the web page.

For each ruleset, `check` compares: active, no bypass, target, ref conditions, the expected rule types and the rule
parameters the script sends. Additional rules and additional required checks do not fail it.

## 8. Approval gate (later)

Zero approvals is a single-maintainer setting, not an approval. When a second account joins:

1. add it as a collaborator first;
2. then set `required_approving_review_count` to `1` and `require_last_push_approval` to `true` in the script and
   run `protect --apply`.

Raising the count before a second reviewer exists would block every merge.

## 9. Limits

| Limit | Meaning |
|---|---|
| Workflows never run on GitHub | UNVERIFIED until the first push; Linux runners and the image scan are untested |
| Zero required approvals | checks are the only gate |
| `Automated review` is required but advisory | it reports, it does not judge correctness |
| Workflow permissions are set in the workflow files | review a change to them with the same care as code |
| Tag ruleset blocks delete and move, not creation | a new tag can still be pushed |
| Signed commits are not required | authorship is not proven |
| Non-provider secret patterns and validity checks | not set by the script |
