import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
  /** Tema bawaan per peran. Tidak dipakai bila pengguna sudah memilih sendiri. */
  applyDefault: (theme: Theme) => void
}

const STORAGE_KEY = 'tanggap.theme'

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function readSaved(): Theme | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    return null
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readSaved() ?? 'light')

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Penyimpanan tidak tersedia (mode privat); tema tetap berlaku untuk sesi ini.
    }
  }, [])

  const applyDefault = useCallback((next: Theme) => {
    if (readSaved()) return
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }, [theme, setTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, applyDefault }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme harus dipakai di dalam ThemeProvider')
  }
  return context
}
