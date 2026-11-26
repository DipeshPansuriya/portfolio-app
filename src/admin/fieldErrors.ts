/** Which admin field each refusal belongs to, so the field can be marked and linked to its text. */

/** Element id of the line that shows problem `index`. */
export const problemId = (index: number) => `content-problem-${index}`

/** A content message starts with the path of its field, such as `stats[0].label`. */
const PATH = /^(?:meta|profile|hero|stats|chapters|principles|contact|stack)(?:\[\d+\])?(?:\.[a-z]+(?:\[\d+\])?)*/i
/** The two that name a chapter by its id instead. */
const CHAPTER_ID = /^(duplicate )?chapter id "(.*)"/

function pathsOf(problem: string, chapters: { id: string }[]): string[] {
  const named = problem.match(CHAPTER_ID)
  if (!named) return problem.match(PATH)?.slice(0, 1) ?? []
  const [, duplicate, id] = named
  const holders = chapters.flatMap((chapter, i) => (chapter.id === id ? [i] : []))
  // The first of a repeated id is the one that may keep it.
  return holders.slice(duplicate ? 1 : 0).map((i) => `chapters[${i}].id`)
}

/** Field path to the ids of its problem lines, ready for `aria-describedby`. */
export function fieldErrors(problems: string[], chapters: { id: string }[]) {
  const fields = new Map<string, string>()
  problems.forEach((problem, index) => {
    for (const path of pathsOf(problem, chapters)) {
      const before = fields.get(path)
      fields.set(path, before ? `${before} ${problemId(index)}` : problemId(index))
    }
  })
  return fields
}

/** The sign-in answers that refuse what was typed, not the timing of it. */
export const signInRefused = (status: number) => status === 400 || status === 401

/** The password-change fields a refused request is about. */
export function passwordErrorFields(status: number, message: string): ('current' | 'next')[] {
  // Another 401 means the session ended, which no field can put right.
  if (status === 401) return message.startsWith('Current password') ? ['current'] : []
  if (status === 422) return ['next']
  return status === 400 ? ['current', 'next'] : []
}
