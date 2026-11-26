/**
 * Local rehearsal only: saves a marker through the admin API, or checks it is live.
 *   docker compose ... exec -T -e MODE=save|expect -e MARK=<text> app node --input-type=module - < checks/content.mjs
 */
const base = `http://127.0.0.1:${process.env.PORT || 4319}`
const { MODE, MARK, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env
const json = { 'content-type': 'application/json' }
const live = async () => (await fetch(`${base}/content/site.json`)).json()
const must = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) process.exit(1)
}

if (MODE === 'save') {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  must(login.status === 200, 'sign-in 200')
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const { csrf } = await login.json()
  const content = await live()
  content.contact.heading = MARK
  const saved = await fetch(`${base}/api/content`, {
    method: 'PUT',
    headers: { ...json, cookie, 'x-csrf-token': csrf },
    body: JSON.stringify({ content, note: 'rehearsal' }),
  })
  must(saved.status === 200, `save 200 (${MARK})`)
}

must((await live()).contact.heading === MARK, `live content holds ${MARK}`)
must((await (await fetch(`${base}/`)).text()).includes(MARK), `/ shows ${MARK}`)
