import { createContext, useContext, type ChangeEvent, type ReactNode } from 'react'
import { problemId } from './fieldErrors'

/** Field path to the ids of the error lines about it (`fieldErrors`). */
export const FieldErrors = createContext<ReadonlyMap<string, string>>(new Map())

/** The ids of the error text about a field: its own `errorId`, else what the server said about `path`. */
export function useErrorText(path?: string, errorId?: string) {
  const listed = useContext(FieldErrors)
  return errorId ?? (path ? listed.get(path) : undefined)
}

/** Marks a refused input and links it to the text that says why. */
export function useInvalid(path?: string, errorId?: string) {
  const text = useErrorText(path, errorId)
  return text ? ({ 'aria-invalid': true, 'aria-describedby': text } as const) : {}
}

const SHOWN = 12

/** The refusals of the last save. Lines past the twelfth stay readable by the fields that link to them. */
export function ProblemList({ problems }: { problems: string[] }) {
  if (!problems.length) return null
  return (
    <ul className="mt-2 flex flex-col gap-1 rounded-xl border border-red-400/30 bg-red-400/5 p-3 font-mono text-[11px] text-danger">
      {problems.map((p, i) => (
        <li key={i} id={problemId(i)} className={i < SHOWN ? undefined : 'sr-only'}>
          • {p}
        </li>
      ))}
      {problems.length > SHOWN ? <li aria-hidden="true">…and {problems.length - SHOWN} more</li> : null}
    </ul>
  )
}

export function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string
  hint?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-faint">{hint}</span> : null}
    </label>
  )
}

const base =
  'w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-faint/70 focus:border-accent/60 focus:bg-bg aria-invalid:border-danger'

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  label,
  path,
  errorId,
}: {
  /** Accessible name for inputs that are not inside a `Field`. */
  label?: string
  /** Content path, to take the server's refusal of this field. */
  path?: string
  errorId?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
}) {
  const invalid = useInvalid(path, errorId)
  return (
    <input
      {...invalid}
      type={type}
      aria-label={label}
      value={value}
      autoComplete={autoComplete}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      className={base}
    />
  )
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
  path,
}: {
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  path?: string
}) {
  const invalid = useInvalid(path)
  return (
    <textarea
      {...invalid}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      className={`${base} resize-y leading-relaxed`}
    />
  )
}

export function ColorInput({
  value,
  onChange,
  path,
}: {
  value: string
  onChange: (v: string) => void
  path?: string
}) {
  const invalid = useInvalid(path)
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#4dd6f7'}
        onChange={(e) => onChange(e.target.value)}
        className="size-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
        aria-label="Pick colour"
      />
      <input
        {...invalid}
        type="text"
        aria-label="Hex colour"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} font-mono`}
      />
    </div>
  )
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max = 100,
  label,
  path,
}: {
  label?: string
  path?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  const invalid = useInvalid(path)
  return (
    <input
      {...invalid}
      type="range"
      aria-label={label}
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      // The native slider, 24 px high so a thumb can take it.
      className="h-6 w-full cursor-pointer accent-[var(--accent)] aria-invalid:outline aria-invalid:outline-danger"
    />
  )
}

export function StringList({
  items,
  onChange,
  placeholder,
  path,
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  /** Content path of the list; item `i` is `path[i]`. */
  path?: string
}) {
  const errors = useContext(FieldErrors)
  const listError = useErrorText(path)
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2.5 w-4 shrink-0 font-mono text-[10px] text-faint">{i + 1}</span>
          <input
            {...(errors.has(`${path}[${i}]`)
              ? { 'aria-invalid': true, 'aria-describedby': errors.get(`${path}[${i}]`) }
              : {})}
            aria-label={`${placeholder ?? 'Item'} ${i + 1}`}
            value={item}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...items]
              next[i] = e.target.value
              onChange(next)
            }}
            className={base}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-red-400/50 hover:text-danger"
            aria-label={`Remove item ${i + 1}`}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        // An empty list has no input to mark.
        aria-describedby={listError}
        onClick={() => onChange([...items, ''])}
        className="w-fit rounded-lg border border-dashed border-line-strong px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink"
      >
        + Add line
      </button>
    </div>
  )
}

export function Card({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
          {subtitle ? <p className="mt-1 text-[11px] leading-snug text-faint">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const styles =
    variant === 'primary'
      ? 'bg-ink text-bg hover:-translate-y-px'
      : variant === 'danger'
        ? 'border border-red-400/40 text-danger hover:bg-red-400/10'
        : 'border border-line-strong bg-surface text-ink hover:bg-surface-2'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[12px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  )
}
