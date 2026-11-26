/**
 * Static file serving for production: br/gzip, ETags, cache rules and real 404s.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, gzip, constants } from 'node:zlib'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml'])
const MIN_COMPRESS = 1024

function cacheControl(rel) {
  // Vite puts a content hash in these names.
  if (rel.startsWith(`assets${sep}`)) return 'public, max-age=31536000, immutable'
  // Stable names: cache for a while, but let a replacement show up eventually.
  if (rel.startsWith(`fonts${sep}`)) return 'public, max-age=2592000'
  if (rel === 'favicon.svg') return 'public, max-age=86400'
  return 'no-cache'
}

/** Picks br, then gzip, honouring `;q=0`. */
function pickEncoding(header = '') {
  const accepted = new Set()
  for (const part of String(header).toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim())
    if (!params.some((p) => /^q=0(\.0+)?$/.test(p))) accepted.add(name)
  }
  if (accepted.has('br')) return 'br'
  if (accepted.has('gzip')) return 'gzip'
  return null
}

/**
 * @param dist      build output directory
 * @param overrides URL path → function returning (or resolving to) `{ body }` with a
 *                  `revision` or `version`, served from memory instead of any file
 *                  (the live content, the hero shell). `null` falls back to the file.
 */
export function createStatic({ dist, overrides = {} }) {
  const compressed = new Map()

  const plain = (res, status, message, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers })
    res.end(message)
  }

  async function resolveFile(path) {
    const rel = normalize(path).replace(/^([/\\]|\.\.[/\\])+/, '')
    const file = join(dist, rel)
    if (file !== dist && !file.startsWith(dist + sep)) return null

    try {
      const info = await stat(file)
      if (!info.isDirectory()) return { file, rel }
    } catch {
      // A missing file with an extension is a real 404; anything else is a page route.
      if (extname(path)) return null
    }
    // The app only has two pages; anything else gets the same shell with a 404.
    const status = /^\/(admin\/?)?$/.test(path) ? 200 : 404
    return { file: join(dist, 'index.html'), rel: 'index.html', status }
  }

  async function fromMemory(path) {
    const found = await overrides[path]()
    if (!found) return null
    const { body, revision, version = `r${revision}`, ext = extname(path) } = found
    return { key: path, rel: path.slice(1), ext, size: body.length, revision, version, read: () => body }
  }

  async function fromDisk(path) {
    const target = await resolveFile(path)
    if (!target) return null
    try {
      const info = await stat(target.file)
      if (!info.isFile()) return null
      const version = `${info.size.toString(36)}-${Math.trunc(info.mtimeMs).toString(36)}`
      const { file } = target
      return { ...target, key: file, ext: extname(file), size: info.size, version, read: () => readFile(file) }
    } catch {
      return null
    }
  }

  return async function serveStatic(req, res, rawPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return plain(res, 405, 'Method not allowed', { allow: 'GET, HEAD' })
    }
    let path
    try {
      path = decodeURIComponent(rawPath)
    } catch {
      return plain(res, 400, 'Bad request')
    }
    if (path.includes('\0')) return plain(res, 400, 'Bad request')

    const target = (Object.hasOwn(overrides, path) && (await fromMemory(path))) || (await fromDisk(path))
    if (!target) return plain(res, 404, 'Not found')

    const { ext } = target
    const compressible = COMPRESSIBLE.has(ext) && target.size >= MIN_COMPRESS
    const encoding = compressible ? pickEncoding(req.headers['accept-encoding']) : null
    const etag = `W/"${target.version}-${encoding ?? 'id'}"`
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': cacheControl(target.rel),
      etag,
    }
    if (compressible) headers.vary = 'Accept-Encoding'
    // The editor sends this back as `baseRevision`.
    if (target.revision !== undefined) headers['x-content-revision'] = String(target.revision)
    if (/^\/admin(\/|$)/.test(path)) headers['x-robots-tag'] = 'noindex, nofollow'

    const status = target.status ?? 200
    if (status === 200 && String(req.headers['if-none-match'] || '').split(/,\s*/).includes(etag)) {
      res.writeHead(304, headers)
      return res.end()
    }

    let body
    const cacheKey = `${target.key}|${encoding}`
    const hit = encoding ? compressed.get(cacheKey) : null
    if (hit?.etag === etag) {
      body = hit.body
    } else {
      body = await target.read()
      if (encoding === 'br') {
        body = await brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
      } else if (encoding === 'gzip') {
        body = await gz(body, { level: 9 })
      }
      if (encoding) compressed.set(cacheKey, { etag, body })
    }

    if (encoding) headers['content-encoding'] = encoding
    headers['content-length'] = body.length
    res.writeHead(status, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}
