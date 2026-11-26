/** Repository layout rules from ADR 0001. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const at = (path) => new URL(`../${path}`, import.meta.url)

test('layout: server/ never imports from src/', () => {
  const offenders = readdirSync(at('server'), { recursive: true })
    .filter((name) => name.endsWith('.mjs'))
    .filter((name) => /(from\s+|import\s*\(?\s*)['"](\.\.\/)+src\//.test(readFileSync(at(`server/${name}`), 'utf8')))
  assert.deepEqual(offenders, [])
})

test('layout: shared code and the seed content sit outside src/ and public/', () => {
  assert.ok(existsSync(at('shared/icon-slugs.ts')))
  assert.ok(existsSync(at('content/site.json')))
  assert.ok(!existsSync(at('src/data/icon-slugs.ts')))
  assert.ok(!existsSync(at('public/content')))
})

test('layout: the slug generator writes into shared/', () => {
  assert.match(readFileSync(at('scripts/gen-icon-slugs.mjs'), 'utf8'), /resolve\(root, 'shared\/icon-slugs\.ts'\)/)
})
