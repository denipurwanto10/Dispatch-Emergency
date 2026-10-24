import { Toaster } from 'sonner'

import { useTheme } from '../context/ThemeContext'

/**
 * Toaster global. Ditempatkan sekali di main.tsx agar notifikasi tetap tampil
 * saat berpindah halaman (mis. toast logout setelah diarahkan ke /login).
 */
export function AppToaster() {
  const { theme } = useTheme()

  return (
    <Toaster
      className="app-toaster"
      theme={theme}
      position="bottom-right"
      closeButton
      richColors
      duration={3600}
      offset={16}
      mobileOffset={12}
      toastOptions={{
        classNames: {
          toast: 'app-toast',
          title: 'app-toast-title',
          description: 'app-toast-desc',
          closeButton: 'app-toast-close',
        },
      }}
    />
  )
}
