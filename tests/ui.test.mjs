/** Components rendered to markup: small-screen cards, the gate toast, admin field errors. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { createElement as h, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { start, source } from './harness.mjs'

const seed = JSON.parse(readFileSync(join(source, 'content/site.json'), 'utf8'))
const noop = () => {}

let vite
after(() => vite?.close())
const load = async (path) => {
  vite ??= createServer({
    root: source,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  })
  vite = await vite
  return vite.ssrLoadModule(path)
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])

/** Every element of static markup, with its attributes, ancestors and leading text. */
function elements(html) {
  const out = []
  const stack = []
  for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>([^<]*)/g)) {
    const [, closing, tag, raw, self, text] = match
    if (closing) {
      stack.pop()
      continue
    }
    const attrs = Object.fromEntries(
      [...raw.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map((m) => [m[1].toLowerCase(), m[2] ?? '']),
    )
    const el = { tag, attrs, text, parents: [...stack] }
    out.push(el)
    if (!self && !VOID.has(tag)) stack.push(el)
  }
  return out
}

const has = (el, name) => (el.attrs.class ?? '').split(/\s+/).includes(name)

/* ------------------------------------------------------------- drive cards */

/** Only the middle of the card may scroll: a control inside the scroller can open off screen. */
function assertPinned(html, controls) {
  const all = elements(html)
  for (const [name, find] of controls) {
    const el = all.find(find)
    assert.ok(el, `${name} is rendered`)
    assert.ok(!el.parents.some((p) => has(p, 'overflow-y-auto')), `${name} is outside every scroller`)
    assert.ok(el.parents.some((p) => has(p, 'max-h-full') && has(p, 'flex-col')), `${name} sits in a card no taller than the screen`)
  }
  assert.ok(all.some((el) => has(el, 'overflow-y-auto') && has(el, 'min-h-0')), 'the rest of the card scrolls')
}

test('intro card: Leave and Start stay on screen, only the text between them scrolls', async () => {
  const { IntroCard } = await load('/src/game/IntroCard.tsx')
  const html = renderToStaticMarkup(
    h(IntroCard, { chapters: seed.chapters, bestMs: 1000, onStart: noop, onExit: noop }),
  )
  assertPinned(html, [
    ['Leave the island', (el) => el.attrs['aria-label'] === 'Leave the island'],
    ['Start the lap', (el) => el.tag === 'button' && 'autofocus' in el.attrs],
  ])
})

test('win card: the result opens at its top and Race again stays on screen', async () => {
  const { WinCard } = await load('/src/game/WinCard.tsx')
  const html = renderToStaticMarkup(
    h(WinCard, {
      finalMs: 1000,
      bestMs: 1000,
      shards: 5,
      totalShards: 5,
      score: 1,
      assisted: false,
      chapters: seed.chapters,
      onReplay: noop,
      onExplore: noop,
      onJump: noop,
    }),
  )
  assertPinned(html, [['Race again', (el) => el.tag === 'button' && 'autofocus' in el.attrs]])
  const heading = elements(html).find((el) => el.tag === 'h2')
  assert.ok(heading.parents.some((p) => has(p, 'overflow-y-auto')), 'the result is in the scroller')
})

test('gate toast: part of the left HUD column, never centred over the card and the sign', async () => {
  const { GameHUD } = await load('/src/game/GameHUD.tsx')
  const props = { zoneLabel: null, discovered: 1, chapters: 5, clockMs: 0, onExit: noop, onReset: noop }
  const all = elements(renderToStaticMarkup(h(GameHUD, { ...props, toast: 'Start passed' })))
  const region = all.find((el) => el.attrs.role === 'status')
  assert.ok(region, 'the toast is a status message')
  assert.equal(region.text, 'Start passed')
  const shown = all.filter((el) => el.text === 'Start passed' && el !== region)
  assert.equal(shown.length, 1, 'and is drawn once')
  const [toast] = shown
  assert.ok(toast.parents.some((p) => p.attrs['aria-hidden'] === 'true'), 'the drawn copy is not read twice')
  const speed = all.find((el) => el.text === 'km/h')
  const column = speed.parents.findLast((p) => has(p, 'flex-col'))
  const columnOf = toast.parents.findLast((p) => has(p, 'flex-col'))
  assert.equal(columnOf.attrs.class, column.attrs.class, 'it hangs under the lap boxes')
  assert.ok(!toast.parents.some((p) => has(p, 'inset-x-0') && has(p, 'justify-center')))
  const none = elements(renderToStaticMarkup(h(GameHUD, { ...props, toast: null })))
  const idle = none.filter((el) => el.attrs.role === 'status')
  assert.equal(idle.length, 1, 'the live region is mounted before there is a message')
  assert.equal(idle[0].text, '')

  const drive = readFileSync(join(source, 'src/game/DriveMode.tsx'), 'utf8')
  assert.match(drive, /toast=\{toast\}/, 'DriveMode hands the message to the HUD')
  assert.doesNotMatch(drive, /\{toast\}\s*<\/div>/, 'and draws none of its own')
})

/* ------------------------------------------------------- admin field errors */

const blank = (n) => ' '.repeat(n)

/** One damaged value per admin field; the value tells the inputs apart. */
const DAMAGE = {
  'profile.name': blank(1),
  'profile.email': 'bad-email',
  'profile.socials[0].label': blank(2),
  'profile.socials[0].href': 'javascript:x',
  'hero.eyebrow': blank(3),
  'hero.subline': blank(4),
  'stats[0].value': blank(5),
  'stats[0].label': blank(6),
  'chapters[0].id': 'Bad Id',
  'chapters[0].title': blank(7),
  'chapters[0].body': blank(8),
  'chapters[0].accent': 'red',
  'chapters[0].bullets[0]': blank(9),
  'principles[0].title': blank(10),
  'principles[0].body': blank(11),
  'contact.heading': blank(12),
  'contact.body': blank(13),
  'stack[0].name': blank(14),
  'stack[0].icon': 'no-such-icon',
  'stack[0].level': 200,
}

function damaged() {
  const content = structuredClone(seed)
  for (const [path, value] of Object.entries(DAMAGE)) {
    const keys = path.split(/[.[\]]+/).filter(Boolean)
    const last = keys.pop()
    keys.reduce((node, key) => node[key], content)[last] = value
  }
  return content
}

test('admin: every refused field is aria-invalid and points at its own error line', async () => {
  const s = await start()
  const content = damaged()
  const res = await s.call('/api/content', { method: 'PUT', headers: await s.signedIn(), body: { content } })
  assert.equal(res.status, 422, res.raw.toString())
  const problems = res.data.errors

  const { fieldErrors } = await load('/src/admin/fieldErrors.ts')
  const { FieldErrors, ProblemList } = await load('/src/admin/fields.tsx')
  const sections = await load('/src/admin/sections.tsx')
  const names = ['Profile', 'Hero', 'Chapters', 'Principles', 'Contact', 'Stack']
  const render = (value) =>
    elements(
      renderToStaticMarkup(
        h(
          FieldErrors.Provider,
          { value },
          h(
            Fragment,
            null,
            h(ProblemList, { problems }),
            ...names.map((name) => h(sections[`${name}Section`], { key: name, draft: content, patch: noop })),
          ),
        ),
      ),
    )

  const all = render(fieldErrors(problems, content.chapters))
  const lines = new Map(all.filter((el) => el.tag === 'li' && el.attrs.id).map((el) => [el.attrs.id, el.text]))
  assert.equal(lines.size, problems.length, 'every problem has a line with an id, also past the twelfth')

  const marked = all.filter((el) => el.attrs['aria-invalid'] === 'true')
  const seen = {}
  for (const el of marked) {
    const ids = el.attrs['aria-describedby'].split(' ')
    // A message starts with the path of its field.
    const paths = new Set(ids.map((id) => lines.get(id).replace(/^• /, '').split(' ')[0]))
    assert.equal(paths.size, 1, [...paths].join())
    const value = el.tag === 'textarea' ? el.text : el.tag === 'select' ? DAMAGE['stack[0].icon'] : el.attrs.value
    seen[[...paths][0]] = value
  }
  assert.deepEqual(seen, Object.fromEntries(Object.entries(DAMAGE).map(([k, v]) => [k, String(v)])))
  assert.equal(marked.length, Object.keys(DAMAGE).length, 'no other field is marked')

  assert.ok(!render(new Map()).some((el) => 'aria-invalid' in el.attrs), 'nothing is marked without errors')
})

test('admin: chapter id messages name the chapters, and form errors name their fields', async () => {
  const { fieldErrors, problemId, signInRefused, passwordErrorFields } = await load('/src/admin/fieldErrors.ts')
  const chapters = [{ id: 'a' }, { id: 'hero' }, { id: 'a' }]
  const map = fieldErrors(
    ['duplicate chapter id "a"', 'chapter id "hero" is reserved by the page layout', 'Content must be a JSON object'],
    chapters,
  )
  assert.deepEqual([...map], [['chapters[2].id', problemId(0)], ['chapters[1].id', problemId(1)]])
  const twice = fieldErrors(['profile.email must be a non-empty string', 'profile.email must look like an email'], [])
  assert.equal(twice.get('profile.email'), `${problemId(0)} ${problemId(1)}`)

  assert.deepEqual([400, 401, 429, 503].map(signInRefused), [true, true, false, false])
  assert.deepEqual(passwordErrorFields(401, 'Current password is incorrect.'), ['current'])
  assert.deepEqual(passwordErrorFields(401, 'Not signed in'), [])
  assert.deepEqual(passwordErrorFields(422, 'Password needs a number.'), ['next'])
  assert.deepEqual(passwordErrorFields(400, 'Password is too long.'), ['current', 'next'])
  assert.deepEqual(passwordErrorFields(429, 'Too many attempts.'), [])
})

test('admin: an input given an error id says it is invalid', async () => {
  const { TextInput } = await load('/src/admin/fields.tsx')
  const [bad] = elements(renderToStaticMarkup(h(TextInput, { value: '', onChange: noop, errorId: 'why' })))
  assert.equal(bad.attrs['aria-invalid'], 'true')
  assert.equal(bad.attrs['aria-describedby'], 'why')
  const [good] = elements(renderToStaticMarkup(h(TextInput, { value: '', onChange: noop })))
  assert.ok(!('aria-invalid' in good.attrs) && !('aria-describedby' in good.attrs))
})
