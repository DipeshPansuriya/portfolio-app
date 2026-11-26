import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { SiteContent } from '../content/types'
import { api, ApiError, setCsrf } from './api'
import { useSession } from './useSession'
import { LoginPage } from './LoginPage'
import { Button, Field, FieldErrors, ProblemList, TextInput } from './fields'
import { fieldErrors, passwordErrorFields } from './fieldErrors'
import {
  ChaptersSection,
  ContactSection,
  HeroSection,
  JsonSection,
  type PendingJson,
  PrinciplesSection,
  ProfileSection,
  StackSection,
} from './sections'
import { CheckIcon, LockIcon, SaveIcon } from '../components/Icons'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'hero', label: 'Hero & stats' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'principles', label: 'Principles' },
  { id: 'contact', label: 'Contact' },
  { id: 'stack', label: 'Tech stack' },
  { id: 'json', label: 'Raw JSON' },
  { id: 'history', label: 'History' },
  { id: 'account', label: 'Account' },
] as const

type TabId = (typeof TABS)[number]['id']

type Revision = { id: number; note: string | null; author: string; created_at: string }

export function AdminApp() {
  const { state, login, logout, refresh } = useSession()

  if (state.status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-ink">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">Checking session…</p>
      </div>
    )
  }

  if (state.status === 'anon') {
    return <LoginPage onLogin={login} onExit={() => { window.location.href = '/' }} />
  }

  return <AdminShell user={state.user} onLogout={logout} onSessionRefresh={refresh} />
}

function AdminShell({
  user,
  onLogout,
  onSessionRefresh,
}: {
  user: { name: string; email: string }
  onLogout: () => Promise<void>
  onSessionRefresh: () => Promise<void>
}) {
  const [tab, setTab] = useState<TabId>('profile')
  const [draft, setDraft] = useState<SiteContent | null>(null)
  const [baseline, setBaseline] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  // Raw JSON typed but not applied. Held here so switching tabs does not lose it.
  const [pendingJson, setPendingJson] = useState<PendingJson | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [skipped, setSkipped] = useState<number[]>([])
  const [dirtyPulse, setDirtyPulse] = useState(false)
  const savedTimer = useRef<number | null>(null)
  const baseRevision = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const loaded = await api.content()
      const content = loaded.content as unknown as SiteContent
      baseRevision.current = loaded.revision
      setDraft(content)
      setBaseline(JSON.stringify(content))
      setPendingJson(null)
      setStatus('idle')
      setNotice(null)
      setProblems([])
    } catch (err) {
      setStatus('error')
      setNotice({ text: err instanceof ApiError ? err.message : 'Could not load content.', error: true })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api
      .revisions()
      .then((r) => {
        setRevisions(r.revisions)
        setSkipped(r.skipped)
      })
      .catch(() => setRevisions([]))
  }, [tab, status])

  const dirty = useMemo(() => (draft ? JSON.stringify(draft) !== baseline : false), [draft, baseline])

  useEffect(() => {
    if (!dirty) return
    setDirtyPulse(true)
    const id = window.setTimeout(() => setDirtyPulse(false), 600)
    return () => window.clearTimeout(id)
  }, [dirty])

  const unsaved = dirty || pendingJson !== null
  const chapters = draft?.chapters
  const marked = useMemo(() => fieldErrors(problems, chapters ?? []), [problems, chapters])

  useEffect(() => {
    if (notice?.error) noticeRef.current?.scrollIntoView({ block: 'center' })
  }, [notice])

  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  /** An edit makes the last save's messages stale. */
  const edited = useCallback(() => {
    setStatus('idle')
    setNotice(null)
    setProblems([])
  }, [])

  const patch = useCallback(
    (updater: (prev: SiteContent) => SiteContent) => {
      setDraft((prev) => (prev ? updater(prev) : prev))
      edited()
    },
    [edited],
  )

  const save = useCallback(async () => {
    if (!draft) return
    setStatus('saving')
    setNotice(null)
    setProblems([])
    try {
      const res = await api.save(draft, note.trim(), baseRevision.current)
      baseRevision.current = res.revision
      setBaseline(JSON.stringify(draft))
      setStatus('saved')
      setNote('')
      setNotice({
        text: `Saved as revision #${res.revision}. It is live now.`,
        error: false,
      })
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setStatus('idle'), 4000)
    } catch (err) {
      setStatus('error')
      if (err instanceof ApiError) {
        setNotice({ text: err.message, error: true })
        setProblems(err.details)
      } else {
        setNotice({ text: 'Save failed.', error: true })
      }
    }
  }, [draft, note])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty && status !== 'saving') void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, save, status])

  /** Restore, Discard and Sign out drop the form, so unsaved edits need a yes first. */
  const confirmDiscard = () => !unsaved || window.confirm('Discard your unsaved changes?')

  const signOut = async () => {
    if (confirmDiscard()) await onLogout()
  }

  async function restore(id: number) {
    if (!confirmDiscard()) return
    setStatus('saving')
    try {
      await api.restore(id)
      await load()
      setStatus('saved')
      setNotice({ text: `Restored revision #${id}.`, error: false })
    } catch (err) {
      setStatus('error')
      setNotice({ text: err instanceof ApiError ? err.message : 'Restore failed.', error: true })
    }
  }

  if (!draft) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-4 text-ink">
        <div className="max-w-sm text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">Content</p>
          <p className="mt-2 text-[13px] text-muted">
            {notice?.text ?? 'Loading the current document…'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => void load()}>Retry</Button>
            <Button variant="primary" onClick={() => void onLogout()}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg border border-line-strong bg-surface-2 text-accent">
              <LockIcon className="size-4" />
            </span>
            <div className="leading-none">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-faint">Admin</p>
              <p className="mt-1 font-display text-[13px] font-semibold tracking-tight">{user.name}</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] sm:flex ${
                unsaved
                  ? 'border-amber-400/40 bg-amber-400/10 text-warn'
                  : 'border-line text-faint'
              } ${dirtyPulse ? 'animate-pulse' : ''}`}
            >
              <span className={`size-1.5 rounded-full ${unsaved ? 'bg-warn' : 'bg-ok'}`} />
              {unsaved ? 'Unsaved' : 'Saved'}
            </span>
            <Button onClick={() => void signOut()}>Sign out</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || status === 'saving'}>
              <SaveIcon className="size-3.5" />
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative shrink-0 rounded-lg px-3 py-1.5 text-[12px] transition-colors ${
                tab === t.id ? 'text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {tab === t.id ? (
                <motion.span
                  layoutId="admin-tab"
                  className="absolute inset-0 rounded-lg border border-line bg-surface-2"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              ) : null}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        {skipped.length ? (
          <p role="alert" className="mb-4 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-warn">
            Older content is live: revision {skipped.map((id) => `#${id}`).join(', ')} failed validation when the
            server started. Check the content, then save or restore a revision.
          </p>
        ) : null}
        <div ref={noticeRef} className={notice || problems.length ? 'mb-4' : ''}>
          {notice ? (
            <p
              role={notice.error ? 'alert' : 'status'}
              className={`rounded-xl border px-3 py-2.5 text-[12px] ${
                notice.error
                  ? 'border-red-400/30 bg-red-400/10 text-danger'
                  : 'border-emerald-400/30 bg-emerald-400/10 text-ok'
              }`}
            >
              {notice.text}
            </p>
          ) : null}
          <ProblemList problems={problems} />
        </div>

        <FieldErrors.Provider value={marked}>
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
            >
              {tab === 'profile' ? <ProfileSection draft={draft} patch={patch} /> : null}
              {tab === 'hero' ? <HeroSection draft={draft} patch={patch} /> : null}
              {tab === 'chapters' ? <ChaptersSection draft={draft} patch={patch} /> : null}
              {tab === 'principles' ? <PrinciplesSection draft={draft} patch={patch} /> : null}
              {tab === 'contact' ? <ContactSection draft={draft} patch={patch} /> : null}
              {tab === 'stack' ? <StackSection draft={draft} patch={patch} /> : null}
              {tab === 'json' ? (
                <JsonSection
                  draft={draft}
                  pending={pendingJson}
                  onPending={setPendingJson}
                  onReplace={(next) => {
                    setDraft(next)
                    edited()
                  }}
                />
              ) : null}
              {tab === 'history' ? (
                <HistoryPanel revisions={revisions} onRestore={restore} busy={status === 'saving'} />
              ) : null}
              {tab === 'account' ? (
                <AccountPanel email={user.email} onChanged={onSessionRefresh} onLogout={signOut} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </FieldErrors.Provider>

        <div className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-3">
          <div className="min-w-[14rem] flex-1">
            <Field label="Revision note" hint="Optional. Shows up in History.">
              <TextInput value={note} onChange={setNote} placeholder="e.g. updated stack levels" />
            </Field>
          </div>
          <Button variant="primary" onClick={() => void save()} disabled={!dirty || status === 'saving'}>
            <SaveIcon className="size-3.5" />
            {status === 'saving'
              ? 'Saving…'
              : dirty
                ? 'Save changes'
                : pendingJson
                  ? 'Apply Raw JSON first'
                  : 'No changes'}
          </Button>
          <Button
            onClick={() => {
              if (confirmDiscard()) void load()
            }}
            disabled={status === 'saving'}
          >
            Discard & reload
          </Button>
        </div>

        <p className="mt-4 pb-6 text-[11px] leading-relaxed text-faint">
          Saving stores a new revision in the database and makes it live. Visitors get the change on
          their next page load. History lists the newest 30 revisions and the first one, to restore.
        </p>
      </main>
    </div>
  )
}

function HistoryPanel({
  revisions,
  onRestore,
  busy,
}: {
  revisions: Revision[]
  onRestore: (id: number) => void
  busy: boolean
}) {
  if (!revisions.length) {
    return (
      <p className="rounded-2xl border border-line bg-surface p-5 text-[12px] text-muted">
        No revisions yet. Every save records one.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {revisions.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5"
        >
          <span className="font-mono text-[11px] text-faint">#{r.id}</span>
          <span className="flex-1 text-[12px] text-ink">{r.note || <em className="text-faint">no note</em>}</span>
          <span className="font-mono text-[10px] text-faint">{new Date(r.created_at).toLocaleString()}</span>
          <Button onClick={() => onRestore(r.id)} disabled={busy}>
            Restore
          </Button>
        </div>
      ))}
    </div>
  )
}

function AccountPanel({
  email,
  onChanged,
  onLogout,
}: {
  email: string
  onChanged: () => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<{ text: string; fields: string[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const errorFor = (field: string) => (err?.fields.includes(field) ? 'password-error' : undefined)
  /** Typing in answer to a marked field clears the message and the marks. */
  const type = (set: (value: string) => void) => (value: string) => {
    set(value)
    if (err?.fields.length) setErr(null)
  }

  async function submit() {
    setErr(null)
    setMsg(null)
    if (next !== confirm) {
      setErr({ text: 'New password and confirmation do not match.', fields: ['confirm'] })
      return
    }
    setBusy(true)
    try {
      const res = await api.changePassword(current, next)
      setCsrf(res.csrf)
      await onChanged()
      setMsg('Password updated. Other sessions were signed out.')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? { text: e.message, fields: passwordErrorFields(e.status, e.message) }
          : { text: 'Could not change the password.', fields: [] },
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">Signed in as</h2>
        <p className="mt-1 font-mono text-[12px] text-muted">{email}</p>
        <div className="mt-3">
          <Button onClick={() => void onLogout()}>Sign out of this session</Button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">Change password</h2>
        <p className="mt-1 text-[11px] leading-snug text-faint">
          Minimum 10 characters with upper, lower and a number. Changing it invalidates every other
          session.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Current">
            <TextInput
              value={current}
              onChange={type(setCurrent)}
              errorId={errorFor('current')}
              type="password"
              autoComplete="current-password"
            />
          </Field>
          <Field label="New">
            <TextInput
              value={next}
              onChange={type(setNext)}
              errorId={errorFor('next')}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm">
            <TextInput
              value={confirm}
              onChange={type(setConfirm)}
              errorId={errorFor('confirm')}
              type="password"
              autoComplete="new-password"
            />
          </Field>
        </div>
        {err ? (
          <p id="password-error" role="alert" className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-danger">
            {err.text}
          </p>
        ) : null}
        {msg ? (
          <p role="status" className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[12px] text-ok">
            <CheckIcon className="size-3.5" /> {msg}
          </p>
        ) : null}
        <div className="mt-3">
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !current || !next}>
            {busy ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </section>
    </div>
  )
}

