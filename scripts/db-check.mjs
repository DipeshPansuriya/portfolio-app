#!/usr/bin/env node
/**
 * Storage smoke test.
 *
 *   npm run db:check
 *
 * Connects with whatever `DATABASE_URL` / fallback the API would use, applies
 * the schema, round-trips a row, and prints the engine, version and row counts.
 * Exits non-zero on any failure so it can gate a deploy.
 */
import { initDb, db, dbInfo, driver } from '../server/db.mjs'

const line = (label, value) => console.log(`${label.padEnd(14)} ${value}`)

try {
  const info = await initDb()
  line('engine', info.engine)
  line('target', info.target)

  if (driver.name === 'postgres') {
    const rows = await db.all('select version() as v, current_database() as db, current_user as u')
    line('server', rows[0].v.split(' on ')[0])
    line('database', rows[0].db)
    line('user', rows[0].u)
  } else {
    const row = await db.get('select sqlite_version() as v')
    line('server', `sqlite ${row.v}`)
  }

  const tables = ['users', 'sessions', 'content_revisions', 'audit_log']
  for (const table of tables) {
    const row = await db.get(`SELECT COUNT(*) AS n FROM ${table}`)
    line(table, Number(row.n))
  }

  // Round-trip through the audit table, then remove the probe row.
  const marker = `db-check-${Date.now()}`
  await db.run('INSERT INTO audit_log (at, actor, action, detail, ip) VALUES (?, ?, ?, ?, ?)', [
    new Date().toISOString(),
    'db-check',
    'probe',
    marker,
    null,
  ])
  const probe = await db.get('SELECT detail FROM audit_log WHERE detail = ?', [marker])
  if (probe?.detail !== marker) throw new Error('round-trip mismatch')
  await db.run('DELETE FROM audit_log WHERE detail = ?', [marker])
  line('round-trip', 'ok')

  await driver.close()
  process.exit(0)
} catch (err) {
  console.error('\n[db:check] failed:', err.message)
  if (err.code) console.error('[db:check] code:', err.code)
  if (driver.name === 'postgres') {
    console.error(
      '[db:check] hint: is Postgres running and is DATABASE_URL correct? ' +
        'Try `brew services start postgresql@17`.',
    )
  }
  await driver.close().catch(() => null)
  process.exit(1)
}
