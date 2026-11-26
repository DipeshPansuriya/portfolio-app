# Push policy: secrets and credentials

**Date:** 2026-11-26  **Status:** Local hooks work in any clone that installs them. The CI backstop runs on the
published repository (workflow runs on 2026-11-26 were green).

**Related:** [GitHub policy](GITHUB-POLICY.md), [CI and PR checks](CI-AND-PR-CHECKS.md), [SECURITY.md](../SECURITY.md)

## 1. Rule

**No credential may enter the repository**: not in a commit, in history, in an image, in a screenshot or in a test
fixture. A credential is anything that grants access: API keys, tokens, private keys, passwords, connection strings
with a password, session values, or an `.env` file that holds any of these.

| Point | Trigger | Scope | Bypass |
|---|---|---|---|
| pre-commit hook | `git commit` | staged content, plus a syntax check of staged `.mjs` and shell files | `git commit --no-verify` |
| pre-push hook | `git push` | every file and path in the outgoing commits, plus the committed tree at HEAD (not uncommitted files) | `git push --no-verify` |
| CI (`security.yml`) | push to `main`, pull request | tree and full history | none |
| CI gate 7 (`scripts/ci.sh 7`) | image build | gitleaks on the image and git history, Trivy secret scan | none |

Both hooks **fail closed**: if the scanner or Python 3 is missing, the commit or push is blocked.

## 2. Activation

The hooks are kept in `.githooks/`. Install them once per clone, and again after the hooks or the scanner change.

```bash
./scripts/install_hooks.sh           # install, or refresh the saved copies
./scripts/install_hooks.sh --check   # verify
./scripts/install_hooks.sh --remove  # take the hooks out again
```

| The installer | Detail |
|---|---|
| writes a small starter for each hook | in git's own hooks folder (`.git/hooks`), which a branch checkout does not change |
| saves copies of both hooks and the scanner | next to the starters |
| replaces the earlier setup | removes the local `core.hooksPath` setting; if a global one is set, points the local one at the git hooks folder |
| keeps other hooks safe | if a hook it did not write is in the way, it stops and changes nothing |

The starter runs the `.githooks/` hook of the checked-out branch, or the saved copy on a branch without one. A branch
that carries an older hook or scanner runs that older version. `--check` fails on the earlier `core.hooksPath` setup,
and notes a saved copy that differs from the checked-out file.

## 3. Scanner

`scripts/check_secrets.py`, Python standard library only.

```bash
python3 scripts/check_secrets.py                 # tracked files
python3 scripts/check_secrets.py --staged        # staged content
python3 scripts/check_secrets.py --range A..B    # what a commit range adds
python3 scripts/check_secrets.py --all-history   # every file in history
python3 scripts/check_secrets.py --tree SHA      # the committed files of one commit
python3 scripts/check_secrets.py --list-rules    # print the rule table
```

Exit codes: `0` clean, `1` blocking finding, `2` the scan itself failed. A finding shows the rule and `path:line`;
the matched line is never printed.

## 4. Rules

| ID | Detects | Severity |
|---|---|---|
| SEC-001 to SEC-004 | GitHub tokens: classic, OAuth, app, fine-grained | block |
| SEC-005, SEC-006 | OpenAI-style and Anthropic keys | block |
| SEC-007, SEC-008 | AWS access key id and secret assignment | block |
| SEC-009 to SEC-012 | Google, Slack, Stripe live, Hugging Face | block |
| SEC-013 | private key blocks, including encrypted and PGP ones | block |
| SEC-014 | JSON Web Tokens | block |
| SEC-020 | hardcoded password assignment | block |
| SEC-021 | hardcoded API key or access token assignment | block |
| SEC-022 | `Bearer` token literal | warn |
| SEC-023 | connection string with an inline password | block |
| SEC-024 | long random value assigned to an upper-case name | warn |
| SEC-025 | env-style `NAME=value` line with a password, token or key name (below) | block |
| SEC-026 | the same kinds of name as keys in YAML files (`.yml`, `.yaml`) | block |
| SEC-030 | a file that must never be committed: `data/`, `.env*` (except `.env.example`), keys, databases, dumps, credential files. Letter case is ignored | block |

SEC-025 and SEC-026 judge a value of 6 or more characters, quoted or not, on the same line as its name.

| Rule | Matches |
|---|---|
| SEC-025 | at the start of a line, also after `export`, `local`, `readonly`, `ENV`, `ARG`, a list dash or `#`; an upper-case name ending `PASSWORD`, `PASSWD`, `PASSPHRASE`, `SECRET`, `TOKEN`, `API_KEY`, `APIKEY`, `SECRET_KEY`, `ACCESS_KEY`, `PRIVATE_KEY` or `_PWD`, or the name `PASS` or one ending `_PASS`; no spaces around `=` |
| SEC-026 | a YAML key ending in one of those words (`-` also joins `API_KEY` and similar; `PASS` only as a separate word), in any letter case |

## 5. False positives

- Add `secret-scan: allow` to the line, only for a value that is provably not a credential (`gitleaks: allow` has the
  same effect).
- Obvious placeholders are allowed automatically: an `<angle-name>`, a `${VAR}` or `$UPPER_NAME` reference as the
  whole value, or a value made mostly of words such as `example`, `placeholder` or `change_me`. Only the value is
  judged.
- SEC-025 and SEC-026 also leave out `${VAR:?message}`, `${{ }}` expressions and command substitutions (`$( )` or
  backticks), and allow a value that is wholly `$name`. The text in `${VAR:-text}` is judged.
- In YAML, an alias, or unquoted text that continues like a sentence, is not treated as a value.
- A short list of known test fixtures is allowed by the hash of the exact value at the exact path. Never add the hash
  of a real credential.

## 6. Not scanned

No folder, file type or file size is skipped: every file that git lists for the chosen scope is read.

| Outside the scan | Reason |
|---|---|
| compressed content, such as inside archives | it cannot be read as text |
| untracked files | they are not part of a commit |
| files of a submodule | they belong to another repository |

## 7. If a secret is found

| Situation | Action |
|---|---|
| Before commit | remove it, stage again, commit |
| Committed, not pushed | amend or rebase it away, then push |
| Already pushed | **revoke or rotate it first**, then clean history; history rewrite is the maintainer's decision |
| In an image | rebuild without it, and rotate it |

Assume a pushed secret is compromised, however quickly it is removed.

## 8. What was checked

Run locally on 2026-11-26, on a scratch clone. Blocked as expected: a fake GitHub token, an environment password
line, a forced `.env`, a forced database file, a new password in a fixture file, a broken JavaScript file, a broken
shell file, a missing scanner, and a push of a commit made with the hook bypassed. The token value was never printed.
The CI jobs have not run on GitHub (UNVERIFIED).

The rules and hooks were tightened later. `tests/repo-guards.test.mjs`, part of `npm test`, covers the new secret
shapes, file sizes and types, the history, range and tree scans, and the hook installer
([results](implementation/Testing-QA-Debugging.md#3-recorded-results-2026-11-26)). Its tests that need Python 3, bash
and a recent git are skipped where one is missing.

## 9. Limits

| Limit | Meaning |
|---|---|
| Pattern matching only | a random secret with no known shape can pass |
| The password, token and key line rules are narrow, to limit false alarms in code | some file formats, name styles, writing styles, short values and values built by a command or variable can still pass |
| Text in unusual encodings may not be recognised | do not rely on the scan for converted or packed content |
| An older hook or scanner on a branch | that version runs there |
| Saved hook copies do not update themselves | run the installer again after a change |
| No live check with providers | a revoked key is still reported |
| Commit messages are not scanned | do not put secrets in them |
| Screenshots are not read | check images by eye |
| Hooks are local and can be bypassed | CI is the backstop |
