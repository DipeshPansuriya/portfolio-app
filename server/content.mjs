/**
 * Content store: validation, revision history and the live copy.
 *
 * The newest `content_revisions` row is the live content (ADR 0002). It is held in
 * memory, so visitors are served without a query and no file is written at runtime.
 * `content/site.json` is only the seed for an empty database.
 */
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db.mjs'
import { iconSlugs } from '../shared/icon-slugs.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const seedFile = resolve(root, 'content/site.json')

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/**
 * The known keys in canonical order, mirroring `src/content/types.ts`; any other
 * key is dropped, so nothing unvalidated reaches the public page.
 *
 * JSON objects are unordered, but the document is read by humans (Raw JSON tab,
 * exports), so every revision is stored in the same order.
 */
const KEY_ORDER = {
  root: ['meta', 'profile', 'hero', 'stats', 'chapters', 'principles', 'contact', 'stack'],
  meta: ['description', 'shareDescription'],
  profile: ['name', 'initials', 'role', 'tagline', 'location', 'timezone', 'email', 'availability', 'socials'],
  social: ['label', 'handle', 'href'],
  hero: ['eyebrow', 'headline', 'subline', 'primaryCta', 'secondaryCta'],
  stat: ['value', 'suffix', 'label'],
  chapter: ['id', 'label', 'kicker', 'title', 'body', 'bullets', 'accent', 'hint'],
  principle: ['title', 'body'],
  contact: ['heading', 'body', 'primaryLabel'],
  stack: ['name', 'icon', 'level'],
}

function reorder(value, keys) {
  if (Array.isArray(value)) return value.map((v) => reorder(v, keys))
  if (!isObj(value)) return value
  const out = {}
  for (const key of keys) if (Object.hasOwn(value, key)) out[key] = value[key]
  return out
}

export function normalizeContent(data) {
  if (!isObj(data)) return data
  const out = reorder(data, KEY_ORDER.root)
  if (isObj(out.meta)) out.meta = reorder(out.meta, KEY_ORDER.meta)
  if (isObj(out.profile)) {
    out.profile = reorder(out.profile, KEY_ORDER.profile)
    if (Array.isArray(out.profile.socials)) {
      out.profile.socials = out.profile.socials.map((s) => reorder(s, KEY_ORDER.social))
    }
  }
  if (isObj(out.hero)) out.hero = reorder(out.hero, KEY_ORDER.hero)
  if (Array.isArray(out.stats)) out.stats = out.stats.map((s) => reorder(s, KEY_ORDER.stat))
  if (Array.isArray(out.chapters)) out.chapters = out.chapters.map((c) => reorder(c, KEY_ORDER.chapter))
  if (Array.isArray(out.principles)) {
    out.principles = out.principles.map((p) => reorder(p, KEY_ORDER.principle))
  }
  if (isObj(out.contact)) out.contact = reorder(out.contact, KEY_ORDER.contact)
  if (Array.isArray(out.stack)) out.stack = out.stack.map((s) => reorder(s, KEY_ORDER.stack))
  return out
}
/** Element ids the page layout owns; a chapter using one would create a duplicate id. */
const RESERVED_IDS = new Set(['hero', 'contact-card', 'contact-heading', 'main', 'root'])

const isStr = (v) => typeof v === 'string'
const isArr = Array.isArray

/** Field-level validation. Returns a list of human-readable problems. */
export function validateContent(data) {
  const errors = []
  const need = (cond, message) => {
    if (!cond) errors.push(message)
  }

  if (!isObj(data)) return ['Content must be a JSON object']

  const { meta, profile, hero, stats, chapters, principles, contact, stack } = data

  // Optional: revisions saved before these fields existed must still boot and restore.
  if (meta !== undefined) {
    need(isObj(meta), 'meta must be an object')
    if (isObj(meta)) {
      for (const key of KEY_ORDER.meta) need(meta[key] === undefined || isStr(meta[key]), `meta.${key} must be text`)
    }
  }

  need(isObj(profile), 'profile must be an object')
  if (isObj(profile)) {
    for (const key of ['name', 'initials', 'role', 'tagline', 'location', 'timezone', 'email', 'availability']) {
      need(isStr(profile[key]) && profile[key].trim().length > 0, `profile.${key} must be a non-empty string`)
    }
    need(isStr(profile.email) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profile.email), 'profile.email must look like an email')
    need(isArr(profile.socials), 'profile.socials must be an array')
    if (isArr(profile.socials)) {
      profile.socials.forEach((s, i) => {
        need(isObj(s), `profile.socials[${i}] must be an object`)
        if (isObj(s)) {
          need(isStr(s.label) && s.label.trim(), `profile.socials[${i}].label is required`)
          // The browser refuses the whole document over this, so it must not be stored.
          need(s.handle === undefined || isStr(s.handle), `profile.socials[${i}].handle must be text`)
          need(isStr(s.href) && s.href.trim(), `profile.socials[${i}].href is required`)
          need(
            isStr(s.href) && /^(https?:\/\/|mailto:|tel:|\/)/.test(s.href),
            `profile.socials[${i}].href must start with https://, mailto:, tel: or /`,
          )
          // Browsers drop tabs and newlines and read `\` as `/`, so these leave the site.
          need(!/^\/[\t\r\n]*[/\\]/.test(s.href), `profile.socials[${i}].href must not start with //`)
        }
      })
    }
  }

  need(isObj(hero), 'hero must be an object')
  if (isObj(hero)) {
    for (const key of ['eyebrow', 'headline', 'subline', 'primaryCta', 'secondaryCta']) {
      need(isStr(hero[key]) && hero[key].trim().length > 0, `hero.${key} must be a non-empty string`)
    }
  }

  need(isArr(stats) && stats.length > 0, 'stats must be a non-empty array')
  if (isArr(stats)) {
    stats.forEach((s, i) => {
      need(isObj(s), `stats[${i}] must be an object`)
      if (isObj(s)) {
        need(isStr(s.value) && s.value.trim(), `stats[${i}].value is required`)
        need(isStr(s.suffix), `stats[${i}].suffix must be a string (may be empty)`)
        need(isStr(s.label) && s.label.trim(), `stats[${i}].label is required`)
      }
    })
  }

  need(isArr(chapters) && chapters.length > 0, 'chapters must be a non-empty array')
  if (isArr(chapters)) {
    const ids = new Set()
    chapters.forEach((c, i) => {
      need(isObj(c), `chapters[${i}] must be an object`)
      if (!isObj(c)) return
      need(isStr(c.id) && /^[a-z0-9-]+$/.test(c.id), `chapters[${i}].id must be lowercase letters, digits or dashes`)
      if (isStr(c.id)) {
        need(!ids.has(c.id), `duplicate chapter id "${c.id}"`)
        need(!RESERVED_IDS.has(c.id), `chapter id "${c.id}" is reserved by the page layout`)
        ids.add(c.id)
      }
      for (const key of ['label', 'kicker', 'title', 'body', 'hint']) {
        need(isStr(c[key]) && c[key].trim().length > 0, `chapters[${i}].${key} must be a non-empty string`)
      }
      need(isStr(c.accent) && /^#[0-9a-fA-F]{3,8}$/.test(c.accent), `chapters[${i}].accent must be a hex colour`)
      need(isArr(c.bullets) && c.bullets.length > 0, `chapters[${i}].bullets must be a non-empty array`)
      if (isArr(c.bullets)) {
        c.bullets.forEach((b, j) =>
          need(isStr(b) && b.trim().length > 0, `chapters[${i}].bullets[${j}] must be a non-empty string`),
        )
      }
    })
  }

  need(isArr(principles), 'principles must be an array')
  if (isArr(principles)) {
    principles.forEach((p, i) => {
      need(isObj(p), `principles[${i}] must be an object`)
      if (isObj(p)) {
        need(isStr(p.title) && p.title.trim(), `principles[${i}].title is required`)
        need(isStr(p.body) && p.body.trim(), `principles[${i}].body is required`)
      }
    })
  }

  need(isObj(contact), 'contact must be an object')
  if (isObj(contact)) {
    for (const key of ['heading', 'body', 'primaryLabel']) {
      need(isStr(contact[key]) && contact[key].trim().length > 0, `contact.${key} must be a non-empty string`)
    }
  }

  need(isArr(stack) && stack.length > 0, 'stack must be a non-empty array')
  if (isArr(stack)) {
    stack.forEach((s, i) => {
      need(isObj(s), `stack[${i}] must be an object`)
      if (isObj(s)) {
        need(isStr(s.name) && s.name.trim(), `stack[${i}].name is required`)
        // An unlisted slug would save fine and then silently vanish from the hero ring.
        need(
          iconSlugs.includes(s.icon),
          `stack[${i}].icon "${String(s.icon ?? '').slice(0, 40)}" is not in the bundled icon list`,
        )
        need(
          typeof s.level === 'number' && s.level >= 0 && s.level <= 100,
          `stack[${i}].level must be a number between 0 and 100`,
        )
      }
    })
  }

  return errors
}

/** The longest text a save accepts, by field path. */
const MAX_LENGTH = Object.fromEntries(
  Object.entries({
    8: 'profile.initials',
    9: 'chapters[].accent',
    20: 'stats[].suffix',
    40: 'stats[].value',
    120: `profile.name profile.role profile.location profile.timezone profile.socials[].label
      hero.eyebrow hero.primaryCta hero.secondaryCta stats[].label chapters[].id chapters[].label
      chapters[].kicker chapters[].hint contact.primaryLabel stack[].name`,
    200: 'profile.availability profile.socials[].handle hero.headline chapters[].title principles[].title contact.heading',
    254: 'profile.email',
    500: 'profile.socials[].href',
    600: `meta.description meta.shareDescription profile.tagline hero.subline chapters[].bullets[]
      principles[].body contact.body`,
    2000: 'chapters[].body',
  }).flatMap(([max, paths]) => paths.split(/\s+/).map((path) => [path, Number(max)])),
)

/** Text that is too long, or holds one half of a character pair (an emoji cut in two). */
function textProblems(value, path = '') {
  if (isStr(value)) {
    if (!value.isWellFormed()) return [`${path} holds half a character, such as a cut emoji`]
    const max = MAX_LENGTH[path.replace(/\[\d+\]/g, '[]')]
    return value.length > max ? [`${path} must be at most ${max} characters`] : []
  }
  if (isArr(value)) return value.flatMap((item, i) => textProblems(item, `${path}[${i}]`))
  if (!isObj(value)) return []
  return Object.entries(value).flatMap(([key, item]) => textProblems(item, path ? `${path}.${key}` : key))
}

/**
 * What only a save is held to, besides `validateContent`: these rules are newer
 * than stored revisions, and a stored one must still boot and restore.
 */
export function saveProblems(data) {
  const problems = textProblems(data)
  const headline = data?.hero?.headline
  // `|` only splits the headline: alone it leaves the main heading empty.
  if (isStr(headline) && headline.includes('|') && !headline.replaceAll('|', '').trim()) {
    problems.push('hero.headline needs words, not only "|"')
  }
  const chapters = isArr(data?.chapters) ? data.chapters : []
  chapters.forEach((c, i) => {
    // The server writes the content into an element with this id.
    if (c?.id === 'site-content') problems.push(`chapter id "${c.id}" is reserved by the page layout`)
    // CSS has no 5 or 7 digit colour; `validateContent` refuses the other wrong lengths.
    if (isStr(c?.accent) && /^#([0-9a-f]{5}|[0-9a-f]{7})$/i.test(c.accent)) {
      problems.push(`chapters[${i}].accent must be a hex colour of 3, 4, 6 or 8 digits`)
    }
  })
  return problems
}

/** `{ revision, body }` of the newest row. One app instance owns it. */
let live = null

export const liveContent = () => live
let skipped = []
/** Newer revisions passed over at boot, so older content is live. A new save clears them. */
export const skippedRevisions = () => skipped

let queue = Promise.resolve()

/**
 * Stores `data` as a new revision and makes it live. Calls run one at a time, so
 * the memory copy can never fall behind a later insert, and `baseRevision` (the
 * revision the editor started from) is compared with no save in between.
 */
export function publish(data, { note, author, baseRevision }) {
  const result = queue.then(async () => {
    if (baseRevision !== undefined && baseRevision !== live.revision) {
      throw Object.assign(
        new Error('The content changed since you loaded it. Discard & reload, then make your edit again.'),
        { status: 409 },
      )
    }
    const json = `${JSON.stringify(normalizeContent(data), null, 2)}\n`
    const row = await db.get(
      'INSERT INTO content_revisions (json, note, author, created_at) VALUES (?, ?, ?, ?) RETURNING id',
      [json, note ?? null, author, new Date().toISOString()],
    )
    live = { revision: Number(row.id), body: Buffer.from(json) }
    skipped = []
    return live.revision
  })
  queue = result.catch(() => null)
  return result
}

/**
 * A stored document and the text it is served as. A link handle could be stored
 * as `null` before saves refused it: it reads as empty, and the row is not rewritten.
 */
function readStored(json) {
  const data = JSON.parse(json)
  const socials = data?.profile?.socials
  const nulls = Array.isArray(socials) ? socials.filter((s) => s?.handle === null) : []
  for (const social of nulls) social.handle = ''
  return { data, body: nulls.length ? `${JSON.stringify(data, null, 2)}\n` : json }
}

/** The text to serve for a stored document, or why it cannot be served. */
function checkStored(json) {
  try {
    const { data, body } = readStored(json)
    return { body, problem: validateContent(data)[0] }
  } catch {
    return { problem: 'not JSON' }
  }
}

/**
 * Boot: the newest revision that still validates becomes live, so a damaged row
 * (a bad restore, a hand edit) never reaches the page. An empty table is filled
 * from the seed.
 */
export async function loadContent() {
  const rows = await db.all('SELECT id FROM content_revisions ORDER BY id DESC')
  for (const { id } of rows) {
    const { json } = await db.get('SELECT json FROM content_revisions WHERE id = ?', [id])
    const { body, problem } = checkStored(json)
    if (!problem) {
      live = { revision: Number(id), body: Buffer.from(body) }
      return
    }
    skipped.push(Number(id))
    console.error(`[content] revision ${id} is not valid and is not served: ${problem}`)
  }
  if (rows.length) throw new Error('No stored content revision is valid: restore the database from a backup.')

  let seed
  try {
    seed = JSON.parse(await readFile(seedFile, 'utf8'))
  } catch (err) {
    throw new Error(`content/site.json cannot be read: ${err.message}`)
  }
  const errors = validateContent(seed)
  if (errors.length) throw new Error(`content/site.json is not valid: ${errors.join('; ')}`)
  await publish(seed, { note: 'seed', author: 'system' })
}

/** The newest revisions, and always the first one: the seed stays restorable. */
export async function listRevisions(limit = 20) {
  return db.all(
    `SELECT id, note, author, created_at FROM content_revisions
     WHERE id IN (SELECT id FROM content_revisions ORDER BY id DESC LIMIT ?)
        OR id = (SELECT MIN(id) FROM content_revisions)
     ORDER BY id DESC`,
    [limit],
  )
}

export async function readRevision(id) {
  const row = await db.get(
    'SELECT id, json, note, author, created_at FROM content_revisions WHERE id = ?',
    [id],
  )
  if (!row) return null
  // The column is `text` on both engines. A hand-damaged row gives `data: null`, which fails validation.
  let data = null
  try {
    data = readStored(row.json).data
  } catch {
    /* not JSON */
  }
  return { ...row, data }
}
