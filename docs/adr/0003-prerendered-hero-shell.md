# ADR 0003: Server-rendered hero shell for mobile LCP

Date: 2026-11-26. Status: Accepted; the owner approved the visible change. Built.

Measured on the built app (headless Chrome, local production, SQLite, NFR-001 profile,
cold cache, 3 runs): LCP 2092 / 1720 / 1716 ms (median 1720) with motion, 1832 / 1688 / 1704 ms
(median 1704) with reduced motion; the same build without the server bundle 2944 / 2932 / 2940 ms
(median 2940). CLS 0, no CSP or console error, headline visible with scripts off. The largest paint is
the subline; React's copy replaces the shell's about 1 s after first paint and is slightly larger
(web font), so it sets the final value. These runs are from before later changes to the shell. A later
local run measured a 1704 ms median (see Testing, QA and debugging). Live-host LCP is UNVERIFIED.

## Context

- Measured on the prototype (390 px, 4x CPU, 1.6 Mbps, 150 ms, local production):
  LCP 4130-4390 ms with motion, 3680-3710 ms with reduced motion. Target is 2500 ms.
- `index.html` has an empty `#root`, so nothing paints before the JavaScript runs.
- Hero words start at `opacity: 0` (`src/components/Reveal.tsx`, `RevealWords`).
- Delaying the 3D scene was tried and gave no gain.
- The admin can change hero text at any time without a rebuild.

## Options considered

| Option | Good | Bad |
|---|---|---|
| A. Server injects a small static hero into `/` (chosen) | Always current; no hydration; no new package | Extra build step; markup must stay in step with `Hero` |
| B. Prerender at build time | Simplest server | Shows old text after an admin edit until a rebuild |
| C. Full SSR + hydration | Whole page without JS | Needs hydration-safe theme, motion and media hooks; large risk |
| D. Only remove the entrance animation | Tiny | Still about 3.7 s |

## Decision

- `src/prerender/HeroShell.tsx`: pure component, no hooks, no motion, no `window`. Eyebrow, headline,
  subline, stats, and button look-alikes. It shares class strings with `Hero`.
- `src/prerender/entry.tsx` exports `render(content)` using `renderToStaticMarkup`.
- Build: `vite build --ssr src/prerender/entry.tsx --outDir dist-server` with `ssr.noExternal: true`,
  so the runtime image still needs only `pg`.
- Production `GET`/`HEAD` on `/` (and `/index.html`): put the shell inside `#root` and the content in
  `<script type="application/json" id="site-content">` with every `<` written as `\u003c`.
  Cache per revision id; same compression and ETag rules as other files.
- Any render error: serve the plain `index.html`, log each distinct error once and try again after 30 s.
  `/admin` and 404 pages stay as today.
- With scripts off the button look-alikes are hidden (`<noscript>` style): they could not work.
- Browser: `ContentProvider` starts from `#site-content` when present. `createRoot` replaces the shell.
- When the shell was present, eyebrow, headline, subline, buttons and stats render in place
  (`initial={false}`): nothing the server painted is hidden and faded in a second time when the app
  starts.

Added 2026-11-26: the same step also fills the page title, descriptions, structured data and the no-script note
from the live content (`server/head.mjs`).

## Consequences

- **Visible change:** when the shell is served, the hero text and buttons have no entrance animation: the
  headline no longer rises word by word, and eyebrow, subline, buttons and stats do not fade in. Without a
  shell all keep their entrance motion. The rest of the motion stays.
- LCP met the 2.5 s target in the local runs above.
- If the main bundle fails, the visitor keeps only the shell and its buttons do nothing (PRD FR-003 limits).
- `tests/shell.test.mjs` fails if `Hero` and `HeroShell` text or classes drift, and proves `</script>` in
  content cannot break out of the data block.
- The data block is not executable, so the existing `script-src 'self'` policy stays unchanged
  (verify in the browser console).
