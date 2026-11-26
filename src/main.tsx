import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

/**
 * `/admin` is a separate entry inside the same bundle graph: it is only fetched
 * when someone actually visits the route, so the public site never pays for it.
 */
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })))

const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin'

function Root() {
  if (!isAdmin) return <App />
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-bg text-ink">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">Loading admin…</p>
        </div>
      }
    >
      <AdminApp />
    </Suspense>
  )
}

const crashed = (
  <div className="grid min-h-screen place-items-center bg-bg px-4 text-center text-ink">
    <div role="alert">
      <p className="font-display text-lg font-semibold">Something went wrong on this page.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 rounded-xl bg-ink px-5 py-3 text-sm font-medium text-bg"
      >
        Reload
      </button>
    </div>
  </div>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={crashed}>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
