import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { clearSession, readSession } from '../auth/session'
import { AppHeader } from '../components/AppHeader'

interface RoleHomePageProps {
  role: 'driver' | 'admin'
}

const COPY = {
  driver: {
    title: 'Ruang driver',
    description:
      'Halaman ini akan menjadi layar tugas driver: rute, status perjalanan, dan konfirmasi tiba di lokasi. Untuk Fase 1, cukup fondasi auth dan peta armada.',
  },
  admin: {
    title: 'Panel admin',
    description:
      'Halaman ini akan menjadi pusat pengelolaan user dan armada. Untuk Fase 1, endpoint admin hanya membuktikan middleware role bekerja.',
  },
} as const

export function RoleHomePage({ role }: RoleHomePageProps) {
  const navigate = useNavigate()
  const session = readSession()

  useEffect(() => {
    if (session && session.user.role !== role) {
      navigate(session.user.role === 'dispatcher' ? '/map' : `/${session.user.role}`, { replace: true })
    }
  }, [session, role, navigate])

  function handleLogout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  const copy = COPY[role]

  return (
    <div className="home-shell">
      <AppHeader subtitle="Fase 1 · Foundation" session={session} onLogout={handleLogout} />

      <main className="home-main">
        <section className="placeholder-card">
          <p className="driver-kicker">Halaman placeholder</p>
          <h1>{copy.title}</h1>
          <p className="muted">{copy.description}</p>

          <div className="placeholder-links">
            <Link className="button button-primary" to="/map">
              Lihat peta armada
            </Link>
            <span className="muted">Login sebagai {session?.user.email ?? '—'}</span>
          </div>

          <div className="phase-list">
            <p>
              <strong>Fase 2</strong> CRUD insiden + 3 kendaraan terdekat
            </p>
            <p>
              <strong>Fase 3</strong> assignment, simulasi perjalanan, WebSocket
            </p>
            <p>
              <strong>Fase 4</strong> layar driver + panel admin penuh
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}
