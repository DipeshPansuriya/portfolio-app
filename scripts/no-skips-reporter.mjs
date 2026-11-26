// Second reporter of the CI test gates (scripts/ci.sh, gates 3 and 4). node:test exits 0
// for a skipped or todo test, so a missing tool would hide the checks: any one fails the run.
export default async function* noSkips(source) {
  const found = []
  for await (const { type, data } of source) {
    if (type !== 'test:pass' && type !== 'test:fail') continue
    const kind = data.skip !== undefined ? 'skipped' : data.todo !== undefined ? 'todo' : ''
    if (kind) found.push(`${kind}: ${data.name} (${data.file ?? 'unknown file'})`)
  }
  if (found.length === 0) return
  process.exitCode = 1
  yield `[no-skips] FAILED: ${found.length} test(s) did not count\n${found.join('\n')}\n`
}
