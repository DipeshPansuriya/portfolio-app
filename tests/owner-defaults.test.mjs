/** No personal defaults: first boot uses placeholders, and recovery finds the existing owner row. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { scratch, start, source } from './harness.mjs'

/** A server with this owner row, and the reset command run with no email in the environment. */
async function setup(env) {
  const root = scratch()
  cpSync(join(source, 'scripts/reset-password.mjs'), join(root, 'scripts/reset-password.mjs'))
  const s = await start(env, root)
  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/reset-password.mjs', ...args], {
      cwd: root,
      env: { PATH: process.env.PATH, ...s.database },
      encoding: 'utf8',
    })
  const users = () => s.sql('SELECT email, name, password_hash FROM users ORDER BY id')
  const credentials = join(root, 'data/admin-credentials.txt')
  return { s, run, users, credentials }
}

test('first boot without ADMIN_EMAIL or ADMIN_NAME creates a placeholder owner', async () => {
  for (const value of ['', '  ']) {
    const { users } = await setup({ ADMIN_EMAIL: value, ADMIN_NAME: value })
    const rows = await users()
    assert.deepEqual(rows.map((r) => [r.email, r.name]), [['owner@local', 'Owner']])
  }
})

test('reset with no email given resets the one existing owner and keeps its email and name', async () => {
  const { s, run, users, credentials } = await setup({ ADMIN_EMAIL: 'earlier@local', ADMIN_NAME: 'Earlier Row' })
  const done = run()
  assert.equal(done.status, 0, done.stderr)
  const text = readFileSync(credentials, 'utf8')
  assert.match(text, /^email: +earlier@local$/m)
  const password = text.match(/^password: (.+)$/m)[1]
  assert.equal((await s.login(password, 'earlier@local')).status, 200)
  assert.deepEqual((await users()).map((r) => [r.email, r.name]), [['earlier@local', 'Earlier Row']])
})

test('reset with no email given changes nothing when there is more than one user', async () => {
  const { s, run, users, credentials } = await setup({})
  const insert =
    "INSERT INTO users (email, name, password_hash, created_at) VALUES ('second@example.test', 'Second', 'x', '2026-01-01')"
  if (s.database.DATABASE_URL) await s.sql(insert)
  else {
    const file = new DatabaseSync(s.database.DSH_DB_FILE)
    file.exec(insert)
    file.close()
  }
  const before = await users()
  const done = run()
  assert.equal(done.status, 1)
  assert.match(done.stderr, /Name the user/)
  assert.deepEqual(await users(), before)
  assert.ok(!existsSync(credentials))
})
