/** Thin client for the admin API. Cookies carry the session; CSRF goes in a header. */

export type AdminUser = { id: number; email: string; name: string }

export class ApiError extends Error {
  status: number
  details: string[]
  constructor(status: number, message: string, details: string[] = []) {
    super(message)
    this.status = status
    this.details = details
  }
}

let csrfToken = ''

export function setCsrf(token: string) {
  csrfToken = token
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  seen?: (headers: Headers) => void,
): Promise<T> {
  const headers = new Headers(init.headers)
  // The API refuses any write that is not declared as JSON, with or without a body.
  const writes = !!init.method && init.method !== 'GET'
  if (writes) headers.set('content-type', 'application/json')
  if (writes && csrfToken) headers.set('x-csrf-token', csrfToken)

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}

  if (!res.ok) {
    const message = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    const details = Array.isArray(data.errors) ? (data.errors as string[]) : []
    throw new ApiError(res.status, message, details)
  }
  seen?.(res.headers)
  return data as T
}

export const api = {
  session: () => request<{ user: AdminUser | null; csrf?: string }>('/api/auth/session'),

  login: (email: string, password: string) =>
    request<{ user: AdminUser; csrf: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  changePassword: (current: string, next: string) =>
    request<{ ok: true; csrf: string }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current, next }),
    }),

  /** The live document and the revision it is, to send back with a save. */
  content: async () => {
    let revision: number | undefined
    const content = await request<Record<string, unknown>>('/api/content', {}, (headers) => {
      const value = headers.get('x-content-revision')
      if (value) revision = Number(value)
    })
    return { content, revision }
  },

  /** Refused (409) when another save landed since `baseRevision` was loaded. */
  save: (content: unknown, note: string, baseRevision?: number) =>
    request<{ ok: true; revision: number }>('/api/content', {
      method: 'PUT',
      body: JSON.stringify({ content, note, baseRevision }),
    }),

  revisions: () =>
    request<{
      revisions: { id: number; note: string | null; author: string; created_at: string }[]
      /** Newer revisions that failed validation at boot: older content is live. */
      skipped: number[]
    }>('/api/content/revisions'),

  restore: (id: number) =>
    request<{ ok: true }>(`/api/content/revisions/${id}/restore`, { method: 'POST' }),
}
