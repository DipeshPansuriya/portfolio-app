/**
 * What a visitor sees before the scripts run: the text part of `Hero`, without
 * hooks, motion or `window`. `createRoot` replaces it. Keep the markup in step
 * with `Hero`; `tests/shell.test.mjs` fails when text or classes drift.
 */
import type { SiteContent } from '../content/types'
import { splitHeadline } from '../content/text'
import { heroClasses as c } from '../components/heroClasses'
import { ArrowUpRight, PlayIcon } from '../components/Icons'

function Words({ text, className }: { text: string; className?: string }) {
  const words = text.split(' ')
  return (
    <span className={className}>
      <span className="sr-only">{text} </span>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} aria-hidden="true" className={c.wordMask}>
          <span className={c.word}>
            {word}
            {i < words.length - 1 ? '\u00A0' : ''}
          </span>
        </span>
      ))}
    </span>
  )
}

export function HeroShell({ content }: { content: SiteContent }) {
  const { profile, hero, stats } = content
  const [lead, accent] = splitHeadline(hero.headline)

  return (
    <div className="relative min-h-screen bg-bg text-ink wrap-anywhere">
      <main className="relative z-10">
        <section id="hero" className={c.section}>
          <div className={c.grid}>
            <div className={c.copy}>
              <div className={c.eyebrow}>
                <span className={c.eyebrowDot}>
                  <span className={c.eyebrowPulse} />
                </span>
                <span className={c.eyebrowText}>{hero.eyebrow}</span>
                <span className={c.eyebrowRule} />
                <span className={c.location}>{profile.location}</span>
              </div>

              <h1 className={c.headline}>
                {lead && <Words text={lead} className={c.lead} />}
                {accent && (
                  <span className={c.accent}>
                    <Words text={accent} />
                  </span>
                )}
              </h1>

              <p className={c.subline}>{hero.subline}</p>

              {/* look-alikes: they become buttons when the app starts */}
              <div className={c.actions} aria-hidden="true" data-lookalike>
                <span className={c.primary}>
                  <PlayIcon className={c.primaryIcon} />
                  <span className={c.primaryLabel}>{hero.primaryCta}</span>
                  <span className={c.primarySheen} />
                </span>
                <span className={c.secondary}>
                  {hero.secondaryCta}
                  <ArrowUpRight className={c.secondaryIcon} />
                </span>
              </div>

              <dl className={c.stats}>
                {stats.map((s, i) => (
                  <div key={i} className={c.stat}>
                    <dt className={c.statTerm}>{s.label}</dt>
                    <dd>
                      <span className={c.statValue}>
                        {s.value}
                        <span className={c.statSuffix}>{s.suffix}</span>
                      </span>
                      <span className={c.statLabel}>{s.label}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            {/* holds the 3D scene's space, so the text does not move when it arrives */}
            <div className={c.scene} />
          </div>
        </section>
      </main>
    </div>
  )
}
