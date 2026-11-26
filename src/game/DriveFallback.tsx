/** Shown instead of the island when 3D cannot start. Reading mode always works. */
export function DriveFallback({ onExit }: { onExit: () => void }) {
  return (
    <div className="fixed inset-0 z-90 grid place-items-center overflow-y-auto bg-bg px-4 text-ink">
      <div role="alert" className="max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="font-display text-lg font-semibold">The island could not start.</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          This browser could not run the 3D view. Everything in it is on the page too. Reloading may
          help if the site was just updated.
        </p>
        <button
          type="button"
          autoFocus
          onClick={onExit}
          className="mt-5 rounded-xl bg-ink px-5 py-3 text-sm font-medium text-bg"
        >
          Read it instead
        </button>
      </div>
    </div>
  )
}
