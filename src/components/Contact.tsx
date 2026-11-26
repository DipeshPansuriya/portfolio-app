import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useContent } from '../content/ContentProvider'
import { CheckIcon, CopyIcon, ArrowUpRight } from './Icons'

export function Contact() {
  const { content } = useContent()
  const { profile, contact } = content
  const [copied, setCopied] = useState(false)
  const reduced = useReducedMotion()

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(profile.email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.location.href = `mailto:${profile.email}`
    }
  }

  return (
    <section id="contact-card" className="relative scroll-mt-24 px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto w-full max-w-6xl">
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(80% 120% at 15% 0%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 60%), radial-gradient(70% 110% at 90% 20%, color-mix(in oklab, var(--accent-2) 18%, transparent), transparent 62%)',
            }}
          />
          <div className="absolute inset-0 grid-lines opacity-[0.2]" aria-hidden="true" />

          <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.25fr_1fr] lg:items-center">
            <div>
              <motion.p
                initial={reduced ? false : { opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
                className="mono-label"
              >
                Direct line
              </motion.p>

              <h2
                id="contact-heading"
                className="mt-2 max-w-md font-display text-[clamp(1.5rem,3vw,2.2rem)] font-semibold leading-tight tracking-[-0.035em]"
              >
                {contact.heading}
              </h2>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href={`mailto:${profile.email}`}
                  className="group font-display text-[clamp(1.1rem,2.4vw,1.6rem)] font-semibold tracking-[-0.03em] text-ink underline-offset-[6px] transition-colors hover:text-accent hover:underline"
                >
                  {profile.email}
                </a>
                <button
                  type="button"
                  onClick={copyEmail}
                  aria-label="Copy email address"
                  className="grid size-9 place-items-center rounded-lg border border-line-strong bg-bg/50 text-muted transition-colors hover:text-ink"
                >
                  {copied ? <CheckIcon className="size-4 text-accent" /> : <CopyIcon className="size-4" />}
                </button>
                <span role="status" className="sr-only">
                  {copied ? 'Email address copied' : ''}
                </span>
              </div>

              <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">{contact.body}</p>
            </div>

            <div className="flex flex-col gap-2.5">
              <a
                href={`mailto:${profile.email}?subject=Hello`}
                className="group flex items-center justify-between rounded-xl bg-ink px-4 py-3.5 text-[13px] font-medium text-bg transition-transform duration-300 hover:-translate-y-0.5"
              >
                {contact.primaryLabel}
                <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
              {profile.socials
                .filter((s) => s.href.startsWith('http'))
                .map((s, i) => (
                  <a
                    key={i}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group flex items-center justify-between rounded-xl border border-line-strong bg-bg/40 px-4 py-3.5 text-[13px] text-ink transition-colors hover:bg-surface-2"
                  >
                    {s.label}
                    <ArrowUpRight className="size-4 text-muted transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </a>
                ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
