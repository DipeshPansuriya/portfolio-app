/** Small derivations from editable content, so nothing on the page is hard-coded. */

/**
 * `[plain line, gradient line]`. A `|` in the headline sets the split;
 * without one the second half of the words gets the gradient.
 */
export function splitHeadline(headline: string): [string, string] {
  const bar = headline.indexOf('|')
  if (bar >= 0) return [headline.slice(0, bar).trim(), headline.slice(bar + 1).trim()]
  const words = headline.trim().split(/\s+/)
  if (words.length < 3) return ['', words.join(' ')]
  const cut = Math.floor(words.length / 2)
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')]
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

export const countWord = (n: number) => WORDS[n] ?? String(n)

/** The chapter that carries the contact buttons: `contact`, else the closing one. */
export const contactChapterId = (chapters: { id: string }[]) =>
  (chapters.find((c) => c.id === 'contact') ?? chapters.at(-1))?.id

/** Where "skip to content" and "read it instead" should land. */
export const anchorFor = (chapters: { id: string }[]) => chapters[0]?.id ?? 'main'
