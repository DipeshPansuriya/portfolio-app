#!/usr/bin/env node
/**
 * One command for local development: starts the admin API, waits for it to
 * answer /api/health, then starts Vite (which proxies /api to it).
 *
 *   npm run dev:full
 *
 * Ctrl-C stops both.
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.PORT || '4319'
const VITE_PORT = process.env.VITE_PORT || '4318'

const children = []
let shuttingDown = false

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)

  const tag = `[${name}]`
  const pipe = (stream, out) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) out.write(`${tag} ${line}\n`)
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)

  child.on('exit', (code) => {
    if (shuttingDown) return
    console.log(`${tag} exited with code ${code}`)
    shutdown(code ?? 0)
  })
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

start('api', process.execPath, ['server/index.mjs'], { PORT })

let ready = false
for (let i = 0; i < 40; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`)
    if (res.ok) {
      ready = true
      break
    }
  } catch {
    /* not up yet */
  }
  await sleep(250)
}

if (!ready) {
  console.error(`[dev:full] admin API did not answer on :${PORT} — is the port taken?`)
  shutdown(1)
} else {
  start('vite', process.execPath, [
    resolve(root, 'node_modules/vite/bin/vite.js'),
    '--port',
    VITE_PORT,
    '--strictPort',
    '--host',
    '127.0.0.1',
  ], { ADMIN_ORIGIN: `http://127.0.0.1:${PORT}` })
}
