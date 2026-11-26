/**
 * Shape check shared by the public site and the admin's raw JSON tab: enough
 * that rendering any section cannot crash. The server validates every field.
 */
const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const isObjList = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.every(isObj)

/** Text the page or the admin forms render. Empty is fine here; the server rejects it on save. */
const TEXT: Record<string, string[]> = {
  profile: ['name', 'initials', 'role', 'tagline', 'location', 'timezone', 'email', 'availability'],
  hero: ['eyebrow', 'headline', 'subline', 'primaryCta', 'secondaryCta'],
  contact: ['heading', 'body', 'primaryLabel'],
  stats: ['value', 'suffix', 'label'],
  chapters: ['id', 'label', 'kicker', 'title', 'body', 'accent', 'hint'],
  principles: ['title', 'body'],
  stack: ['name', 'icon'],
}

function textProblem(data: Record<string, unknown>): string | null {
  for (const [section, keys] of Object.entries(TEXT)) {
    const value = data[section]
    const rows: [string, Record<string, unknown>][] = Array.isArray(value)
      ? value.map((row, i) => [`${section}[${i}]`, row])
      : [[section, value as Record<string, unknown>]]
    for (const [where, row] of rows) {
      const key = keys.find((k) => typeof row[k] !== 'string')
      if (key) return `"${where}.${key}" must be text`
    }
  }
  return null
}

export function shapeProblem(data: unknown): string | null {
  if (!isObj(data)) return 'root is not an object'

  for (const key of ['profile', 'hero', 'contact']) {
    if (!isObj(data[key])) return `"${key}" must be an object`
  }
  for (const key of ['stats', 'chapters', 'principles', 'stack']) {
    if (!isObjList(data[key])) return `"${key}" must be an array of objects`
  }
  if (!isObjList((data.profile as Record<string, unknown>).socials)) {
    return '"profile.socials" must be an array of objects'
  }
  for (const s of (data.profile as { socials: Record<string, unknown>[] }).socials) {
    if (typeof s.href !== 'string') return 'every social link needs a string "href"'
    if (typeof s.label !== 'string') return 'every social link needs a string "label"'
    if (s.handle !== undefined && typeof s.handle !== 'string') return 'a social "handle" must be text'
  }

  const chapters = data.chapters as Record<string, unknown>[]
  if (!chapters.length) return '"chapters" must be a non-empty array'
  if (!(data.stack as unknown[]).length) return '"stack" must be a non-empty array'

  const ids = new Set<string>()
  for (const chapter of chapters) {
    if (typeof chapter.id !== 'string' || !chapter.id) return 'every chapter needs a string "id"'
    if (ids.has(chapter.id)) return `duplicate chapter id "${chapter.id}"`
    ids.add(chapter.id)
    if (!Array.isArray(chapter.bullets) || !chapter.bullets.every((b) => typeof b === 'string')) {
      return `chapter "${chapter.id}" needs a "bullets" array of text`
    }
  }
  const text = textProblem(data)
  if (text) return text
  const meta = data.meta
  if (meta !== undefined && !(isObj(meta) && Object.values(meta).every((v) => typeof v === 'string'))) {
    return '"meta" must be an object of text'
  }
  const level = (data.stack as Record<string, unknown>[]).findIndex((s) => typeof s.level !== 'number')
  return level < 0 ? null : `"stack[${level}].level" must be a number`
}
