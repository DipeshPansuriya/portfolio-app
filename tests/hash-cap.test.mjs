/** Capped password hashing. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { start, scratch, PASSWORD, EMAIL } from './harness.mjs'

const NEW_PASSWORD = 'Another-Passw0rd-1'
const from = (a, b = 1) => ({ 'x-forwarded-for': `198.${a}.${b}.7` })

/** Wrong sign-ins at once, each from its own address and for its own email. */
const flood = (s, net, count = 60) =>
  Array.from({ length: count }, (_, i) => s.login('nope', `u${net}-${i}@example.test`, from(net, i)))

const statuses = async (requests) => (await Promise.all(requests)).map((r) => r.status)

test('gate: one hash at a time, bounded lanes, trusted goes first', async () => {
  const { createHashGate } = await import('../server/hash-gate.mjs')
  const enter = createHashGate({ anonymous: 2, trusted: 1 })
  const order = []
  const take = (name, trusted = false) => {
    const ticket = enter(trusted)
    ticket?.turn.then(() => order.push(name))
    return ticket
  }
  const tick = () => new Promise((ok) => setImmediate(ok))

  const first = take('a')
  const second = take('b')
  const third = take('c')
  assert.equal(take('refused'), null, 'one running and two waiting is full')
  const owner = take('owner', true)
  assert.ok(owner, 'a full anonymous lane does not close the trusted one')
  assert.equal(take('second owner', true), null)
  await tick()
  assert.deepEqual(order, ['a'])

  first.done()
  first.done()
  await tick()
  assert.deepEqual(order, ['a', 'owner'], 'a second done() frees nothing more')

  second.done() // gives up while still waiting
  assert.ok(take('d'), 'and its place is free again')
  owner.done()
  await tick()
  assert.deepEqual(order, ['a', 'owner', 'c'])
  third.done()
  await tick()
  assert.deepEqual(order, ['a', 'owner', 'c', 'd'])
})

test('login flood: the overflow gets 503 with Retry-After, the site still answers', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  const requests = flood(s, 1)
  const page = s.call('/')
  const answers = await Promise.all(requests)
  assert.equal((await page).status, 200)
  assert.deepEqual([...new Set(answers.map((r) => r.status))].sort(), [401, 503])
  const busy = answers.find((r) => r.status === 503)
  assert.equal(busy.headers['retry-after'], String(busy.data.retryAfter))
  assert.ok(busy.data.retryAfter >= 1)
  assert.match(busy.data.error, /busy/i)
  assert.equal((await s.login(PASSWORD, EMAIL, from(9))).status, 200, 'every slot is free again')
})

test('login flood: a busy answer is not counted as an attempt', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  const others = flood(s, 2)
  const mine = Array.from({ length: 20 }, () => s.login(PASSWORD, EMAIL, from(10)))
  const codes = await statuses(mine)
  await Promise.all(others)
  assert.ok(codes.includes(503), codes.join())
  assert.ok(!codes.includes(429), codes.join())
  assert.equal((await s.login(PASSWORD, EMAIL, from(10))).status, 200)
})

test('login flood: a known browser and a signed-in password change still get through', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  const first = await s.login(PASSWORD, EMAIL, from(11))
  const [session, device] = first.headers['set-cookie'].map((c) => c.split(';')[0])
  const others = flood(s, 3)
  const known = s.login(PASSWORD, EMAIL, { ...from(12), cookie: device })
  assert.equal((await known).status, 200)
  const more = flood(s, 4)
  const change = await s.call('/api/auth/password', {
    method: 'POST',
    headers: { cookie: session, 'x-csrf-token': first.data.csrf, ...from(11) },
    body: { current: PASSWORD, next: NEW_PASSWORD },
  })
  assert.equal(change.status, 200, change.raw.toString())
  assert.ok((await statuses([...others, ...more])).includes(503))
})

test('login flood: a blocked address holds no place in the queue', async () => {
  const s = await start({ TRUST_PROXY: '1' })
  for (let i = 0; i < 5; i++) await s.login('nope', EMAIL, from(13))
  const codes = await statuses(Array.from({ length: 30 }, () => s.login('nope', EMAIL, from(13))))
  assert.deepEqual([...new Set(codes)], [429])
})

/* ------------------------------------------------------------ the place */

/** A server with `script` preloaded into it. */
async function preloaded(script, env = {}) {
  const root = scratch()
  writeFileSync(join(root, 'preload.mjs'), script)
  return start({ ...env, NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'preload.mjs')).href}` }, root)
}

const within = (ms, request) =>
  Promise.race([request, new Promise((ok) => setTimeout(() => ok({ status: 'no answer' }), ms).unref())])

test('login: a fault while the attempt is counted still frees the hash place', async () => {
  const s = await preloaded(`
    const set = Map.prototype.set
    Map.prototype.set = function (key, value) {
      if (typeof key === 'string' && key.endsWith('|fault@example.test')) throw new Error('throttle fault (test)')
      return set.call(this, key, value)
    }
  `)
  assert.equal((await s.login('nope', 'fault@example.test')).status, 500)
  assert.equal((await within(5000, s.login())).status, 200)
})

test('login: a slow flood audit write holds up no other sign-in', async () => {
  // The `auth.flood` write never finishes in this server.
  const s = await preloaded(
    `
    import { registerHooks } from 'node:module'
    registerHooks({
      load(url, context, next) {
        const loaded = next(url, context)
        if (!url.endsWith('/server/db.mjs')) return loaded
        const source = String(loaded.source).replace('export async function audit(', 'async function write(')
        return {
          ...loaded,
          source: source + "\\nexport const audit = (action, ...rest) => action === 'auth.flood' ? new Promise(() => {}) : write(action, ...rest)",
        }
      },
    })
  `,
    { TRUST_PROXY: '1' },
  )
  assert.match(readFileSync(join(s.root, 'server/db.mjs'), 'utf8'), /export async function audit\(/)
  // The 20th failure for one email starts the flood, and its request waits on the write.
  for (let i = 0; i < 19; i++) await s.login('nope', EMAIL, from(20, i))
  s.login('nope', EMAIL, from(21)).catch(() => null)
  await new Promise((ok) => setTimeout(ok, 500))
  assert.equal((await within(5000, s.login(PASSWORD, EMAIL, from(22)))).status, 200)
})

/* ------------------------------------------------------------- fallback */

test('content: a revision skipped at boot is reported to the owner until a new save', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const list = async (server) => (await server.call('/api/content/revisions', { headers })).data
  assert.deepEqual((await list(s)).skipped, [])
  await s.stop()
  const db = JSON.stringify(pathToFileURL(join(s.root, 'server/db.mjs')).href)
  const damage = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { db, driver } = await import(${db})
       await db.run('INSERT INTO content_revisions (json, author, created_at) VALUES (?, ?, ?)', ['not json', 'x', new Date().toISOString()])
       await driver.close()`,
    ],
    { cwd: s.root, env: { PATH: process.env.PATH, ...s.database }, encoding: 'utf8' },
  )
  assert.equal(damage.status, 0, damage.stderr)

  const again = await start({}, s.root)
  assert.deepEqual((await list(again)).skipped, [2])
  const content = (await again.call('/api/content')).data
  assert.equal((await again.call('/api/content', { method: 'PUT', headers, body: { content } })).status, 200)
  assert.deepEqual((await list(again)).skipped, [])
})
