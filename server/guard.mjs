/**
 * Who is calling, and may this call change anything: proxy trust, client address,
 * and the Host / Origin / Content-Type check for state-changing API requests.
 */
import { BlockList, isIP } from 'node:net'
import { timingSafeEqual } from 'node:crypto'

/** Compares a client-supplied token without leaking how much of it matched. */
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ------------------------------------------------------------- proxy trust */

const MAX_HOPS = 10

/** `TRUST_PROXY` is the number of reverse proxies in front of this process. */
export function trustProxyHops(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '' || text === 'false') return 0
  if (text === 'true') return 1
  if (/^\d+$/.test(text) && Number(text) <= MAX_HOPS) return Number(text)
  throw new Error(`TRUST_PROXY must be 0, or the number of proxies in front (1 to ${MAX_HOPS}).`)
}

const local = new BlockList()
for (const [net, bits] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]]) {
  local.addSubnet(net, bits, 'ipv4')
}
local.addAddress('::1', 'ipv6')
local.addSubnet('fc00::', 7, 'ipv6')
local.addSubnet('fe80::', 10, 'ipv6')

const unmapped = (ip) => String(ip || '').replace(/^::ffff:(?=\d+\.)/i, '').split('%')[0]

function isListed(list, ip) {
  const family = isIP(ip)
  return family !== 0 && list.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

/**
 * `TRUSTED_PROXY_IPS`: comma-separated addresses or subnets of the reverse proxy.
 * `null` when unset, which leaves every local or private peer trusted.
 */
export function parseProxyList(value) {
  const entries = String(value || '').split(',').map((part) => part.trim()).filter(Boolean)
  if (!entries.length) return null
  const list = new BlockList()
  for (const entry of entries) {
    const [address, bits, ...rest] = entry.split('/')
    const family = isIP(address)
    const type = family === 4 ? 'ipv4' : 'ipv6'
    const max = family === 4 ? 32 : 128
    if (!family || rest.length || (bits !== undefined && !(/^\d+$/.test(bits) && Number(bits) <= max))) {
      throw new Error(`TRUSTED_PROXY_IPS entry "${entry}" must be an IP address or a subnet such as 172.20.0.0/16.`)
    }
    if (bits === undefined) list.addAddress(address, type)
    else list.addSubnet(address, Number(bits), type)
  }
  return list
}

/**
 * Each proxy appends the address it received the request from, so the client is
 * the `hops`-th entry from the right; anything further left is client-supplied.
 * The header counts only when the direct peer is local or private (or, with
 * `proxies`, one of those), so a process exposed without a proxy cannot be fed
 * forged addresses from the internet.
 */
export function clientIp(req, hops, proxies = null) {
  const peer = unmapped(req.socket.remoteAddress) || 'unknown'
  if (!hops || !isListed(proxies ?? local, peer)) return peer
  const chain = String(req.headers['x-forwarded-for'] || '').split(',')
  const entry = (chain[chain.length - hops] || '').trim()
  // Some proxies add the port: `1.2.3.4:5555` or `[2001:db8::1]:443`.
  const bare = unmapped(entry.match(/^\[(.+)\](?::\d+)?$/)?.[1] ?? entry.replace(/^([\d.]+):\d+$/, '$1'))
  return isIP(bare) ? bare : peer
}

/** Throttle key: one IPv6 customer usually holds a whole /64, so count it as one. */
export function addressKey(ip) {
  if (isIP(ip) !== 6) return ip
  const [head, tail] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const gap = tail === undefined ? [] : Array(Math.max(0, 8 - left.length - right.length)).fill('0')
  const groups = [...left, ...gap, ...right].slice(0, 4)
  return `${groups.map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`
}

/* ------------------------------------------------------------ request guard */

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']

/** `PUBLIC_ORIGIN`: comma-separated `https://your-domain` values. */
export function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().replace(/\/$/, '').toLowerCase())
    .filter(Boolean)
    .map((text) => {
      const url = URL.canParse(text) ? new URL(text) : null
      if (!url || !/^https?:$/.test(url.protocol) || url.origin !== text) {
        throw new Error(`PUBLIC_ORIGIN entry "${text}" must look like https://example.com`)
      }
      return url
    })
}

/**
 * Why a state-changing request must be refused, or `null`. The Host list stops
 * DNS rebinding; the Origin check stops other sites; requiring JSON means a
 * cross-origin page cannot send the request without a preflight.
 */
export function requestProblem(req, allowed) {
  const host = String(req.headers.host || '').toLowerCase()
  const name = host.match(/^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::\d{1,5})?$/)?.[1]
  const listed = allowed.some((url) => url.host === host || url.host === host.replace(/:(80|443)$/, ''))
  if (!name || (!LOOPBACK.includes(name) && !listed)) {
    return { status: 403, message: 'This host name is not allowed.' }
  }
  const origin = req.headers.origin?.toLowerCase()
  if (origin !== undefined) {
    const sameOrigin = /^https?:\/\//.test(origin) && origin.slice(origin.indexOf('//') + 2) === host
    if (!sameOrigin && !allowed.some((url) => url.origin === origin)) {
      return { status: 403, message: 'This request origin is not allowed.' }
    }
  }
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') {
    return { status: 415, message: 'Content-Type must be application/json.' }
  }
  return null
}
