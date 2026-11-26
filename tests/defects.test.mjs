/**
 * Defects D1-D10 of the QA run: save rules, the helpers behind the admin and the drive, and guards on
 * the layout classes (the layout itself is measured in a browser, which the test run does not have).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { start, source } from './harness.mjs'
import * as text from '../src/content/text.ts'
import * as marks from '../src/admin/fieldErrors.ts'

const read = (path) => readFileSync(join(source, path), 'utf8')
const seed = JSON.parse(read('content/site.json'))
const edited = (change) => {
  const content = structuredClone(seed)
  change(content)
  return content
}

async function editor() {
  const s = await start()
  const headers = await s.signedIn()
  const save = (change) =>
    s.call('/api/content', { method: 'PUT', headers, body: { content: edited(change) } })
  return { s, save }
}

/** The save is refused, and a message starts with the path of the field, so the admin can mark it. */
function refused(res, path, label) {
  assert.equal(res.status, 422, `${label}: ${res.raw}`)
  assert.ok(res.data.errors.some((e) => e.startsWith(path)), `${label}: ${res.data.errors}`)
}

/* ------------------------------------------------------------- save rules */

test('D6: a save refuses half a character, and keeps whole ones', async () => {
  const { save } = await editor()
  refused(await save((c) => (c.profile.initials = 'AB\ud83d')), 'profile.initials ', 'high half')
  refused(await save((c) => (c.chapters[0].bullets[0] = 'cut \udc80')), 'chapters[0].bullets[0] ', 'low half')
  assert.equal((await save((c) => (c.profile.initials = 'AB🚀'))).status, 200)
})

test('D6: initials are cut between characters, never inside one', () => {
  assert.equal(text.firstCharacters('AB🚀', 3), 'AB🚀')
  assert.equal(text.firstCharacters('ABCD', 3), 'ABC')
  assert.equal(text.firstCharacters('A👩‍💻BC', 3), 'A👩‍💻B')
  assert.equal(text.firstCharacters('', 3), '')
  assert.match(read('src/admin/sections.tsx'), /set\('initials', firstCharacters\(v, 3\)\)/)
})

test('D7: an accent is a colour the page can use: 3, 4, 6 or 8 hex digits', async () => {
  const { save } = await editor()
  for (const accent of ['#12345', '#1234567']) {
    refused(await save((c) => (c.chapters[0].accent = accent)), 'chapters[0].accent ', accent)
  }
  for (const accent of ['#abc', '#abcd', '#aAbBcC', '#aabbccdd']) {
    assert.equal((await save((c) => (c.chapters[0].accent = accent))).status, 200, accent)
  }
})

test('D10: a chapter cannot take the id of the content data block', async () => {
  const { save } = await editor()
  const res = await save((c) => (c.chapters[1].id = 'site-content'))
  assert.equal(res.status, 422, String(res.raw))
  assert.deepEqual(res.data.errors, ['chapter id "site-content" is reserved by the page layout'])
})

test('D10: a headline needs words, on either side of the bar', async () => {
  const { save } = await editor()
  for (const headline of ['|', ' | ', '||']) {
    refused(await save((c) => (c.hero.headline = headline)), 'hero.headline ', headline)
  }
  for (const headline of ['Ship it |', '| every day', 'Hello']) {
    assert.equal((await save((c) => (c.hero.headline = headline))).status, 200, headline)
  }
})

test('save rules: a revision stored before them still boots, is served, restores and names its fields', async () => {
  const first = await start()
  await first.stop()
  const old = edited((c) => {
    c.profile.initials = 'AB\ud83d'
    c.chapters[0].accent = '#12345'
    c.chapters[1].id = 'site-content'
    c.hero.headline = '|'
  })
  const json = JSON.stringify(old).replaceAll("'", "''")
  const [{ id }] = await first.sql(
    `INSERT INTO content_revisions (json, author, created_at) VALUES ('${json}', 'old', '2026-01-01T00:00:00Z') RETURNING id`,
  )

  const s = await start({}, first.root)
  assert.deepEqual((await s.call('/api/content')).data, old, 'the stored revision is live, not the seed')
  assert.doesNotMatch(s.log(), /is not valid/)
  const headers = await s.signedIn()
  const restored = await s.call(`/api/content/revisions/${id}/restore`, { method: 'POST', headers })
  assert.equal(restored.status, 200, String(restored.raw))
  const saved = await s.call('/api/content', { method: 'PUT', headers, body: { content: old } })
  for (const path of ['profile.initials ', 'chapters[0].accent ', 'chapter id "site-content"', 'hero.headline ']) {
    refused(saved, path, path)
  }
})

/* ------------------------------------------------------------------ admin */

test('D8: a refused field in a closed chapter opens that chapter', () => {
  const chapters = [{ id: 'a' }, { id: 'b' }, { id: 'a' }]
  const repeated = marks.fieldErrors(['duplicate chapter id "a"'], chapters)
  assert.equal(marks.chapterToOpen(repeated, 0), 2)
  assert.equal(marks.chapterToOpen(repeated, null), 2)
  const two = marks.fieldErrors(['chapters[1].title must be text', 'chapters[2].bullets[0] is empty'], chapters)
  assert.equal(marks.chapterToOpen(two, 0), 1)
  assert.equal(marks.chapterToOpen(two, 2), 2, 'an open chapter with a refused field stays open')
  const elsewhere = marks.fieldErrors(['hero.headline needs words'], chapters)
  assert.equal(marks.chapterToOpen(elsewhere, 0), 0)
  assert.equal(marks.chapterToOpen(elsewhere, null), null)
  assert.match(read('src/admin/sections.tsx'), /setOpen\(\(current\) => chapterToOpen\(errors, current\)\)/)
})

test('D9: the availability hint says where it shows', () => {
  const profile = read('src/admin/sections.tsx').split('function HeroSection')[0]
  assert.doesNotMatch(profile, /hero badge and contact block/)
  assert.match(profile, /label="Availability" hint="[^"]*chapter menu/)
  // The hint is true only while the menu is the one place that shows it.
  assert.match(read('src/components/Nav.tsx'), /profile\.availability/)
  assert.doesNotMatch(read('src/components/Footer.tsx'), /profile\.availability/)
})

/* ----------------------------------------------------------------- layout */

test('D1: the contact column may be narrower than the address, which breaks before the domain', () => {
  const contact = read('src/components/Contact.tsx')
  assert.match(contact, /grid grid-cols-1 gap-8 p-6/)
  assert.match(contact, /className="group min-w-0 font-display/)
  assert.match(contact, /<wbr \/>/)
})

test('D2: links that do not fit the bar give way to the menu', () => {
  const nav = read('src/components/Nav.tsx')
  assert.match(nav, /new ResizeObserver/)
  assert.match(nav, /scrollWidth > \w+\.clientWidth \+ spare/)
  // A menu left open when the links start to fit again must close, or it keeps holding the scroll.
  assert.match(nav, /\}, \[open, crowded\]\)/)
  assert.match(nav, /const menuFit = crowded \? 'menu' : fit/)
  assert.equal(nav.match(/data-fit=\{menuFit\}/g)?.length, 2, 'the menu button and the menu')
})

test('D3, D4: long words wrap, and the small marks beside them keep their size', () => {
  // On the public page, scripts off or on. Not on `body`: in the admin it splits button words and row numbers.
  for (const file of ['src/App.tsx', 'src/prerender/HeroShell.tsx']) {
    assert.match(read(file), /<div className="relative min-h-screen bg-bg text-ink wrap-anywhere">/, file)
  }
  assert.doesNotMatch(read('src/index.css'), /overflow-wrap/)
  assert.match(read('src/components/Footer.tsx'), /className="flex shrink-0 items-center gap-4"/)
  // Finish card: the title goes under the chapter name when both do not fit, and the lap time stays on one line.
  assert.match(read('src/game/WinCard.tsx'), /<span className="flex min-w-0 flex-1 flex-wrap /)
  assert.match(read('src/game/WinCard.tsx'), /grid grid-cols-3 [^"]*wrap-normal/)
  assert.match(read('src/index.css'), /\bsvg \{\s*flex-shrink: 0;/)
  assert.match(read('src/components/Footer.tsx'), /className="grid size-7 shrink-0 /)
  assert.match(read('src/components/heroClasses.ts'), /eyebrowDot: '[^']*shrink-0/)
  assert.match(read('src/components/ChapterBlock.tsx'), /className="grid size-8 shrink-0 /)
  assert.match(read('src/components/ChapterBlock.tsx'), /className="h-px w-6 shrink-0"/)
  assert.match(read('src/components/Chapters.tsx'), /className="shrink-0 [^"]*text-accent">/)
})

test('D5: the gate card keeps its close button, and the passed notice stays short', () => {
  assert.match(read('src/game/ZonePanel.tsx'), /aria-label="Close panel"\s+className="grid size-8 shrink-0 /)
  assert.match(read('src/game/ZonePanel.tsx'), /<div className="min-w-0">/)
  assert.match(read('src/game/GameHUD.tsx'), /className="line-clamp-3">\{toast\}/)
  // The "Entered" banner: a long name takes two lines, and the words around it stay whole.
  assert.match(read('src/game/GameHUD.tsx'), /className="line-clamp-2 min-w-0 [^"]*">\{zoneLabel\}/)
  assert.match(read('src/game/GameHUD.tsx'), /className="shrink-0 [^"]*">Entered</)
  assert.match(read('src/game/GameHUD.tsx'), /className="pointer-events-auto -my-1 shrink-0 /)
})

test('D5: text too long for a gate sign is cut before it is squeezed unreadably', () => {
  const measure = (s) => [...s].length * 10
  assert.equal(text.signText('Short', 100, measure), 'Short')
  // Up to the allowed squeeze the whole text stays.
  assert.equal(text.signText('x'.repeat(16), 100, measure), 'x'.repeat(16))
  const cut = text.signText('word '.repeat(24), 100, measure)
  assert.ok(cut.endsWith('…') && measure(cut) <= 160 && measure(cut) > 130, cut)
  assert.ok(text.signText('🚀'.repeat(40), 100, measure).isWellFormed())
  // The name and the hint are drawn through one helper that applies it.
  assert.match(read('src/game/Circuit.tsx'), /ctx\.fillText\(signText\([\s\S]*line\(label, [\s\S]*line\(hint, /)
})
