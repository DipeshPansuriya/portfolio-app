import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SiteContent } from './types'
import seed from '../../content/site.json'
import { shapeProblem } from './validate'

type Ctx = {
  content: SiteContent
  /** The server painted the hero from this content before the scripts ran. */
  prerendered: boolean
}

const ContentContext = createContext<Ctx | null>(null)

const SOURCE = `${import.meta.env.BASE_URL}content/site.json`

/** Frozen in at build time: shown until the live copy arrives, or if it cannot be read. */
const defaultContent = seed as SiteContent

/** The live content the server put into `/` (ADR 0003); `null` on any other page. */
function readShellContent(): SiteContent | null {
  if (typeof document === 'undefined') return null
  try {
    const json: unknown = JSON.parse(document.getElementById('site-content')?.textContent || 'null')
    return shapeProblem(json) ? null : (json as SiteContent)
  } catch {
    return null
  }
}

async function fetchContent(): Promise<SiteContent> {
  const res = await fetch(`${SOURCE}?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${SOURCE}`)
  const json: unknown = await res.json()
  const problem = shapeProblem(json)
  if (problem) throw new Error(`Invalid content: ${problem}`)
  return json as SiteContent
}

export function ContentProvider({ children }: { children: ReactNode }) {
  const [fromShell] = useState(readShellContent)
  const [content, setContent] = useState<SiteContent>(fromShell ?? defaultContent)

  useEffect(() => {
    let mounted = true
    fetchContent().then(
      (next) => mounted && setContent(next),
      // What is on screen stays: the shell's content, or the built-in copy.
      (err: unknown) => console.warn('[content] the live copy was not loaded:', err),
    )
    return () => {
      mounted = false
    }
  }, [])

  const value = useMemo<Ctx>(() => ({ content, prerendered: fromShell !== null }), [content, fromShell])

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>
}

export function useContent(): Ctx {
  const ctx = useContext(ContentContext)
  if (!ctx) throw new Error('useContent must be used inside <ContentProvider>')
  return ctx
}
