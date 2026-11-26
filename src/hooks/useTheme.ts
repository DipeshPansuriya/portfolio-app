import { useCallback, useEffect, useRef, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'dp-theme'

const SYSTEM_LIGHT = '(prefers-color-scheme: light)'

/** The visitor's own choice, if they ever made one with the toggle. */
function readStored(): Theme | null {
  try {
    const stored = window.localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* storage blocked */
  }
  return null
}

const systemTheme = (): Theme => (window.matchMedia?.(SYSTEM_LIGHT).matches ? 'light' : 'dark')

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? systemTheme())
  const chosen = useRef(false)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('light', theme === 'light')
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f4f0' : '#05060a')
  }, [theme])

  // Follow the OS live until the visitor picks a theme.
  useEffect(() => {
    const media = window.matchMedia?.(SYSTEM_LIGHT)
    const follow = () => {
      if (!chosen.current && !readStored()) setTheme(systemTheme())
    }
    media?.addEventListener('change', follow)
    return () => media?.removeEventListener('change', follow)
  }, [])

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    chosen.current = true
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
    setTheme(next)
  }, [theme])

  return { theme, toggle }
}
