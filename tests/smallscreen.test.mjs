/** Small screens: controls stay on screen. Plus the restore of a damaged revision. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { start } from './harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('drive HUD: the top-right controls wrap, and Reset stays beside Exit', () => {
  const hud = read('src/game/GameHUD.tsx')
  assert.match(hud, /pointer-events-auto flex min-w-0 flex-wrap items-center justify-end gap-2/)
  assert.match(hud, /<div className="flex items-center gap-2">\s*<button\s+type="button"\s+onClick=\{onReset\}/)
})

test('mobile menu: scrolls on a short screen, starts below the header, and Lenis leaves it alone', () => {
  const nav = read('src/components/Nav.tsx')
  const menu = nav.slice(nav.indexOf('{open && ('))
  // The padding is outside the scroller, so scrolled items are clipped instead of crossing the header.
  assert.match(menu, /className="fixed inset-0 z-40 [^"]*pt-24 /)
  assert.match(menu, /data-lenis-prevent\s+className="[^"]*overflow-y-auto/)
  // Auto margins centre the list and, unlike justify-center, never push it above the scroll start.
  assert.match(menu, /className="my-auto /)
  assert.doesNotMatch(menu, /justify-center/)
})

test('restore: a revision that is not JSON is 422, and nothing changes', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const live = (await s.call('/api/content')).raw.toString()
  const [{ id }] = await s.sql(
    "INSERT INTO content_revisions (json, author, created_at) VALUES ('not json', 'hand', '2026-01-01T00:00:00Z') RETURNING id",
  )
  const res = await s.call(`/api/content/revisions/${id}/restore`, { method: 'POST', headers })
  assert.equal(res.status, 422, res.raw.toString())
  assert.equal(res.data.error, 'Stored revision is no longer valid.')
  assert.ok(res.data.errors.length)
  assert.equal((await s.call('/api/content')).raw.toString(), live)
  assert.equal((await s.sql('SELECT COUNT(*) AS n FROM content_revisions'))[0].n, 2)
})
