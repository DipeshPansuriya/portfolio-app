# Branch and repository policy

**Date:** 2026-11-26  **Status:** Files are in the repository. Everything that lives in GitHub settings is **to be
applied at publish**.

One page for what is in force, what is planned and who decides. Details: [GitHub policy](GITHUB-POLICY.md),
[Push policy](PUSH-POLICY.md), [Hardening checklist](REPO-HARDENING-CHECKLIST.md).

## 1. Summary

| Area | In the repository today | On GitHub |
|---|---|---|
| Secret blocking | git hooks and scanner | secret scanning and push protection: to be applied |
| Security audit | `scripts/security_audit.sh` | runs in `security.yml` (UNVERIFIED there) |
| Quality gates | `scripts/ci.sh`, `quality.yml` | required checks: to be applied |
| Branch protection | ruleset defined in `scripts/github_settings.py` | to be applied |
| Tag protection | ruleset defined for `v*` | to be applied |
| Code scanning | CodeQL settings defined in the script | to be applied |
| Dependency updates | `.github/dependabot.yml` | starts on GitHub; alerts to be applied |
| Ownership | `.github/CODEOWNERS` | review by code owner: off |

## 2. Branches

| Branch | Use |
|---|---|
| `main` | the only long-lived branch; the release pipeline builds nothing else |
| topic branches | short-lived, merged by pull request, deleted after merge |

Rules to be enforced on `main`: no deletion, no force push, linear history, pull request required, review threads
resolved, nine required checks on an up-to-date branch, no bypass for anyone.

## 3. Merging

| Method | Planned |
|---|---|
| Squash | on; the way into `main` |
| Merge commit | switched on in the settings, but the linear history rule keeps merge commits off `main` ([GitHub: available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)) |
| Rebase | off |

## 4. Commits

Prefixes: `feat:`, `fix:`, `docs:`, `ci:`, `security:`, `deps:`, `test:`, `refactor:`. The body says what changed and
how it was checked.

## 5. Tags and releases

There is no release yet. Tags matching `v*` are to be protected against deletion and moving. Creating a tag is not
restricted. A pushed `v*` tag runs `quality.yml`.

The Jenkins release stages (`Jenkinsfile`) build only `main` and need a person's approval. The pipeline is **not
active**.

## 6. Approvals

Zero required approvals while there is one maintainer. How to raise it:
[GitHub policy, section 8](GITHUB-POLICY.md).

## 7. Decisions that stay with the maintainer

| Decision | Examples |
|---|---|
| Anything outward | publishing, pushing an image, DNS, deploy |
| History rewrite or force push | after a leaked secret |
| New dependency | any new package, image or action |
| Security exception | renewing the database image acceptance list |
| Deleting data | old backups, a repository |
