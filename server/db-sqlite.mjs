/**
 * SQLite driver — the zero-config fallback.
 *
 * Used when `DATABASE_URL` is not set, so `npm run dev:full` works on a machine
 * without PostgreSQL. Same interface as the Postgres driver, same SQL text.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );

  CREATE TABLE IF NOT EXISTS content_revisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    json       TEXT NOT NULL,
    note       TEXT,
    author     TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     TEXT NOT NULL,
    actor  TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_revisions_created ON content_revisions(created_at DESC);
`

export function createSqliteDriver(file) {
  const target = resolve(file)
  mkdirSync(dirname(target), { recursive: true })
  const isNew = !existsSync(target)
  const db = new DatabaseSync(target)
  // Password hashes live here: owner-only, set before WAL creates its side files.
  if (isNew) chmodSync(target, 0o600)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DDL)

  return {
    name: 'sqlite',
    label: target,
    // One writer at a time, and text timestamps: nothing to add.
    forShare: '',
    timestampParam: '?',
    async all(sql, params = []) {
      return db.prepare(sql).all(...params)
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params)
    },
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params)
      return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) }
    },
    async close() {
      db.close()
    },
  }
}
