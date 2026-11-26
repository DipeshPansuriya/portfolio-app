# Authentication and security

**Date:** 2026-11-26  **Status:** Describes the code. Not checked on a live server: the project is not deployed.

One owner account signs in to `/admin`. Visitors need no account.
**Related:** [SECURITY.md](../../SECURITY.md), [API](../API.md), [Push policy](../PUSH-POLICY.md)

## Sign-in

| Item | Value | Code |
|---|---|---|
| Password hash | scrypt (N 16384, r 8, p 1), random 16-byte salt, parameters stored with the hash, constant-time compare | `server/auth.mjs` |
| Password rules | at least 10 characters, a lower-case letter, an upper-case letter, a number, not starting with a few obvious words | `passwordProblems` |
| Unknown email | checked against a dummy hash, so timing does not reveal accounts | `server/index.mjs` |
| Hash cap | one password hash at a time; up to 8 anonymous and 4 trusted requests wait, trusted first; the rest get 503 | `server/hash-gate.mjs` |
| Session token | 32 random bytes; only its SHA-256 is stored | `server/auth.mjs` |
| Session life | 8 hours | `server/auth.mjs` |
| Session cookie | `dp_session`: HttpOnly, SameSite=Strict, Secure in production | `server/index.mjs` |
| Known-browser cookie | `dp_device`, path `/api/auth`, 90 days; signed with a key from the password hash; grants no access, only separate sign-in tries | `server/auth.mjs` |
| CSRF token | 24 random bytes, returned at sign-in, sent as `X-CSRF-Token` on password change, save and restore | `server/index.mjs` |
| Password change | needs the current password; ends other sessions and renews the CSRF token | `server/index.mjs` |
| Sign-out | removes the session; needs no CSRF token, but the request checks below still apply | `server/index.mjs` |
| Lost password | `npm run admin:reset-password` on the machine that holds the data: new password and ends that user's sessions | `scripts/reset-password.mjs` |

First start: the owner account is created once. Production needs `ADMIN_PASSWORD`; in development a random password
is written to a file readable only by its owner. No password is built into the code.

There is one role. There is no multi-factor sign-in, OAuth or email reset.

## Request checks on every write

For every non-GET request under `/api/` (`requestProblem` in `server/guard.mjs`):

- the `Host` must be the loopback name or one from `PUBLIC_ORIGIN`, which stops DNS rebinding (403);
- a present `Origin` must be the same site or listed (403);
- `Content-Type` must be `application/json`, also with an empty body (415).

Bodies over 512 kB get 413. Bad JSON, a NUL character or a non-object body get 400. Content is validated before it
is stored (422). Database queries use parameters.

## Sign-in limits

`server/throttle.mjs`, a 15-minute window:

| Rule | Value |
|---|---|
| Failed tries per address and email | 5 |
| Failed tries per address | 30 |
| Under heavy failure from many sources | 2 tries per address |
| Password change, per signed-in user | 5 |
| Answer when limited | 429 with `retryAfter` and a `Retry-After` header |
| Answer when password checks are busy | 503 with `Retry-After`; no try is counted |

IPv6 addresses are counted per /64 network. The limits are designed so that a stranger cannot lock the owner out
from a different address. They live in memory, in one process, and reset on restart. The compose file also sets a
rate limit at the proxy (UNVERIFIED on a live proxy). Heavy abuse can still make sign-in unavailable for a while.
Use a long, random password.

**Known limitation:** during a sustained flood of sign-in attempts, a new browser (one that has not signed in
before) may get 503 and be unable to sign in while the flood lasts. In the app, a browser that signed in within the
last 90 days, with the password unchanged since, waits in a separate queue that is served first. This is not a
guarantee of access: that queue is also limited, and so is the proxy.

## Client address

Behind a reverse proxy, set `TRUST_PROXY` to the number of proxies that add `X-Forwarded-For`. Too high a number
lets clients choose their own address. `TRUSTED_PROXY_IPS` can limit who may set it. Production does not start
without `TRUST_PROXY`.

## Response headers

Set on every response by the app:

| Header | Value |
|---|---|
| `content-security-policy` | `default-src 'self'`; `img-src 'self' data: blob:`; `font-src 'self'`; `style-src 'self' 'unsafe-inline'`; `script-src 'self'`; `connect-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `object-src 'none'` |
| `x-content-type-options` | `nosniff` |
| `x-frame-options` | `DENY` |
| `referrer-policy` | `strict-origin-when-cross-origin` |
| `permissions-policy` | camera, microphone and geolocation off |
| `cross-origin-opener-policy` | `same-origin` |
| `strict-transport-security` | production only: one year, `includeSubDomains` |

`includeSubDomains` affects every subdomain when the main domain is used: check that first. `/admin` is marked
`noindex`.

## Data held

| Data | Where | Note |
|---|---|---|
| Public profile content | content revisions | public by design; every revision is kept |
| Owner login email and password hash | `users` | private |
| IP address and browser string | `sessions`; IP also in `audit_log` | no automatic deletion of the audit log |
| Database dumps | backup volume | hold the above; owner-only file mode |

The audit log records sign-ins, failures, limits, saves, refused saves, restores and password changes. Encryption of
disks and backups on a server is UNVERIFIED.

## Secrets

- `.env` files and `data/` are git-ignored and left out of the image build; `.env.example` holds names only.
- Server secrets are generated by `deploy/bootstrap-env.sh` into a file with mode 600.
- `ADMIN_PASSWORD` is for the first start only; remove it afterwards.
- Hooks and CI scan for secrets ([Push policy](../PUSH-POLICY.md)). `scripts/security_audit.sh` runs static checks
  on the code, the image definition, the lockfile and the workflows.

## Container and network

| Control | Where |
|---|---|
| Non-root user, read-only root filesystem, all capabilities dropped, no new privileges, memory, CPU and process limits | `Dockerfile`, `deploy/compose.yaml` |
| No published ports; the database is on an internal network | `deploy/compose.yaml` |
| Separate database roles: an application owner that is not a superuser, and a read-only backup role | `deploy/postgres-init/10-app-role.sh` |

## Open items

Server hardening that is not finished yet (secret handling on the host, alerting, off-machine backups, a scan of
every image architecture) is to be closed or accepted by the owner before go-live. The database image findings are
accepted for a limited time only ([ADR 0005](../adr/0005-database-storage-and-backups.md)). No threat model,
incident plan or compliance review is in the repository.
