/** Production guards: what must be set, and what must be refused. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sameSecret } from '../server/guard.mjs'
import { scratch, start, source, database, EMAIL } from './harness.mjs'

const DEV = { NODE_ENV: 'development' }
const password = (file) => readFileSync(file, 'utf8').match(/^password: (.+)$/m)[1]

test('production: refuses to start without a database, and creates none', async () => {
  const root = scratch()
  await assert.rejects(start({ DSH_DB_FILE: '' }, root), /server exited [1-9][\s\S]*DATABASE_URL/)
  await assert.rejects(start({ DSH_DB_FILE: '  ', DATABASE_URL: ' ' }, root), /DATABASE_URL must be set/)
  assert.ok(!existsSync(join(root, 'data')))
  await (await start({ ...DEV, DSH_DB_FILE: '' }, root)).stop()
})

test('production: DATABASE_URL alone counts as a database', async () => {
  // Nothing listens on port 1: the start gets past the guard and fails on the connection.
  const unreachable = 'postgres://nobody@127.0.0.1:1/none'
  await assert.rejects(start({ DSH_DB_FILE: '', DATABASE_URL: unreachable }), /ECONNREFUSED/)
})

test('production: refuses to start without PUBLIC_ORIGIN', async () => {
  for (const value of ['', ' , ']) await assert.rejects(start({ PUBLIC_ORIGIN: value }), /PUBLIC_ORIGIN must be set/)
  await (await start({ ...DEV, PUBLIC_ORIGIN: '' })).stop()
})

test('production: an empty user table needs ADMIN_PASSWORD; later boots do not', async () => {
  const root = scratch()
  await assert.rejects(start({ ADMIN_PASSWORD: '' }, root), /ADMIN_PASSWORD must be set/)
  assert.ok(!existsSync(join(root, 'data/admin-credentials.txt')))
  const first = await start({}, root)
  assert.equal((await first.sql('SELECT COUNT(*) AS n FROM users'))[0].n, 1)
  await first.stop()
  const later = await start({ ADMIN_PASSWORD: '' }, root)
  assert.equal((await later.login()).status, 200)
})

/** Every file under `root`, except the database and the linked packages. */
function snapshot(root, dir = '') {
  const out = {}
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name)
    if (name === 'node_modules' || /\.db(-wal|-shm)?$/.test(name)) continue
    if (lstatSync(join(root, rel)).isDirectory()) Object.assign(out, snapshot(root, rel))
    else out[rel] = createHash('sha256').update(readFileSync(join(root, rel))).digest('hex')
  }
  return out
}

test('CREDENTIALS_DIR: the generated first password goes there', async () => {
  const root = scratch()
  const dir = mkdtempSync(join(tmpdir(), 'portfolio-creds-'))
  try {
    const s = await start({ ...DEV, ADMIN_PASSWORD: '', CREDENTIALS_DIR: dir }, root)
    const file = join(dir, 'admin-credentials.txt')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal((await s.login(password(file))).status, 200)
    assert.ok(!existsSync(join(root, 'data/admin-credentials.txt')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CREDENTIALS_DIR: the reset command writes only there', async () => {
  const root = scratch()
  cpSync(join(source, 'scripts/reset-password.mjs'), join(root, 'scripts/reset-password.mjs'))
  const s = await start({}, root)
  const before = snapshot(root)
  const done = spawnSync(process.execPath, ['scripts/reset-password.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      ...s.database,
      ADMIN_EMAIL: EMAIL,
      CREDENTIALS_DIR: join(root, 'run'),
    },
    encoding: 'utf8',
  })
  assert.equal(done.status, 0, done.stderr)
  const after = snapshot(root)
  const written = join('run', 'admin-credentials.txt')
  assert.ok(after[written])
  delete after[written]
  assert.deepEqual(after, before)
  assert.equal((await s.login(password(join(root, written)))).status, 200)
})

test('ready: 200 while the database answers', async () => {
  const s = await start()
  const res = await s.call('/api/ready')
  assert.equal(res.status, 200)
  assert.deepEqual(res.data, { ok: true })
  assert.equal(res.headers['cache-control'], 'no-store')
})

/**
 * A preload for the server process: every query fails while `db-down` exists in
 * its folder, and each constant-time comparison is written to `compared.log`.
 */
const SPY = `
  import crypto from 'node:crypto'
  import { appendFileSync, existsSync } from 'node:fs'
  import { syncBuiltinESMExports } from 'node:module'
  import { DatabaseSync } from 'node:sqlite'
  import pg from ${JSON.stringify(pathToFileURL(join(source, 'node_modules/pg/lib/index.js')).href)}
  for (const [type, method] of [[DatabaseSync, 'prepare'], [pg.Pool, 'query']]) {
    const real = type.prototype[method]
    type.prototype[method] = function (...args) {
      if (existsSync('db-down')) throw new Error('database is down (test)')
      return real.apply(this, args)
    }
  }
  const equal = crypto.timingSafeEqual
  crypto.timingSafeEqual = (a, b) => {
    appendFileSync('compared.log', Buffer.from(a).toString('utf8') + '\\n')
    return equal(a, b)
  }
  syncBuiltinESMExports()
`

async function spied() {
  const root = scratch()
  writeFileSync(join(root, 'spy.mjs'), SPY)
  return start({ NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'spy.mjs')).href}` }, root)
}

test('ready: 503 over HTTP while the database does not answer, 200 again after', async () => {
  const s = await spied()
  writeFileSync(join(s.root, 'db-down'), '')
  const down = await s.call('/api/ready')
  assert.equal(down.status, 503)
  assert.deepEqual(down.data, { error: 'Database is not reachable.' })
  assert.equal((await s.call('/api/health')).status, 200)
  assert.equal((await s.call('/content/site.json')).status, 200, 'content is served from memory')
  rmSync(join(s.root, 'db-down'))
  assert.equal((await s.call('/api/ready')).status, 200)
})

test('CSRF: the token is compared in constant time', async () => {
  assert.equal(sameSecret('abc123', 'abc123'), true)
  for (const given of ['abc124', 'abc12', 'abc1234', '', undefined, ['abc123']]) {
    assert.equal(sameSecret(given, 'abc123'), false, String(given))
  }

  const s = await spied()
  const headers = await s.signedIn()
  const token = headers['x-csrf-token']
  const write = (value) =>
    s.call('/api/auth/password', {
      method: 'POST',
      headers: { cookie: headers.cookie, ...(value === undefined ? {} : { 'x-csrf-token': value }) },
      body: { current: 'no', next: 'x' },
    })
  const wrong = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
  for (const value of [undefined, wrong, token.slice(1), `${token}x`]) assert.equal((await write(value)).status, 403)
  const compared = () => readFileSync(join(s.root, 'compared.log'), 'utf8').split('\n')
  assert.ok(compared().includes(wrong), 'the route compares through timingSafeEqual')
  assert.equal((await write(token)).status, 401, 'right token: reaches the password check')
  assert.ok(compared().includes(token))
})

test('links: protocol-relative addresses are refused', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const content = (await s.call('/api/content')).data
  const save = async (href) => {
    content.profile.socials[0].href = href
    return (await s.call('/api/content', { method: 'PUT', headers, body: { content } })).status
  }
  for (const href of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '///evil.example']) {
    assert.equal(await save(href), 422, JSON.stringify(href))
  }
  for (const href of ['/', '/resume.pdf', '/a//b', 'https://example.com', 'mailto:a@example.com', 'tel:+100']) {
    assert.equal(await save(href), 200, href)
  }
})

test('.env.example: names every setting and leaves the database to the reader', () => {
  const text = readFileSync(join(source, '.env.example'), 'utf8')
  for (const name of ['DATABASE_URL', 'DSH_DB_FILE', 'PUBLIC_ORIGIN', 'TRUST_PROXY', 'CREDENTIALS_DIR', 'ADMIN_PASSWORD', 'TRUSTED_PROXY_IPS']) {
    assert.match(text, new RegExp(`^(# )?${name}=`, 'm'), name)
  }
  for (const name of ['DATABASE_URL', 'ADMIN_PASSWORD']) assert.doesNotMatch(text, new RegExp(`^${name}=.`, 'm'), name)
})
