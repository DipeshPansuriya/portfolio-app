/**
 * ADR 0003: `/` with a static hero inside `#root`, the head tags and the live
 * content in a data block, so the first paint does not wait for the scripts.
 * Built once per content revision. A failure returns `null` (the plain
 * `index.html` is served instead) and the build is tried again later.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fillHead } from './head.mjs'

const EMPTY_ROOT = '<div id="root"></div>'

/**
 * @param dist   build output holding `index.html`
 * @param bundle server bundle exporting `render(content)`
 * @param live   returns the live `{ revision, body }`
 * @param retryMs how long a failed build is not retried
 */
export function createShell({ dist, bundle, live, retryMs = 30_000 }) {
  let cached = null
  const logged = new Set()

  async function build(body) {
    const content = JSON.parse(body)
    const { render } = await import(pathToFileURL(bundle).href)
    const html = fillHead(await readFile(join(dist, 'index.html'), 'utf8'), content)
    if (!html.includes(EMPTY_ROOT)) throw new Error(`index.html has no ${EMPTY_ROOT}`)
    // With no `<` left, no content can close the script element or open a comment.
    const data = JSON.stringify(content).replaceAll('<', '\\u003c')
    const markup = `<div id="root">${render(content)}</div><script type="application/json" id="site-content">${data}</script>`
    // A function, so `$&` and friends in the content are not replacement patterns.
    const page = Buffer.from(html.replace(EMPTY_ROOT, () => markup))
    // Hash of the page: it changes with the content and with a new build.
    return { body: page, version: `s${createHash('sha256').update(page).digest('base64url').slice(0, 22)}`, ext: '.html' }
  }

  return () => {
    const { revision, body } = live()
    if (cached?.revision !== revision || Date.now() >= cached.retryAt) {
      const entry = { revision, retryAt: Infinity }
      entry.page = build(body).catch((err) => {
        if (!logged.has(err.message)) console.error('[shell] serving the plain page:', err.message)
        logged.add(err.message)
        entry.retryAt = Date.now() + retryMs
        return null
      })
      cached = entry
    }
    return cached.page
  }
}
