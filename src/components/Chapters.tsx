import { countWord } from '../content/text'
import { motion, useReducedMotion } from 'framer-motion'
import { useContent } from '../content/ContentProvider'
import { ChapterBlock } from './ChapterBlock'
import { Reveal } from './Reveal'
import { PlayIcon } from './Icons'

export function Chapters({ onDrive }: { onDrive: () => void }) {
  const { content } = useContent()
  const { chapters, principles } = content
  const reduced = useReducedMotion()

  return (
    <section className="relative px-4 pb-8 sm:px-6">
      <div className="mx-auto w-full max-w-6xl">
        {chapters.map((chapter, i) => (
          <ChapterBlock
            key={chapter.id}
            chapter={chapter}
            index={i}
            total={chapters.length}
            onDrive={onDrive}
          />
        ))}

        {/* principles sit between the last chapter and the footer */}
        <div className="border-t border-line py-14 sm:py-16">
          <Reveal>
            <p className="mono-label">How I work</p>
          </Reveal>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {principles.map((p, i) => (
              <Reveal key={i} delay={i * 0.08}>
                <motion.div
                  whileHover={reduced ? undefined : { y: -3 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                  className="h-full rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong"
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="shrink-0 font-mono text-[10px] text-accent">{String(i + 1).padStart(2, '0')}</span>
                    <h3 className="font-display text-[14px] font-medium tracking-tight">{p.title}</h3>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{p.body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* drive banner */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(80% 130% at 12% 0%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 62%), radial-gradient(70% 110% at 92% 30%, color-mix(in oklab, var(--accent-2) 20%, transparent), transparent 64%)',
            }}
          />
          <div className="relative flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div>
              <p className="mono-label">Prefer to walk?</p>
              <p className="mt-2 max-w-md font-display text-lg font-medium leading-snug tracking-tight">
                The same {countWord(content.chapters.length)} chapters, laid out as an island you can drive across.
              </p>
            </div>
            <button
              type="button"
              onClick={onDrive}
              className="group inline-flex shrink-0 items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-medium text-bg transition-transform hover:-translate-y-0.5"
            >
              <PlayIcon className="size-3.5" />
              Enter the island
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
