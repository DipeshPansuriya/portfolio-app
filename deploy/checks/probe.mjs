/**
 * Read-only checks of a running app, from inside its container (no published port):
 *   docker exec -i <container> node --input-type=module - < deploy/checks/probe.mjs
 */
const base = `http://127.0.0.1:${process.env.PORT || 4319}`
let failed = 0

function expect(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

async function get(path) {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(10_000) })
  return { status: res.status, headers: res.headers, text: await res.text() }
}

const ready = await get('/api/ready')
expect(ready.status === 200, '/api/ready 200')

const health = await get('/api/health')
expect(JSON.parse(health.text).storage === 'postgres', 'storage is PostgreSQL')

const home = await get('/')
expect(home.status === 200 && home.text.includes('id="site-content"'), '/ 200 with the hero shell and data block')
expect(/default-src 'self'/.test(home.headers.get('content-security-policy') || ''), 'content security policy header')
expect(/max-age=/.test(home.headers.get('strict-transport-security') || ''), 'HSTS header')
expect(home.headers.get('x-frame-options') === 'DENY', 'frame protection header')

const script = home.text.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
expect(Boolean(script) && (await get(script)).status === 200, 'page script 200')

const content = await get('/content/site.json')
expect(content.status === 200 && Array.isArray(JSON.parse(content.text).chapters), '/content/site.json 200')
expect((await get('/admin')).status === 200, '/admin 200')
expect((await get('/no-such-page')).status === 404, 'unknown page 404')

process.exit(failed ? 1 : 0)
