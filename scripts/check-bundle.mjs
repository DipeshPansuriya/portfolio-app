#!/usr/bin/env node
/**
 * First-load JavaScript budget (PRD NFR-002): the scripts `index.html` asks for,
 * its module preloads and everything they import statically, gzipped. three.js
 * must stay out of that set. Lazy chunks do not count. The stylesheets are
 * checked against their own budget.
 *
 *   node scripts/check-bundle.mjs [dist]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const LIMIT = 160_000
/** CSS the page asks for (docs/ARCHITECTURE.md, performance budget). */
const CSS_LIMIT = 15_000
const dist = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'))

function check() {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const queue = [...html.matchAll(/<script\b[^>]*?\ssrc="([^"]+)"|<link\b(?=[^>]*\srel="modulepreload")[^>]*?\shref="([^"]+)"/g)]
    .map((m) => posix.resolve('/', m[1] ?? m[2]))
  if (!queue.length) throw new Error('index.html loads no script')

  const seen = new Set()
  const problems = []
  let total = 0
  for (const path of queue) {
    if (seen.has(path)) continue
    seen.add(path)
    const code = readFileSync(join(dist, path))
    const size = gzipSync(code, { level: 9 }).length
    total += size
    console.log(`[bundle] ${String(size).padStart(7)} B gzip  ${path}`)
    if (/three/i.test(posix.basename(path)) || code.includes('WebGLRenderer')) {
      problems.push(`three.js is in the first load: ${path}`)
    }
    // `import x from "./a.js"` and `import "./a.js"`, but not the lazy `import("./a.js")`.
    for (const [, next] of code.toString().matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      queue.push(posix.resolve(posix.dirname(path), next))
    }
  }
  if (total > LIMIT) problems.push(`first load is ${total} B, over the budget of ${LIMIT} B gzip`)
  console.log(`[bundle] first load: ${seen.size} files, ${total} B gzip (budget ${LIMIT} B)`)

  const css = [...html.matchAll(/<link\b(?=[^>]*\srel="stylesheet")[^>]*?\shref="([^"]+)"/g)].reduce(
    (sum, m) => sum + gzipSync(readFileSync(join(dist, posix.resolve('/', m[1]))), { level: 9 }).length,
    0,
  )
  if (css > CSS_LIMIT) problems.push(`CSS is ${css} B, over the budget of ${CSS_LIMIT} B gzip`)
  console.log(`[bundle] CSS: ${css} B gzip (budget ${CSS_LIMIT} B)`)
  return problems
}

try {
  const problems = check()
  for (const problem of problems) console.error(`[bundle] FAIL ${problem}`)
  if (problems.length) process.exitCode = 1
} catch (err) {
  console.error(`[bundle] FAIL ${err.message} (run \`npm run build\` first)`)
  process.exitCode = 1
}
