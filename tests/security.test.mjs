/** Lockout, proxy trust, request guard, password recovery. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { scratch, start, source, EMAIL, PASSWORD } from './harness.mjs'

const from = (ip) => ({ 'x-forwarded-for': ip })
const cookieNamed = (res, name) =>
  (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`))?.split(';')[0]

/* ------------------------------------------------------------------ lockout */

test('M1: wrong guesses at the owner email from many addresses do not lock the owner out', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  for (let i = 0; i < 40; i++) await s.login('nope', EMAIL, from(`198.51.100.${i}`))
  assert.equal((await s.login(PASSWORD, EMAIL, from('203.0.113.9'))).status, 200)
  assert.equal((await s.sql("SELECT COUNT(*) AS n FROM audit_log WHERE action='auth.flood'"))[0].n, 1)
})

test('M1: a global flood does not lock the owner out', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  for (let i = 0; i < 120; i++) await s.login('nope', `u${i}@example.test`, from(`10.0.${i}.1`))
  assert.equal((await s.login(PASSWORD, EMAIL, from('203.0.113.9'))).status, 200)
})

test('M1: during a flood each address gets only two tries, and flood guesses stop filling the audit log', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  for (let i = 0; i < 20; i++) await s.login('nope', EMAIL, from(`198.51.100.${i}`))
  const codes = []
  for (let i = 0; i < 6; i++) codes.push((await s.login('nope', EMAIL, from('203.0.113.50'))).status)
  assert.deepEqual(codes, [401, 401, 429, 429, 429, 429])
  assert.equal((await s.sql("SELECT COUNT(*) AS n FROM audit_log WHERE action='auth.failed'"))[0].n, 20)
})

test('M1: IPv6 addresses in one /64 share a budget', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  const codes = []
  for (let i = 1; i <= 7; i++) codes.push((await s.login('nope', EMAIL, from(`2001:db8:1:2::${i}`))).status)
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429])
  assert.equal((await s.login('nope', EMAIL, from('2001:db8:1:3::1'))).status, 401)
})

test('M1: a browser that signed in before is not affected by attempts from its own address', async () => {
  const s = await start()
  const first = await s.login()
  const device = cookieNamed(first, 'dp_device')
  assert.ok(device, 'device cookie issued')
  const raw = first.headers['set-cookie'].find((c) => c.startsWith('dp_device='))
  assert.match(raw, /HttpOnly/)
  assert.match(raw, /SameSite=Strict/)
  assert.match(raw, /Path=\/api\/auth/)

  for (let i = 0; i < 8; i++) await s.login('nope')
  assert.equal((await s.login()).status, 429, 'same address without the cookie stays blocked')
  assert.equal((await s.login(PASSWORD, EMAIL, { cookie: device })).status, 200)
})

test('M1: a device cookie has its own small budget, and a forged one gets nothing', async () => {
  const s = await start()
  const device = cookieNamed(await s.login(), 'dp_device')
  const codes = []
  for (let i = 0; i < 7; i++) codes.push((await s.login('nope', EMAIL, { cookie: device })).status)
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429])

  const t = await start()
  const real = cookieNamed(await t.login(), 'dp_device')
  const forged = `${real.slice(0, -4)}AAAA`
  for (let i = 0; i < 6; i++) await t.login('nope')
  assert.equal((await t.login(PASSWORD, EMAIL, { cookie: forged })).status, 429)
})

test('M1: a password change retires old device cookies and gives this browser a new one', async () => {
  const s = await start()
  const first = await s.login()
  const old = cookieNamed(first, 'dp_device')
  const headers = { cookie: first.headers['set-cookie'][0].split(';')[0], 'x-csrf-token': first.data.csrf }
  const changed = await s.call('/api/auth/password', {
    method: 'POST',
    headers,
    body: { current: PASSWORD, next: 'Another-Passw0rd-9' },
  })
  assert.equal(changed.status, 200)
  const fresh = cookieNamed(changed, 'dp_device')
  assert.ok(fresh && fresh !== old)
  for (let i = 0; i < 6; i++) await s.login('nope')
  assert.equal((await s.login('Another-Passw0rd-9', EMAIL, { cookie: old })).status, 429)
  assert.equal((await s.login('Another-Passw0rd-9', EMAIL, { cookie: fresh })).status, 200)
})

/* -------------------------------------------------------------------- proxy */

const loggedIp = async (s) => (await s.sql("SELECT ip FROM audit_log WHERE action='auth.failed' ORDER BY id DESC LIMIT 1"))[0].ip

test('M2: with two proxies the client is the second entry from the right', async () => {
  const s = await start({ TRUST_PROXY: '2' })
  await s.login('nope', EMAIL, from('9.9.9.9, 203.0.113.7, 198.51.100.1'))
  assert.equal(await loggedIp(s), '203.0.113.7')
  await s.login('nope', EMAIL, from('203.0.113.7'))
  assert.equal(await loggedIp(s), '127.0.0.1', 'too few entries: fall back to the socket address')
  await s.login('nope', EMAIL, from('not-an-ip, 198.51.100.1'))
  assert.equal(await loggedIp(s), '127.0.0.1', 'garbage is never used as an address')
})

test('M2: forwarded headers count only when the direct peer is local or private', async () => {
  const { clientIp, trustProxyHops } = await import(resolve(source, 'server/guard.mjs'))
  const req = (peer, xff) => ({ socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': xff } })
  assert.equal(clientIp(req('8.8.8.8', '1.2.3.4'), 1), '8.8.8.8')
  for (const peer of ['127.0.0.1', '::1', '::ffff:10.1.2.3', '172.20.0.2', '192.168.1.5', 'fd00::2']) {
    assert.equal(clientIp(req(peer, '1.2.3.4'), 1), '1.2.3.4', peer)
  }
  assert.equal(clientIp(req('127.0.0.1', '1.2.3.4:5555'), 1), '1.2.3.4')
  assert.equal(clientIp(req('127.0.0.1', '[2001:db8::1]:443'), 1), '2001:db8::1')
  assert.equal(clientIp(req('127.0.0.1', '1.2.3.4'), 0), '127.0.0.1')
  assert.deepEqual(['', undefined, '0', 'false', '1', 'true', '2'].map(trustProxyHops), [0, 0, 0, 0, 1, 1, 2])
  for (const bad of ['yes', '-1', '1.5', '11']) assert.throws(() => trustProxyHops(bad), /TRUST_PROXY/, bad)
})

test('M2: production refuses to start until TRUST_PROXY is set; a bad value always stops boot', async () => {
  await assert.rejects(start({ TRUST_PROXY: '' }), /TRUST_PROXY/)
  await assert.rejects(start({ TRUST_PROXY: 'yes', NODE_ENV: 'development' }), /TRUST_PROXY/)
  await start({ TRUST_PROXY: '', NODE_ENV: 'development' })
})

/* ------------------------------------------------------------ request guard */

const post = (s, headers, path = '/api/auth/login') =>
  s.call(path, { method: 'POST', headers, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
const JSON_TYPE = { 'content-type': 'application/json' }

test('guard: state-changing calls require application/json', async () => {
  const s = await start()
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'text/plain; application/json', '']) {
    assert.equal((await post(s, { 'content-type': type })).status, 415, type)
  }
  assert.equal((await s.call('/api/auth/logout', { method: 'POST', headers: { 'content-type': '' } })).status, 415)
  assert.equal((await post(s, { 'content-type': 'Application/JSON; charset=utf-8' })).status, 200)
  assert.equal((await s.sql("SELECT COUNT(*) AS n FROM audit_log WHERE action='auth.login'"))[0].n, 1)
})

test('guard: foreign Host or Origin is refused, same-origin works (direct and through the dev proxy)', async () => {
  const s = await start()
  const status = async (headers) => (await post(s, { ...JSON_TYPE, ...headers })).status
  assert.equal(await status({ host: 'evil.example' }), 403)
  assert.equal(await status({ host: 'evil.example', origin: 'http://evil.example' }), 403, 'DNS rebinding')
  assert.equal(await status({ origin: 'http://evil.example' }), 403)
  assert.equal(await status({ origin: 'null' }), 403)
  assert.equal(await status({ host: '127.0.0.1:4319', origin: 'http://localhost:9999' }), 403, 'other local port')
  assert.equal(await status({ host: '127.0.0.1.evil.example' }), 403)
  for (const host of ['127.0.0.1:4318', 'localhost:4318', '[::1]:4319']) {
    assert.equal(await status({ host, origin: `http://${host}` }), 200, host)
  }
  assert.equal((await s.call('/api/health', { headers: { host: 'probe.internal' } })).status, 200)
})

test('guard: PUBLIC_ORIGIN allows the real domain, with or without a Host-preserving proxy', async () => {
  const s = await start({ PUBLIC_ORIGIN: 'https://site.example, https://www.site.example/' })
  const status = async (headers) => (await post(s, { ...JSON_TYPE, ...headers })).status
  assert.equal(await status({ host: 'site.example', origin: 'https://site.example' }), 200)
  assert.equal(await status({ origin: 'https://www.site.example' }), 200, 'proxy rewrote Host to the upstream')
  assert.equal(await status({ host: 'site.example', origin: 'https://evil.example' }), 403)
  await assert.rejects(start({ PUBLIC_ORIGIN: 'site.example' }), /PUBLIC_ORIGIN/)
})

/* ----------------------------------------------------------------- recovery */

test('recovery: reset-password rewrites only the password and that user sessions', async () => {
  const root = scratch()
  cpSync(join(source, 'scripts/reset-password.mjs'), join(root, 'scripts/reset-password.mjs'))
  const s = await start({}, root)
  const headers = await s.signedIn()
  const content = (await s.call('/api/content')).data
  content.hero.headline = 'Kept through recovery'
  assert.equal((await s.call('/api/content', { method: 'PUT', headers, body: { content } })).status, 200)
  const count = async (t) => (await s.sql(`SELECT COUNT(*) AS n FROM ${t}`))[0].n
  const before = { revisions: await count('content_revisions'), audit: await count('audit_log') }

  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/reset-password.mjs', ...args], {
      cwd: root,
      env: { PATH: process.env.PATH, ADMIN_EMAIL: EMAIL, ...s.database },
      encoding: 'utf8',
    })
  const unknown = run('nobody@example.test')
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /No user/)
  assert.equal(await count('sessions'), 1)

  const done = run()
  assert.equal(done.status, 0, done.stderr)
  const password = readFileSync(join(root, 'data/admin-credentials.txt'), 'utf8').match(/^password: (.+)$/m)[1]
  assert.ok(!done.stdout.includes(password), 'password is never printed')
  assert.equal(await count('sessions'), 0)
  assert.equal(await count('content_revisions'), before.revisions)
  assert.equal(await count('audit_log'), before.audit + 1)
  assert.equal(await count('users'), 1)
  assert.equal((await s.login(PASSWORD)).status, 401)
  assert.equal((await s.login(password)).status, 200)
})

/* --------------------------------------------------------------- open items */

test('icons: an unknown stack icon slug is refused', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const content = (await s.call('/api/content')).data
  content.stack[0].icon = 'notarealicon'
  const put = await s.call('/api/content', { method: 'PUT', headers, body: { content } })
  assert.equal(put.status, 422)
  assert.match(put.data.errors.join(' '), /notarealicon/)
})

function themeFor({ saved = null, light = false, blocked = false }) {
  const classes = new Set(['dark'])
  const root = {
    style: {},
    classList: { replace: (a, b) => classes.delete(a) && classes.add(b) },
  }
  runInNewContext(readFileSync(join(source, 'public/theme-init.js'), 'utf8'), {
    document: { documentElement: root, querySelector: () => null },
    matchMedia: () => ({ matches: light }),
    localStorage: {
      getItem: () => {
        if (blocked) throw new Error('blocked')
        return saved
      },
    },
  })
  return [...classes][0]
}

test('theme: the OS preference applies before paint unless a choice was saved', () => {
  assert.equal(themeFor({ light: true }), 'light')
  assert.equal(themeFor({ light: false }), 'dark')
  assert.equal(themeFor({ saved: 'dark', light: true }), 'dark')
  assert.equal(themeFor({ saved: 'light', light: false }), 'light')
  assert.equal(themeFor({ blocked: true, light: true }), 'light')
})

test('start line: nothing overhead reaches into the camera view, so the HUD stays readable', async () => {
  const g = await import(resolve(source, 'src/game/view.ts'))
  const degrees = (rad) => (rad * 180) / Math.PI
  const topOfView = g.FOV / 2 - degrees(Math.atan((g.CHASE.height - g.CHASE.lookY) / (g.CHASE.back + g.CHASE.lookAhead)))
  const overhead = {
    'gantry beam': [g.GANTRY.beamY - g.GANTRY.beamHeight / 2, g.GANTRY.depth],
    // The arch bar pulses up to 1.17 times its size.
    'start gate bar': [g.gateBarY('__start') - (g.GATE.bar * 1.17) / 2, g.GATE.bar * 1.17],
    'start gate label': [g.gateBarY('__start') + g.GATE.labelGap - g.GATE.labelHeight / 2, 0],
  }
  for (const [name, [underside, depth]] of Object.entries(overhead)) {
    const angle = degrees(Math.atan((underside - g.CHASE.height) / (g.CHASE.back - depth / 2)))
    assert.ok(angle > topOfView + 1, `${name} at ${angle.toFixed(1)} vs view top ${topOfView.toFixed(1)}`)
  }
  assert.equal(g.gateBarY('craft'), 6, 'other gates keep their height')
})
