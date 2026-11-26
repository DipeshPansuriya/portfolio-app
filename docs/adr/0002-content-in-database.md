# ADR 0002: Live content lives in the database

Date: 2026-11-26. Status: Accepted.

## Context

An admin save in the prototype does four writes (`server/content.mjs`, `server/index.mjs` PUT route):

1. copies `public/content/site.json` to `data/backups/`
2. rewrites `public/content/site.json`
3. inserts a `content_revisions` row
4. runs `scripts/sync-content.mjs`, which rewrites `src/content/defaultContent.ts`

In a container this fails: writes into `public/` and `src/` need a writable image, are lost on redeploy,
and the file and the database can disagree.

## Options considered

| Option | Good | Bad |
|---|---|---|
| A. Database is the only live store (chosen) | App needs no volume; one thing to back up; one atomic write | Code and 4 test spots change |
| B. File on a volume + history in database | Smaller change | Two stores to keep in step and back up; needs a volume |
| C. Content in git, rebuild on change | Simple server | Breaks the promise "edit in admin, no rebuild" |

## Decision

- **The newest `content_revisions` row is the live content.** No new table, no schema change.
- Save: validate, insert one row, update the in-memory copy. Restore: insert a copy of the old row.
- First boot with an empty table: validate `content/site.json` and insert it (note `seed`, author `system`).
  An invalid seed stops the start.
- The server keeps the live JSON in memory (loaded at boot). `GET /content/site.json` and `GET /api/content`
  read from memory, with an ETag from the revision id. The URL does not change for the browser.
- The browser fallback imports `content/site.json` at build time.
- Removed: `scripts/sync-content.mjs`, `scripts/normalize-content.mjs`, `src/content/defaultContent.ts`,
  `backupCurrent`, `snapshotCurrent`, `resyncTypedFallback`, `writeContent` (file), the `predev`/`prebuild`
  hooks, and the Vite `contentReload` plugin.
- Changed: `PUT /api/content` returns `{ ok, revision }`; admin texts at `src/admin/AdminApp.tsx:146-148,357`
  and the type in `src/admin/api.ts:60`; Vite proxies `/content/site.json` to the API.
- `normalizeContent` and `validateContent` stay.

## Consequences

- Exactly one app instance (memory copy, in-memory login throttle). Write this in the compose file.
- A manual database edit needs an app restart.
- Dev: an open public tab no longer live-updates after a save; reload it.
- If the database is down at runtime, visitors still get the page; saving fails.
- `content/site.json` in git is only the seed. It drifts from live content; export from the Raw JSON tab if needed.
- Revisions are never pruned (about 7 kB each today; cap per save is 512 kB).
- Cut-over: copy the prototype's current `public/content/site.json` to `content/site.json`. The local
  prototype database history is not migrated.
