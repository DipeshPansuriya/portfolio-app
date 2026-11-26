/** ADR 0002: the newest database revision is the live content; nothing else is written. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { scratch, start, source } from './harness.mjs'

const seed = JSON.parse(readFileSync(join(source, 'content/site.json'), 'utf8'))
const URLS = ['/content/site.json', '/api/content']

const withHeadline = (headline) => {
  const content = structuredClone(seed)
  content.hero.headline = headline
  return content
}
const save = (s, headers, content, note) =>
  s.call('/api/content', { method: 'PUT', headers, body: { content, note } })
const history = async (s, headers) => (await s.call('/api/content/revisions', { headers })).data.revisions

test('content: an empty database is seeded from content/site.json', async () => {
  const s = await start()
  for (const url of URLS) assert.deepEqual((await s.call(url)).data, seed, url)
  const revisions = await history(s, await s.signedIn())
  assert.deepEqual(revisions.map((r) => [r.note, r.author]), [['seed', 'system']])
})

test('content: the seed carries only a placeholder contact address', () => {
  const addresses = JSON.stringify(seed).match(/[^\s"<>:]+@[^\s"<>]+/g)
  assert.deepEqual([...new Set(addresses)], ['hello@example.com'])
})

test('content: an invalid seed stops the start and stores nothing', async () => {
  for (const bad of [JSON.stringify({ ...seed, hero: undefined }), '{not json']) {
    const root = scratch()
    writeFileSync(join(root, 'content/site.json'), bad)
    await assert.rejects(start({}, root), /content\/site\.json/)
    writeFileSync(join(root, 'content/site.json'), JSON.stringify(seed))
    const s = await start({}, root)
    assert.equal((await s.sql('SELECT COUNT(*) AS n FROM content_revisions'))[0].n, 1)
    await s.stop()
  }
})

test('content: a save is what visitors fetch next, with a new ETag', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const first = await s.call('/content/site.json')
  assert.equal(first.headers['cache-control'], 'no-cache')
  assert.ok(first.headers.etag)

  const put = await save(s, headers, withHeadline('Saved headline'), 'n')
  assert.equal(put.status, 200, put.raw.toString())
  const newest = (await history(s, headers))[0]
  assert.deepEqual(put.data, { ok: true, revision: Number(newest.id) })

  for (const url of URLS) {
    const live = await s.call(`${url}?t=1`, { headers: { 'if-none-match': first.headers.etag } })
    assert.equal(live.status, 200, url)
    assert.equal(live.data.hero.headline, 'Saved headline', url)
    assert.notEqual(live.headers.etag, first.headers.etag)
    const again = await s.call(url, { headers: { 'if-none-match': live.headers.etag } })
    assert.equal(again.status, 304, url)
    assert.equal(again.raw.length, 0)
  }
})

test('content: the live copy is compressed and honours HEAD and method rules', async () => {
  const s = await start()
  const br = await s.call('/content/site.json', { headers: { 'accept-encoding': 'br' } })
  assert.equal(br.headers['content-encoding'], 'br')
  assert.equal(br.headers.vary, 'Accept-Encoding')
  assert.deepEqual(JSON.parse(brotliDecompressSync(br.raw)), seed)
  const head = await s.call('/content/site.json', { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.raw.length, 0)
  assert.equal((await s.call('/content/site.json', { method: 'POST' })).status, 405)
})

test('content: the API serves the live copy in development too, for the Vite proxy', async () => {
  const s = await start({ NODE_ENV: 'development' })
  assert.deepEqual((await s.call('/content/site.json?t=1')).data, seed)
  assert.match(readFileSync(join(source, 'vite.config.ts'), 'utf8'), /'\/content\/site\.json':/)
})

test('content: a save survives a restart, and the seed does not overwrite it', async () => {
  const first = await start()
  assert.equal((await save(first, await first.signedIn(), withHeadline('Kept'))).status, 200)
  const tag = (await first.call('/content/site.json')).headers.etag
  await first.stop()
  writeFileSync(join(first.root, 'content/site.json'), JSON.stringify(withHeadline('Newer seed')))
  const second = await start({}, first.root)
  const live = await second.call('/content/site.json')
  assert.equal(live.data.hero.headline, 'Kept')
  assert.equal(live.headers.etag, tag)
  assert.equal((await second.sql('SELECT COUNT(*) AS n FROM content_revisions'))[0].n, 2)
})

test('content: restore adds a copy of the old revision and makes it live', async () => {
  const s = await start()
  const headers = await s.signedIn()
  await save(s, headers, withHeadline('First edit'), 'n')
  await save(s, headers, withHeadline('Second edit'), 'n')
  const oldest = (await history(s, headers)).at(-1)
  const back = await s.call(`/api/content/revisions/${oldest.id}/restore`, { method: 'POST', headers })
  assert.equal(back.status, 200, back.raw.toString())
  for (const url of URLS) assert.deepEqual((await s.call(url)).data, seed, url)
  const after = await history(s, headers)
  assert.equal(after.length, 4)
  assert.equal(after[0].note, `restored #${oldest.id}`)
  const gone = await s.call('/api/content/revisions/999999/restore', { method: 'POST', headers })
  assert.equal(gone.status, 404)
})

test('content: a refused save changes nothing', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const bad = await save(s, headers, { ...seed, hero: null })
  assert.equal(bad.status, 422)
  assert.ok(bad.data.errors.length)
  assert.deepEqual((await s.call('/content/site.json')).data, seed)
  assert.equal((await history(s, headers)).length, 1)
})

test('content: 12 parallel saves all land, and the newest one is live', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => save(s, headers, withHeadline(`Parallel ${i}`))),
  )
  assert.deepEqual([...new Set(results.map((r) => r.status))], [200])
  assert.equal(new Set(results.map((r) => r.data.revision)).size, 12)
  assert.equal((await s.sql('SELECT COUNT(*) AS n FROM content_revisions'))[0].n, 13)
  const newest = (await s.sql('SELECT json FROM content_revisions ORDER BY id DESC LIMIT 1'))[0]
  assert.deepEqual((await s.call('/content/site.json')).data, JSON.parse(newest.json))
})

/** Every file under `root` except the database folder and the linked packages. */
function snapshot(root, dir = '') {
  const out = {}
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name)
    if (rel === 'data' || rel === 'node_modules') continue
    const info = lstatSync(join(root, rel))
    if (info.isDirectory()) Object.assign(out, { [`${rel}/`]: 'dir' }, snapshot(root, rel))
    else out[rel] = `${info.mtimeMs}:${createHash('sha256').update(readFileSync(join(root, rel))).digest('hex')}`
  }
  return out
}

test('content: no file outside data/ changes during a save or a restore', async () => {
  const s = await start()
  const headers = await s.signedIn()
  const before = snapshot(s.root)
  assert.equal((await save(s, headers, withHeadline('Only the database'))).status, 200)
  const oldest = (await history(s, headers)).at(-1)
  assert.equal((await s.call(`/api/content/revisions/${oldest.id}/restore`, { method: 'POST', headers })).status, 200)
  assert.deepEqual(snapshot(s.root), before)
  assert.ok(!existsSync(join(s.root, 'data/backups')))
})

test('content: the old file-writing pieces are gone', () => {
  for (const path of ['scripts/sync-content.mjs', 'scripts/normalize-content.mjs', 'src/content/defaultContent.ts']) {
    assert.ok(!existsSync(join(source, path)), path)
  }
  const { scripts } = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  for (const name of ['predev', 'prebuild', 'content:sync', 'content:normalize']) assert.equal(scripts[name], undefined, name)
})
