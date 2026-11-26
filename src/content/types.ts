/**
 * Content schema. Everything the site renders comes from `SiteContent`, loaded
 * at runtime from `/content/site.json` (see `ContentProvider`).
 *
 * Keep this file free of content — it only describes shape.
 */

export type SocialLink = {
  label: string
  handle: string
  href: string
}

export type Profile = {
  name: string
  initials: string
  role: string
  tagline: string
  location: string
  timezone: string
  email: string
  availability: string
  socials: SocialLink[]
}

export type Hero = {
  eyebrow: string
  headline: string
  subline: string
  primaryCta: string
  secondaryCta: string
}

export type Stat = {
  value: string
  suffix: string
  label: string
}

/** A chapter is both a page section and a zone on the drive island. */
export type Chapter = {
  id: string
  label: string
  kicker: string
  title: string
  body: string
  bullets: string[]
  /** Any CSS colour. */
  accent: string
  hint: string
}

export type Principle = {
  title: string
  body: string
}

export type Contact = {
  heading: string
  body: string
  primaryLabel: string
}

/** One entry in the orbiting tech ring on the hero. */
export type StackItem = {
  name: string
  /** Slug from the generated simple-icons registry. */
  icon: string
  /** 0–100, sets the icon size on the ring. */
  level: number
}

/** Wording for search results and link previews; the built-in text is used without it. */
export type Meta = {
  description: string
  shareDescription: string
}

export type SiteContent = {
  /** Absent in revisions saved before it existed. */
  meta?: Meta
  profile: Profile
  hero: Hero
  stats: Stat[]
  chapters: Chapter[]
  principles: Principle[]
  contact: Contact
  stack: StackItem[]
}
