/** Hardening, proven through behaviour. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { scratch, start, database, source, PASSWORD, EMAIL } from './harness.mjs'

const seed = JSON.parse(readFileSync(join(source, 'content/site.json'), 'utf8'))
const NEW_PASSWORD = 'Another-Passw0rd-1'

/** Runs `code` in a fresh process against the database of `root`; returns the printed JSON. */
async function probe(root, code, env = {}) {
  const at = (path) => JSON.stringify(pathToFileURL(join(root, path)).href)
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code(at)], {
    cwd: root,
    env: { PATH: process.env.PATH, ...(await database(root)), ...env },
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout.trim().split('\n').at(-1))
}

/* ------------------------------------------------------------ DB 8: sessions */

test('session: none is created for a password hash that is no longer current', async () => {
  const s = await start()
  await s.stop()
  const result = await probe(s.root, (at) => `
    const { db, initDb, driver } = await import(${at('server/db.mjs')})
    const { createSession } = await import(${at('server/auth.mjs')})
    await initDb()
    const user = await db.get('SELECT * FROM users')
    const stale = await createSession({ ...user, password_hash: 'scrypt$old' })
    const current = await createSession(user)
    const rows = await db.get('SELECT COUNT(*) AS n FROM sessions')
    await driver.close()
    console.log(JSON.stringify({ stale, current: Boolean(current?.token), rows: Number(rows.n) }))
  `)
  assert.deepEqual(result, { stale: null, current: true, rows: 1 })
})

test('session: sign-ins racing a password change leave no session on the old password', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  const from = (n) => ({ 'x-forwarded-for': `203.0.113.${n}` })
  let owner = await s.signedIn()
  let current = PASSWORD
  let n = 1
  for (let round = 0; round < 4; round++) {
    const next = `${NEW_PASSWORD}-${round}`
    const racing = []
    const change = s.call('/api/auth/password', { method: 'POST', headers: owner, body: { current, next } })
    for (let i = 0; i < 8; i++) {
      racing.push(new Promise((ok) => setTimeout(ok, i * 12)).then(() => s.login(current, EMAIL, from(n++))))
    }
    const changed = await change
    assert.equal(changed.status, 200, changed.raw.toString())
    owner = { ...owner, 'x-csrf-token': changed.data.csrf }
    await Promise.all(racing)
    assert.equal((await s.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n, 1, `round ${round}: only the owner stays`)
    current = next
  }
})

/* ---------------------------------------------------- DB 11: two admin tabs */

test('content: a save from an out-of-date base is refused with 409', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const live = await s.call('/api/content')
  const base = Number(live.headers['x-content-revision'])
  assert.ok(base >= 1, 'the content response names its revision')
  const cached = await s.call('/api/content', { headers: { 'if-none-match': live.headers.etag } })
  assert.equal(cached.status, 304)
  assert.equal(cached.headers['x-content-revision'], String(base))

  const edit = (headline, baseRevision) => {
    const content = structuredClone(seed)
    content.hero.headline = headline
    return s.call('/api/content', { method: 'PUT', headers, body: { content, baseRevision } })
  }
  const both = await Promise.all([edit('Tab one', base), edit('Tab two', base)])
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409])
  const winner = both.find((r) => r.status === 200)
  assert.equal((await s.sql('SELECT COUNT(*) AS n FROM content_revisions'))[0].n, 2)
  assert.equal((await edit('Next save', winner.data.revision)).status, 200)
  assert.equal((await edit('Bad base', 'x')).status, 400)
})

/* ------------------------------------------------------- DB 15: bad input */

test('input: a NUL byte is 400 and an oversized revision id is 404, never 500', async () => {
  const s = await start()
  const headers = await s.signedIn()
  assert.equal((await s.login(PASSWORD, 'a\0@example.test')).status, 400)
  assert.equal((await s.login('a\0b')).status, 400)
  const content = (await s.call('/api/content')).data
  const put = (body) => s.call('/api/content', { method: 'PUT', headers, body })
  assert.equal((await put({ content, note: 'a\0b' })).status, 400)
  assert.equal((await put({ content: { ...content, 'a\0': 1 } })).status, 400)
  for (const id of ['2147483648', '99999999999', '9'.repeat(400)]) {
    const res = await s.call(`/api/content/revisions/${id}/restore`, { method: 'POST', headers })
    assert.equal(res.status, 404, id.slice(0, 20))
  }
})

/* ------------------------------------------------------------- publish queue */

test('publish: a slow insert cannot leave an older revision live', async () => {
  const result = await probe(scratch(), (at) => `
    const { db, driver } = await import(${at('server/db.mjs')})
    const { publish, liveContent } = await import(${at('server/content.mjs')})
    let id = 0
    db.get = () => {
      const mine = (id += 1)
      return new Promise((ok) => setTimeout(() => ok({ id: mine }), mine === 1 ? 40 : 0))
    }
    await Promise.all([publish({}, { author: 'a' }), publish({}, { author: 'b' })])
    const first = liveContent().revision
    const same = { author: 'c', baseRevision: first }
    const both = await Promise.allSettled([publish({}, same), publish({}, same)])
    await driver.close()
    console.log(JSON.stringify([first, ...both.map((r) => r.reason?.status ?? r.value)]))
  `)
  assert.deepEqual(result, [2, 3, 409])
})

/* ------------------------------------------------ Security 5, 6: stored data */

test('content: unknown keys are not stored or served', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const content = structuredClone(seed)
  content.extra = { junk: 1 }
  content.profile.extra = 'x'
  content.profile.socials[0].extra = 'x'
  content.chapters[0].extra = 'x'
  content.stack[0].extra = 'x'
  assert.equal((await s.call('/api/content', { method: 'PUT', headers, body: { content } })).status, 200)
  assert.deepEqual((await s.call('/content/site.json')).data, seed)
})

test('boot: a broken newest revision is skipped for the newest valid one, loudly', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const content = structuredClone(seed)
  content.hero.headline = 'Last good one'
  assert.equal((await s.call('/api/content', { method: 'PUT', headers, body: { content } })).status, 200)
  await s.stop()
  await probe(s.root, (at) => `
    const { db, driver } = await import(${at('server/db.mjs')})
    for (const json of ['not json', '{"hero":null}']) {
      await db.run('INSERT INTO content_revisions (json, author, created_at) VALUES (?, ?, ?)', [json, 'x', new Date().toISOString()])
    }
    await driver.close()
    console.log(true)
  `)
  const again = await start({}, s.root)
  assert.deepEqual((await again.call('/content/site.json')).data, content)
  assert.match(again.log(), /revision \d+ is not valid/)
})

/* --------------------------------------------------- Security 3: proxy peers */

test('proxy: with TRUSTED_PROXY_IPS only those peers may set the client address', async () => {
  const { clientIp, parseProxyList } = await import('../server/guard.mjs')
  const req = (peer) => ({ socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': '198.51.100.7' } })
  const only = parseProxyList('172.20.0.2, 10.1.0.0/16, fd00::/8')
  for (const peer of ['172.20.0.2', '::ffff:172.20.0.2', '10.1.9.9', 'fd00::5']) {
    assert.equal(clientIp(req(peer), 1, only), '198.51.100.7', peer)
  }
  for (const peer of ['172.20.0.3', '10.2.0.1', '127.0.0.1']) assert.equal(clientIp(req(peer), 1, only), peer, peer)
  assert.equal(clientIp(req('10.2.0.1'), 1, parseProxyList('')), '198.51.100.7', 'unset: any private peer, as before')
  for (const bad of ['traefik', '10.0.0.0/33', '10.0.0.0/', '1.2.3.4/8/8']) {
    assert.throws(() => parseProxyList(bad), /TRUSTED_PROXY_IPS/, bad)
  }
})

test('proxy: the server honours TRUSTED_PROXY_IPS', async () => {
  const s = await start({ TRUST_PROXY: '1', TRUSTED_PROXY_IPS: '192.0.2.1' })
  await s.login(PASSWORD, EMAIL, { 'x-forwarded-for': '198.51.100.7' })
  assert.equal((await s.sql("SELECT ip FROM audit_log WHERE action = 'auth.login'"))[0].ip, '127.0.0.1')
})

/* -------------------------------------------- Security 4, DB 16: the driver */

test('postgres: the logged address never carries any part of the password', async () => {
  const { createPostgresDriver } = await import('../server/db-pg.mjs')
  const label = async (url) => {
    const driver = createPostgresDriver(url)
    await driver.close()
    return driver.label
  }
  for (const url of [
    'postgres://app:abc@def@db.example:5432/site',
    'postgres://app:zz9secret@db.example/site?password=zz9secret',
    'postgres://app:12/zz9secret@db.example/site',
    'postgres://app:12#zz9secret@db.example/site',
    'postgres://app:zz9 secret@@db.example/site',
  ]) {
    assert.doesNotMatch(await label(url), /abc|def@|zz9|secret/, url)
  }
  assert.equal(await label('postgres://app:abc@def@db.example:5432/site'), 'postgres://app:***@db.example:5432/site')
})

test('postgres: queries are time limited', () => {
  assert.match(readFileSync(join(source, 'server/db-pg.mjs'), 'utf8'), /query_timeout:[\s\S]*statement_timeout:/)
})

/* ------------------------------------------------------- QA P3-4: Retry-After */

test('throttle: 429 carries Retry-After', async () => {
  const s = await start()
  let res
  for (let i = 0; i < 8 && res?.status !== 429; i++) res = await s.login('wrong')
  assert.equal(res.status, 429)
  assert.equal(res.headers['retry-after'], String(res.data.retryAfter))
})

/* ------------------------------------------------------ Review P2-6: shell */

test('shell: a passing failure is retried, and each different failure is logged', async (t) => {
  const { createShell } = await import('../server/shell.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'portfolio-shell-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bundle = join(dir, `entry-${randomBytes(4).toString('hex')}.mjs`)
  writeFileSync(bundle, 'export const render = (c) => { if (c.broken) throw new Error("render-broke"); return "<p>ok</p>" }\n')
  const logged = []
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')))
  let live = { revision: 1, body: Buffer.from('{}') }
  const page = createShell({ dist: dir, bundle, live: () => live, retryMs: 0 })
  assert.equal(await page(), null, 'no index.html yet')
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div>')
  assert.match(String((await page())?.body), /<p>ok<\/p>/, 'same revision, after the fault is gone')
  live = { revision: 2, body: Buffer.from('{"broken":true}') }
  assert.equal(await page(), null)
  assert.equal(await page(), null)
  assert.equal(logged.filter((l) => l.includes('ENOENT')).length, 1)
  assert.equal(logged.filter((l) => l.includes('render-broke')).length, 1)
})

/* ------------------------------------------------- Review P2-10: CSS budget */

test('bundle: the CSS budget is gated', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'portfolio-css-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<script type="module" src="/assets/a.js"></script><link rel="stylesheet" crossorigin href="/assets/a.css">')
  writeFileSync(join(dir, 'assets/a.js'), 'console.log(1)')
  const check = (css) => {
    writeFileSync(join(dir, 'assets/a.css'), css)
    return spawnSync(process.execPath, [join(source, 'scripts/check-bundle.mjs'), dir], { encoding: 'utf8' })
  }
  assert.equal(check('a{color:red}').status, 0)
  const big = randomBytes(30_000).toString('base64')
  assert.ok(gzipSync(big).length > 15_000)
  const over = check(big)
  assert.equal(over.status, 1)
  assert.match(over.stderr, /CSS is \d+ B, over the budget of 15000 B gzip/)
})

/* ------------------------------------------------------------ UI behaviour */

test('nav: the highlighted section is the one under the header, not the next one', async () => {
  const { currentSection } = await import('../src/hooks/activeSection.ts')
  const at = (...tops) => tops.map((top, i) => ({ id: 'abc'[i], top }))
  assert.equal(currentSection(at(96, 420, 900), 900, false), 'a', 'short section just clicked')
  assert.equal(currentSection(at(-400, 100, 460), 900, false), 'b')
  assert.equal(currentSection(at(700, 1400, 2000), 900, false), 'a', 'still on the hero')
  assert.equal(currentSection(at(-900, -200, 500), 900, true), 'c', 'end of the page')
  assert.equal(currentSection([], 900, false), '')
})

test('admin: status colours reach 4.5:1 in both themes', () => {
  const css = readFileSync(join(source, 'src/index.css'), 'utf8')
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const lum = (c) => c.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
  for (const selector of [':root', 'html.light']) {
    const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0]
    const token = (name) => block.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1]
    for (const name of ['danger', 'warn', 'ok']) {
      assert.ok(token(name), `${selector} --${name}`)
      assert.match(css, new RegExp(`--color-${name}: var\\(--${name}\\);`))
      const text = rgb(token(name))
      const tinted = rgb(token('bg')).map((v, i) => v * 0.9 + text[i] * 0.1)
      for (const ground of [rgb(token('bg')), tinted]) {
        assert.ok(ratio(text, ground) >= 4.5, `${selector} ${name}: ${ratio(text, ground).toFixed(2)}`)
      }
    }
  }
  for (const file of ['AdminApp.tsx', 'LoginPage.tsx', 'fields.tsx', 'sections.tsx']) {
    assert.doesNotMatch(readFileSync(join(source, 'src/admin', file), 'utf8'), /text-(red|amber|emerald)-\d/, file)
  }
})

test('shell: with scripts off the look-alike buttons are hidden', () => {
  assert.match(readFileSync(join(source, 'index.html'), 'utf8'), /<noscript>\s*<style>\s*\[data-lookalike\]\s*\{\s*display: none !important/)
  assert.match(readFileSync(join(source, 'src/prerender/HeroShell.tsx'), 'utf8'), /aria-hidden="true" data-lookalike/)
  assert.ok(existsSync(join(source, 'public/theme-init.js')))
})

test('theme: the first paint sets theme-color to match', () => {
  const run = (light) => {
    const meta = { content: 'dark-default', setAttribute: (_, v) => (meta.content = v) }
    const document = {
      documentElement: { classList: { replace() {} }, style: {} },
      querySelector: () => meta,
    }
    new Function('localStorage', 'matchMedia', 'document', readFileSync(join(source, 'public/theme-init.js'), 'utf8'))(
      { getItem: () => null }, () => ({ matches: light }), document,
    )
    return meta.content
  }
  assert.equal(run(true), '#f5f4f0')
  assert.equal(run(false), 'dark-default')
})
