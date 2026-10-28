import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { useTheme } from '../context/ThemeContext'
import type { Role, Session } from '../types'
import { Brand } from './Brand'
import { ConfirmDialog } from './ConfirmDialog'
import {
  IconClose,
  IconLogout,
  IconMap,
  IconMenu,
  IconMoon,
  IconSidebar,
  IconSliders,
  IconSun,
  IconTruck,
  type IconProps,
} from './icons'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
}

interface NavItem {
  to: string
  label: string
  icon: (props: IconProps) => ReactNode
}

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  dispatcher: [{ to: '/map', label: 'Peta operasi', icon: IconMap }],
  admin: [
    { to: '/admin', label: 'Panel admin', icon: IconSliders },
    { to: '/map', label: 'Peta operasi', icon: IconMap },
  ],
  driver: [{ to: '/driver', label: 'Layar driver', icon: IconTruck }],
}

const COLLAPSE_KEY = 'tanggap.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

interface AppShellProps {
  /** Judul halaman di header. */
  title: string
  /** Keterangan singkat di bawah judul. */
  subtitle?: string
  session: Session | null
  onLogout: () => void
  /** Elemen di kanan header (status koneksi, dsb.). */
  actions?: ReactNode
  /** Angka kecil di samping item navigasi, dengan key berupa path. */
  badges?: Record<string, number>
  /** Kelas tambahan untuk area isi. */
  contentClassName?: string
  children: ReactNode
}

/** Kerangka halaman setelah login: sidebar navigasi + header halaman + area isi. */
export function AppShell({
  title,
  subtitle,
  session,
  onLogout,
  actions,
  badges,
  contentClassName = '',
  children,
}: AppShellProps) {
  const user = session?.user
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [navOpen, setNavOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)

  const items = user ? NAV_BY_ROLE[user.role] : []

  // Drawer ponsel menutup sendiri setelah pindah halaman.
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        // Penyimpanan tidak tersedia; pilihan tetap berlaku untuk sesi ini.
      }
      return next
    })
    // Peta Leaflet perlu menghitung ulang ukurannya setelah sidebar bergerak.
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 260)
  }

  function confirmLogout() {
    setLogoutOpen(false)
    toast.info('Anda telah keluar')
    onLogout()
  }

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''} ${navOpen ? 'is-nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Navigasi utama">
        <div className="sidebar-brand">
          <Brand sub="Operasi lapangan, terpantau" />
          <button
            className="sidebar-close"
            type="button"
            aria-label="Tutup menu"
            onClick={() => setNavOpen(false)}
          >
            <IconClose size={18} />
          </button>
        </div>

        <p className="sidebar-label">Ruang kerja</p>
        <nav className="sidebar-nav">
          {items.map((item) => {
            const badge = badges?.[item.to]
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                title={item.label}
              >
                <item.icon size={19} />
                <span className="nav-text">{item.label}</span>
                {badge != null ? <span className="nav-badge">{badge}</span> : null}
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          {user ? (
            <div className="account-card" title={[ROLE_LABEL[user.role], user.operating_city].filter(Boolean).join(', ')}>
              <span className="avatar" aria-hidden="true">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <div className="account-text">
                <span className="account-name">{user.name}</span>
                <span className="account-role">
                  <i aria-hidden="true" />
                  {ROLE_LABEL[user.role]}
                </span>
              </div>
            </div>
          ) : null}

          <div className="sidebar-tools">
            <button className="side-button" type="button" onClick={toggleTheme} title={theme === 'light' ? 'Mode gelap' : 'Mode terang'}>
              {theme === 'light' ? <IconMoon size={17} /> : <IconSun size={17} />}
              <span>{theme === 'light' ? 'Gelap' : 'Terang'}</span>
            </button>
            <button className="side-button side-button--collapse" type="button" onClick={toggleCollapsed} aria-pressed={collapsed} title={collapsed ? 'Lebarkan menu' : 'Ciutkan menu'}>
              <IconSidebar size={17} />
              <span>{collapsed ? 'Lebarkan' : 'Ciutkan'}</span>
            </button>
          </div>

          <button className="side-logout" type="button" onClick={() => setLogoutOpen(true)} title="Keluar">
            <IconLogout size={17} />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      <button className="shell-scrim" type="button" aria-label="Tutup menu" tabIndex={-1} onClick={() => setNavOpen(false)} />

      <div className="shell-body">
        <header className="topbar">
          <button className="topbar-menu" type="button" aria-label="Buka menu" onClick={() => setNavOpen(true)}>
            <IconMenu size={20} />
          </button>
          <div className="topbar-title">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="topbar-actions">{actions}</div>
        </header>

        <main className={`shell-main ${contentClassName}`}>{children}</main>
      </div>

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
    </div>
  )
}
