import { lazy, Suspense } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { useContent } from '../content/ContentProvider'
import { RevealWords } from './Reveal'
import { ArrowDown, ArrowUpRight, PlayIcon } from './Icons'
import { scrollToSection } from '../hooks/useSmoothScroll'
import { anchorFor, splitHeadline } from '../content/text'
import { hasWebGL } from '../three/webgl'
import { ErrorBoundary } from './ErrorBoundary'
import { heroClasses } from './heroClasses'

const HeroScene = lazy(() => import('../three/HeroScene'))

/** Shown for reduced motion, without WebGL, or if the 3D scene fails. */
const sceneFallback = (
  <div className="grid h-full w-full place-items-center">
    <div className="size-[min(62vw,24rem)] rounded-full border border-line-strong bg-[radial-gradient(circle_at_35%_30%,color-mix(in_oklab,var(--accent)_30%,transparent),transparent_60%)]" />
  </div>
)

type Props = { theme: 'dark' | 'light'; onDrive: () => void; covered: boolean }

export function Hero({ theme, onDrive, covered }: Props) {
  const { content, prerendered } = useContent()
  const { profile, hero, stats, chapters } = content
  const reduced = useReducedMotion()
  // The server already painted these: animating them in again would hide them first.
  const inPlace = reduced || prerendered
  const [lead, accent] = splitHeadline(hero.headline)
  const firstChapter = anchorFor(chapters)
  const { scrollY } = useScroll()

  const sceneY = useTransform(scrollY, [0, 700], [0, 110])
  const sceneOpacity = useTransform(scrollY, [0, 560], [1, 0.12])
  const copyY = useTransform(scrollY, [0, 620], [0, 64])

  return (
    <section id="hero" className={heroClasses.section}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 grid-lines opacity-[0.35] [mask-image:radial-gradient(70%_60%_at_50%_35%,black,transparent)]" />
        <div className="absolute left-1/2 top-[-18%] size-[46rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--accent)_20%,transparent),transparent_65%)] blur-3xl" />
        <div className="absolute -right-32 top-1/3 size-[34rem] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--accent-2)_22%,transparent),transparent_65%)] blur-3xl" />
        <div className="absolute -left-24 bottom-0 size-[26rem] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--accent-3)_14%,transparent),transparent_68%)] blur-3xl" />
      </div>

      <div className={heroClasses.grid}>
        <motion.div
          style={{ y: reduced ? 0 : copyY }}
          className={heroClasses.copy}
        >
          <motion.div
            initial={inPlace ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className={heroClasses.eyebrow}
          >
            <span className={heroClasses.eyebrowDot}>
              <span className={heroClasses.eyebrowPulse} />
            </span>
            <span className={heroClasses.eyebrowText}>
              {hero.eyebrow}
            </span>
            <span className={heroClasses.eyebrowRule} />
            <span className={heroClasses.location}>
              {profile.location}
            </span>
          </motion.div>

          <h1 className={heroClasses.headline}>
            {lead && <RevealWords text={lead} className={heroClasses.lead} delay={0.1} instant={prerendered} />}
            {accent && (
              <span className={heroClasses.accent}>
                <RevealWords text={accent} delay={0.22} instant={prerendered} />
              </span>
            )}
          </h1>

          <motion.p
            initial={inPlace ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className={heroClasses.subline}
          >
            {hero.subline}
          </motion.p>

          <motion.div
            initial={inPlace ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className={heroClasses.actions}
          >
            <button
              type="button"
              onClick={onDrive}
              className={heroClasses.primary}
            >
              <PlayIcon className={heroClasses.primaryIcon} />
              <span className={heroClasses.primaryLabel}>{hero.primaryCta}</span>
              <span className={heroClasses.primarySheen} />
            </button>

            <button
              type="button"
              onClick={() => scrollToSection(firstChapter)}
              className={heroClasses.secondary}
            >
              {hero.secondaryCta}
              <ArrowUpRight className={heroClasses.secondaryIcon} />
            </button>
          </motion.div>

          <motion.dl
            initial={inPlace ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.68, ease: [0.16, 1, 0.3, 1] }}
            className={heroClasses.stats}
          >
            {stats.map((s, i) => (
              <div key={i} className={heroClasses.stat}>
                <dt className={heroClasses.statTerm}>{s.label}</dt>
                <dd>
                  <span className={heroClasses.statValue}>
                    {s.value}
                    <span className={heroClasses.statSuffix}>{s.suffix}</span>
                  </span>
                  <span className={heroClasses.statLabel}>{s.label}</span>
                </dd>
              </div>
            ))}
          </motion.dl>
        </motion.div>

        <motion.div
          style={{ y: reduced ? 0 : sceneY, opacity: reduced ? 1 : sceneOpacity }}
          className={heroClasses.scene}
          aria-hidden="true"
        >
          {!reduced && hasWebGL() ? (
            <ErrorBoundary fallback={sceneFallback}>
              <Suspense fallback={null}>
                <HeroScene
                  className="h-full w-full"
                  dark={theme === 'dark'}
                  stack={content.stack}
                  covered={covered}
                />
              </Suspense>
            </ErrorBoundary>
          ) : (
            sceneFallback
          )}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-bg lg:h-32" />
        </motion.div>
      </div>

      {/* the 3D ring is invisible to screen readers, so say the same thing in text */}
      <p className="sr-only">Technology stack: {content.stack.map((s) => s.name).join(', ')}.</p>

      {/* chapter rail — the same order the island uses */}
      <div className="relative mx-auto mt-4 w-full max-w-6xl px-4 sm:px-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="mono-label shrink-0 pr-1">Chapters</span>
          {chapters.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => scrollToSection(c.id)}
              className="group flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 transition-colors hover:border-line-strong"
            >
              <span
                className="size-1.5 rounded-full transition-transform group-hover:scale-125"
                style={{ background: c.accent }}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted group-hover:text-ink">
                {String(i + 1).padStart(2, '0')} {c.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="mono-label">Scroll or drive</span>
        <button
          type="button"
          onClick={() => scrollToSection(firstChapter)}
          aria-label="Scroll to the first chapter"
          className="grid size-9 place-items-center rounded-full border border-line text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          <ArrowDown className="size-4 animate-float" />
        </button>
      </div>
    </section>
  )
}
