/** Black-box API tests. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { scratch, start, EMAIL, PASSWORD } from './harness.mjs'

test('P0-2: a saved change is what visitors fetch', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const content = (await s.call('/api/content')).data
  content.hero.headline = 'Saved headline for the test'
  const put = await s.call('/api/content', { method: 'PUT', headers, body: { content, note: 't' } })
  assert.equal(put.status, 200, put.raw.toString())
  const live = await s.call('/content/site.json?t=1')
  assert.equal(live.data.hero.headline, 'Saved headline for the test')
  assert.equal(live.headers['cache-control'], 'no-cache')
})

test('P1-4: chapter ids used by the page layout are rejected', async () => {
  const s = await start()
  const headers = await s.signedIn()
  for (const id of ['hero', 'contact-card', 'contact-heading', 'main', 'root']) {
    const content = (await s.call('/api/content')).data
    content.chapters[0].id = id
    const put = await s.call('/api/content', { method: 'PUT', headers, body: { content } })
    assert.equal(put.status, 422, id)
  }
})

test('P1-2: a spoofed X-Forwarded-For does not reset the throttle', async () => {
  const s = await start()
  const codes = []
  for (let i = 0; i < 8; i++) {
    codes.push((await s.login('nope', EMAIL, { 'x-forwarded-for': `203.0.113.${i}` })).status)
  }
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429, 429])
  assert.equal((await s.sql("SELECT COUNT(*) AS n FROM audit_log WHERE action='auth.throttled'"))[0].n, 1)
  assert.deepEqual((await s.sql("SELECT DISTINCT ip FROM audit_log WHERE action='auth.failed'")).map((r) => r.ip), ['127.0.0.1'])
})

test('P1-2: parallel guesses cannot slip past the limit', async () => {
  const s = await start()
  const codes = await Promise.all(Array.from({ length: 20 }, () => s.login('nope').then((r) => r.status)))
  assert.equal(codes.filter((c) => c === 401).length, 5)
})

test('P1-2: behind a trusted proxy the last hop is the client; the per-email count tightens every address', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  const guess = (xff) => s.login('nope', EMAIL, { 'x-forwarded-for': xff }).then((r) => r.status)
  for (let i = 0; i < 20; i++) assert.equal(await guess(`1.1.1.1, 198.51.100.${i}`), 401)
  assert.equal((await s.sql("SELECT ip FROM audit_log WHERE action='auth.failed' LIMIT 1"))[0].ip, '198.51.100.0')
  const codes = []
  for (let i = 0; i < 4; i++) codes.push(await guess(`9.9.9.${i}, 203.0.113.1`))
  assert.deepEqual(codes, [401, 401, 429, 429])
})

test('P1-2: many addresses and many emails switch every address to the strict budget', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  const guess = (email, ip) => s.login('nope', email, { 'x-forwarded-for': ip }).then((r) => r.status)
  for (let i = 0; i < 100; i++) assert.equal(await guess(`u${i}@example.test`, `10.0.${i}.1`), 401)
  const codes = []
  for (let i = 0; i < 4; i++) codes.push(await guess(`v${i}@example.test`, '203.0.113.2'))
  assert.deepEqual(codes, [401, 401, 429, 429])
})

test('P1-2: oversized email is refused and never stored; good logins do not use up the budget', async () => {
  const s = await start()
  const big = await s.login('x', `${'a'.repeat(100_000)}@example.test`)
  assert.equal(big.status, 400)
  assert.equal((await s.sql('SELECT COUNT(*) AS n FROM audit_log WHERE LENGTH(actor) > 254'))[0].n, 0)
  for (let i = 0; i < 40; i++) assert.equal((await s.login()).status, 200)
})

test('P1-3: a reseed overwrites the stale credentials file with the working password', async () => {
  const root = scratch()
  mkdirSync(join(root, 'data'))
  const file = join(root, 'data/admin-credentials.txt')
  writeFileSync(file, 'password: stale-old-value\n', { mode: 0o644 })
  const s = await start({ ADMIN_PASSWORD: '', NODE_ENV: 'development' }, root)
  const password = readFileSync(file, 'utf8').match(/^password: (.+)$/m)[1]
  assert.notEqual(password, 'stale-old-value')
  assert.equal((await s.login(password)).status, 200)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  // On PostgreSQL there is no database file in the folder to protect.
  const dbFile = s.database.DSH_DB_FILE
  if (dbFile) assert.equal(statSync(dbFile).mode & 0o777, 0o600)
})

test('P2-18: a weak ADMIN_PASSWORD stops the first boot', async () => {
  await assert.rejects(start({ ADMIN_PASSWORD: 'short' }), /ADMIN_PASSWORD/)
})

test('P2-18: password-change guesses are throttled', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const codes = []
  for (let i = 0; i < 7; i++) {
    const res = await s.call('/api/auth/password', { method: 'POST', headers, body: { current: 'no', next: 'x' } })
    codes.push(res.status)
  }
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429])
})

test('password change still works end to end', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const res = await s.call('/api/auth/password', {
    method: 'POST',
    headers,
    body: { current: PASSWORD, next: 'Another-Passw0rd-9' },
  })
  assert.equal(res.status, 200, res.raw.toString())
  assert.equal((await s.login('Another-Passw0rd-9')).status, 200)
})

test('P2-17: bad input is a 4xx, not a 500', async () => {
  const s = await start()
  assert.equal((await s.call('/api/auth/session', { headers: { cookie: 'x=%' } })).status, 200)
  for (const body of ['null', '[]', '"x"', '{bad']) {
    assert.equal((await s.call('/api/auth/login', { method: 'POST', body })).status, 400, body)
  }
  assert.equal((await s.call('/%E0%A4%A')).status, 400)
  assert.equal((await s.call('/a%00.js')).status, 400)
})

test('P1-9: compression, validators, cache rules and real 404s', async () => {
  const s = await start()
  const br = await s.call('/assets/app-abc123.js', { headers: { 'accept-encoding': 'gzip, br' } })
  assert.equal(br.headers['content-encoding'], 'br')
  assert.equal(br.headers.vary, 'Accept-Encoding')
  assert.match(brotliDecompressSync(br.raw).toString(), /console\.log/)
  assert.match(br.headers['cache-control'], /immutable/)
  const gz = await s.call('/assets/app-abc123.js', { headers: { 'accept-encoding': 'gzip' } })
  assert.equal(gz.headers['content-encoding'], 'gzip')
  assert.match(gunzipSync(gz.raw).toString(), /console\.log/)
  const plain = await s.call('/assets/app-abc123.js', { headers: { 'accept-encoding': 'br;q=0' } })
  assert.equal(plain.headers['content-encoding'], undefined)
  assert.notEqual(plain.headers.etag, br.headers.etag)

  const again = await s.call('/assets/app-abc123.js', {
    headers: { 'accept-encoding': 'br', 'if-none-match': br.headers.etag },
  })
  assert.equal(again.status, 304)
  assert.equal(again.raw.length, 0)

  assert.match((await s.call('/fonts/a.woff2')).headers['cache-control'], /max-age=\d{6,}/)
  assert.equal((await s.call('/assets/gone-000.js')).status, 404)
  assert.equal((await s.call('/missing.png')).status, 404)
  const spa = await s.call('/admin')
  assert.equal(spa.status, 200)
  assert.match(spa.headers['x-robots-tag'], /noindex/)
  assert.equal((await s.call('/')).status, 200)
  const head = await s.call('/', { method: 'HEAD' })
  assert.equal(head.raw.length, 0)
  const escape = await s.call('/..%2f..%2fserver%2findex.mjs')
  assert.doesNotMatch(escape.raw.toString(), /createServer/)
})

test('P2-6: unknown pages answer 404, known routes 200', async () => {
  const s = await start()
  for (const path of ['/', '/admin', '/admin/', '/index.html']) {
    assert.equal((await s.call(path)).status, 200, path)
  }
  const lost = await s.call('/no-such-page')
  assert.equal(lost.status, 404)
  assert.match(lost.raw.toString(), /<title>spa/)
})
