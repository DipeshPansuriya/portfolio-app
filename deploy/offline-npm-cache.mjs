#!/usr/bin/env node
/**
 * Offline image builds (`CI_OFFLINE=1 sh scripts/ci.sh`): copies only the runtime
 * packages of the lockfile out of this machine's npm cache, so the build can run
 * `npm ci --omit=dev --offline` with no network. Downloads nothing.
 *
 *   node deploy/offline-npm-cache.mjs <target folder> [source cache]
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [target, source = process.env.npm_config_cache || join(homedir(), '.npm')] = process.argv.slice(2)
if (!target) throw new Error('usage: offline-npm-cache.mjs <target folder> [source cache]')

const split = (hex) => [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4)]
const { packages } = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
let count = 0

for (const [path, entry] of Object.entries(packages)) {
  if (!path || entry.dev) continue
  const [algorithm, digest] = entry.integrity.split('-')
  // npm's cache layout: file content by digest, plus an index entry by request URL.
  const content = join('_cacache', 'content-v2', algorithm, ...split(Buffer.from(digest, 'base64').toString('hex')))
  const key = `make-fetch-happen:request-cache:${entry.resolved}`
  const index = join('_cacache', 'index-v5', ...split(createHash('sha256').update(key).digest('hex')))
  for (const file of [content, index]) {
    if (existsSync(join(source, file))) cpSync(join(source, file), join(target, file))
    else if (file === content) throw new Error(`${path} is not in the npm cache at ${source}`)
  }
  count += 1
}
console.log(`[offline-cache] ${count} runtime packages copied`)
