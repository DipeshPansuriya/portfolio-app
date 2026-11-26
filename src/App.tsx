import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { Chapters } from './components/Chapters'
import { Contact } from './components/Contact'
import { Footer } from './components/Footer'
import { CursorGlow, GrainOverlay } from './components/Atmosphere'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DriveFallback } from './game/DriveFallback'
import { ContentProvider, useContent } from './content/ContentProvider'
import { anchorFor } from './content/text'
import { useTheme } from './hooks/useTheme'
import { getLenis, useSmoothScroll } from './hooks/useSmoothScroll'

/** The game (and its three.js code) is only fetched the first time it is opened. */
const DriveMode = lazy(() => import('./game/DriveMode').then((m) => ({ default: m.DriveMode })))

function Shell() {
  const { theme, toggle } = useTheme()
  const { content } = useContent()
  const [drive, setDrive] = useState(false)
  const [driveLoaded, setDriveLoaded] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  useSmoothScroll()

  const openDrive = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null
    setDriveLoaded(true)
    setDrive(true)
  }, [])
  const closeDrive = useCallback(() => setDrive(false), [])

  // While the game is open the page must not scroll; afterwards focus returns.
  useEffect(() => {
    if (drive) {
      getLenis()?.stop()
      return () => getLenis()?.start()
    }
    opener.current?.focus({ preventScroll: true })
    opener.current = null
  }, [drive])

  // One long word or address wraps, also in grid and flex columns, instead of widening or leaving them.
  return (
    <div className="relative min-h-screen bg-bg text-ink wrap-anywhere">
      {/* inert takes the whole page out of tab order and the accessibility tree */}
      <div inert={drive}>
        <a
          href={`#${anchorFor(content.chapters)}`}
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-70 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-3 focus:text-sm focus:text-bg"
        >
          Skip to content
        </a>

        <CursorGlow />
        <GrainOverlay />
        <Nav
          theme={theme}
          onToggleTheme={toggle}
          chapters={content.chapters}
          profile={content.profile}
          onDrive={openDrive}
        />

        <main id="main" className="relative z-10">
          <Hero theme={theme} onDrive={openDrive} covered={drive} />
          <Chapters onDrive={openDrive} />
          <Contact />
        </main>

        <Footer />
      </div>

      {driveLoaded && (
        <ErrorBoundary fallback={drive ? <DriveFallback onExit={closeDrive} /> : null}>
          <Suspense
            fallback={
              drive ? (
                <div role="status" className="fixed inset-0 z-80 grid place-items-center bg-bg">
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
                    Building the island
                  </span>
                </div>
              ) : null
            }
          >
            <DriveMode open={drive} onClose={closeDrive} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ContentProvider>
      <Shell />
    </ContentProvider>
  )
}
