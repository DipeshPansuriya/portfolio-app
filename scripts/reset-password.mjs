#!/usr/bin/env node
/**
 * Local password recovery: `npm run admin:reset-password [email]`. The email comes
 * from the argument, else `ADMIN_EMAIL`, else the database's only user.
 * Replaces one user's password hash and signs that user out. Content history and
 * the audit log are kept. The new password goes to a 0600 file, never to stdout.
 */
import { initDb, driver, resetOwnerPassword } from '../server/db.mjs'

const email = (process.argv[2]?.trim() || process.env.ADMIN_EMAIL?.trim() || '').toLowerCase()

try {
  const info = await initDb()
  console.log(`[reset] storage ${info.engine} — ${info.target}`)
  const done = await resetOwnerPassword(email)
  if (done) {
    console.log(`[reset] new password for ${done.email} written to ${done.file}`)
    console.log('[reset] that user is signed out everywhere. Restart the API to clear login throttling.')
  } else {
    const why = email
      ? `No user "${email}" in this database.`
      : 'Name the user (npm run admin:reset-password <email>): there is not exactly one.'
    console.error(`[reset] ${why} Nothing was changed.`)
    process.exitCode = 1
  }
} finally {
  await driver.close()
}
