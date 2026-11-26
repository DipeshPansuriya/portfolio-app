import { useCallback, useEffect, useState } from 'react'
import { api, setCsrf, type AdminUser } from './api'

type State =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'authed'; user: AdminUser }

/**
 * Session bootstrap. The cookie is HttpOnly, so the only way to know whether we
 * are signed in is to ask the server — one request on mount.
 */
export function useSession() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const { user, csrf } = await api.session()
      if (!user || !csrf) {
        setState({ status: 'anon' })
        return
      }
      setCsrf(csrf)
      setState({ status: 'authed', user })
    } catch {
      setState({ status: 'anon' })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const { user, csrf } = await api.login(email, password)
    setCsrf(csrf)
    setState({ status: 'authed', user })
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => null)
    setCsrf('')
    setState({ status: 'anon' })
  }, [])

  return { state, login, logout, refresh }
}
