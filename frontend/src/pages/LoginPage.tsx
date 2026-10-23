import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError, login } from '../api/client'
import { homeForRole, readSession, saveSession } from '../auth/session'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const session = readSession()
    if (session) {
      navigate(homeForRole(session.user.role), { replace: true })
    }
  }, [navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const session = await login(email.trim(), password)
      saveSession(session)
      navigate(homeForRole(session.user.role), { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Tidak bisa menghubungi server. Pastikan backend sedang berjalan.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <div>
            <p className="brand-name">Dispatch</p>
            <p className="brand-sub">Emergency Response Command Center</p>
          </div>
        </div>

        <div className="login-heading">
          <p className="eyebrow">Masuk ke command center</p>
          <h1 id="login-title">Siap menerima laporan?</h1>
          <p className="muted">
            Gunakan akun yang terdaftar untuk mengakses peta kendaraan dan panel sesuai role.
          </p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              placeholder="nama@dispatch.local"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Memeriksa kredensial…' : 'Masuk'}
          </button>
        </form>

        <p className="login-foot">Akses terbatas untuk petugas Dispatch. Semua aktivitas tercatat.</p>
      </section>

      <aside className="login-aside" aria-hidden="true">
        <div className="aside-grid" />
        <div className="aside-content">
          <p className="eyebrow">Fase 1 · Foundation</p>
          <h2>Koordinasi respons dimulai dari satu layar.</h2>
          <ul>
            <li>Auth dengan role dispatcher, driver, dan admin</li>
            <li>Posisi kendaraan langsung dari PostGIS</li>
            <li>Peta operasi Bandung berbasis OpenStreetMap</li>
          </ul>
          <p className="aside-note">Dispatcher · Driver · Administrator</p>
        </div>
      </aside>
    </main>
  )
}
