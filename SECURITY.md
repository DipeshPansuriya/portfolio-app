# Security policy

## Supported versions

| Version | Supported |
|---|---|
| Latest commit on `main` | yes |
| Anything older | no |

There is no tagged release yet.

## Reporting a vulnerability

**Do not open a public issue with security details.**

Use GitHub's private reporting:
[Report a vulnerability](https://github.com/DipeshPansuriya/portfolio-app/security/advisories/new)

Private reporting is switched on as part of publishing this repository
([GitHub policy](docs/GITHUB-POLICY.md)). If the form is not available, open an issue that only asks for a
private channel, with no details, and wait for an answer.

Please include:

| Field | Detail |
|---|---|
| Version | commit hash (`git rev-parse --short HEAD`) or image tag |
| Component | site, API, admin, image, git hooks, CI or deploy scripts |
| Reproduction | the smallest steps that show the problem |
| Impact | what an attacker gains, and from where |
| Suggested fix | optional |

Never include real passwords, tokens or other people's data in a report.

## What to expect

This is a single-maintainer project. Reports are handled as soon as the maintainer can; no fixed response times
are promised. Please allow time for a fix before publishing details.

## Scope

In scope:

- the public site and every `/api/*` endpoint
- the `/admin` editor, sign-in and sessions
- the container image and the deploy and backup scripts
- git hooks, CI workflows and repository scripts

Out of scope:

- vulnerabilities in third-party packages or base images: report those upstream (tell us too, if the way this
  project uses them makes the problem reachable)
- volume-based denial of service
- attacks that need an account on the server or control of the owner's machine
- testing against a live site you do not own: run your own copy ([setup](docs/implementation/Setup-Initialisation.md))

## Known limits

The design has limits that are accepted for a small, single-owner site: one owner account, no multi-factor
sign-in, one application instance, and sign-in limits held in memory. Heavy abuse can make sign-in unavailable for a
while: during a sustained flood of sign-in attempts, a new browser (one that has not signed in before) may get 503.
Controls and limits: [Authentication and security](docs/implementation/Authentication-Security.md).

## More detail

- [Authentication and security](docs/implementation/Authentication-Security.md)
- [Push policy](docs/PUSH-POLICY.md): the no-credential rule
- [GitHub policy](docs/GITHUB-POLICY.md): branch, tag and Actions settings
