/**
 * Gate 8, after `scripts/reset-password.mjs` ran in the container: the new password
 * is in an owner-only file, signs in, and the first-boot one no longer does.
 * Nothing secret is printed. For throwaway containers only.
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const base = `http://127.0.0.1:${process.env.PORT || 4319}`
const file = join(process.env.CREDENTIALS_DIR, 'admin-credentials.txt')
let failed = 0

function expect(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

const signIn = async (password) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password }),
  })
  return res.status
}

const mode = statSync(file).mode & 0o777
expect(mode === 0o600, `${file} written, mode ${mode.toString(8)}`)
const password = readFileSync(file, 'utf8').match(/^password:\s+(\S+)$/m)?.[1]
expect(Boolean(password) && (await signIn(password)) === 200, 'sign-in with the new password 200')
expect((await signIn(process.env.ADMIN_PASSWORD)) === 401, 'sign-in with the old password 401')

process.exit(failed ? 1 : 0)
