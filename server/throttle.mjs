/**
 * In-memory login throttle.
 *
 * Only an address's own attempts can ever block it: 5 per address+email and 30
 * per address in 15 minutes. The per-email and global counts never block anyone;
 * once either is full ("flood"), every address gets just `strict` tries. So a
 * stranger cannot lock the owner out of a clean address, and each source stays
 * bounded. There is deliberately no absolute ceiling across unlimited sources:
 * that ceiling is exactly what let a stranger lock the owner out.
 *
 * `own` is a private budget (a signed-in browser, or a password change) that no
 * one else's attempts touch. The state is per process and resets on restart.
 */
const WINDOW_MS = 15 * 60_000
const MAX_KEYS = 20_000

/** Failed attempts allowed per window. */
export const LIMITS = { pair: 5, email: 20, ip: 30, global: 100, strict: 2, own: 5 }

const attempts = new Map()

const buckets = (ip, subject, own) =>
  own
    ? [[`own:${own}`, LIMITS.own]]
    : [
        [`pair:${ip}|${subject}`, LIMITS.pair],
        [`ip:${ip}`, LIMITS.ip],
        [`email:${subject}`, LIMITS.email],
        ['global', LIMITS.global],
      ]

const isShared = (key) => key === 'global' || key.startsWith('email:')

function live(key, now) {
  const entry = attempts.get(key)
  if (!entry) return null
  const blocked = entry.blockedUntil > now
  if (!blocked && now - entry.firstAt > WINDOW_MS) {
    attempts.delete(key)
    return null
  }
  return entry
}

function refuse(entry, until, now) {
  const firstBlock = !entry.reported
  entry.reported = true
  return { blocked: true, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)), firstBlock }
}

/** Keeps memory bounded under many sources. The global count is never dropped. */
function trim() {
  if (attempts.size < MAX_KEYS) return
  sweepThrottle()
  for (const key of attempts.keys()) {
    if (attempts.size < MAX_KEYS * 0.9) break
    if (key !== 'global') attempts.delete(key)
  }
}

/**
 * Reserve one attempt *before* the password is checked, so parallel requests
 * cannot all pass the gate while the hash is still being computed.
 * `flood`: strict mode was already on. `tripped`: this attempt switched it on.
 * `firstBlock` is true once per block, so the audit log is not flooded.
 */
export function takeAttempt(ip, subject, { own } = {}) {
  const now = Date.now()
  trim()
  const list = buckets(ip, subject, own)

  for (const [key] of list) {
    const entry = !isShared(key) && live(key, now)
    if (entry && entry.blockedUntil > now) return refuse(entry, entry.blockedUntil, now)
  }

  const flood = list.some(([key]) => isShared(key) && live(key, now)?.blockedUntil > now)
  const mine = flood && live(`ip:${ip}`, now)
  // Not reported per address: the one `auth.flood` audit row already covers it.
  if (mine && mine.count >= LIMITS.strict) {
    return { ...refuse(mine, mine.firstAt + WINDOW_MS, now), firstBlock: false }
  }

  let tripped = false
  let remaining = LIMITS.pair
  for (const [key, max] of list) {
    const entry = live(key, now) ?? { count: 0, firstAt: now, blockedUntil: 0, reported: false }
    entry.count += 1
    if (entry.count >= max) {
      if (isShared(key) && entry.blockedUntil <= now) tripped = true
      entry.blockedUntil = now + WINDOW_MS
    }
    attempts.set(key, entry)
    if (key.startsWith('pair:') || key.startsWith('own:')) remaining = Math.max(0, max - entry.count)
  }
  if (flood) remaining = Math.max(0, LIMITS.strict - attempts.get(`ip:${ip}`).count)
  return { blocked: false, remaining, flood, tripped }
}

/** A correct password gives the reserved attempt back. */
export function succeed(ip, subject, { own } = {}) {
  for (const [key, max] of buckets(ip, subject, own)) {
    const entry = attempts.get(key)
    if (!entry) continue
    entry.count -= 1
    if (key.startsWith('pair:') || key.startsWith('own:') || entry.count <= 0) attempts.delete(key)
    else if (entry.count < max) entry.blockedUntil = 0
  }
}

/** Housekeeping so the map cannot grow without bound. */
export function sweepThrottle() {
  const now = Date.now()
  for (const key of attempts.keys()) live(key, now)
}
