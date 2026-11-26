/**
 * Portfolio admin API — plain `node:http`, one dependency (`pg`).
 *
 *   POST   /api/auth/login          { email, password }        → sets session cookie
 *   POST   /api/auth/logout                                    → clears session
 *   GET    /api/auth/session                                   → { user } | { user: null }
 *   POST   /api/auth/password       { current, next }          → rotates hash, kills sessions
 *   GET    /api/content                                        → live content (also /content/site.json)
 *   PUT    /api/content             { content, note, baseRevision? }
 *                                   → validated new revision; 409 if `baseRevision` is not live
 *   GET    /api/content/revisions                              → revision list
 *   POST   /api/content/revisions/:id/restore                  → restore a revision
 *   GET    /api/health                                         → liveness + storage engine
 *   GET    /api/ready                                          → 200 once the database answers, else 503
 *
 * Every non-GET `/api/` call needs an allowed Host and Origin and
 * `Content-Type: application/json` (see `guard.mjs`).
 *
 * Password checks are capped (see `hash-gate.mjs`): when the queue is full,
 * sign-in and password change answer 503 with Retry-After.
 *
 * Storage is PostgreSQL when `DATABASE_URL` is set, SQLite otherwise.
 * In production (`NODE_ENV=production`) the same process also serves `dist/`, and
 * refuses to start without a database, `TRUST_PROXY`, `PUBLIC_ORIGIN` and, while
 * there is no user, `ADMIN_PASSWORD`.
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, audit, seedOwner, dbInfo, initDb, isReady, driver } from './db.mjs'
import {
  hashPassword,
  verifyPassword,
  passwordProblems,
  createSession,
  readSession,
  destroySession,
  purgeExpiredSessions,
  rotateCsrf,
  createDeviceToken,
  deviceId,
  DEVICE_SECONDS,
} from './auth.mjs'
import { takeAttempt, succeed, sweepThrottle } from './throttle.mjs'
import { createHashGate } from './hash-gate.mjs'
import { createStatic } from './static.mjs'
import { createShell } from './shell.mjs'
import {
  trustProxyHops,
  parseProxyList,
  clientIp,
  addressKey,
  parseOrigins,
  requestProblem,
  sameSecret,
} from './guard.mjs'
import {
  validateContent,
  saveProblems,
  loadContent,
  liveContent,
  skippedRevisions,
  publish,
  listRevisions,
  readRevision,
} from './content.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT || 4319)
const HOST = process.env.HOST || '127.0.0.1'
const PROD = process.env.NODE_ENV === 'production'
const COOKIE = 'dp_session'
const MAX_BODY = 512 * 1024
const DEVICE_COOKIE = 'dp_device'
const MAX_EMAIL = 254
const MAX_PASSWORD = 1024
/** The largest id an `integer` column holds. */
const MAX_ID = 2 ** 31 - 1
const BUSY_SECONDS = 5

/** Every password check a request can cause goes through this. */
const enterHash = createHashGate()

// Visitors read the live copy in memory, never a copy frozen into `dist/` at build time.
const CONTENT_URL = '/content/site.json'
const dist = resolve(root, 'dist')
const homePage = createShell({ dist, bundle: resolve(root, 'dist-server/entry.js'), live: liveContent })
const serveStatic = createStatic({
  dist,
  overrides: { [CONTENT_URL]: liveContent, '/': homePage, '/index.html': homePage },
})

// Both are read once at boot; a bad value stops the start.
let proxyHops = 0
let publicOrigins = []
let trustedProxies = null
const warned = new Set()

function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[admin] ${message}`)
}

/** Compared against when the email is unknown, so timing does not reveal accounts. */
let dummyHash = ''

/* ------------------------------------------------------------------ helpers */

const json = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

const fail = (res, status, message, extra = {}) => json(res, status, { error: message, ...extra })

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const value = part.slice(idx + 1).trim()
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(value)
    } catch {
      /* a malformed cookie is simply ignored */
    }
  }
  return out
}

function cookie(name, value, maxAge, path = '/') {
  const bits = [`${name}=${value}`, `Path=${path}`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`]
  if (PROD) bits.push('Secure')
  return bits.join('; ')
}

const sessionCookie = (token, maxAge) => cookie(COOKIE, token, maxAge)
/** Survives sign-out on purpose: it keeps this browser out of other people's throttling. */
const deviceCookie = (user) => cookie(DEVICE_COOKIE, createDeviceToken(user), DEVICE_SECONDS, '/api/auth')

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('Payload too large'), { status: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  let body
  let nul = false
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'), (key, value) => {
      if (key.includes('\0') || (typeof value === 'string' && value.includes('\0'))) nul = true
      return value
    })
  } catch {
    throw Object.assign(new Error('Body is not valid JSON'), { status: 400 })
  }
  // PostgreSQL text cannot hold it, so it would surface as a 500 further on.
  if (nul) throw Object.assign(new Error('Text must not contain a NUL character'), { status: 400 })
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Body must be a JSON object'), { status: 400 })
  }
  return body
}

function tooMany(res, gate) {
  res.setHeader('retry-after', String(gate.retryAfter))
  return fail(res, 429, `Too many attempts. Try again in ${gate.retryAfter}s.`, {
    retryAfter: gate.retryAfter,
  })
}

/** Refused before `takeAttempt`, so it costs the caller none of their tries. */
function busy(res) {
  warnOnce('busy', 'sign-in checks are queued to the limit; the overflow is answered with 503')
  res.setHeader('retry-after', String(BUSY_SECONDS))
  return fail(res, 503, `The server is busy checking other sign-ins. Try again in ${BUSY_SECONDS}s.`, {
    retryAfter: BUSY_SECONDS,
  })
}

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('cross-origin-opener-policy', 'same-origin')
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  )
  // This host only: the site runs on a main domain whose other subdomains it must not force onto HTTPS.
  if (PROD) res.setHeader('strict-transport-security', 'max-age=31536000')
}

/** Requires a valid session; also enforces the CSRF header on writes. */
async function requireSession(req, res, { csrf = false } = {}) {
  const cookies = parseCookies(req.headers.cookie)
  const session = await readSession(cookies[COOKIE])
  if (!session) {
    fail(res, 401, 'Not signed in')
    return null
  }
  if (csrf) {
    if (!sameSecret(req.headers['x-csrf-token'], session.csrf)) {
      fail(res, 403, 'CSRF token missing or stale — reload the page')
      return null
    }
  }
  return session
}

/* -------------------------------------------------------------------- routes */

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  const method = req.method || 'GET'
  const ip = clientIp(req, proxyHops, trustedProxies)
  if (req.headers['x-forwarded-for'] && !proxyHops) {
    warnOnce('xff', 'X-Forwarded-For ignored because TRUST_PROXY is 0. Behind a proxy, set the proxy count.')
  }

  if (path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const problem = requestProblem(req, publicOrigins)
    if (problem) {
      if (problem.status === 403) {
        warnOnce('origin', 'refused a request from an unlisted Host or Origin. For a real domain set PUBLIC_ORIGIN.')
      }
      return fail(res, problem.status, problem.message)
    }
  }

  if (path === '/api/health') {
    return json(res, 200, { ok: true, uptime: process.uptime(), storage: dbInfo.engine })
  }

  if (path === '/api/ready') {
    return (await isReady()) ? json(res, 200, { ok: true }) : fail(res, 503, 'Database is not reachable.')
  }

  /* ---- auth ---- */

  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (email.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
      return fail(res, 400, 'Email or password is too long.')
    }

    const user = await db.get('SELECT * FROM users WHERE email = ?', [email])
    const device = deviceId(parseCookies(req.headers.cookie)[DEVICE_COOKIE], user)
    const source = addressKey(ip)
    const budget = { own: device && `device:${device}` }
    // No `await` between these two: a blocked source gives its place straight back.
    const ticket = enterHash(Boolean(device))
    if (!ticket) return busy(res)
    let gate
    let ok = false
    try {
      gate = takeAttempt(source, email, budget)
      if (gate.blocked) {
        ticket.done()
        if (gate.firstBlock) await audit('auth.throttled', { actor: email, ip })
        return tooMany(res, gate)
      }
      await ticket.turn
      ok = await verifyPassword(password, user?.password_hash ?? dummyHash)
    } finally {
      ticket.done()
    }
    // Written after the place is free, so a slow database holds up no one else.
    if (gate.tripped) {
      console.warn('[admin] many failed sign-ins: every address now gets only a few tries')
      await audit('auth.flood', { actor: email, ip })
    }
    if (!user || !ok) {
      // During a flood the single `auth.flood` row stands in, so the log cannot be filled.
      if (!gate.flood) await audit('auth.failed', { actor: email, ip })
      return fail(res, 401, 'Email or password is incorrect.', { remaining: gate.remaining })
    }

    await purgeExpiredSessions()
    const session = await createSession(user, { ip, userAgent: req.headers['user-agent'] })
    if (!session) {
      // The password changed while this one was being checked.
      await audit('auth.failed', { actor: email, ip })
      return fail(res, 401, 'Email or password is incorrect.', { remaining: gate.remaining })
    }
    succeed(source, email, budget)
    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id])
    await audit('auth.login', { actor: user.email, ip })
    return json(
      res,
      200,
      { user: { id: Number(user.id), email: user.email, name: user.name }, csrf: session.csrf },
      { 'set-cookie': [sessionCookie(session.token, session.maxAge), deviceCookie(user)] },
    )
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie)
    const session = await readSession(cookies[COOKIE])
    await destroySession(cookies[COOKIE])
    if (session) await audit('auth.logout', { actor: session.user.email, ip })
    return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) })
  }

  if (path === '/api/auth/session' && method === 'GET') {
    const cookies = parseCookies(req.headers.cookie)
    const session = await readSession(cookies[COOKIE])
    // 200 with `user: null` rather than 401: a signed-out visitor is a normal
    // state, and a 401 here would show up as a console error on every page load.
    if (!session) return json(res, 200, { user: null })
    return json(res, 200, { user: session.user, csrf: session.csrf })
  }

  if (path === '/api/auth/password' && method === 'POST') {
    const session = await requireSession(req, res, { csrf: true })
    if (!session) return
    const body = await readJson(req)
    const current = String(body.current || '')
    const next = String(body.next || '')
    if (current.length > MAX_PASSWORD || next.length > MAX_PASSWORD) {
      return fail(res, 400, 'Password is too long.')
    }
    const subject = `password-change#${session.user.id}`
    const row = await db.get('SELECT * FROM users WHERE id = ?', [session.user.id])
    // One place covers both the check of `current` and the hash of `next`.
    const ticket = enterHash(true)
    if (!ticket) return busy(res)
    let password_hash
    try {
      // Private budget: only this signed-in user's own guesses count against it.
      const gate = takeAttempt(ip, subject, { own: subject })
      if (gate.blocked) return tooMany(res, gate)

      await ticket.turn
      if (!row || !(await verifyPassword(current, row.password_hash))) {
        await audit('auth.password.denied', { actor: session.user.email, ip })
        return fail(res, 401, 'Current password is incorrect.')
      }
      succeed(ip, subject, { own: subject })
      const problems = passwordProblems(next)
      if (problems.length) return fail(res, 422, `Password needs ${problems.join(', ')}.`)
      password_hash = await hashPassword(next)
    } finally {
      ticket.done()
    }

    const updated = await db.run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', [
      password_hash,
      row.id,
      row.password_hash,
    ])
    // Another change landed first, so `current` is no longer the password.
    if (!updated.changes) return fail(res, 401, 'Current password is incorrect.')
    await db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', [row.id, session.sessionId])
    const csrf = await rotateCsrf(session.sessionId)
    await audit('auth.password.changed', { actor: session.user.email, ip })
    return json(res, 200, { ok: true, csrf }, { 'set-cookie': deviceCookie({ ...row, password_hash }) })
  }

  /* ---- content ---- */

  if (path === '/api/content' && method === 'GET') return serveStatic(req, res, CONTENT_URL)

  if (path === '/api/content' && method === 'PUT') {
    const session = await requireSession(req, res, { csrf: true })
    if (!session) return
    const body = await readJson(req)
    const content = body.content
    const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null
    // The revision the editor started from; without it the save is unconditional.
    const { baseRevision } = body
    if (baseRevision !== undefined && !Number.isInteger(baseRevision)) {
      return fail(res, 400, 'baseRevision must be a whole number.')
    }

    const errors = [...validateContent(content), ...saveProblems(content)]
    if (errors.length) {
      await audit('content.rejected', { actor: session.user.email, detail: errors[0], ip })
      return fail(res, 422, 'Content did not validate.', { errors })
    }

    const revision = await publish(content, { note, author: session.user.email, baseRevision })
    await audit('content.saved', {
      actor: session.user.email,
      detail: `${content.chapters.length} chapters${note ? ` — ${note}` : ''}`,
      ip,
    })
    return json(res, 200, { ok: true, revision })
  }

  if (path === '/api/content/revisions' && method === 'GET') {
    const session = await requireSession(req, res)
    if (!session) return
    return json(res, 200, { revisions: await listRevisions(30), skipped: skippedRevisions() })
  }

  const restore = path.match(/^\/api\/content\/revisions\/(\d+)\/restore$/)
  if (restore && method === 'POST') {
    const session = await requireSession(req, res, { csrf: true })
    if (!session) return
    const id = Number(restore[1])
    const row = id <= MAX_ID ? await readRevision(id) : null
    if (!row) return fail(res, 404, 'Revision not found')
    const errors = validateContent(row.data)
    if (errors.length) return fail(res, 422, 'Stored revision is no longer valid.', { errors })
    await publish(row.data, { note: `restored #${row.id}`, author: session.user.email })
    await audit('content.restored', { actor: session.user.email, detail: `revision ${row.id}`, ip })
    return json(res, 200, { ok: true })
  }

  /* ---- static: the live content always (dev proxies it here), `dist/` in production ---- */

  if (path === CONTENT_URL || (PROD && !path.startsWith('/api/'))) return serveStatic(req, res, path)

  return fail(res, 404, 'Not found')
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  if (PROD && !process.env.TRUST_PROXY?.trim()) {
    throw new Error('TRUST_PROXY must be set in production: 0 with no reverse proxy, else the number of proxies.')
  }
  proxyHops = trustProxyHops(process.env.TRUST_PROXY)
  publicOrigins = parseOrigins(process.env.PUBLIC_ORIGIN)
  trustedProxies = parseProxyList(process.env.TRUSTED_PROXY_IPS)
  if (PROD && !publicOrigins.length) {
    throw new Error('PUBLIC_ORIGIN must be set in production: the https address visitors use.')
  }

  const info = await initDb()
  console.log(`[admin] storage ${info.engine} — ${info.target}`)

  dummyHash = await hashPassword(randomBytes(24).toString('base64url'))
  const seeded = await seedOwner()
  if (seeded?.generated) {
    console.log(`[admin] created owner ${seeded.email}; password written to ${seeded.file}`)
  } else if (seeded) {
    console.log(`[admin] created owner ${seeded.email} from environment`)
  }

  await loadContent()

  setInterval(() => {
    purgeExpiredSessions().catch((err) => console.error('[admin] session purge:', err.message))
    sweepThrottle()
  }, 10 * 60_000).unref()

  const server = createServer((req, res) => {
    securityHeaders(res)
    handle(req, res).catch((err) => {
      const status = err?.status || 500
      if (status >= 500) console.error('[api]', err)
      if (!res.headersSent) fail(res, status, status >= 500 ? 'Internal error' : err.message)
      else res.end()
    })
  })

  server.listen(PORT, HOST, () => {
    console.log(`[admin] API on http://${HOST}:${PORT}${PROD ? ' (serving dist/)' : ''}`)
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(async () => {
        await driver.close().catch(() => null)
        process.exit(0)
      })
    })
  }
}

boot().catch((err) => {
  console.error('[admin] failed to start:', err)
  process.exit(1)
})
