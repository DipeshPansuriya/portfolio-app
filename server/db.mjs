/**
 * Storage entry point.
 *
 * PostgreSQL when `DATABASE_URL` is set, SQLite otherwise. Both drivers expose
 * the same tiny async interface (`all` / `get` / `run`) and share one set of SQL
 * strings, so the rest of the server never branches on the backend.
 */
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSqliteDriver } from './db-sqlite.mjs'
import { createPostgresDriver } from './db-pg.mjs'
import { hashPassword, passwordProblems } from './auth.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(root, 'data')

const databaseUrl = process.env.DATABASE_URL?.trim()
const chosenFile = process.env.DSH_DB_FILE?.trim()
const production = process.env.NODE_ENV === 'production'

// Checked before any driver exists: falling back to a local SQLite file in
// production would look healthy and lose everything on the next redeploy.
if (production && !databaseUrl && !chosenFile) {
  throw new Error('DATABASE_URL must be set in production (an explicit DSH_DB_FILE, a SQLite file, also counts).')
}

const sqliteFile = chosenFile ? resolve(chosenFile) : resolve(dataDir, 'portfolio.db')

export const driver = databaseUrl
  ? createPostgresDriver(databaseUrl)
  : createSqliteDriver(sqliteFile)

export const db = {
  all: (sql, params) => driver.all(sql, params),
  get: (sql, params) => driver.get(sql, params),
  run: (sql, params) => driver.run(sql, params),
}

export const dbInfo = { engine: driver.name, target: driver.label }

/** Postgres needs its DDL applied once; SQLite does it at connect time. */
export async function initDb() {
  if (driver.init) await driver.init()
  return dbInfo
}

/** Readiness probe: can the database answer a query right now? */
export async function isReady() {
  try {
    await db.get('SELECT 1')
    return true
  } catch {
    return false
  }
}

export async function audit(action, { actor = null, detail = null, ip = null } = {}) {
  await db.run('INSERT INTO audit_log (at, actor, action, detail, ip) VALUES (?, ?, ?, ?, ?)', [
    new Date().toISOString(),
    actor,
    action,
    detail,
    ip,
  ])
}

/** A read-only container points this at a tmpfs; locally it is `data/`. */
const credentialsDir = process.env.CREDENTIALS_DIR?.trim()
  ? resolve(process.env.CREDENTIALS_DIR.trim())
  : dataDir
const credentialsFile = resolve(credentialsDir, 'admin-credentials.txt')

function writeCredentials(email, password, how) {
  mkdirSync(credentialsDir, { recursive: true })
  writeFileSync(
    credentialsFile,
    [
      `Portfolio admin — ${how}.`,
      `email:    ${email}`,
      `password: ${password}`,
      '',
      'Change it after signing in (Account → Change password), then delete this file.',
      '',
    ].join('\n'),
    { mode: 0o600 },
  )
  chmodSync(credentialsFile, 0o600) // `mode` only applies when the file is new
}

/**
 * First boot: create the owner account. Credentials come from the environment
 * when provided. Otherwise, in development only, a random password is generated
 * once and written to `admin-credentials.txt` (mode 0600) in the credentials
 * folder, so it is never a hard-coded secret. Production needs `ADMIN_PASSWORD`.
 */
export async function seedOwner() {
  const existing = await db.get('SELECT COUNT(*) AS n FROM users')
  if (Number(existing.n) > 0) return null

  const email = (process.env.ADMIN_EMAIL?.trim() || 'owner@local').toLowerCase()
  const name = process.env.ADMIN_NAME?.trim() || 'Owner'
  const generated = !process.env.ADMIN_PASSWORD
  if (production && generated) {
    throw new Error('ADMIN_PASSWORD must be set for the first start in production: there is no user yet.')
  }
  const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url')

  if (!generated) {
    const problems = passwordProblems(password)
    if (problems.length) throw new Error(`ADMIN_PASSWORD needs ${problems.join(', ')}.`)
  }

  // Written before the user row, and always overwritten: a file left over from an
  // earlier database must never be mistaken for the current password.
  if (generated) writeCredentials(email, password, 'generated on first boot')

  await db.run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    email,
    name,
    await hashPassword(password),
    new Date().toISOString(),
  ])

  await audit('user.seed', { actor: email, detail: generated ? 'generated password' : 'env password' })
  return { email, password, generated, file: generated ? credentialsFile : null }
}

/**
 * Local recovery (`scripts/reset-password.mjs`): a new password for one user and
 * nothing else. The file is written first, so a password is never set unseen.
 * Without an email it takes the only user there is, and refuses to guess between more.
 */
export async function resetOwnerPassword(email) {
  let user
  if (email) user = await db.get('SELECT id, email FROM users WHERE email = ?', [email])
  else if (Number((await db.get('SELECT COUNT(*) AS n FROM users')).n) === 1) {
    user = await db.get('SELECT id, email FROM users')
  }
  if (!user) return null
  const password = randomBytes(12).toString('base64url')
  writeCredentials(user.email, password, 'reset by the recovery command')
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), user.id])
  await db.run('DELETE FROM sessions WHERE user_id = ?', [user.id])
  await audit('user.password.reset', { actor: user.email, detail: 'local recovery command' })
  return { email: user.email, file: credentialsFile }
}

export { root, dataDir }
