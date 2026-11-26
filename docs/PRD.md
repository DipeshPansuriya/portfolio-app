# portfolio: product requirements

**Version:** 1.1  **Date:** 2026-11-26  **Status:** Release 1 built, not deployed
**Related:** [Design](DESIGN.md), [Architecture](ARCHITECTURE.md)

## 1. Executive summary

A personal portfolio the visitor can read or drive. A 3D circuit opens the chapters one gate at a time; a plain
reading mode shows the same content; the owner edits the portfolio content at `/admin`. Small interface text
(buttons, hints, menu labels) stays in code; the hero button labels and the main contact button label are part of
the content. The prototype was approved as "one level". Release 1 makes that level production quality and ready to
deploy.

## 2. Goals and non-goals

### 2.1 Goals

- **G1:** ship the approved experience with no loss of behaviour.
- **G2:** admin edits survive restarts and redeploys, with history and backups.
- **G3:** fast first paint on a slow phone (LCP at or under 2.5 s in the test profile).
- **G4:** one command runs all quality gates; one image deploys.

### 2.2 Non-goals

- New levels or sections, case studies, resume download, analytics, contact form, sound.
- Multi-user admin, OAuth, multi-factor sign-in, email reset.
- Editing small interface text from the admin.
- Changing the owner's words or facts.

## 3. Audience

| Who | Needs |
|---|---|
| Visitor (recruiter, engineer, client) | the facts fast, on any device; may or may not play |
| Owner | edit the content safely from a browser |

## 4. Requirements

### 4.1 Functional

| ID | Title | Acceptance | Priority |
|---|---|---|---|
| FR-001 | Reading mode | hero, chapters, principles, contact and footer render from content; navigation and skip link work | P0 |
| FR-002 | Drive circuit | intro, timed lap, one gate with a card per chapter, finish with best time; keyboard and touch; leaving returns focus | P0 |
| FR-003 | Fallbacks | no WebGL, reduced motion or a failed lazy 3D or game file still show the content (limits below) | P0 |
| FR-004 | Admin sign-in | one owner; limited attempts; sign out; change password | P0 |
| FR-005 | Edit and publish | all tabs save; visitors get the change on their next load, without a rebuild; bad data is refused with a message naming the field, and the field is marked | P0 |
| FR-006 | History | History lists the newest 30 revisions and always the first one (the seed); any listed revision that is still valid restores | P0 |
| FR-007 | Recovery | a local command resets only one user's password and sessions | P0 |
| FR-008 | Theme | follows the system until the visitor chooses; the choice is kept | P1 |
| FR-009 | Search and sharing | on the production server, title, share title, structured data and the no-script note come from the live content; optional search and share descriptions replace the built-in ones | P1 |

#### FR-003 limits

Accepted by the owner on 2026-11-26. The guarantee covers the lazy-loaded 3D and game files only.

| Case | What the visitor gets |
|---|---|
| A main script file is blocked or fails | the server-rendered hero only: no chapters, contact or footer. The two hero buttons show but do nothing |
| The same, and the server served the plain page (server render failed) | an empty page |
| Scripts off | the hero with its two buttons hidden, and a short "needs JavaScript" note with a profile link (or the email address if there is no web profile) |

### 4.2 Non-functional

| ID | Category | Requirement | Target |
|---|---|---|---|
| NFR-001 | Performance | LCP of `/`, 390 px wide, 4x slower CPU, 1.6 Mbps, 150 ms delay, median of 3 | at or under 2500 ms; CLS at or under 0.1 |
| NFR-002 | Performance | first-load JavaScript, gzip; no 3D library preload | at or under 160 kB (CSS 15 kB) |
| NFR-003 | Security | no open High or Critical finding (one named, time-limited exception: the database image, ADR 0005); security headers kept; no secret in repository or image | 0 |
| NFR-004 | Accessibility | Lighthouse accessibility on `/`; keyboard path through navigation, drive dialog and admin | at or above 95 |
| NFR-005 | Reliability | content survives a container recreate; restore from a dump proven | pass |
| NFR-006 | Scale | personal-site traffic, one instance | fits a 256 MB application limit |
| NFR-007 | Browsers | current Chrome, Safari, Firefox; one real iOS and one real Android check | checked or marked UNVERIFIED |

Measured results: [Testing, QA and debugging](implementation/Testing-QA-Debugging.md).

## 5. User journeys

| Journey | Steps |
|---|---|
| Read | land, scroll or use the chapter navigation, contact |
| Drive | open, intro, lap through the gates, read cards, finish, leave |
| Edit | sign in, change fields, save, check the public page |
| Undo an edit | open History, restore a revision |
| Lost password | run the reset command where the data lives, sign in, change it |

## 6. Data and content

The content is one document: profile, hero, stats, chapters, principles, contact, tech stack and optional search
descriptions ([Database](DATABASE.md)). The seed in `content/site.json` fills an empty database. The content is the
owner's and is not covered by the code licence.

## 7. Constraints and assumptions

| Item | Detail |
|---|---|
| One instance | live content copy and sign-in limits are in memory |
| One owner | no roles |
| Runtime packages | only `pg`; new packages need the owner's yes |
| Hosting | one virtual server with Docker; not checked yet |

## 8. Risks

| Risk | Mitigation |
|---|---|
| 3D too heavy for a device | lazy loading, fallbacks, reading mode |
| A bad edit breaks the page | validation before storing, history, invalid stored revisions are not served |
| Database loss | nightly dump and restore test; a copy off the disk is still open |
| Sign-in abuse | limits, hash cap, proxy rate limit (UNVERIFIED on a live proxy) |

## 9. Success measures

| Measure | Target |
|---|---|
| All P0 requirements pass independent checks | yes |
| LCP, bundle and accessibility targets | met |
| Backup restore and rollback | proven before go-live |

No visitor analytics are collected.

## 10. Release criteria

All P0 requirements pass, independent QA and security checks are done, and backups and rollback are proven.

## 11. Open owner decisions

Host name, storage option (provisional, [ADR 0005](adr/0005-database-storage-and-backups.md)), image publishing and
go-live. The stat figures and descriptions are the owner's wording.
