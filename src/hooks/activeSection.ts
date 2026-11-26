/**
 * Which section the navigation highlights: the last one whose top has passed a
 * line below the header, so a short section just scrolled to is not skipped in
 * favour of the next. At the end of the page it is the last one, which may never
 * reach that line.
 */
export function currentSection(
  sections: readonly { id: string; top: number }[],
  viewportHeight: number,
  atBottom: boolean,
) {
  if (atBottom) return sections.at(-1)?.id ?? ''
  const passed = sections.filter((s) => s.top <= viewportHeight * 0.3)
  return (passed.at(-1) ?? sections[0])?.id ?? ''
}
