import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { ApiError } from './api'
import { TextInput } from './fields'
import { signInRefused } from './fieldErrors'
import { ArrowUpRight, LockIcon } from '../components/Icons'

export function LoginPage({
  onLogin,
  onExit,
}: {
  onLogin: (email: string, password: string) => Promise<void>
  onExit: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<{ text: string; refused: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const errorId = error?.refused ? 'login-error' : undefined

  /** Typing again clears a refusal and its marks. */
  const type = (set: (value: string) => void) => (value: string) => {
    set(value)
    if (error?.refused) setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onLogin(email.trim(), password)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { text: err.message, refused: signInRefused(err.status) }
          : { text: 'Could not reach the admin API.', refused: false },
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4 py-10 text-ink">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 grid-lines opacity-30 [mask-image:radial-gradient(60%_50%_at_50%_40%,black,transparent)]" />
        <div className="absolute left-1/2 top-0 size-[38rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--accent)_18%,transparent),transparent_65%)] blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-[26rem] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--accent-2)_16%,transparent),transparent_65%)] blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[26rem]"
      >
        <div className="glass rounded-3xl border border-line p-6 shadow-[0_40px_120px_-50px_rgba(0,0,0,0.9)] sm:p-8">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl border border-line-strong bg-surface-2 text-accent">
              <LockIcon className="size-4" />
            </span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Admin</p>
              <h1 className="font-display text-[17px] font-semibold tracking-tight">Sign in to edit</h1>
            </div>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            Content lives in one JSON document. Signing in unlocks the editor, revision history and
            password controls. The session is an HttpOnly cookie that expires after 8 hours.
          </p>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Email</span>
              <TextInput
                value={email}
                onChange={type(setEmail)}
                errorId={errorId}
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Password</span>
              <TextInput
                value={password}
                onChange={type(setPassword)}
                errorId={errorId}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••"
              />
            </label>

            {error ? (
              <p
                id="login-error"
                role="alert"
                className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-danger"
              >
                {error.text}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy || !email || !password}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-medium text-bg transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Sign in'}
              <ArrowUpRight className="size-3.5" />
            </button>
          </form>

          <button
            type="button"
            onClick={onExit}
            className="mt-2 w-full py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-ink"
          >
            ← Back to the site
          </button>
        </div>
      </motion.div>
    </div>
  )
}
