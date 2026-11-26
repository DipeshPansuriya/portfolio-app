# portfolio: design

**Version:** 1.1  **Date:** 2026-11-26  **Status:** Describes the built release
**Related:** [PRD](PRD.md), [Architecture](ARCHITECTURE.md)

## 1. Overview

The approved prototype is the reference for look and behaviour. This file records what must stay true.

## 2. Principles

- Content first: the 3D layer never blocks reading.
- One content document drives navigation, page sections and circuit gates.
- Motion respects `prefers-reduced-motion`.
- Hand-written components on shared tokens; no component library.

## 3. System context

Visitors and the owner use one web app ([Architecture](ARCHITECTURE.md)).

## 4. Architecture in brief

One React app (public page; admin and game loaded only when needed), one Node process, one database.

## 5. Components

| Area | Path | Responsibility |
|---|---|---|
| Page | `src/App.tsx`, `src/components/` | navigation, hero, chapters, contact, footer, error boundary |
| Hero 3D | `src/three/` | tech ring, particles, WebGL check |
| Circuit | `src/game/` | track, car, physics, display, cards, lap state (lazy) |
| Admin | `src/admin/` | sign-in, editor tabs, API client (lazy) |
| Content | `src/content/` | provider, types, shape check |
| Hero shell | `src/prerender/` | static first paint ([ADR 0003](adr/0003-prerendered-hero-shell.md)) |

## 6. User interface

### 6.1 Screens

`/` reading mode, the drive overlay on `/`, `/admin`, and a not-found response.

### 6.2 Reading page

| Element | Behaviour |
|---|---|
| Navigation, chapter links in the bar | up to 6 chapters: from 1024 px wide; 7 or 8: from 1280 px; 9 or more: never |
| Navigation, otherwise | a menu button; it also replaces the links when their names do not fit the bar |
| Long words and addresses | wrap anywhere rather than widen or leave their column; the contact email breaks before the domain first |
| Hero stats | any number of entries; two per row on narrow screens, four per row on wide ones |
| Hero tech ring | each icon is sized by its `level` (0 to 100) |
| Contact buttons in a chapter | shown on the chapter with the id `contact`, else on the last chapter |
| Principles | cards under "How I work", after the chapters |
| Numbers | two digits |

Saved but not shown: the time zone and the social link handles.

### 6.3 Drive

Flow: open, intro card, lap through one gate per chapter (the card holds for 5 seconds and waits while it is
hovered or focused), finish card with best time.

| Input | Action |
|---|---|
| `W` or Up, `S` or Down | accelerate, brake and reverse |
| `Space` | handbrake |
| `A` `D` or Left Right; drag | steer; swing the camera |
| `Shift` | boost |
| `E` or `Enter` | open a card |
| `P` | pause |
| `R` | back to the start |
| `Esc` | close or leave |

- Game keys work only while the circuit is open. Touch devices get an on-screen pad.
- A lap in which "Next" (fast travel) was used does not set a best time.
- Intro and finish cards stay inside the screen on small sizes: the middle scrolls, the main buttons stay visible.
- Notices sit in the left column under the lap counters, clear of the gate card and the pad, three lines at most.
- A gate sign squeezes a long name or hint, and cuts it with an ellipsis beyond 1.6 times the sign width.

### 6.4 Admin

Tabs: Profile (with search and sharing), Hero and stats, Chapters, Principles, Contact, Tech stack, Raw JSON,
History, Account. `Ctrl` or `Cmd` + `S` saves. Refused saves list the problems and mark the fields; the Chapters tab
opens the first chapter that holds a marked field. On a narrow
phone the chapter rows wrap so the row buttons keep their size; sliders use the native control at 24 px height.

Chapter fields: id, label, kicker, title, body, bullets, accent, hint. The hint shows under the chapter title and on
its island sign. Reserved ids: `hero`, `contact-card`, `contact-heading`, `main`, `root`, `site-content`.
Refused on save only, so stored revisions still start and restore: half a character (a cut emoji), an accent of 5 or 7
hex digits, a headline that is only `|`, and the id `site-content`.

### 6.5 Visual tokens

CSS variables in `src/index.css` (`--bg`, `--surface`, `--ink`, `--accent` and related), dark by default with a
light override. Self-hosted fonts: Space Grotesk, Inter, JetBrains Mono.

## 7. Data

Types in `src/content/types.ts`; storage in [Database](DATABASE.md). State: React context for content, a small store
for the lap, browser local storage for the theme (`dp-theme`) and the best lap (`dp-island-best-ms`).

## 8. API

[API](API.md).

## 9. Security

[Authentication and security](implementation/Authentication-Security.md).

## 10. Performance

Server-rendered hero, lazy game and admin files, Brotli or gzip, immutable hashed assets, no 3D library in the first
load.

## 11. Errors

Error boundaries around the 3D scene and the game. If the live content cannot be loaded or has a wrong shape, what is
on screen stays: the server-rendered content, or the copy built into the app from the seed file. API errors are
`{ error, errors? }`.

## 12. Accessibility

Skip link, focus rings, labelled admin inputs, errors linked to their fields, a focus-trapped drive dialog with the
page made inert, screen-reader text for the tech ring, light and dark contrast. Not tested with screen readers
(UNVERIFIED).

## 13. Known design limits

- On some screen sizes the gate card or notice area covers part of the gate sign.
- Long text in a gate sign is squeezed to fit, so very long labels become narrow.
- The headline is large: keep it short. A `|` sets where its second line starts.
