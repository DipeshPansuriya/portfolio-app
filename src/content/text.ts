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

/** What a reader counts as characters: an emoji or an accented letter stays whole. */
const characters = (text: string) => Array.from(new Intl.Segmenter().segment(text), (part) => part.segment)

export const firstCharacters = (text: string, count: number) => characters(text).slice(0, count).join('')

/** How far a canvas may squeeze text and leave it readable. */
const SQUEEZE = 1.6

/** `text` for a gate sign `width` wide: whole while it can be squeezed in, else cut with an ellipsis. */
export function signText(text: string, width: number, measure: (text: string) => number) {
  if (measure(text) <= width * SQUEEZE) return text
  const kept = characters(text)
  while (kept.length && measure(`${kept.join('')}…`) > width * SQUEEZE) kept.pop()
  return `${kept.join('').trimEnd()}…`
}
