import { useCallback, useContext, useEffect, useState, type SelectHTMLAttributes } from 'react'
import type { Chapter, Meta, Principle, SiteContent, StackItem } from '../content/types'
import { shapeProblem } from '../content/validate'
import { firstCharacters } from '../content/text'
import { iconSlugs } from '../../shared/icon-slugs'
import { chapterToOpen } from './fieldErrors'
import {
  Button,
  Card,
  ColorInput,
  Field,
  FieldErrors,
  NumberInput,
  StringList,
  TextArea,
  TextInput,
  useInvalid,
} from './fields'
import { PlusIcon, TrashIcon } from '../components/Icons'

export type SectionProps = {
  draft: SiteContent
  patch: (updater: (prev: SiteContent) => SiteContent) => void
}

/* ------------------------------------------------------------------ profile */

export function ProfileSection({ draft, patch }: SectionProps) {
  const p = draft.profile
  const set = (key: keyof typeof p, value: string) =>
    patch((prev) => ({ ...prev, profile: { ...prev.profile, [key]: value } }))
  const setMeta = (key: keyof Meta, value: string) =>
    patch((prev) => ({
      ...prev,
      meta: { description: '', shareDescription: '', ...prev.meta, [key]: value },
    }))

  return (
    <div className="flex flex-col gap-4">
      <Card title="Identity" subtitle="Who the site is about: the nav, the footer and the page title use these.">
        <Field label="Full name">
          <TextInput path="profile.name" value={p.name} onChange={(v) => set('name', v)} />
        </Field>
        <Field label="Initials" hint="Up to three characters, used in the nav and footer marks.">
          <TextInput path="profile.initials" value={p.initials} onChange={(v) => set('initials', firstCharacters(v, 3))} />
        </Field>
        <Field label="Role">
          <TextInput path="profile.role" value={p.role} onChange={(v) => set('role', v)} />
        </Field>
        <Field label="Availability" hint="Shown only in the chapter menu, which replaces the nav links on narrow screens.">
          <TextInput path="profile.availability" value={p.availability} onChange={(v) => set('availability', v)} />
        </Field>
        <Field label="Tagline" wide hint="One sentence. Appears in the footer.">
          <TextArea path="profile.tagline" value={p.tagline} onChange={(v) => set('tagline', v)} rows={2} />
        </Field>
      </Card>

      <Card title="Reach" subtitle="Email is used by the contact card and the copy button.">
        <Field label="Email">
          <TextInput path="profile.email" value={p.email} onChange={(v) => set('email', v)} type="email" />
        </Field>
        <Field label="Location">
          <TextInput path="profile.location" value={p.location} onChange={(v) => set('location', v)} />
        </Field>
        <Field label="Timezone" hint="Not shown on the site. IANA name, e.g. Asia/Kolkata.">
          <TextInput path="profile.timezone" value={p.timezone} onChange={(v) => set('timezone', v)} />
        </Field>
      </Card>

      <Card
        title="Social links"
        subtitle="https:// opens in a new tab. mailto: and tel: open the mail client or dialer. Handles are saved but not shown."
        actions={
          <Button
            onClick={() =>
              patch((prev) => ({
                ...prev,
                profile: {
                  ...prev.profile,
                  socials: [...prev.profile.socials, { label: '', handle: '', href: '' }],
                },
              }))
            }
          >
            <PlusIcon className="size-3.5" /> Add
          </Button>
        }
      >
        <div className="flex flex-col gap-3 sm:col-span-2">
          {p.socials.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-line bg-bg/40 p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
              <TextInput
                path={`profile.socials[${i}].label`}
                value={s.label}
                label={`Link ${i + 1} name`}
                placeholder="Label"
                onChange={(v) =>
                  patch((prev) => {
                    const socials = [...prev.profile.socials]
                    socials[i] = { ...socials[i], label: v }
                    return { ...prev, profile: { ...prev.profile, socials } }
                  })
                }
              />
              <TextInput
                path={`profile.socials[${i}].handle`}
                value={s.handle}
                label={`Link ${i + 1} handle`}
                placeholder="Handle"
                onChange={(v) =>
                  patch((prev) => {
                    const socials = [...prev.profile.socials]
                    socials[i] = { ...socials[i], handle: v }
                    return { ...prev, profile: { ...prev.profile, socials } }
                  })
                }
              />
              <TextInput
                path={`profile.socials[${i}].href`}
                value={s.href}
                label={`Link ${i + 1} address`}
                placeholder="https://…"
                onChange={(v) =>
                  patch((prev) => {
                    const socials = [...prev.profile.socials]
                    socials[i] = { ...socials[i], href: v }
                    return { ...prev, profile: { ...prev.profile, socials } }
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove ${s.label || 'link'}`}
                onClick={() =>
                  patch((prev) => ({
                    ...prev,
                    profile: { ...prev.profile, socials: prev.profile.socials.filter((_, j) => j !== i) },
                  }))
                }
                className="grid size-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-red-400/50 hover:text-danger"
              >
                <TrashIcon className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Search and sharing"
        subtitle="Read by search engines and link previews. An empty field keeps the built-in text."
      >
        <Field label="Search description" wide>
          <TextArea
            path="meta.description"
            value={draft.meta?.description ?? ''}
            onChange={(v) => setMeta('description', v)}
          />
        </Field>
        <Field label="Share description" wide>
          <TextArea
            path="meta.shareDescription"
            value={draft.meta?.shareDescription ?? ''}
            onChange={(v) => setMeta('shareDescription', v)}
            rows={2}
          />
        </Field>
      </Card>
    </div>
  )
}

/* --------------------------------------------------------------------- hero */

export function HeroSection({ draft, patch }: SectionProps) {
  const h = draft.hero
  const set = (key: keyof typeof h, value: string) =>
    patch((prev) => ({ ...prev, hero: { ...prev.hero, [key]: value } }))

  return (
    <div className="flex flex-col gap-4">
      <Card title="Hero copy" subtitle="The first screen. Headline is split into two animated lines.">
        <Field label="Eyebrow">
          <TextInput path="hero.eyebrow" value={h.eyebrow} onChange={(v) => set('eyebrow', v)} />
        </Field>
        <Field label="Primary button">
          <TextInput path="hero.primaryCta" value={h.primaryCta} onChange={(v) => set('primaryCta', v)} />
        </Field>
        <Field label="Headline" wide hint="Large text: keep it under ~40 characters. A | sets where the second line starts.">
          <TextInput path="hero.headline" value={h.headline} onChange={(v) => set('headline', v)} />
        </Field>
        <Field label="Subline" wide>
          <TextArea path="hero.subline" value={h.subline} onChange={(v) => set('subline', v)} rows={3} />
        </Field>
        <Field label="Secondary button">
          <TextInput path="hero.secondaryCta" value={h.secondaryCta} onChange={(v) => set('secondaryCta', v)} />
        </Field>
      </Card>

      <Card
        title="Stats"
        subtitle="The figures under the hero buttons. Four fill one row on a wide screen."
        actions={
          <Button
            onClick={() =>
              patch((prev) => ({ ...prev, stats: [...prev.stats, { value: '', suffix: '', label: '' }] }))
            }
          >
            <PlusIcon className="size-3.5" /> Add
          </Button>
        }
      >
        <div className="flex flex-col gap-2 sm:col-span-2">
          {draft.stats.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-line bg-bg/40 p-3 sm:grid-cols-[0.7fr_0.5fr_2fr_auto]">
              <TextInput
                path={`stats[${i}].value`}
                value={s.value}
                label={`Stat ${i + 1} value`}
                placeholder="13"
                onChange={(v) =>
                  patch((prev) => {
                    const stats = [...prev.stats]
                    stats[i] = { ...stats[i], value: v }
                    return { ...prev, stats }
                  })
                }
              />
              <TextInput
                path={`stats[${i}].suffix`}
                value={s.suffix}
                label={`Stat ${i + 1} suffix`}
                placeholder="+"
                onChange={(v) =>
                  patch((prev) => {
                    const stats = [...prev.stats]
                    stats[i] = { ...stats[i], suffix: v }
                    return { ...prev, stats }
                  })
                }
              />
              <TextInput
                path={`stats[${i}].label`}
                value={s.label}
                label={`Stat ${i + 1} label`}
                placeholder="Label"
                onChange={(v) =>
                  patch((prev) => {
                    const stats = [...prev.stats]
                    stats[i] = { ...stats[i], label: v }
                    return { ...prev, stats }
                  })
                }
              />
              <button
                type="button"
                aria-label="Remove stat"
                onClick={() =>
                  patch((prev) => ({ ...prev, stats: prev.stats.filter((_, j) => j !== i) }))
                }
                className="grid size-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-red-400/50 hover:text-danger"
              >
                <TrashIcon className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* ----------------------------------------------------------------- chapters */

export function ChaptersSection({ draft, patch }: SectionProps) {
  // Keyed by position, not id: editing the id field must not collapse the panel
  // out from under the caret.
  const [open, setOpen] = useState<number | null>(0)
  const errors = useContext(FieldErrors)

  // A refused field must be on screen to be seen.
  useEffect(() => {
    setOpen((current) => chapterToOpen(errors, current))
  }, [errors])

  const move = (from: number, to: number) =>
    patch((prev) => {
      if (to < 0 || to >= prev.chapters.length) return prev
      const chapters = [...prev.chapters]
      const [item] = chapters.splice(from, 1)
      chapters.splice(to, 0, item)
      return { ...prev, chapters }
    })

  const setChapter = (index: number, updater: (c: Chapter) => Chapter) =>
    patch((prev) => {
      const chapters = [...prev.chapters]
      chapters[index] = updater(chapters[index])
      return { ...prev, chapters }
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-snug text-faint">
          Each chapter is both a page section and a zone on the drive island. Order here is the order
          of the circuit. The chapter with the id “contact” shows the email and profile buttons;
          without one, the last chapter does.
        </p>
        <Button
          onClick={() => {
            setOpen(draft.chapters.length)
            patch((prev) => ({
              ...prev,
              chapters: [
                ...prev.chapters,
                {
                  id: `chapter-${prev.chapters.length + 1}`,
                  label: 'New',
                  kicker: `Chapter ${String(prev.chapters.length + 1).padStart(2, '0')}`,
                  title: '',
                  body: '',
                  bullets: [''],
                  accent: '#4dd6f7',
                  hint: '',
                },
              ],
            }))
          }}
        >
          <PlusIcon className="size-3.5" /> Add chapter
        </Button>
      </div>

      {draft.chapters.map((c, i) => {
        const isOpen = open === i
        return (
          <section key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
            {/* wraps on a narrow phone, so the three buttons keep their size */}
            <header className="flex flex-wrap items-center gap-2 p-3">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex min-h-8 min-w-0 flex-1 basis-40 items-center gap-3 text-left"
                aria-expanded={isOpen}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.accent }} />
                <span className="font-mono text-[10px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                <span className="truncate font-display text-[13px] font-medium tracking-tight">{c.label || 'Untitled'}</span>
                <span className="min-w-0 truncate text-[11px] text-faint">{c.title}</span>
              </button>
              <div className="ml-auto flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="grid size-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:text-ink disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === draft.chapters.length - 1}
                  aria-label="Move down"
                  className="grid size-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:text-ink disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen((current) => {
                      if (current === null) return null
                      if (current === i) return null
                      return current > i ? current - 1 : current
                    })
                    patch((prev) => ({ ...prev, chapters: prev.chapters.filter((_, j) => j !== i) }))
                  }}
                  disabled={draft.chapters.length === 1}
                  aria-label="Delete chapter"
                  className="grid size-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-red-400/50 hover:text-danger disabled:opacity-30"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </div>
            </header>

            {isOpen ? (
              <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2">
                <Field label="Id" hint="Lowercase, dashes. Used for anchors and the island gate.">
                  <TextInput path={`chapters[${i}].id`} value={c.id} onChange={(v) => setChapter(i, (x) => ({ ...x, id: v }))} />
                </Field>
                <Field label="Nav label">
                  <TextInput path={`chapters[${i}].label`} value={c.label} onChange={(v) => setChapter(i, (x) => ({ ...x, label: v }))} />
                </Field>
                <Field label="Kicker">
                  <TextInput path={`chapters[${i}].kicker`} value={c.kicker} onChange={(v) => setChapter(i, (x) => ({ ...x, kicker: v }))} />
                </Field>
                <Field label="Island hint" hint="Shown under the chapter title and on its sign on the island.">
                  <TextInput path={`chapters[${i}].hint`} value={c.hint} onChange={(v) => setChapter(i, (x) => ({ ...x, hint: v }))} />
                </Field>
                <Field label="Title" wide>
                  <TextInput path={`chapters[${i}].title`} value={c.title} onChange={(v) => setChapter(i, (x) => ({ ...x, title: v }))} />
                </Field>
                <Field label="Body" wide>
                  <TextArea path={`chapters[${i}].body`} value={c.body} onChange={(v) => setChapter(i, (x) => ({ ...x, body: v }))} rows={4} />
                </Field>
                <Field label="Accent" wide>
                  <ColorInput path={`chapters[${i}].accent`} value={c.accent} onChange={(v) => setChapter(i, (x) => ({ ...x, accent: v }))} />
                </Field>
                <Field label="Bullets" wide>
                  <StringList
                    path={`chapters[${i}].bullets`}
                    items={c.bullets}
                    onChange={(bullets) => setChapter(i, (x) => ({ ...x, bullets }))}
                    placeholder="One line"
                  />
                </Field>
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

/* --------------------------------------------------------------- principles */

export function PrinciplesSection({ draft, patch }: SectionProps) {
  const setPrinciple = (index: number, updater: (p: Principle) => Principle) =>
    patch((prev) => {
      const principles = [...prev.principles]
      principles[index] = updater(principles[index])
      return { ...prev, principles }
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-snug text-faint">
          The cards under “How I work”, after the last chapter.
        </p>
        <Button
          onClick={() =>
            patch((prev) => ({ ...prev, principles: [...prev.principles, { title: '', body: '' }] }))
          }
        >
          <PlusIcon className="size-3.5" /> Add
        </Button>
      </div>

      {draft.principles.map((p, i) => (
        <section key={i} className="rounded-2xl border border-line bg-surface p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Principle ${i + 1} title`}>
              <TextInput path={`principles[${i}].title`} value={p.title} onChange={(v) => setPrinciple(i, (x) => ({ ...x, title: v }))} />
            </Field>
            <Field label="Body">
              <TextArea path={`principles[${i}].body`} value={p.body} onChange={(v) => setPrinciple(i, (x) => ({ ...x, body: v }))} rows={2} />
            </Field>
          </div>
          <div className="mt-2 flex justify-end">
            <Button
              variant="danger"
              onClick={() => patch((prev) => ({ ...prev, principles: prev.principles.filter((_, j) => j !== i) }))}
            >
              <TrashIcon className="size-3.5" /> Remove
            </Button>
          </div>
        </section>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ contact */

export function ContactSection({ draft, patch }: SectionProps) {
  const c = draft.contact
  const set = (key: keyof typeof c, value: string) =>
    patch((prev) => ({ ...prev, contact: { ...prev.contact, [key]: value } }))

  return (
    <Card title="Contact block" subtitle="The closing card above the footer.">
      <Field label="Heading" wide>
        <TextInput path="contact.heading" value={c.heading} onChange={(v) => set('heading', v)} />
      </Field>
      <Field label="Body" wide>
        <TextArea path="contact.body" value={c.body} onChange={(v) => set('body', v)} rows={3} />
      </Field>
      <Field label="Primary button label">
        <TextInput path="contact.primaryLabel" value={c.primaryLabel} onChange={(v) => set('primaryLabel', v)} />
      </Field>
    </Card>
  )
}

/* -------------------------------------------------------------------- stack */

function IconSelect({ path, ...props }: { path: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const invalid = useInvalid(path)
  return (
    <select
      {...props}
      {...invalid}
      className="w-full rounded-lg border border-line bg-bg/60 px-2 py-2 font-mono text-[11px] text-ink outline-none focus:border-accent/60 aria-invalid:border-danger"
    >
      {iconSlugs.map((slug) => (
        <option key={slug} value={slug}>
          {slug}
        </option>
      ))}
    </select>
  )
}

export function StackSection({ draft, patch }: SectionProps) {
  const setItem = (index: number, updater: (s: StackItem) => StackItem) =>
    patch((prev) => {
      const stack = [...prev.stack]
      stack[index] = updater(stack[index])
      return { ...prev, stack }
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-snug text-faint">
          Drives the orbiting logo ring on the hero. Level sets the icon size.
        </p>
        <Button
          onClick={() =>
            patch((prev) => ({ ...prev, stack: [...prev.stack, { name: '', icon: 'react', level: 70 }] }))
          }
        >
          <PlusIcon className="size-3.5" /> Add
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {draft.stack.map((s, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <TextInput path={`stack[${i}].name`} value={s.name} label={`Technology ${i + 1} name`} placeholder="Name" onChange={(v) => setItem(i, (x) => ({ ...x, name: v }))} />
              <button
                type="button"
                aria-label="Remove"
                onClick={() => patch((prev) => ({ ...prev, stack: prev.stack.filter((_, j) => j !== i) }))}
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-red-400/50 hover:text-danger"
              >
                <TrashIcon className="size-3.5" />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <IconSelect
                path={`stack[${i}].icon`}
                aria-label={`Technology ${i + 1} icon`}
                value={s.icon}
                onChange={(e) => setItem(i, (x) => ({ ...x, icon: e.target.value }))}
              />
              <span className="w-9 shrink-0 text-right font-mono text-[10px] text-faint">{s.level}</span>
            </div>
            <div className="mt-2">
              <NumberInput path={`stack[${i}].level`} value={s.level} label={`Technology ${i + 1} level`} onChange={(v) => setItem(i, (x) => ({ ...x, level: v }))} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- json */

/** Typed but not applied, plus the form it was started from. */
export type PendingJson = { text: string; base: string }

export function JsonSection({
  draft,
  pending,
  onPending,
  onReplace,
}: {
  draft: SiteContent
  pending: PendingJson | null
  onPending: (next: PendingJson | null) => void
  onReplace: (next: SiteContent) => void
}) {
  const current = JSON.stringify(draft, null, 2)
  const text = pending?.text ?? current
  const outdated = pending !== null && pending.base !== current
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback(() => {
    try {
      const parsed = JSON.parse(text) as SiteContent
      const problem = shapeProblem(parsed)
      if (problem) {
        setError(`Not applied: ${problem}.`)
        return
      }
      if (outdated && !window.confirm('The form changed after you started this edit. Replace the form with this JSON?')) {
        return
      }
      onReplace(parsed)
      onPending(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }, [text, outdated, onPending, onReplace])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] leading-snug text-faint">
          Raw document. The server checks every field before it is stored.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              if (pending && !window.confirm('Discard the unapplied JSON edits?')) return
              onPending(null)
              setError(null)
            }}
          >
            Reload from form
          </Button>
          <Button variant="primary" onClick={apply}>
            Apply to form
          </Button>
        </div>
      </div>
      <textarea
        value={text}
        aria-label="Site content as JSON"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'json-error' : undefined}
        onChange={(e) => {
          onPending({ text: e.target.value, base: pending?.base ?? current })
          setError(null)
        }}
        spellCheck={false}
        rows={26}
        className="w-full rounded-xl border border-line bg-bg/70 p-3 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-accent/60 aria-invalid:border-danger"
      />
      {error ? (
        <p id="json-error" role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      ) : pending ? (
        <p className="text-[11px] text-faint">Unapplied edits — press “Apply to form”, then Save.</p>
      ) : null}
    </div>
  )
}
