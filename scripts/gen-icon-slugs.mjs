#!/usr/bin/env node
/**
 * Emits `shared/icon-slugs.ts` — just the simple-icons slugs, no path data.
 *
 * The admin editor needs the slug list for its picker, but pulling the whole
 * path registry into the admin chunk would duplicate ~100 kB of SVG. Run this
 * after regenerating `icon-paths.ts`.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src/data/icon-paths.ts')
const target = resolve(root, 'shared/icon-slugs.ts')

const raw = await readFile(source, 'utf8')
const slugs = [...raw.matchAll(/^ {2}"([a-z0-9]+)":/gm)].map((m) => m[1])

if (!slugs.length) {
  console.error('[icons] no slugs found — did icon-paths.ts change shape?')
  process.exit(1)
}

await writeFile(
  target,
  `// GENERATED from src/data/icon-paths.ts by scripts/gen-icon-slugs.mjs.
// Do not edit by hand — run \`npm run icons:slugs\` instead.
export const iconSlugs: string[] = ${JSON.stringify(slugs, null, 2)}
`,
  'utf8',
)

console.log(`[icons] ${slugs.length} slugs → shared/icon-slugs.ts`)
