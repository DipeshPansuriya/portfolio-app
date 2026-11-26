/** What the owner edits reaches the page, and the screens fit. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { scratch, start, source } from './harness.mjs'

const seed = JSON.parse(readFileSync(join(source, 'content/site.json'), 'utf8'))
const template = readFileSync(join(source, 'index.html'), 'utf8')
const read = (path) => readFileSync(join(source, path), 'utf8')
const noop = () => {}

let vite
after(async () => {
  delete globalThis.document
  await (await vite)?.close()
})
const load = async (path) => {
  vite ??= createServer({
    root: source,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  })
  return (await vite).ssrLoadModule(path)
}

/** A server with the real `index.html` and a stand-in for the hero render. */
async function site() {
  const root = scratch()
  writeFileSync(join(root, 'dist/index.html'), template)
  mkdirSync(join(root, 'dist-server'))
  writeFileSync(join(root, 'dist-server/entry.js'), 'export const render = () => "<main></main>"\n')
  return start({}, root)
}

const save = (s, headers, content) => s.call('/api/content', { method: 'PUT', headers, body: { content } })
const edited = (change) => {
  const content = structuredClone(seed)
  change(content)
  return content
}

const unescape = (text) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name])

/** What a crawler or a browser without scripts reads from the page. */
function head(html) {
  const meta = (attr, value) => {
    const found = [...html.matchAll(new RegExp(`<meta[^>]*\\b${attr}="${value}"[^>]*>`, 'g'))]
    assert.equal(found.length, 1, `one ${value} tag`)
    // Not the `content` inside `data-content`.
    return unescape(found[0][0].match(/\scontent="([^"]*)"/)[1])
  }
  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  assert.equal(ld.length, 1)
  assert.equal([...html.matchAll(/<title\b/g)].length, 1)
  const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)[1]
  return {
    title: unescape(html.match(/<title[^>]*>([^<]*)<\/title>/)[1]),
    description: meta('name', 'description'),
    ogTitle: meta('property', 'og:title'),
    ogDescription: meta('property', 'og:description'),
    person: JSON.parse(ld[0][1]),
    noscript,
    text: unescape(noscript.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
    links: [...noscript.matchAll(/href="([^"]*)"/g)].map((m) => unescape(m[1])),
  }
}

/** The tags as `index.html` ships them: the owner's wording. */
const shipped = head(template)

/* ----------------------------------------------------------------- M1, M2 */

test('head: with the seed it reads as before, from the content', async () => {
  const s = await site()
  const now = head((await s.call('/')).raw.toString())
  for (const key of ['title', 'description', 'ogTitle', 'ogDescription', 'person', 'text', 'links']) {
    assert.deepEqual(now[key], shipped[key], key)
  }
  assert.deepEqual(seed.meta, { description: shipped.description, shareDescription: shipped.ogDescription })
})

test('head: a saved name, role, profile link and descriptions reach the page', async () => {
  const s = await site()
  const content = edited((c) => {
    c.profile.name = 'Asha Rao'
    c.profile.role = 'Platform Lead'
    c.profile.socials = [
      { label: 'Email', handle: '', href: 'mailto:asha@example.test' },
      { label: 'GitHub', handle: '', href: 'https://github.com/asha' },
    ]
    c.meta = { description: 'New search text.', shareDescription: 'New share text.' }
  })
  assert.equal((await save(s, await s.signedIn(), content)).status, 200)
  const res = await s.call('/')
  const now = head(res.raw.toString())
  assert.equal(now.title, 'Asha Rao — Platform Lead')
  assert.equal(now.ogTitle, now.title)
  assert.equal(now.description, 'New search text.')
  assert.equal(now.ogDescription, 'New share text.')
  assert.deepEqual(now.person, {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Asha Rao',
    jobTitle: 'Platform Lead',
    sameAs: ['https://github.com/asha'],
  })
  assert.match(now.text, /^Asha Rao, Platform Lead\. .*the GitHub profile works without it\.$/)
  assert.deepEqual(now.links, ['https://github.com/asha'])
  assert.match(res.raw.toString(), /\[data-lookalike\]/, 'the noscript style stays')
  assert.match(res.headers['content-security-policy'], /script-src 'self'(;|$)/)
  assert.doesNotMatch(res.raw.toString(), /Dipesh Pansuriya, Software Engineer\./)
})

test('head: content cannot break out of a tag, an attribute or the data blocks', async () => {
  const s = await site()
  const nasty = `"></title></script></noscript><script>alert(1)</script> $& $' &amp;`
  const content = edited((c) => {
    c.profile.name = nasty
    c.profile.role = nasty
    c.profile.socials = [{ label: nasty, handle: '', href: `https://example.test/"><img src=x onerror=1>` }]
    c.meta = { description: nasty, shareDescription: nasty }
  })
  assert.equal((await save(s, await s.signedIn(), content)).status, 200)
  const html = (await s.call('/')).raw.toString()
  assert.doesNotMatch(html, /<script>|<img /i)
  assert.equal(html.match(/<noscript>/g).length, 1)
  assert.equal(html.match(/<\/script>/g).length, template.match(/<\/script>/g).length + 1)
  const now = head(html)
  assert.equal(now.title, `${nasty} — ${nasty}`)
  assert.equal(now.description, nasty)
  assert.equal(now.person.name, nasty)
  assert.deepEqual(now.links, [content.profile.socials[0].href])
})

test('head: with no web profile the noscript line offers the email', async () => {
  const s = await site()
  const content = edited((c) => (c.profile.socials = []))
  assert.equal((await save(s, await s.signedIn(), content)).status, 200)
  const now = head((await s.call('/')).raw.toString())
  assert.deepEqual(now.links, [`mailto:${seed.profile.email}`])
  assert.ok(!('sameAs' in now.person))
})

test('meta: a revision saved before the fields existed boots, serves and restores', async () => {
  const s = await site()
  const old = edited((c) => {
    delete c.meta
    c.profile.name = 'Old Revision'
  })
  const [{ id }] = await s.sql(
    `INSERT INTO content_revisions (json, author, created_at) VALUES ('${JSON.stringify(old).replaceAll("'", "''")}', 'hand', '2026-01-01T00:00:00Z') RETURNING id`,
  )
  await s.stop()
  const again = await start({}, s.root)
  assert.deepEqual((await again.call('/api/content')).data, old)
  const now = head((await again.call('/')).raw.toString())
  assert.equal(now.title, `Old Revision — ${seed.profile.role}`)
  assert.equal(now.description, shipped.description)
  assert.equal(now.ogDescription, shipped.ogDescription)
  const headers = await again.signedIn()
  assert.deepEqual((await again.call('/api/content/revisions', { headers })).data.skipped, [])
  const back = await again.call(`/api/content/revisions/${id}/restore`, { method: 'POST', headers })
  assert.equal(back.status, 200, back.raw.toString())
  // Empty fields keep the built-in wording too.
  const empty = edited((c) => (c.meta = { description: '', shareDescription: '' }))
  assert.equal((await save(again, headers, empty)).status, 200)
  assert.equal(head((await again.call('/')).raw.toString()).description, shipped.description)
})

test('head: a blank description keeps the built-in wording', async () => {
  const s = await site()
  const content = edited((c) => (c.meta = { description: '   ', shareDescription: ' \n\t ' }))
  assert.equal((await save(s, await s.signedIn(), content)).status, 200)
  const now = head((await s.call('/')).raw.toString())
  assert.equal(now.description, shipped.description)
  assert.equal(now.ogDescription, shipped.ogDescription)
})

test('handle: a revision stored with a null handle boots and restores, the handle read as empty', async () => {
  const s = await site()
  const old = edited((c) => {
    c.profile.name = 'Null Handle'
    c.profile.socials[0].handle = null
  })
  const stored = JSON.stringify(old)
  const [{ id }] = await s.sql(
    `INSERT INTO content_revisions (json, author, created_at) VALUES ('${stored.replaceAll("'", "''")}', 'hand', '2026-01-01T00:00:00Z') RETURNING id`,
  )
  await s.stop()
  const again = await start({}, s.root)
  const expected = structuredClone(old)
  expected.profile.socials[0].handle = ''
  const headers = await again.signedIn()
  assert.deepEqual((await again.call('/api/content/revisions', { headers })).data.skipped, [])
  assert.deepEqual((await again.call('/api/content')).data, expected)
  assert.equal(head((await again.call('/')).raw.toString()).title, `Null Handle — ${seed.profile.role}`)

  const back = await again.call(`/api/content/revisions/${id}/restore`, { method: 'POST', headers })
  assert.equal(back.status, 200, back.raw.toString())
  assert.deepEqual((await again.call('/api/content')).data, expected)
  const [row] = await again.sql(`SELECT json FROM content_revisions WHERE id = ${Number(id)}`)
  assert.equal(row.json, stored, 'the stored revision is not rewritten')
  // A new save is still held to the rule.
  const refused = await save(again, headers, old)
  assert.equal(refused.status, 422)
  assert.deepEqual(refused.data.errors, ['profile.socials[0].handle must be text'])
})

/* --------------------------------------------------------------------- M3 */

/** Every path to a value inside `node`. */
const paths = (node, at = []) =>
  node && typeof node === 'object'
    ? [...(at.length ? [at] : []), ...Object.entries(node).flatMap(([k, v]) => paths(v, [...at, k]))]
    : [at]

test('content: the server refuses everything the browser would refuse to show', async () => {
  const root = scratch()
  process.env.DSH_DB_FILE = join(root, 'data/portfolio.db')
  const { validateContent } = await import(pathToFileURL(join(root, 'server/content.mjs')).href)
  delete process.env.DSH_DB_FILE
  const { shapeProblem } = await load('/src/content/validate.ts')
  assert.deepEqual(validateContent(seed), [])
  assert.equal(shapeProblem(seed), null)
  const accepted = []
  for (const path of paths(seed)) {
    for (const value of [7, null, {}, [7]]) {
      const content = structuredClone(seed)
      path.slice(0, -1).reduce((node, key) => node[key], content)[path.at(-1)] = value
      if (shapeProblem(content) && !validateContent(content).length) accepted.push(`${path.join('.')} = ${JSON.stringify(value)}`)
    }
  }
  assert.deepEqual(accepted, [])
  const handle = edited((c) => (c.profile.socials[0].handle = 7))
  assert.deepEqual(validateContent(handle), ['profile.socials[0].handle must be text'])
  const meta = edited((c) => (c.meta.description = 7))
  assert.deepEqual(validateContent(meta), ['meta.description must be text'])
})

/* ------------------------------------------------------------------ limits */

test('limits: an over-long field is refused on save, and stored long text still restores', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const long = edited((c) => {
    c.hero.headline = 'h'.repeat(201)
    c.chapters[0].bullets[0] = 'b'.repeat(601)
    c.stack[0].name = 'n'.repeat(121)
  })
  const refused = await save(s, headers, long)
  assert.equal(refused.status, 422, refused.raw.toString())
  assert.deepEqual(refused.data.errors, [
    'hero.headline must be at most 200 characters',
    'chapters[0].bullets[0] must be at most 600 characters',
    'stack[0].name must be at most 120 characters',
  ])
  const [{ id }] = await s.sql(
    `INSERT INTO content_revisions (json, author, created_at) VALUES ('${JSON.stringify(long).replaceAll("'", "''")}', 'hand', '2026-01-01T00:00:00Z') RETURNING id`,
  )
  const back = await s.call(`/api/content/revisions/${id}/restore`, { method: 'POST', headers })
  assert.equal(back.status, 200, back.raw.toString())
})

/* ------------------------------------------------------------------ FR-006 */

test('history: the first revision stays listed and restorable after more than 30 saves', async () => {
  const s = await start()
  const headers = await s.signedIn()
  for (let i = 0; i < 33; i++) {
    assert.equal((await save(s, headers, edited((c) => (c.hero.eyebrow = `Edit ${i}`)))).status, 200)
  }
  const { revisions } = (await s.call('/api/content/revisions', { headers })).data
  assert.equal(revisions.length, 31)
  assert.deepEqual(revisions.map((r) => Number(r.id)), [...Array.from({ length: 30 }, (_, i) => 34 - i), 1])
  assert.equal(revisions.at(-1).note, 'seed')
  assert.equal((await s.call('/api/content/revisions/1/restore', { method: 'POST', headers })).status, 200)
  assert.deepEqual((await s.call('/api/content')).data, seed)
})

/* -------------------------------------------------------------- M4, M5, UI */

/** The public components, rendered from `content` the way a served page starts. */
async function render(path, name, content, props = {}) {
  const { ContentProvider } = await load('/src/content/ContentProvider.tsx')
  const component = (await load(path))[name]
  globalThis.document = { getElementById: () => ({ textContent: JSON.stringify(content) }) }
  try {
    return renderToStaticMarkup(h(ContentProvider, null, h(component, props)))
  } finally {
    delete globalThis.document
  }
}

test('contact buttons: they survive a renamed or removed `contact` chapter', async () => {
  const mail = `href="mailto:${seed.profile.email}"`
  const { buildTrack } = await load('/src/game/track.ts')
  const renamed = edited((c) => (c.chapters.at(-1).id = 'say-hello'))
  const moved = edited((c) => c.chapters.unshift(c.chapters.pop()))
  for (const [content, holder] of [[seed, 'contact'], [renamed, 'say-hello'], [moved, 'contact']]) {
    const html = await render('/src/components/Chapters.tsx', 'Chapters', content, { onDrive: noop })
    assert.equal(html.split(mail).length - 1, 1, holder)
    const article = html.split('<article ').find((part) => part.includes(mail))
    assert.ok(article.startsWith(`id="${holder}"`), article.slice(0, 40))
    const zone = buildTrack(content.chapters).gates.find((g) => g.id === holder)
    const card = await render('/src/game/ZonePanel.tsx', 'ZonePanel', content, {
      zone,
      holdLeft: null,
      holdPaused: false,
      onHoldPause: noop,
      onClose: noop,
      onJumpToSection: noop,
      onNext: noop,
    })
    assert.ok(card.includes(mail), `drive card of ${holder}`)
  }
})

test('stack level: a higher level draws a bigger icon on the ring', async () => {
  const { ringScale } = await load('/src/three/ringScale.ts')
  assert.deepEqual([0, 80, 100].map(ringScale), [0.6, 1, 1.1])
  assert.deepEqual([-5, 400].map(ringScale), [0.6, 1.1])
  assert.match(read('src/three/TechRing.tsx'), /ringScale\(/)
})

test('admin: meta fields can be edited, and the hints say what is shown', async () => {
  const sections = await load('/src/admin/sections.tsx')
  const markup = (name) => renderToStaticMarkup(h(sections[name], { draft: seed, patch: noop }))
  const profile = markup('ProfileSection')
  assert.ok(profile.includes('Search description') && profile.includes('Share description'))
  assert.ok(profile.includes(`>${seed.meta.shareDescription}</textarea>`))
  assert.match(profile, /Handles are saved but not shown/)
  assert.match(profile, /Not shown on the site\. IANA name/)
  assert.match(profile, /Up to three characters/)
  assert.match(markup('HeroSection'), /\| (starts|sets)/)
  assert.doesNotMatch(markup('HeroSection'), /Four cells/)
  assert.match(markup('ChaptersSection'), /without one, the last chapter/)
  assert.doesNotMatch(markup('PrinciplesSection'), /inside the Principles chapter/)
  const stack = markup('StackSection')
  assert.match(stack, /Level sets the icon size/)
  assert.match(stack, /<input type="range"[^>]*class="[^"]*\bh-6\b/)
})

test('numbers and long lists: two digits past nine, and no duplicate keys', async () => {
  const content = edited((c) => {
    c.principles = Array.from({ length: 10 }, () => ({ title: 'Same', body: 'Same' }))
  })
  const html = await render('/src/components/Chapters.tsx', 'Chapters', content, { onDrive: noop })
  assert.match(html, />10</)
  assert.doesNotMatch(html, />010</)
  for (const file of ['Nav', 'Chapters']) assert.doesNotMatch(read(`src/components/${file}.tsx`), />0\{i \+ 1\}</)
  for (const file of ['components/Hero', 'components/Chapters', 'components/ChapterBlock', 'components/Contact', 'components/Footer', 'prerender/HeroShell', 'game/ZonePanel']) {
    assert.doesNotMatch(read(`src/${file}.tsx`), /key=\{(?:[a-z]\.(?:label|title)|b)\}/, file)
  }
})

test('nav: chapter links need room, and more of them need more', async () => {
  const { Nav } = await load('/src/components/Nav.tsx')
  const nav = (count) =>
    renderToStaticMarkup(
      h(Nav, {
        theme: 'dark',
        onToggleTheme: noop,
        onDrive: noop,
        profile: seed.profile,
        chapters: Array.from({ length: count }, (_, i) => ({ ...seed.chapters[0], id: `c${i}` })),
      }),
    )
  // Past eight, no screen is wide enough for the bar: links would be hidden behind a sideways scroll.
  for (const [count, fit] of [[5, 'few'], [6, 'few'], [7, 'many'], [8, 'many'], [9, 'menu']]) {
    const html = nav(count)
    assert.ok(html.includes(`data-fit="${fit}"`), `${count} chapters`)
    assert.doesNotMatch(html, /\bmd:(flex|hidden)\b/, 'nothing switches at 768 px any more')
  }
})
