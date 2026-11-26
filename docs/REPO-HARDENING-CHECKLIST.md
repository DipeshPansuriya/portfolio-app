# Repository hardening checklist

**Date:** 2026-11-26  **Status:** First publish not done yet.

An ordered list for taking this repository from "code on GitHub" to "protected and checkable". Record a control as
done only after seeing it work. Details: [GitHub policy](GITHUB-POLICY.md), [Push policy](PUSH-POLICY.md).

State words:

- **In repo**: the file exists in this repository.
- **At publish**: to be applied on GitHub; not in force now.
- **Verify**: how to prove it.

## 1. Repository basics

| # | Item | State | Verify |
|---|---|---|---|
| 1.1 | Public, as a clean copy without private notes or earlier history | At publish | repository page, `git log` |
| 1.2 | Description and topics | At publish | repository page |
| 1.3 | Default branch `main` | At publish | repository settings |
| 1.4 | `LICENSE` with the personal content exclusion | In repo | read [LICENSE](../LICENSE) |
| 1.5 | `README.md`, `CHANGELOG.md` | In repo | open them |
| 1.6 | `.gitignore` covers env files, databases, keys, dumps, build output | In repo | `./scripts/security_audit.sh` (SA-08) |
| 1.7 | `.gitattributes` normalises line endings | In repo | open the file |
| 1.8 | No private detail in tracked files | Before publish | read-through and search of the copy |

## 2. Community health files

| # | Item | Path | State |
|---|---|---|---|
| 2.1 | Contributing guide | `CONTRIBUTING.md` | In repo |
| 2.2 | Code of conduct | `CODE_OF_CONDUCT.md` | In repo |
| 2.3 | Security policy at the root | `SECURITY.md` | In repo |
| 2.4 | Issue templates and chooser | `.github/ISSUE_TEMPLATE/` | In repo; check that its links name this repository |
| 2.5 | Pull request template | `.github/pull_request_template.md` | In repo |
| 2.6 | Code owners | `.github/CODEOWNERS` | In repo |

## 3. Local protection

| # | Item | Verify |
|---|---|---|
| 3.1 | Hooks installed | `./scripts/install_hooks.sh --check` |
| 3.2 | Tree clean | `python3 scripts/check_secrets.py` |
| 3.3 | History clean | `python3 scripts/check_secrets.py --all-history` |
| 3.4 | Audit passes | `./scripts/security_audit.sh` |
| 3.5 | Links resolve | `python3 scripts/check_docs.py` |

## 4. GitHub settings (run `settings` before the first push)

| # | Item | Verify | State |
|---|---|---|---|
| 4.1 | Merge methods, delete branch on merge | `github_settings.py check` | At publish |
| 4.2 | Secret scanning and push protection | same | At publish |
| 4.3 | Dependabot alerts and security updates | same | At publish |
| 4.4 | Private vulnerability reporting | same | At publish |
| 4.5 | Actions: pinned hashes required | same | At publish |
| 4.6 | Actions: read-only token, no pull request approval | same | At publish |
| 4.7 | Fork pull request approval | same | At publish |

## 5. Protection (run `protect` after the first push and green checks)

| # | Item | Verify | State |
|---|---|---|---|
| 5.1 | CodeQL default setup | `github_settings.py check` | At publish |
| 5.2 | Ruleset `main-protection`, no bypass | a direct push to `main` is rejected | At publish |
| 5.3 | Nine required checks | a pull request with a failing check cannot merge | At publish |
| 5.4 | Ruleset `release-tags` | deleting or moving a `v*` tag is rejected | At publish |
| 5.5 | Add `Image build and scan` to the required checks | only after it has passed on GitHub | Later |
| 5.6 | Approval count 1 | needs a second account | Later |

## 6. Actions and dependencies

| # | Item | State |
|---|---|---|
| 6.1 | Every action pinned to a commit hash | In repo (audit SA-17) |
| 6.2 | Least permissions per workflow, no `pull_request_target` | In repo (audit SA-17) |
| 6.3 | Dependabot for Actions, npm and Docker | In repo |
| 6.4 | Locked packages from the public registry with checksums | In repo (audit SA-12) |
| 6.5 | Installs run no package scripts | In repo (audit SA-12) |

## 7. Image and release

| # | Item | State |
|---|---|---|
| 7.1 | Base images pinned by digest, no `latest` | In repo (audit SA-11) |
| 7.2 | Image runs as a non-root user, read-only in the stack | In repo (audit SA-11, CI gate 8) |
| 7.3 | Image labelled with version and commit | In repo (`Dockerfile`, CI gate 6) |
| 7.4 | Secret and vulnerability scan of the image | In repo (CI gate 7); not run on GitHub |
| 7.5 | Release checksum or signature | Not in place: there is no release |

## 8. Prove the controls

| # | Attempt | Expected | Result |
|---|---|---|---|
| 8.1 | Commit a fake token | pre-commit blocks | blocked locally, 2026-11-26 |
| 8.2 | Bypass the commit hook, then push | pre-push blocks | blocked locally, 2026-11-26 |
| 8.3 | Push directly to `main` | rejected | not run |
| 8.4 | Force push to `main` | rejected | not run |
| 8.5 | Delete or move a release tag | rejected | not run |
| 8.6 | Open a pull request with a failing check | merge blocked | not run |
| 8.7 | Add an unpinned action | audit and GitHub reject it | audit: fails locally on a planted fault; GitHub: not run |

Write down the observed output, not the intent.
