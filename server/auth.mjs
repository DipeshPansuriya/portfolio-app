/**
 * Password hashing and session tokens. Login throttling lives in `throttle.mjs`.
 * Everything here uses `node:crypto` — no third-party auth library.
 */
import { randomBytes, scrypt, timingSafeEqual, createHash, createHmac } from 'node:crypto'
import { promisify } from 'node:util'
import { db, driver } from './db.mjs'

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }
const SESSION_HOURS = 8
// Async so a burst of logins cannot stall every other request.
const derive = promisify(scrypt)

/* ------------------------------------------------------------ known devices */

export const DEVICE_SECONDS = 90 * 24 * 3600

// Keyed by the stored password hash: no new secret or table, and changing or
// resetting the password retires every device token.
const deviceMac = (user, expires, nonce) =>
  createHmac('sha256', user.password_hash).update(`device.${user.id}.${expires}.${nonce}`).digest()

/** Proof that this browser has signed in as `user` before. It grants no access. */
export function createDeviceToken(user) {
  const expires = Date.now() + DEVICE_SECONDS * 1000
  const nonce = randomBytes(12).toString('base64url')
  return `${expires}.${nonce}.${deviceMac(user, expires, nonce).toString('base64url')}`
}

/** The token's id when it is genuine and current for `user`, else `null`. */
export function deviceId(token, user) {
  const [expires, nonce, mac] = String(token || '').split('.')
  if (!user || !mac || !(Number(expires) > Date.now())) return null
  const expected = deviceMac(user, expires, nonce)
  const actual = Buffer.from(mac, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? nonce : null
}

/* ---------------------------------------------------------------- passwords */

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await derive(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  })
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const expected = Buffer.from(hash, 'base64url')
    const actual = await derive(password, Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    })
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export function passwordProblems(password) {
  const out = []
  if (typeof password !== 'string') return ['Password must be a string']
  if (password.length < 10) out.push('at least 10 characters')
  if (!/[a-z]/.test(password)) out.push('a lowercase letter')
  if (!/[A-Z]/.test(password)) out.push('an uppercase letter')
  if (!/[0-9]/.test(password)) out.push('a number')
  if (/^(password|admin|letmein|qwerty)/i.test(password)) out.push('something less obvious')
  return out
}

/* ----------------------------------------------------------------- sessions */

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/**
 * `null` when `user.password_hash` is no longer the stored one: a sign-in that
 * was checking the old password while it changed must not leave a session. On
 * PostgreSQL the row lock makes the insert wait for that change.
 */
export async function createSession(user, { ip, userAgent } = {}) {
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(24).toString('base64url')
  const now = Date.now()
  const time = driver.timestampParam
  const { changes } = await db.run(
    `INSERT INTO sessions (id, user_id, csrf, created_at, expires_at, ip, user_agent)
     SELECT ?, id, ?, ${time}, ${time}, ?, ?
     FROM users WHERE id = ? AND password_hash = ?${driver.forShare}`,
    [
      sha256(token),
      csrf,
      new Date(now).toISOString(),
      new Date(now + SESSION_HOURS * 3600_000).toISOString(),
      ip ?? null,
      userAgent ?? null,
      user.id,
      user.password_hash,
    ],
  )
  return changes ? { token, csrf, maxAge: SESSION_HOURS * 3600 } : null
}

export async function readSession(token) {
  if (!token) return null
  const row = await db.get(
    `SELECT s.id, s.csrf, s.expires_at, u.id AS user_id, u.email, u.name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [sha256(token)],
  )
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM sessions WHERE id = ?', [row.id])
    return null
  }
  return {
    sessionId: row.id,
    csrf: row.csrf,
    user: { id: Number(row.user_id), email: row.email, name: row.name },
  }
}

export async function destroySession(token) {
  if (!token) return
  await db.run('DELETE FROM sessions WHERE id = ?', [sha256(token)])
}

export async function purgeExpiredSessions() {
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()])
}

export async function rotateCsrf(sessionId) {
  const csrf = randomBytes(24).toString('base64url')
  await db.run('UPDATE sessions SET csrf = ? WHERE id = ?', [csrf, sessionId])
  return csrf
}
