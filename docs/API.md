# portfolio: API

**Version:** 1.1  **Date:** 2026-11-26  **Status:** Built, not deployed
**Related:** [Architecture](ARCHITECTURE.md), [Database](DATABASE.md)

## 1. Overview

Same origin, JSON, base `/api`. In development the web server forwards `/api` and `/content/site.json` to the API on
port 4319. Source: `server/index.mjs`.

## 2. Principles

Small surface, one owner, no versioning: browser and server ship in one image.

## 3. Authentication

- Session cookie `dp_session`: HttpOnly, SameSite=Strict, Secure in production, 8 hours.
- Known-browser cookie `dp_device` (path `/api/auth`): gives a browser that signed in before its own sign-in tries.
  It grants no access.
- Password change, save and restore need the header `X-CSRF-Token`. **Sign-out does not.**
- Every non-GET `/api/` call needs an allowed `Host`, a same or listed `Origin` (`PUBLIC_ORIGIN`; loopback hosts are
  always allowed) and `Content-Type: application/json`, also with an empty body.

## 4. Conventions

Error body: `{ "error": string, "errors"?: string[], "retryAfter"?: number }`. A failed sign-in also returns
`remaining`.

| Status | Meaning |
|---|---|
| 400 | bad JSON or body shape, a NUL character in any text, email or password too long, `baseRevision` not a whole number |
| 401 | no or expired session, wrong credentials, wrong current password |
| 403 | CSRF token, Host or Origin refused |
| 404 | unknown route, file or revision |
| 405 | wrong method on a file |
| 409 | the save's `baseRevision` is no longer live |
| 413 | body over 512 kB |
| 415 | not `application/json` |
| 422 | content or new password failed validation |
| 429 | too many attempts at **sign-in or password change** (`retryAfter` and a `Retry-After` header) |
| 500 | unexpected |
| 503 | `/api/ready`: database not reachable. Sign-in and password change: password checks busy (`retryAfter` and `Retry-After`; no attempt is counted) |

Sign-in limits in a 15-minute window: 5 failed tries per address and email, 30 per address; under heavy failure from
many sources, 2 per address. Password change: 5 per signed-in user. Exact rules: `server/throttle.mjs`.

New passwords need at least 10 characters, a lower-case letter, an upper-case letter and a number, and must not start
with a few obvious words.

## 5. Endpoints

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/api/health` | none | | `{ ok, uptime, storage }` (the process is up) |
| GET | `/api/ready` | none | | `200 { ok }` once the database answers, else 503 |
| POST | `/api/auth/login` | none, limited | `{ email, password }` | `{ user, csrf }` and both cookies |
| POST | `/api/auth/logout` | cookie, no CSRF token | `{}` or empty | `{ ok }`, clears the session cookie |
| GET | `/api/auth/session` | cookie | | `{ user, csrf }` or `{ user: null }` |
| POST | `/api/auth/password` | cookie and CSRF, limited | `{ current, next }` | `{ ok, csrf }`; other sessions end |
| GET | `/api/content` | none | | the content document, header `x-content-revision` |
| PUT | `/api/content` | cookie and CSRF | `{ content, note?, baseRevision? }` | `{ ok, revision }` |
| GET | `/api/content/revisions` | cookie | | `{ revisions[], skipped[] }` |
| POST | `/api/content/revisions/:id/restore` | cookie and CSRF | empty | `{ ok }`; 404 unknown id; 422 if the stored revision is not valid or not JSON |

Notes:

- **Save:** checks field rules and [length limits](DATABASE.md#41-length-limits); each problem starts with the field
  path. `note` is cut to 200 characters. Without `baseRevision` the save is unconditional.
- **History:** `revisions` is the newest 30 and always the first revision, newest first. `skipped` lists revision ids
  found invalid at start, and is empty after a new save.
- **Restore:** stores a copy of the old revision as a new one. It checks field rules, not length limits, and takes no
  `baseRevision`.

Pages and files (production):

| Path | Behaviour |
|---|---|
| `/`, `/index.html` | page with head tags, server-rendered hero and content data block from the live content; `no-cache` with ETag; plain `index.html` if building it fails |
| `/content/site.json` | live content from memory, `no-cache` with ETag (also in development) |
| `/admin` | app page, `noindex` |
| `/assets/*` | cached for a year, Brotli or gzip |
| unknown page or missing file | 404 |

## 6. Webhooks and events

None.

## 7. Clients

The browser app only (`src/admin/api.ts` for the admin).

## 8. Evolution

Change browser and server in the same change, with a test.

## Appendix

No OpenAPI file in release 1.
