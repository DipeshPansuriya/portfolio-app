import { useContent } from '../content/ContentProvider'
import { scrollToSection } from '../hooks/useSmoothScroll'
import { ArrowUpRight } from './Icons'

const year = new Date().getFullYear()

export function Footer() {
  const { content } = useContent()
  const { profile, chapters } = content

  return (
    <footer className="relative border-t border-line px-4 pb-8 pt-10 sm:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-md border border-line-strong bg-surface-2 font-mono text-[10px]">
                {profile.initials}
              </span>
              <span className="font-display text-[13px] font-medium tracking-tight">{profile.name}</span>
            </div>
            <p className="mt-3 max-w-xs text-[12px] leading-relaxed text-faint">
              {profile.tagline}
            </p>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <div>
              <p className="mono-label">Chapters</p>
              <div className="mt-2 flex flex-col items-start gap-1.5">
                {chapters.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => scrollToSection(c.id)}
                    className="py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mono-label">Elsewhere</p>
              <div className="mt-2 flex flex-col items-start gap-1.5">
                {profile.socials.map((s, i) => (
                  <a
                    key={i}
                    href={s.href}
                    target={s.href.startsWith('http') ? '_blank' : undefined}
                    rel="noreferrer noopener"
                    className="group inline-flex items-center gap-1 py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
                  >
                    {s.label}
                    <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            © {year} {profile.name} — built with React, Three.js & Tailwind
          </p>
          <div className="flex items-center gap-4">
            <a
              href="/admin"
              className="py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-ink"
            >
              Admin
            </a>
            <button
              type="button"
              onClick={() => scrollToSection('hero')}
              className="w-fit py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-ink"
            >
              Back to top ↑
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
