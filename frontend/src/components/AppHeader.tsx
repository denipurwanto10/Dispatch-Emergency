import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import type { Role, Session } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import { Brand } from './Brand'
import { IconLogout } from './icons'
import { ThemeToggle } from './ThemeToggle'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
}

interface AppHeaderProps {
  /** Nama halaman, tampil di bawah nama aplikasi. */
  subtitle: string
  session: Session | null
  onLogout: () => void
  /** Elemen tambahan sebelum info akun (status koneksi, tautan navigasi). */
  children?: ReactNode
}

/** Header seragam untuk semua halaman setelah login. */
export function AppHeader({ subtitle, session, onLogout, children }: AppHeaderProps) {
  const user = session?.user
  const [logoutOpen, setLogoutOpen] = useState(false)
  const meta = user
    ? [ROLE_LABEL[user.role], user.operating_city].filter(Boolean).join(', ')
    : ''

  function confirmLogout() {
    setLogoutOpen(false)
    toast.info('Anda telah keluar')
    onLogout()
  }

  return (
    <>
      <header className="app-header">
        <Brand sub={subtitle} />

        <div className="app-header-right">
          {children}

          {user ? (
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <div className="user-chip-text">
                <span className="user-chip-name">{user.name}</span>
                <span className="user-chip-role">{meta}</span>
              </div>
            </div>
          ) : null}

          <ThemeToggle />

          <button className="button button-ghost button-logout" type="button" onClick={() => setLogoutOpen(true)}>
            <IconLogout />
            <span>Keluar</span>
          </button>
        </div>
      </header>

      <ConfirmDialog
        open={logoutOpen}
        title="Keluar dari Tanggap?"
        description="Sesi Anda di perangkat ini akan diakhiri. Anda perlu masuk lagi untuk melanjutkan."
        confirmLabel="Keluar"
        cancelLabel="Batal"
        icon={<IconLogout size={20} />}
        onConfirm={confirmLogout}
        onCancel={() => setLogoutOpen(false)}
      />
    </>
  )
}
