/** T6: runtime packages, bundle budget, CI gates and the test database. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratch, start, source } from './harness.mjs'

const json = (path) => JSON.parse(readFileSync(join(source, path), 'utf8'))

test('packages: pg is the only runtime dependency, in package.json and in the lockfile', () => {
  const manifest = json('package.json')
  assert.deepEqual(Object.keys(manifest.dependencies), ['pg'])
  for (const name of ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', 'framer-motion', 'lenis']) {
    assert.ok(manifest.devDependencies[name], name)
  }
  const { packages } = json('package-lock.json')
  assert.deepEqual(packages[''].dependencies, manifest.dependencies)
  assert.deepEqual(packages[''].devDependencies, manifest.devDependencies)
  // Walk what `pg` needs; nothing else may survive `npm ci --omit=dev`.
  const needed = new Set()
  const visit = (name) => {
    const entry = packages[`node_modules/${name}`]
    if (!entry || needed.has(name)) return
    needed.add(name)
    for (const next of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) visit(next)
  }
  visit('pg')
  const runtime = Object.entries(packages)
    .filter(([path, entry]) => path && !entry.dev && !entry.devOptional)
    .map(([path]) => path.replace(/^node_modules\//, ''))
  assert.ok(runtime.includes('pg'))
  assert.deepEqual(runtime.filter((name) => !needed.has(name)), [])
})

/* ------------------------------------------------------------- bundle budget */

function bundle(files) {
  const dist = mkdtempSync(join(tmpdir(), 'portfolio-bundle-'))
  mkdirSync(join(dist, 'assets'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, name), text)
  const run = spawnSync(process.execPath, [join(source, 'scripts/check-bundle.mjs'), dist], { encoding: 'utf8' })
  rmSync(dist, { recursive: true, force: true })
  return { status: run.status, out: run.stdout + run.stderr }
}
const page = (extra = '') =>
  `<script src="/theme-init.js"></script><script type="application/ld+json">{}</script>` +
  `<script type="module" crossorigin src="/assets/index-a.js"></script>${extra}`
const preload = (name) => `<link rel="modulepreload" crossorigin href="/assets/${name}">`
/** Random text barely compresses: gzip keeps about three quarters of it. */
const heavy = (kb) => `//${randomBytes(kb * 1000).toString('base64')}`
const base = { 'theme-init.js': '1', 'assets/index-a.js': 'import("./lazy.js")', 'assets/lazy.js': heavy(400) }

test('bundle: a first load within the budget passes; lazy chunks do not count', () => {
  const run = bundle({ ...base, 'index.html': page() })
  assert.equal(run.status, 0, run.out)
  assert.match(run.out, /2 files/)
})

test('bundle: preloads and static imports count against 160 kB gzip', () => {
  for (const files of [
    { ...base, 'index.html': page(preload('big.js')), 'assets/big.js': heavy(200) },
    { ...base, 'index.html': page(), 'assets/index-a.js': 'import{a}from"./dep.js";', 'assets/dep.js': 'import"./big.js"', 'assets/big.js': heavy(200) },
    { ...base, 'index.html': page(), 'theme-init.js': heavy(200) },
  ]) {
    const run = bundle(files)
    assert.equal(run.status, 1, run.out)
    assert.match(run.out, /over the budget/)
  }
})

test('bundle: three.js in the first load fails, by name or by content', () => {
  for (const [name, text] of [['three.core-x.js', '1'], ['vendor.js', 'console.warn("THREE.WebGLRenderer: x")']]) {
    const run = bundle({ ...base, 'index.html': page(preload(name)), [`assets/${name}`]: text })
    assert.equal(run.status, 1, run.out)
    assert.match(run.out, /three\.js/)
  }
})

test('bundle: a missing build or a missing file fails', () => {
  assert.equal(bundle({}).status, 1)
  assert.equal(bundle({ 'index.html': '<p>no scripts</p>' }).status, 1)
  assert.equal(bundle({ 'index.html': page() }).status, 1)
})

/* ----------------------------------------------------------------- CI script */

test('ci.sh: gates 1-5 in order, with a pinned, limited, throwaway PostgreSQL', () => {
  assert.ok(existsSync(join(source, 'scripts/ci.sh')))
  const text = readFileSync(join(source, 'scripts/ci.sh'), 'utf8')
  const order = ['npm ci', 'npm run typecheck', 'npm test', 'TEST_DATABASE_URL="postgres', 'npm run build', 'scripts/check-bundle.mjs']
  const at = order.map((step) => text.search(new RegExp(`^(?!#).*${step.replace(/[.$]/g, '\\$&')}`, 'm')))
  assert.ok(at.every((n, i) => n >= 0 && (i === 0 || n > at[i - 1])), JSON.stringify(at))
  assert.match(text, /^set -eu$/m)
  assert.match(text, /postgres:17\.11-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb/)
  for (const flag of ['--pull never', '--memory', '--cpus', '--tmpfs /var/lib/postgresql/data', '-p 127.0.0.1::5432', 'docker rm -f', 'trap cleanup EXIT']) {
    assert.ok(text.includes(flag), flag)
  }
  const run = text.match(/docker run [\s\S]*?"\$PG_IMAGE"/)[0]
  assert.doesNotMatch(run, /\s(-v|--volume|--mount)\b/, 'nothing from the host is mounted')
  assert.doesNotMatch(text, /POSTGRES_PASSWORD=[^"$\s]/, 'no fixed password')
})

/* ------------------------------------------------------------ test database */

test('harness: TEST_DATABASE_URL chooses the engine, and each folder gets its own database', async () => {
  const engine = process.env.TEST_DATABASE_URL ? 'postgres' : 'sqlite'
  const [first, second] = [await start({}, scratch()), await start({}, scratch())]
  assert.equal((await first.call('/api/health')).data.storage, engine)
  await first.login('wrong')
  const failed = "SELECT COUNT(*) AS n FROM audit_log WHERE action='auth.failed'"
  assert.deepEqual([(await first.sql(failed))[0].n, (await second.sql(failed))[0].n], [1, 0])
})
