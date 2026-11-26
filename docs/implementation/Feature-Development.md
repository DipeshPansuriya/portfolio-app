# Features and feature development

**Date:** 2026-11-26  **Status:** Current for release 1

## 1. Features

Acceptance wording: [PRD](../PRD.md).

| ID | Feature | Code |
|---|---|---|
| FR-001 | Reading mode | `src/components/`, `src/content/ContentProvider.tsx` |
| FR-002 | Drive circuit | `src/game/` |
| FR-003 | Fallbacks | `src/three/webgl.ts`, `src/game/DriveFallback.tsx`, `src/components/ErrorBoundary.tsx`, `src/prerender/`, `server/shell.mjs` |
| FR-004 | Admin sign-in | `src/admin/LoginPage.tsx`, `src/admin/useSession.ts`, `server/auth.mjs`, `server/throttle.mjs`, `server/hash-gate.mjs` |
| FR-005 | Edit and publish | `src/admin/`, `server/content.mjs`, `PUT /api/content` |
| FR-006 | History and restore | `GET /api/content/revisions`, `POST .../restore` |
| FR-007 | Password recovery | `scripts/reset-password.mjs` |
| FR-008 | Theme | `src/hooks/useTheme.ts` |
| FR-009 | Search and sharing text | `server/head.mjs`, "Search and sharing" in the Profile tab |

Behaviour rules worth knowing:

- A save may name the revision it started from (`baseRevision`); a stale one gets 409, so two open admin tabs do not
  overwrite each other.
- Keys outside the schema are dropped on save.
- At start the newest revision that validates is served; if none does, the app does not start.
- `content/site.json` only seeds an empty database. It is also built into the web app as a fallback copy.
- With scripts off, the look-alike hero buttons are hidden.

Out of scope for release 1: see [PRD, non-goals](../PRD.md#22-non-goals).

## 2. Making a change

1. **Plan:** what changes, which files, how it will be checked. Read the matching document and
   [decisions](../adr/).
2. **Test first** where behaviour changes.
3. **Build.**
4. **Documents:** PRD for scope, Design for behaviour, Architecture for structure, Database for the schema and
   content rules, API for endpoints, README for commands and variables, [changelog](../../CHANGELOG.md).
5. **Check:** the commands in [CONTRIBUTING](../../CONTRIBUTING.md).
6. **Pull request** into `main`.

### Adding a content field

| Step | Where |
|---|---|
| Type | `src/content/types.ts` |
| Browser shape check | `src/content/validate.ts` |
| Server rules, key order, length limit | `server/content.mjs` |
| Editor control | `src/admin/sections.tsx`; error path pattern in `src/admin/fieldErrors.ts` |
| Display | component; also `src/prerender/HeroShell.tsx` for hero text |
| Seed | `content/site.json` |
| Old revisions | keep the field optional, so earlier revisions still start and restore |

## 3. Code standards

| Area | Standard |
|---|---|
| Languages | TypeScript for the web app; ES modules (`.mjs`) for server and scripts |
| Type check | `npm run typecheck` |
| Lint and format | none configured |
| Dependencies | runtime: `pg` only; web libraries are build-time |
| Size budgets | `scripts/check-bundle.mjs` |
| Hero markup | `Hero` and `HeroShell` share class names; a test fails if they drift |
| Server changes | `scripts/security_audit.sh` checks exact lines in `server/`; update it with the code |

There is no feature flag system.
