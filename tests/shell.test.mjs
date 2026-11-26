/** ADR 0003: the server puts a static hero and the content into `/`. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { isBuiltin } from 'node:module'
import { build, createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { scratch, start, source } from './harness.mjs'

const seed = JSON.parse(readFileSync(join(source, 'content/site.json'), 'utf8'))
const PAGE = '<!doctype html><html><head><title>spa</title></head><body><div id="root"></div></body></html>'
const BLOCK = /<script type="application\/json" id="site-content">([\s\S]*?)<\/script>/g
const blocks = (html) => [...html.matchAll(BLOCK)].map((m) => m[1])

const out = mkdtempSync(join(tmpdir(), 'portfolio-ssr-'))
after(() => rmSync(out, { recursive: true, force: true }))
let bundled

/** The real server bundle, built the way `npm run build` builds it. */
const bundle = () => (bundled ??= buildBundle())

async function buildBundle() {
  const mode = process.env.NODE_ENV
  await build({
    root: source,
    logLevel: 'silent',
    build: { ssr: 'src/prerender/entry.tsx', outDir: out, emptyOutDir: true },
  })
  // Vite leaves NODE_ENV=production behind; a production JSX runtime loaded next
  // to the development React here reports keys as missing that are not.
  if (mode === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = mode
  return join(out, 'entry.js')
}

async function site({ entry } = {}) {
  const root = scratch()
  writeFileSync(join(root, 'dist/index.html'), PAGE)
  mkdirSync(join(root, 'dist-server'))
  if (entry === undefined) cpSync(await bundle(), join(root, 'dist-server/entry.js'))
  else if (entry !== null) writeFileSync(join(root, 'dist-server/entry.js'), entry)
  return start({}, root)
}

const save = async (s, headers, change) => {
  const content = structuredClone(seed)
  change(content)
  const put = await s.call('/api/content', { method: 'PUT', headers, body: { content } })
  assert.equal(put.status, 200, put.raw.toString())
  return content
}

test('shell: the build writes the server bundle, and it needs no package at run time', async () => {
  const { scripts } = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  assert.match(scripts.build, /vite build --ssr src\/prerender\/entry\.tsx --outDir dist-server/)
  assert.match(readFileSync(join(source, 'index.html'), 'utf8'), /<div id="root"><\/div>/)
  const code = readFileSync(await bundle(), 'utf8')
  const bare = [...code.matchAll(/(?:^import\s[^'"]*?from\s*|^import\s*|\b__require\(|\brequire\(|\bimport\()["']([^"'./][^"']*)["']/gm)]
    .map((m) => m[1].replace(/^node:/, ''))
    .filter((name) => !isBuiltin(name))
  assert.deepEqual(bare, [])
  assert.doesNotMatch(code, /react-dom[\w.-]*\.development|process\.env\.NODE_ENV/, 'production React only')
  assert.deepEqual(readdirSync(out), ['entry.js'], 'no copy of public/')
})

test('shell: `/` and `/index.html` carry the hero and the data block; other pages do not', async () => {
  const s = await site()
  for (const path of ['/', '/index.html', '/?utm=1']) {
    const res = await s.call(path)
    assert.equal(res.status, 200, path)
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8')
    assert.equal(res.headers['cache-control'], 'no-cache')
    assert.match(res.headers['content-security-policy'], /script-src 'self'(;|$)/)
    const html = res.raw.toString()
    assert.match(html, /<div id="root"><div[^>]*>.*<section id="hero".*<h1 /s, path)
    for (const text of [seed.hero.eyebrow, seed.hero.subline, seed.hero.primaryCta, seed.stats[0].label]) {
      assert.ok(html.includes(text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')), text)
    }
    assert.equal(blocks(html).length, 1)
    assert.deepEqual(JSON.parse(blocks(html)[0]), seed)
  }
  for (const path of ['/admin', '/admin/', '/no-such-page']) {
    assert.equal((await s.call(path)).raw.toString(), PAGE, path)
  }
  assert.equal((await s.call('/dist-server/entry.js')).status, 404)
})

test('shell: a save changes the page and its ETag; HEAD, 304 and compression work', async () => {
  const s = await site()
  const headers = await s.signedIn()
  const first = await s.call('/')
  await save(s, headers, (c) => (c.hero.headline = 'Fresh from | the admin'))
  const next = await s.call('/', { headers: { 'if-none-match': first.headers.etag } })
  assert.equal(next.status, 200)
  assert.notEqual(next.headers.etag, first.headers.etag)
  assert.match(next.raw.toString(), /Fresh from/)
  assert.equal((await s.call('/', { headers: { 'if-none-match': next.headers.etag } })).status, 304)
  const head = await s.call('/', { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.raw.length, 0)
  assert.equal(Number(head.headers['content-length']), next.raw.length)
  const br = await s.call('/', { headers: { 'accept-encoding': 'br' } })
  assert.equal(br.headers['content-encoding'], 'br')
  assert.equal(br.headers.vary, 'Accept-Encoding')
  assert.equal(brotliDecompressSync(br.raw).toString(), next.raw.toString())
})

test('shell: a new build changes the ETag even when the content revision is the same', async () => {
  const s = await site()
  const tag = (await s.call('/')).headers.etag
  await s.stop()
  writeFileSync(join(s.root, 'dist/index.html'), PAGE.replace('spa', 'spa v2'))
  const again = await start({}, s.root)
  const res = await again.call('/', { headers: { 'if-none-match': tag } })
  assert.equal(res.status, 200)
  assert.match(res.raw.toString(), /spa v2/)
})

test('shell: `</script>` in content cannot break out of the data block or the markup', async () => {
  const s = await site()
  const headers = await s.signedIn()
  const nasty = `</script><script>alert(1)</script><!-- $& $' <img src=x onerror=alert(2)>`
  const content = await save(s, headers, (c) => {
    c.hero.headline = `${nasty} | ${nasty}`
    c.hero.subline = nasty
    c.stats[0].label = nasty
    c.contact.body = nasty
  })
  const html = (await s.call('/')).raw.toString()
  assert.doesNotMatch(html, /<script>|<img |<!-- \$/i)
  assert.equal(html.match(/<script/g).length, 1)
  assert.equal(html.match(/<\/script>/g).length, 1)
  assert.equal(blocks(html).length, 1)
  assert.doesNotMatch(blocks(html)[0], /</)
  assert.deepEqual(JSON.parse(blocks(html)[0]), content)
})

test('shell: a render error serves the plain page and is logged once', async () => {
  const s = await site({ entry: 'export function render() { throw new Error("boom-in-render") }\n' })
  const headers = await s.signedIn()
  for (let i = 0; i < 2; i++) {
    const res = await s.call('/')
    assert.equal(res.status, 200)
    assert.equal(res.raw.toString(), PAGE)
  }
  await save(s, headers, (c) => (c.hero.headline = 'Another revision'))
  assert.equal((await s.call('/')).raw.toString(), PAGE)
  assert.equal(s.log().match(/boom-in-render/g)?.length, 1, s.log())
})

test('shell: without the server bundle the plain page is served', async () => {
  const s = await site({ entry: null })
  const res = await s.call('/')
  assert.equal(res.status, 200)
  assert.equal(res.raw.toString(), PAGE)
})

/* ------------------------------------------------------------ drift, client */

/** Layout-relevant outline: tags (a look-alike span stands for a button), classes and text. */
function outline(html, rootClass) {
  const parts = html.replace(/<!--.*?-->/gs, '').match(/<[^>]*>|[^<]+/g)
  const from = parts.findIndex((p) => p.includes(`class="${rootClass}"`))
  assert.ok(from >= 0, `no element with class "${rootClass}"`)
  const result = []
  let depth = 0
  for (const part of parts.slice(from)) {
    if (part.startsWith('</')) depth -= 1
    else if (part.startsWith('<')) {
      const tag = part.match(/^<([a-zA-Z0-9]+)/)[1].replace(/^button$/, 'span')
      const cls = (part.match(/ class="([^"]*)"/)?.[1] ?? '').trim().replace(/\s+/g, ' ')
      result.push(`<${tag} ${cls}>`)
      if (!part.endsWith('/>')) depth += 1
    } else result.push(part)
    if (depth === 0) break
  }
  return result
}

test('shell: HeroShell matches Hero, which starts from the data block and renders the shell parts in place', async (t) => {
  const vite = await createServer({
    root: source,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  })
  t.after(() => {
    delete globalThis.document
    return vite.close()
  })
  const load = (path) => vite.ssrLoadModule(path)
  const { Hero } = await load('/src/components/Hero.tsx')
  const { ContentProvider } = await load('/src/content/ContentProvider.tsx')
  const { HeroShell } = await load('/src/prerender/HeroShell.tsx')
  const { heroClasses } = await load('/src/components/heroClasses.ts')

  const content = structuredClone(seed)
  content.hero = {
    eyebrow: 'Edited eyebrow',
    headline: 'Edited first line | edited second line',
    subline: 'Edited subline',
    primaryCta: 'Edited go',
    secondaryCta: 'Edited read',
  }
  content.profile.location = 'Edited place'
  content.stats[0] = { value: '77', suffix: '%', label: 'Edited stat' }
  const hero = () =>
    renderToStaticMarkup(
      h(ContentProvider, null, h(Hero, { theme: 'dark', onDrive: () => {}, covered: false })),
    )
  const dataBlock = (text) => {
    globalThis.document = { getElementById: (id) => (id === 'site-content' ? { textContent: text } : null) }
  }
  const opening = (html, cls) => html.match(new RegExp(`<[a-z0-9]+ [^>]*class="${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`))?.[0]

  for (const text of [undefined, '{broken', '{"hero":1}']) {
    if (text !== undefined) dataBlock(text)
    const plain = hero()
    assert.ok(plain.includes(seed.hero.subline), 'falls back to the seed')
    for (const name of ['eyebrow', 'subline', 'actions', 'stats']) {
      assert.match(opening(plain, heroClasses[name]), /opacity:0/, `without a shell ${name} keeps its entrance`)
    }
  }

  dataBlock(JSON.stringify(content).replace(/</g, '\\u003c'))
  const live = hero()
  const shell = renderToStaticMarkup(h(HeroShell, { content }))

  assert.deepEqual(outline(shell, heroClasses.copy), outline(live, heroClasses.copy))
  assert.ok(outline(shell, heroClasses.copy).includes('Edited subline'))
  for (const name of ['section', 'grid', 'copy', 'scene']) {
    assert.ok(shell.includes(`class="${heroClasses[name]}"`), `shell: ${name}`)
    assert.ok(live.includes(`class="${heroClasses[name]}"`), `hero: ${name}`)
  }
  for (const name of ['eyebrow', 'subline', 'actions', 'stats']) {
    assert.doesNotMatch(opening(live, heroClasses[name]), /opacity:0/, `${name} renders in place`)
  }
  const headline = live.match(/<h1 [\s\S]*?<\/h1>/)[0]
  assert.doesNotMatch(headline, /opacity:0|translateY\(108%\)/, 'headline renders in place')
  assert.doesNotMatch(shell, /opacity|<button|<a /)
})
