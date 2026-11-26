/**
 * Shared black-box harness. Each server runs from a throwaway copy of the project
 * with its own database, so real data, `.env` and `content/` are never touched:
 * a SQLite file in that copy, or, with `TEST_DATABASE_URL`, a new PostgreSQL
 * database on that server (the URL's user needs CREATEDB), dropped afterwards.
 */
import { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { request } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

export const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cleanups = []
// Newest first: servers stop before their database and folder go.
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

export const PASSWORD = 'Test-Only-Passw0rd'
export const EMAIL = 'owner@example.test'

const freePort = () =>
  new Promise((done) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => done(port))
    })
  })

export function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'portfolio-test-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  cpSync(join(source, 'server'), join(root, 'server'), { recursive: true })
  cpSync(join(source, 'content'), join(root, 'content'), { recursive: true })
  cpSync(join(source, 'shared'), join(root, 'shared'), { recursive: true })
  symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'))
  mkdirSync(join(root, 'dist/assets'), { recursive: true })
  mkdirSync(join(root, 'dist/fonts'))
  mkdirSync(join(root, 'dist/content'))
  writeFileSync(join(root, 'dist/index.html'), '<!doctype html><title>spa</title>')
  writeFileSync(join(root, 'dist/assets/app-abc123.js'), 'console.log("x");\n'.repeat(500))
  writeFileSync(join(root, 'dist/fonts/a.woff2'), 'font')
  writeFileSync(join(root, 'dist/content/site.json'), '{"stale":true}')
  return root
}

const postgres = process.env.TEST_DATABASE_URL?.trim()
const databases = new Map()
/** `count(*)` is a bigint, which `pg` hands back as text; SQLite gives a number. */
const types = { getTypeParser: (oid, format) => (oid === 20 ? Number : pg.types.getTypeParser(oid, format)) }

async function query(connectionString, sql) {
  const client = new pg.Client({ connectionString, types })
  await client.connect()
  try {
    return (await client.query(sql)).rows
  } finally {
    await client.end()
  }
}

async function createDatabase() {
  const name = `portfolio_test_${randomBytes(8).toString('hex')}`
  await query(postgres, `CREATE DATABASE ${name}`)
  cleanups.push(() => query(postgres, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`))
  const url = new URL(postgres)
  url.pathname = `/${name}`
  return url.href
}

/** The setting that points a process at the test database belonging to `root`. */
export async function database(root) {
  if (!postgres) return { DSH_DB_FILE: join(root, 'data/portfolio.db') }
  if (!databases.has(root)) databases.set(root, createDatabase())
  return { DATABASE_URL: await databases.get(root) }
}

export async function start(env = {}, root = scratch()) {
  const port = await freePort()
  const db = await database(root)
  // A test that sets either variable itself is testing the choice: add nothing.
  const own = 'DSH_DB_FILE' in env || 'DATABASE_URL' in env
  const base = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    TRUST_PROXY: '0',
    PUBLIC_ORIGIN: 'https://portfolio.example.test',
    ...(own ? {} : db),
    // Many test servers share one PostgreSQL.
    PG_POOL_MAX: '2',
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: { ...base, ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: PASSWORD, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  cleanups.push(() => child.kill('SIGKILL'))
  const exited = new Promise((done) => child.once('exit', done))
  /** Clean shutdown, so a test can boot the same folder and database again. */
  const stop = () => {
    child.kill('SIGTERM')
    return exited
  }
  let log = ''
  await new Promise((ok, bad) => {
    const seen = (d) => {
      log += d
      if (log.includes('API on')) ok()
    }
    child.stdout.on('data', seen)
    child.stderr.on('data', seen)
    child.on('exit', (code) => bad(new Error(`server exited ${code}: ${log}`)))
  })
  /** Raw request: no automatic decompression, arbitrary paths. */
  const call = (path, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((ok, bad) => {
      const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
      const sent = method === 'GET' || method === 'HEAD' ? headers : { 'content-type': 'application/json', ...headers }
      const req = request({ host: '127.0.0.1', port, path, method, headers: sent }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks)
          let data = null
          try {
            data = JSON.parse(raw.toString('utf8'))
          } catch {
            /* not JSON */
          }
          ok({ status: res.statusCode, headers: res.headers, raw, data })
        })
      })
      req.on('error', bad)
      if (payload !== undefined) req.write(payload)
      req.end()
    })
  const login = (password = PASSWORD, email = EMAIL, headers = {}) =>
    call('/api/auth/login', { method: 'POST', headers, body: { email, password } })
  const signedIn = async () => {
    const res = await login()
    assert.equal(res.status, 200, res.raw.toString())
    return { cookie: res.headers['set-cookie'][0].split(';')[0], 'x-csrf-token': res.data.csrf }
  }
  /** Rows from this server's database; the same SQL has to work on both engines. */
  const sql = async (text) => {
    if (db.DATABASE_URL) return query(db.DATABASE_URL, text)
    // Writable only for the INSERT a test uses to plant a damaged row.
    const file = new DatabaseSync(db.DSH_DB_FILE, { readOnly: !text.startsWith('INSERT') })
    try {
      return file.prepare(text).all()
    } finally {
      file.close()
    }
  }
  return { root, call, login, signedIn, sql, stop, database: db, log: () => log }
}

