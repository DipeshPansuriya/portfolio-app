import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import { heroClasses } from './heroClasses'

type Props = {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
  once?: boolean
}

/** Fade + rise on first scroll into view. */
export function Reveal({ children, className, delay = 0, y = 26, once = true }: Props) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-12% 0px -12% 0px' }}
      transition={{ duration: 0.85, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** Word-by-word rise used for headline copy. */
export function RevealWords({
  text,
  className,
  wordClassName,
  delay = 0,
  instant = false,
}: {
  /** Already on screen (server-rendered): no entrance. */
  instant?: boolean
  text: string
  className?: string
  wordClassName?: string
  delay?: number
}) {
  const reduced = useReducedMotion()
  const words = text.split(' ')

  return (
    <span className={className}>
      {/* aria-label is ignored on a plain span, so give screen readers real text */}
      <span className="sr-only">{text} </span>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} aria-hidden="true" className={heroClasses.wordMask}>
          <motion.span
            className={`${heroClasses.word} ${wordClassName ?? ''}`}
            initial={reduced || instant ? false : { y: '108%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            transition={{
              duration: 1,
              delay: delay + i * 0.055,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {word}
            {i < words.length - 1 ? '\u00A0' : ''}
          </motion.span>
        </span>
      ))}
    </span>
  )
}
