# Contributing

Thanks for looking at this project. It is a personal portfolio with a single maintainer, so please open an issue
before a large change.

## Quick start

Needs Node.js 22.18 or newer and git. Python 3 is needed for the hooks and checks.

```bash
git clone https://github.com/DipeshPansuriya/portfolio-app.git
cd portfolio-app
./scripts/install_hooks.sh      # pre-commit and pre-push: once per clone, and again after the hooks or scanner change
npm ci --ignore-scripts
npm run dev:full                # web http://127.0.0.1:4318, API :4319
```

Details: [Setup and initialisation](docs/implementation/Setup-Initialisation.md).

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build && node scripts/check-bundle.mjs
python3 scripts/check_secrets.py
python3 scripts/check_docs.py
./scripts/security_audit.sh --quick     # without --quick it also runs npm audit (needs network)
sh deploy/check-pipeline.sh             # no Docker needed
sh deploy/check-scripts.sh              # no Docker needed
```

`sh scripts/ci.sh` runs the full gates, including the image build and scans. It needs Docker and the pinned images
([deploy guide](deploy/README.md)).

## Rules

| Rule | Detail |
|---|---|
| Pull requests into `main` | enforced by a repository ruleset once it is applied ([GitHub policy](docs/GITHUB-POLICY.md)) |
| No credentials | checked at commit, push and CI ([push policy](docs/PUSH-POLICY.md)) |
| Commit prefixes | `feat:`, `fix:`, `docs:`, `ci:`, `security:`, `deps:`, `test:`, `refactor:` |
| Squash merge | history on `main` stays linear |
| Docs ship with code | a behaviour change updates the affected document in the same pull request |
| Tests | a behaviour change comes with a test |
| Dependencies | the only runtime package is `pg`; ask first before adding any package |
| Actions | pin every `uses:` to a full commit hash, with the tag in a trailing comment |

Two things that surprise people:

- A new password-like value in a test blocks the commit. Use an obvious placeholder, or add `secret-scan: allow` to
  that line when the value is provably not a credential.
- `scripts/security_audit.sh` looks for exact lines in `server/`. A refactor there must update the audit in the same
  change.

## What a pull request needs

1. A title with a commit prefix.
2. A body that says **what** changed and **how it was checked**: commands and their output.
3. Green checks.
4. No unresolved review threads.

The automated review comment is a report, not an approval.

## Content and licence

Code, scripts and technical documentation are under the [MIT licence](LICENSE). The maintainer's name, biography,
photos and portfolio content are **not**. Please do not send pull requests that change the portfolio text or
personal facts. By contributing code you agree to license it under the MIT licence.

## Reporting a security issue

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Documentation map

| Document | Contents |
|---|---|
| [PRD](docs/PRD.md) | requirements and acceptance |
| [Design](docs/DESIGN.md) | behaviour and look |
| [Architecture](docs/ARCHITECTURE.md) | components, request paths, budgets |
| [Database](docs/DATABASE.md) | tables, content document, backups |
| [API](docs/API.md) | endpoints |
| [Testing, QA and debugging](docs/implementation/Testing-QA-Debugging.md) | tests and known gaps |
| [Contributor and agent guide](docs/AGENTS.md) | rules for people and AI coding assistants |

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
