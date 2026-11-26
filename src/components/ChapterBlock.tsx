import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { useContent } from '../content/ContentProvider'
import type { Chapter } from '../content/types'
import { ArrowUpRight } from './Icons'
import { contactChapterId } from '../content/text'

type Props = {
  chapter: Chapter
  index: number
  total: number
  onDrive: () => void
}

/**
 * One chapter of the reading mode. Each block lifts and fades as it crosses the
 * viewport, and the numbered rail fills as you scroll through the list.
 */
export function ChapterBlock({ chapter, index, total, onDrive }: Props) {
  const { content } = useContent()
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })

  const lift = useTransform(scrollYProgress, [0, 0.5, 1], [26, 0, -26])
  const glow = useTransform(scrollYProgress, [0, 0.5, 1], [0.08, 0.42, 0.08])

  return (
    <motion.article
      ref={ref}
      id={chapter.id}
      style={{ y: reduced ? 0 : lift }}
      className="relative scroll-mt-28 border-t border-line py-14 sm:py-20"
    >
      <div className="grid gap-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-14">
        <div>
          <div className="flex items-center gap-3">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-lg border font-mono text-[10px]"
              style={{
                borderColor: `color-mix(in oklab, ${chapter.accent} 45%, transparent)`,
                color: `color-mix(in oklab, ${chapter.accent} var(--accent-strength), var(--ink))`,
                background: `color-mix(in oklab, ${chapter.accent} 10%, transparent)`,
              }}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="mono-label">{chapter.kicker}</span>
          </div>

          <h2 className="mt-5 font-display text-[clamp(1.8rem,3.6vw,2.8rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
            {chapter.title}
          </h2>

          <div className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            <span className="h-px w-6 shrink-0" style={{ background: chapter.accent }} />
            {chapter.hint}
          </div>
        </div>

        <div className="relative">
          <motion.div
            aria-hidden="true"
            style={{ opacity: reduced ? 0.22 : glow }}
            className="pointer-events-none absolute -left-6 -top-10 size-48 rounded-full blur-3xl"
          >
            <div
              className="size-full rounded-full"
              style={{
                background: `radial-gradient(circle, color-mix(in oklab, ${chapter.accent} 55%, transparent), transparent 70%)`,
              }}
            />
          </motion.div>

          <p className="relative text-[15px] leading-relaxed text-muted">{chapter.body}</p>

          <ul className="relative mt-5 space-y-2.5">
            {chapter.bullets.map((b, i) => (
              <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-faint">
                <span
                  className="mt-[7px] size-1 shrink-0 rounded-full"
                  style={{ background: chapter.accent }}
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {chapter.id === contactChapterId(content.chapters) && (
            <div className="relative mt-6 flex flex-wrap items-center gap-2">
              <a
                href={`mailto:${content.profile.email}`}
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-[12px] font-medium text-bg transition-transform hover:-translate-y-px"
              >
                {content.profile.email}
                <ArrowUpRight className="size-3.5" />
              </a>
              {content.profile.socials
                .filter((s) => s.href.startsWith('http'))
                .map((s, i) => (
                  <a
                    key={i}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[12px] text-ink transition-colors hover:bg-surface-2"
                  >
                    {s.label}
                    <ArrowUpRight className="size-3.5 text-muted" />
                  </a>
                ))}
              <button
                type="button"
                onClick={onDrive}
                className="inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-[12px] text-muted transition-colors hover:text-ink"
              >
                Drive this instead
                <ArrowUpRight className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-10 flex items-center gap-3">
        <div className="h-px flex-1 bg-line">
          <div
            className="h-full origin-left"
            style={{
              background: chapter.accent,
              width: `${((index + 1) / total) * 100}%`,
            }}
          />
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
          {index + 1} / {total}
        </span>
      </div>
    </motion.article>
  )
}
