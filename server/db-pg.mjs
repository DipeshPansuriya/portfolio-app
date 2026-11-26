/**
 * PostgreSQL driver.
 *
 * One `pg.Pool`, one schema, `?` placeholders rewritten to `$n` so the rest of
 * the server keeps a single set of SQL strings shared with the SQLite driver.
 */
import pg from 'pg'

const { Pool } = pg

const DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id            serial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         text PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    ip         text,
    user_agent text
  );

  CREATE TABLE IF NOT EXISTS content_revisions (
    id         serial PRIMARY KEY,
    -- text, not jsonb: jsonb normalises key order, and the live document is
    -- served exactly as it was saved.
    json       text NOT NULL,
    note       text,
    author     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id     serial PRIMARY KEY,
    at     timestamptz NOT NULL DEFAULT now(),
    actor  text,
    action text NOT NULL,
    detail text,
    ip     text
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_revisions_created ON content_revisions(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
`

/** `?` → `$1`, `$2`, … Left-to-right, so repeated placeholders stay distinct. */
function numbered(sql) {
  let n = 0
  return sql.replace(/\?/g, () => `$${(n += 1)}`)
}

/**
 * The address for the log: user, host and database only. Anything that does not
 * parse cleanly (a raw `/`, `#` or space in a hand-set password) is not printed.
 */
function safeLabel(connectionString) {
  const url = URL.canParse(connectionString) ? new URL(connectionString) : null
  if (!url?.host || url.hash || `${url.pathname}${url.search}`.includes('@')) {
    return 'PostgreSQL (address not shown)'
  }
  const user = url.username ? `${url.username}${url.password ? ':***' : ''}@` : ''
  return `${url.protocol}//${user}${url.host}${url.pathname}`
}

export function createPostgresDriver(connectionString) {
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'portfolio-admin',
    // A hung statement must not stall the save queue for ever.
    query_timeout: 10_000,
    statement_timeout: 10_000,
  })

  // A pool error must not take the process down; log and let the next query retry.
  pool.on('error', (err) => console.error('[pg] idle client error:', err.message))

  return {
    name: 'postgres',
    label: safeLabel(connectionString),
    // Dialect: the row lock for `INSERT … SELECT`, and a typed timestamp in its select list.
    forShare: ' FOR SHARE',
    timestampParam: '?::timestamptz',
    async init() {
      await pool.query(DDL)
      const { rows } = await pool.query('select current_database() as db, version() as v')
      return rows[0]
    },
    async all(sql, params = []) {
      const { rows } = await pool.query(numbered(sql), params)
      return rows
    },
    async get(sql, params = []) {
      const { rows } = await pool.query(numbered(sql), params)
      return rows[0]
    },
    async run(sql, params = []) {
      const { rowCount } = await pool.query(numbered(sql), params)
      return { changes: rowCount ?? 0 }
    },
    async close() {
      await pool.end()
    },
  }
}
